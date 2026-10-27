const { EventEmitter } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const { mkdir, open, rename, rm, readdir } = require('node:fs/promises');
const path = require('node:path');
const semver = require('semver');

const repository = 'https://github.com/chopperH0824/pageport';
const endpoint = 'https://api.github.com/repos/chopperH0824/pageport/releases/latest';
const releasePage = 'https://pageport.chopperh.me/#download';
const downloadBase = 'https://pageport.chopperh.me/downloads';
const officialHost = 'pageport.chopperh.me';
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

// Fallback used when api.github.com is blocked, rate limited or slow (common
// on mainland networks). The official download host is already trusted for the
// installers themselves; its metadata must still name a valid semver release,
// point at the matching GitHub tag and carry a complete size/SHA-256 pair.
function mirrorInfo(meta, currentVersion, platform, arch, base) {
  let origin;
  try { origin = new URL(base); } catch { throw new Error('镜像地址无效。'); }
  if (origin.protocol !== 'https:' || origin.hostname !== officialHost) throw new Error('镜像地址无效。');
  const version = semver.valid(meta?.version);
  if (!version || semver.prerelease(version)) throw new Error('无效版本。');
  if (meta.githubReleaseUrl !== `${repository}/releases/tag/v${version}`) throw new Error('版本来源不一致。');
  const name = platform === 'darwin' ? `PagePort-${version}-${arch}.dmg`
    : platform === 'win32' && arch === 'x64' ? `PagePort-${version}-x64-setup.exe` : '';
  const asset = Array.isArray(meta.assets) ? meta.assets.find(item => item?.filename === name) : null;
  const size = asset?.sizeBytes, digest = String(asset?.sha256 || '');
  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(name)}`;
  const installer = asset &&
    /^[a-f0-9]{64}$/.test(digest) &&
    Number.isSafeInteger(size) && size > 0 && size <= maxInstallerSize &&
    asset.githubDownloadUrl === `${repository}/releases/download/v${version}/${name}`
    ? { name, url, size, sha256: digest } : null;
  return {
    available: semver.gt(version, currentVersion), version, releaseUrl: releasePage, installer,
    notes: Array.isArray(meta.highlights) ? meta.highlights.filter(item => typeof item === 'string').join('\n').slice(0, 12000) : '',
    publishedAt: Number.isFinite(Date.parse(meta.releaseDate)) ? `${meta.releaseDate}T00:00:00Z` : null,
    checkedVia: 'mirror',
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
        let release;
        try {
          const response = await this.options.fetcher(endpoint, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PagePort', 'X-GitHub-Api-Version': '2022-11-28' },
            signal: AbortSignal.timeout(15000), redirect: 'error',
          });
          if (!response.ok) throw new Error('GitHub 检查失败。');
          release = { ...releaseInfo(JSON.parse((await readLimited(response, 256 * 1024)).toString('utf8')),
            this.options.version, this.options.platform, this.options.arch), checkedVia: 'github' };
        } catch {
          // api.github.com is frequently blocked or rate limited on mainland
          // networks even when github.com itself loads. The official download host
          // publishes the same release metadata, so fall back to it.
          try {
            if (!this.options.downloadBase) throw new Error('未配置镜像。');
            const response = await this.options.fetcher(`${this.options.downloadBase}/latest.json`, {
              headers: { Accept: 'application/json', 'User-Agent': 'PagePort' },
              signal: AbortSignal.timeout(12000), redirect: 'error',
            });
            if (!response.ok) throw new Error('镜像检查失败。');
            release = mirrorInfo(JSON.parse((await readLimited(response, 256 * 1024)).toString('utf8')),
              this.options.version, this.options.platform, this.options.arch, this.options.downloadBase);
          } catch {
            return this.set({ status: 'error', error: '暂时无法检查更新：GitHub 与官方镜像均不可用，请检查网络后重试。' });
          }
        }
        const sameDownload = this.downloaded?.sha256 === release.installer?.sha256 && this.downloaded?.version === release.version;
        return this.set({ ...release, status: release.available ? (sameDownload ? 'downloaded' : 'available') : 'current', checkedAt: Date.now(), progress: 0 });
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

module.exports = { UpdateManager, releaseInfo, mirrorInfo };
