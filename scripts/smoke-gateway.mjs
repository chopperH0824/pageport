import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packaged = process.argv.includes('--packaged');
const archive = process.argv.includes('--archive');
let executable = process.argv.find(arg => arg.startsWith('--app='))?.slice(6);
if (archive) {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const name = `PagePort-${pkg.version}-${process.platform === 'win32' ? 'x64' : 'arm64'}-gateway`;
  const folder = await mkdtemp(path.join(tmpdir(), 'pageport-gateway-archive-'));
  if (process.platform === 'win32') execFileSync('tar.exe', ['-xf', path.resolve(`release/${name}.zip`), '-C', folder]);
  else execFileSync('ditto', ['-x', '-k', path.resolve(`release/${name}.zip`), folder]);
  const entries = await readdir(path.join(folder, name));
  if (!entries.includes(`Start PagePort.${process.platform === 'win32' ? 'cmd' : 'command'}`)) throw new Error('Gateway launcher missing.');
  executable = path.join(folder, name, process.platform === 'win32' ? 'app/PagePort.exe' : 'PagePort.app/Contents/MacOS/PagePort');
}
executable ||= packaged ? path.resolve(process.platform === 'win32' ? 'release/win-unpacked/PagePort.exe' : 'release/mac-arm64/PagePort.app/Contents/MacOS/PagePort') : require('electron');
const output = path.resolve(process.env.PAGEPORT_SMOKE_DIR || await mkdtemp(path.join(tmpdir(), 'pageport-gateway-check-')));
const env = { ...process.env, PAGEPORT_SMOKE_DIR: output };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [...(!packaged && !archive && !process.argv.some(a => a.startsWith('--app=')) ? ['.'] : []), '--gateway', '--gateway-smoke'], { env, stdio: 'inherit' });
const timer = setTimeout(() => child.kill(), 180000);
const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
clearTimeout(timer);
if (code !== 0) throw new Error(`Gateway smoke exited with ${code}.`);
const state = JSON.parse(await readFile(path.join(output, 'gateway-smoke.json'), 'utf8'));
if (!state.passed || state.saving.length !== 3 || !state.saving.every(s => s.passed)) throw new Error('Gateway browser verification failed.');
console.log('Gateway authentication, browser editing, three image-preserving downloads and responsive layout passed.');
