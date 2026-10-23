import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pngToIco from 'png-to-ico';

const commit = '5d5ac64d55c8ba882a6b0b7b9428a66b9e21114a';
const sourceHash = '41a10157227b04bbba3007aaf3e48f1848fb22fbdaec547cc2d663045c5b016e';
const root = process.cwd();
const arch = process.env.PAGEPORT_ARCH || 'x64';
if (arch !== 'x64') throw new Error('Windows builds currently support x64 only.');
const dir = await mkdtemp(path.join(tmpdir(), 'pageport-windows-build-'));
await mkdir('resources', { recursive: true });
try {
  const response = await fetch(`https://codeload.github.com/kovetskiy/mark/tar.gz/${commit}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Unable to download pinned Mark source.');
  const source = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(source).digest('hex') !== sourceHash) throw new Error('Mark source checksum mismatch.');
  const archive = path.join(dir, 'mark.tar.gz');
  await writeFile(archive, source);
  execFileSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
  const sourceDir = path.join(dir, `mark-${commit}`);
  execFileSync(process.env.GO_BIN || 'go', ['build', '-mod=readonly', '-trimpath',
    '-ldflags', `-s -w -X main.version=16.22.0 -X main.commit=${commit}`,
    '-o', path.join(root, 'resources', 'mark.exe'), './cmd/mark'], {
    cwd: sourceDir, stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'amd64', GOTOOLCHAIN: 'local' },
  });
  await copyFile(path.join(sourceDir, 'LICENSE'), 'resources/mark-LICENSE');
  await writeFile('resources/icon.ico', await pngToIco('resources/icon.png'));
  console.log(`Prepared Mark 16.22.0 from verified source ${commit} and Windows icon.`);
} finally { await rm(dir, { recursive: true, force: true }); }
