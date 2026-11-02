import { cp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const mac = process.platform === 'darwin';
if (!mac && process.platform !== 'win32') throw new Error('Build on the native target platform.');
const name = `PagePort-${pkg.version}-${mac ? 'arm64' : 'x64'}-gateway`;
const target = path.join(root, 'release', name);
const source = path.join(root, 'release', mac ? 'mac-arm64/PagePort.app' : 'win-unpacked');
await stat(source);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, path.join(target, mac ? 'PagePort.app' : 'app'), { recursive: true, preserveTimestamps: true });
if (mac) {
  await writeFile(path.join(target, 'Start PagePort.command'), '#!/bin/sh\ncd "$(dirname "$0")"\nexec "./PagePort.app/Contents/MacOS/PagePort" --gateway\n', { mode: 0o755 });
} else {
  await writeFile(path.join(target, 'Start PagePort.cmd'), '@echo off\r\nstart "" "%~dp0app\\PagePort.exe" --gateway\r\n', 'ascii');
}
await writeFile(path.join(target, 'README.txt'), `PagePort ${pkg.version} - local browser gateway\n\n1. Extract the ENTIRE ZIP to a writable folder.\n2. Double-click Start PagePort.${mac ? 'command' : 'cmd'}.\n3. Keep the gateway window open while editing in your browser.\n4. Save your documents before choosing Quit gateway.\n\nNo installer, administrator privileges, Node.js, Go or Word are required.\nRequires ${mac ? 'Apple Silicon, macOS 13+' : 'Windows 10/11 x64'} and a modern browser.\nThis is not a way to bypass company application policies. If execution is blocked, contact your IT administrator.\nThe package is not code signed. Verify the published SHA-256; do not disable system protections.\nDocuments are converted locally. Only explicitly requested Confluence operations contact your chosen HTTPS server.\nBackups are stored in your user profile under PagePort Gateway/data, separately from the desktop edition.\nLegacy binary DOC conversion is macOS-only; Windows users should save it as DOCX first.\nDOC export is Word-compatible MHTML, not the legacy binary DOC format.\nRemote image URLs are not automatically downloaded or archived.\n\nhttps://pageport.chopperh.me\nhttps://github.com/chopperH0824/pageport\n`, 'utf8');
const zip = `${target}.zip`;
await rm(zip, { force: true });
if (mac) execFileSync('ditto', ['-c', '-k', '--keepParent', target, zip], { stdio: 'inherit' });
else execFileSync('tar.exe', ['-a', '-c', '-f', zip, '-C', path.dirname(target), path.basename(target)], { stdio: 'inherit' });
console.log(`Gateway archive ready: ${path.basename(zip)}`);
