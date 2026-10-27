import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { UpdateManager, releaseInfo, mirrorInfo } = createRequire(import.meta.url)('../desktop/updates.cjs');
const bytes = Buffer.from('verified mock installer');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const base = 'https://github.com/chopperH0824/pageport';
const releasePage = 'https://pageport.chopperh.me/#download';
const asset = name => ({ name, state: 'uploaded', size: bytes.length, digest: `sha256:${sha256}`,
  browser_download_url: `${base}/releases/download/v0.4.0/${name}` });
const release = overrides => ({ tag_name: 'v0.4.0', published_at: '2026-10-23T00:00:00Z',
  body: '<script>not executable</script>\nRelease notes',
  assets: [asset('PagePort-0.4.0-arm64.dmg'), asset('PagePort-0.4.0-x64.dmg'), asset('PagePort-0.4.0-x64-setup.exe')], ...overrides });

test('release detection compares semver and selects only the matching platform and architecture', () => {
  for (const [platform, arch, name] of [
    ['darwin', 'arm64', 'PagePort-0.4.0-arm64.dmg'], ['darwin', 'x64', 'PagePort-0.4.0-x64.dmg'],
    ['win32', 'x64', 'PagePort-0.4.0-x64-setup.exe'],
  ]) {
    const state = releaseInfo(release(), '0.3.10', platform, arch);
    assert.equal(state.available, true);
    assert.equal(state.installer.name, name);
    assert.equal(state.installer.sha256, sha256);
    assert.equal(state.installer.url, `${base}/releases/download/v0.4.0/${name}`);
    assert.equal(state.releaseUrl, releasePage);
    assert.doesNotMatch(state.releaseUrl, /github\.com/);
  }
  assert.equal(releaseInfo(release(), '0.4.0', 'darwin', 'arm64').available, false);
  assert.equal(releaseInfo(release(), '0.10.0', 'win32', 'x64').available, false);
  assert.equal(releaseInfo(release(), '0.3.1', 'win32', 'arm64').installer, null);
  assert.equal(releaseInfo(release(), '0.3.1', 'linux', 'x64').installer, null);
});

test('drafts, prereleases and malformed versions cannot become updates', () => {
  for (const value of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.5.0-beta.1' },
    { tag_name: '../../etc/passwd' }, { tag_name: 'latest' }]) {
    assert.throws(() => releaseInfo(release(value), '0.3.1', 'darwin', 'arm64'));
  }
});

test('untrusted asset URLs, names, digests and sizes fall back to the fixed release page', () => {
  const original = asset('PagePort-0.4.0-arm64.dmg');
  for (const value of [{ browser_download_url: 'https://evil.example/a.dmg' },
    { browser_download_url: 'http://github.com/chopperH0824/pageport/a.dmg' },
    { name: '../../a.dmg' }, { digest: null }, { digest: 'sha256:bad' }, { size: 0 }, { size: 2 ** 40 },
    { state: 'new' }]) {
    const info = releaseInfo(release({ assets: [{ ...original, ...value }] }), '0.3.1', 'darwin', 'arm64');
    assert.equal(info.installer, null);
    assert.equal(info.releaseUrl, releasePage);
    assert.doesNotMatch(info.releaseUrl, /github\.com/);
  }
});

const officialBase = 'https://pageport.chopperh.me/downloads';
const mirror = (overrides = {}) => ({
  product: 'PagePort', version: '0.4.0', releaseDate: '2026-10-23',
  githubReleaseUrl: `${base}/releases/tag/v0.4.0`,
  highlights: ['镜像检查提示'],
  assets: [
    { filename: 'PagePort-0.4.0-arm64.dmg', sizeBytes: bytes.length, sha256,
      githubDownloadUrl: `${base}/releases/download/v0.4.0/PagePort-0.4.0-arm64.dmg` },
    { filename: 'PagePort-0.4.0-x64-setup.exe', sizeBytes: bytes.length, sha256,
      githubDownloadUrl: `${base}/releases/download/v0.4.0/PagePort-0.4.0-x64-setup.exe` },
  ],
  ...overrides,
});

async function manager(t, fetcher) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pageport-updates-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new UpdateManager({ version: '0.3.1', platform: 'win32', arch: 'x64', directory, fetcher });
}

test('checking uses only public release metadata and deduplicates concurrent requests', async t => {
  let count = 0;
  const update = await manager(t, async (url, options) => {
    count++;
    assert.equal(url, 'https://api.github.com/repos/chopperH0824/pageport/releases/latest');
    assert.equal(options.redirect, 'error');
    assert.equal(Object.keys(options.headers).some(key => /authorization|cookie/i.test(key)), false);
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json(release());
  });
  await Promise.all([update.check(), update.check()]);
  assert.equal(count, 1);
  assert.equal(update.state.status, 'available');
});

test('network, HTTP, malformed and oversized metadata errors remain recoverable', async t => {
  for (const fetcher of [
    async () => { throw new Error('private diagnostic'); },
    async () => new Response('{}', { status: 403 }),
    async () => new Response('not JSON'),
    async () => new Response('x'.repeat(256 * 1024 + 1)),
  ]) {
    const update = await manager(t, fetcher);
    const result = await update.check();
    assert.equal(result.status, 'error');
    assert.doesNotMatch(result.error, /private diagnostic/);
    update.options.fetcher = async () => Response.json(release());
    assert.equal((await update.check()).status, 'available');
  }
});

