import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packaged = process.argv.includes('--packaged');
const installed = process.argv.find(arg => arg.startsWith('--app='))?.slice(6);
const executable = installed || (packaged
  ? process.platform === 'win32' ? path.resolve('release/win-unpacked/PagePort.exe')
    : path.resolve('release/mac-arm64/PagePort.app/Contents/MacOS/PagePort')
  : require('electron'));
if(packaged || installed) {
  const archive=process.platform==='win32'
    ? path.join(path.dirname(executable),'resources/app.asar')
    : path.resolve(path.dirname(executable),'../Resources/app.asar');
  const asar=require('@electron/asar');
  const allowed=new Set(['desktop','server','dist','node_modules','package.json','LICENSE','THIRD_PARTY_NOTICES.md']);
  for(const entry of asar.listPackage(archive)) {
    const root=entry.replaceAll('\\','/').split('/').filter(Boolean)[0];
    if(!allowed.has(root))throw new Error('Unexpected content in application archive.');
  }
  console.log('Packaged application roots match the public runtime allowlist.');
}
const output = process.env.PAGEPORT_SMOKE_DIR || await mkdtemp(path.join(tmpdir(), 'pageport-check-'));
const args = [...(packaged || installed ? [] : ['.']), '--smoke', '--smoke-toc', '--smoke-editor', '--smoke-updates'];
const child = spawn(executable, args, { stdio: 'inherit', env: { ...process.env, PAGEPORT_SMOKE_DIR: output } });
const timer = setTimeout(() => { child.kill(); }, 120000);
const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
clearTimeout(timer);
if (code !== 0) throw new Error(`Desktop smoke exited with ${code}.`);
const state = JSON.parse(await readFile(path.join(output, 'desktop-smoke.json'), 'utf8'));
if (!state.brand?.loaded || state.brand.source !== '/brand.png' ||
  state.brand.blue !== '#2463eb' || state.brand.mint !== '#008a78') throw new Error('Desktop brand assets or theme are missing.');
if (!state.toc?.passed || !state.editor?.passed || !state.updates?.passed || !state.settings?.passed ||
  !state.backups?.passed || !state.focusRestore ||
  !state.spacing?.every(item=>item.passed) || state.toc.narrowOverflow) throw new Error('Desktop smoke assertions failed.');
console.log('Desktop editing, TOC, search, document spacing, backups, focus restore, settings and update UI checks passed.');
