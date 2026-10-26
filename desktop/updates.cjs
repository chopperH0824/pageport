const { EventEmitter } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const { mkdir, open, rename, rm, readdir } = require('node:fs/promises');
const path = require('node:path');
const semver = require('semver');

const repository = 'https://github.com/chopperH0824/pageport';
const endpoint = 'https://api.github.com/repos/chopperH0824/pageport/releases/latest';
const releasePage = 'https://pageport.chopperh.me/#download';
const downloadBase = 'https://pageport.chopperh.me/downloads';
const maxInstallerSize = 1024 * 1024 * 1024;

async function readLimited(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('响应过大。');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function releaseInfo(release, currentVersion, platform, arch) {
  const version = semver.valid(release?.tag_name);
  if (!version || semver.prerelease(version) || release.draft || release.prerelease) throw new Error('无效版本。');
  const releaseUrl = releasePage;
  const name = platform === 'darwin' ? `PagePort-${version}-${arch}.dmg`
    : platform === 'win32' && arch === 'x64' ? `PagePort-${version}-x64-setup.exe` : '';
  const asset = Array.isArray(release.assets) ? release.assets.find(item => item.name === name && item.state === 'uploaded') : null;
  const url = `${repository}/releases/download/${encodeURIComponent(release.tag_name)}/${name}`;
  const installer = asset && asset.browser_download_url === url &&
    /^sha256:[a-f0-9]{64}$/.test(asset.digest) &&
    Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maxInstallerSize
    ? { name, url, size: asset.size, sha256: asset.digest.slice(7) } : null;
  return {
    available: semver.gt(version, currentVersion), version, releaseUrl, installer,
    notes: typeof release.body === 'string' ? release.body.slice(0, 12000) : '',
    publishedAt: Number.isFinite(Date.parse(release.published_at)) ? release.published_at : null,
  };
}

class UpdateManager extends EventEmitter {
  constructor({ version, platform = process.platform, arch = process.arch, directory, fetcher = fetch, downloadBase: installerBase = '' }) {
    super();
    this.options = { version, platform, arch, directory, fetcher, downloadBase: installerBase };
    this.state = { status: 'idle', currentVersion: version };
  }
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
    return this.state;
  }
  async check() {
    if (this.checking) return this.checking;
    if (this.state.status === 'downloading') return this.state;
    this.set({ status: 'checking', error: '' });
    this.checking = (async () => {
      try {
        const response = await this.options.fetcher(endpoint, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PagePort', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(15000), redirect: 'error',
        });
        if (!response.ok) throw new Error('检查失败。');
        const release = releaseInfo(JSON.parse((await readLimited(response, 256 * 1024)).toString('utf8')),
          this.options.version, this.options.platform, this.options.arch);
        const sameDownload = this.downloaded?.sha256 === release.installer?.sha256 && this.downloaded?.version === release.version;
        return this.set({ ...release, status: release.available ? (sameDownload ? 'downloaded' : 'available') : 'current', checkedAt: Date.now(), progress: 0 });
      } catch {
        return this.set({ status: 'error', error: '无法连接 GitHub 检查更新，请检查网络后重试。' });
      } finally { this.checking = null; }
    })();
    return this.checking;
  }
  async download() {
    if (this.downloading) return this.downloading;
    if (this.state.status !== 'available' || !this.state.installer) return this.state;
    const installer = this.state.installer, version = this.state.version;
    this.set({ status: 'downloading', progress: 0, error: '' });
    this.downloading = (async () => {
      let partial, handle;
      try {
        await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
        partial = path.join(this.options.directory, `${randomUUID()}.partial`);
        handle = await open(partial, 'wx', 0o600);
        // Large installers come from the official download host; Release metadata still supplies
        // the expected size and digest, so the package cannot be accepted if the mirror is stale.
        const installerUrl = this.options.downloadBase
          ? `${this.options.downloadBase}/${encodeURIComponent(installer.name)}`
          : installer.url;
        const response = await this.options.fetcher(installerUrl, {
          signal: AbortSignal.timeout(10 * 60 * 1000), redirect: 'error',
        });
        if (!response.ok) throw new Error('下载失败。');
        // Only the fixed official download-host path for this verified Release asset is requested.
        let bytes = 0, lastProgress = -1;
        const digest = createHash('sha256');
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > installer.size) throw new Error('文件大小不匹配。');
          digest.update(chunk);
          await handle.writeFile(chunk);
          const progress = Math.floor(bytes / installer.size * 100);
          if (progress !== lastProgress) { lastProgress = progress; this.set({ progress }); }
        }
        if (bytes !== installer.size || digest.digest('hex') !== installer.sha256) throw new Error('文件校验失败。');
        await handle.close(); handle = null;
        const file = path.join(this.options.directory, installer.name);
        // Keep only one verified installer in this dedicated cache.
        for (const name of await readdir(this.options.directory)) {
          if (/^PagePort-[0-9]+\.[0-9]+\.[0-9]+-(?:arm64\.dmg|x64\.dmg|x64-setup\.exe)$/.test(name)) {
            await rm(path.join(this.options.directory, name), { force: true });
          }
        }
        await rename(partial, file);
        this.downloaded = { file, sha256: installer.sha256, version };
        return this.set({ status: 'downloaded', progress: 100 });
      } catch {
        return this.set({ status: 'available', progress: 0, error: '安装包下载或 SHA-256 校验失败，未打开任何文件。请重试或前往发布页下载。' });
      } finally {
        await handle?.close().catch(() => {});
        if (partial) await rm(partial, { force: true }).catch(() => {});
        this.downloading = null;
      }
    })();
    return this.downloading;
  }
}

module.exports = { UpdateManager, releaseInfo };
