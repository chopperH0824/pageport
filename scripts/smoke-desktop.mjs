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
const output = process.env.PAGEPORT_SMOKE_DIR || await mkdtemp(path.join(tmpdir(), 'pageport-check-'));
const args = [...(packaged || installed ? [] : ['.']), '--smoke', '--smoke-toc', '--smoke-editor', '--smoke-updates'];
const child = spawn(executable, args, { stdio: 'inherit', env: { ...process.env, PAGEPORT_SMOKE_DIR: output } });
const timer = setTimeout(() => { child.kill(); }, 120000);
const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
clearTimeout(timer);
if (code !== 0) throw new Error(`Desktop smoke exited with ${code}.`);
const state = JSON.parse(await readFile(path.join(output, 'desktop-smoke.json'), 'utf8'));
if (!state.toc?.passed || !state.editor?.passed || !state.updates?.passed || state.toc.narrowOverflow) throw new Error('Desktop smoke assertions failed.');
console.log('Desktop editing, TOC, search, narrow window and update UI checks passed.');