test('mirror metadata is validated before it can become an update', () => {
  assert.equal(mirrorInfo(mirror(), '0.3.1', 'win32', 'x64', officialBase).installer.name, 'PagePort-0.4.0-x64-setup.exe');
  assert.equal(mirrorInfo(mirror(), '0.4.0', 'win32', 'x64', officialBase).available, false);
  for (const value of [{ version: 'latest' }, { version: '0.5.0-beta.1' },
    { githubReleaseUrl: 'https://github.com/evil/repo/releases/tag/v0.4.0' },
    { githubReleaseUrl: `${base}/releases/tag/v0.3.0` }]) {
    assert.throws(() => mirrorInfo(mirror(value), '0.3.1', 'win32', 'x64', officialBase));
  }
  for (const value of [
    { assets: [] },
    { assets: [{ ...mirror().assets[1], sha256: 'bad' }] },
    { assets: [{ ...mirror().assets[1], sizeBytes: 0 }] },
    { assets: [{ ...mirror().assets[1], sizeBytes: 2 ** 40 }] },
    { assets: [{ ...mirror().assets[1], githubDownloadUrl: 'https://evil.example/x.exe' }] },
  ]) {
    const info = mirrorInfo(mirror(value), '0.3.1', 'win32', 'x64', officialBase);
    assert.equal(info.installer, null);
  }
  assert.throws(() => mirrorInfo(mirror(), '0.3.1', 'win32', 'x64', 'https://evil.example/downloads'));
  assert.throws(() => mirrorInfo(mirror(), '0.3.1', 'win32', 'x64', 'http://pageport.chopperh.me/downloads'));
});

test('GitHub API failures fall back to the official mirror metadata', async t => {
  const official = await mkdtemp(path.join(tmpdir(), 'pageport-updates-mirror-fallback-'));
  t.after(() => rm(official, { recursive: true, force: true }));
  for (const github of [
    async () => { throw new Error('network unreachable'); },
    async () => new Response('{}', { status: 403 }),
    async () => new Response('not JSON'),
  ]) {
    const urls = [];
    const update = new UpdateManager({
      version: '0.3.1', platform: 'win32', arch: 'x64', directory: official,
      downloadBase: officialBase,
      fetcher: async (url, options) => {
        urls.push(url);
        if (url.includes('api.github.com')) return github();
        assert.equal(url, `${officialBase}/latest.json`);
        assert.equal(options.redirect, 'error');
        return Response.json(mirror());
      },
    });
    const result = await update.check();
    assert.equal(result.status, 'available');
    assert.equal(result.version, '0.4.0');
    assert.equal(result.checkedVia, 'mirror');
    assert.equal(result.installer.sha256, sha256);
    assert.equal(result.installer.url, `${officialBase}/PagePort-0.4.0-x64-setup.exe`);
    assert.match(result.notes, /镜像检查提示/);
    assert.equal(urls.length, 2);
  }
});

test('the mirror is not queried while the GitHub API works', async t => {
  const urls = [];
  const update = await manager(t, async url => {
    urls.push(url);
    return Response.json(release());
  });
  const result = await update.check();
  assert.equal(result.status, 'available');
  assert.equal(result.checkedVia, 'github');
  assert.deepEqual(urls, ['https://api.github.com/repos/chopperH0824/pageport/releases/latest']);
});

test('installer is streamed, checked, deduplicated and never executed', async t => {
  let downloads = 0;
  const update = await manager(t, async url => {
    if (url.includes('api.github.com')) return Response.json(release());
    downloads++;
    assert.equal(url, `${base}/releases/download/v0.4.0/PagePort-0.4.0-x64-setup.exe`);
    await new Promise(resolve => setTimeout(resolve, 20));
    return new Response(bytes);
  });
  await update.check();
  await Promise.all([update.download(), update.download()]);
  assert.equal(downloads, 1);
  assert.equal(update.state.status, 'downloaded');
  assert.equal(update.state.progress, 100);
  assert.deepEqual(await readFile(update.downloaded.file), bytes);
  assert.deepEqual(await readdir(update.options.directory), ['PagePort-0.4.0-x64-setup.exe']);
  assert.equal((await update.check()).status, 'downloaded');
});

test('configured official download host is used for the large installer', async t => {
  let installerUrl = '';
  const directory = await mkdtemp(path.join(tmpdir(), 'pageport-updates-mirror-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const update = new UpdateManager({
    version: '0.3.1', platform: 'win32', arch: 'x64', directory,
    downloadBase: 'https://pageport.chopperh.me/downloads',
    fetcher: async (url, options) => {
      if (url.includes('api.github.com')) return Response.json(release());
      installerUrl = url;
      assert.equal(options.redirect, 'error');
      return new Response(bytes);
    },
  });
  await update.check();
  await update.download();
  assert.equal(installerUrl, 'https://pageport.chopperh.me/downloads/PagePort-0.4.0-x64-setup.exe');
  assert.equal(update.state.status, 'downloaded');
});

test('partial, oversized, corrupt and failed downloads leave no installer or partial files', async t => {
  for (const response of [
    () => new Response(bytes.subarray(1)),
    () => new Response(Buffer.concat([bytes, bytes])),
    () => new Response(Buffer.alloc(bytes.length)),
    () => new Response('', { status: 404 }),
  ]) {
    const update = await manager(t, async url => url.includes('api.github.com') ? Response.json(release()) : response());
    await update.check();
    await update.download();
    assert.equal(update.state.status, 'available');
    assert.match(update.state.error, /SHA-256/);
    assert.equal(update.downloaded, undefined);
    assert.deepEqual(await readdir(update.options.directory), []);
  }
});
