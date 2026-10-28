import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('Windows installer verification requires Windows.');
const root = await mkdtemp(path.join(tmpdir(), 'pageport-installer-'));
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
try {
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const installer = path.resolve(`release/PagePort-${version}-x64-setup.exe`);
  const parent = path.join(root, 'installed');
  const target = path.join(parent, 'PagePort');
  execFileSync(installer, ['/S', `/D=${parent}`], { timeout: 120000, stdio: 'inherit' });
  if (!(await readdir(parent)).includes('PagePort')) throw new Error('Installer must create its own PagePort directory.');
  const disposableInstaller = path.join(root, `PagePort-${version}-x64-setup (1).exe`);
  await copyFile(installer, disposableInstaller);
  execFileSync(disposableInstaller, ['/S', '--delete-installer', `/D=${target}`], { timeout: 120000, stdio: 'inherit' });
  if ((await readdir(target)).includes('PagePort')) throw new Error('Installer duplicated the PagePort directory.');
  const cleanupDeadline = Date.now() + 10000;
  while (Date.now() < cleanupDeadline) {
    const stillExists = await stat(disposableInstaller).then(() => true, () => false);
    if (!stillExists) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (await stat(disposableInstaller).then(() => true, () => false)) {
    throw new Error('Installer did not delete itself after installation when requested.');
  }
  const unpacked = await readFile('release/win-unpacked/resources/app.asar');
  const installed = await readFile(path.join(target, 'resources/app.asar'));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  if (sha(unpacked) !== sha(installed)) throw new Error('Installed app differs from tested package.');
  const metadata = JSON.parse(asar.extractFile(path.join(target, 'resources/app.asar'), 'package.json'));
  if (metadata.version !== version) throw new Error('Installed version mismatch.');
  execFileSync(process.execPath, ['scripts/smoke-desktop.mjs', `--app=${path.join(target, 'PagePort.exe')}`], { stdio: 'inherit', timeout: 150000 });
  console.log(`Verified installed PagePort ${version}; archive SHA-256 ${sha(installed)}.`);
  const uninstaller = (await readdir(target)).find(name => name.startsWith('Uninstall') && name.endsWith('.exe'));
  if (!uninstaller) throw new Error('Missing uninstaller.');
  execFileSync(path.join(target, uninstaller), ['/S'], { timeout: 60000, stdio: 'inherit' });
} finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 }); }
