#!/usr/bin/env node
/**
 * 根据 release/ 里的 macOS DMG 与 Windows 安装程序，更新本地下载站元数据。
 * 只有显式传入 --deploy 时才同步到服务器。
 *
 *   node scripts/sync-download-site.mjs
 *   node scripts/sync-download-site.mjs --github
 *   PAGEPORT_SSH_HOST=<host> node scripts/sync-download-site.mjs --github --deploy
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const pkgPath = path.join(rootDir, "package.json");
const releaseDir = path.join(rootDir, "release");
const siteDir = path.join(rootDir, "site");
const latestJsonPath = path.join(siteDir, "downloads", "latest.json");
const indexPath = path.join(siteDir, "index.html");

const HIGHLIGHTS = [
  "设置里的「发布页」打开 pageport.chopperh.me 下载区，便于在国内直接下载。",
  "安装包仍按当前系统从官方 Release 下载，并校验文件大小与 SHA-256。",
  "启动后的自动检查仍只在设置图标上显示圆点，不弹窗打断编辑。",
  "保留 0.5.0 的编辑、导入、发布、自动备份与版本冲突保护。"
];

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;

function readInstaller(spec) {
  const filePath = path.join(releaseDir, spec.filename);
  if (!fs.existsSync(filePath)) {
    if (!process.argv.includes("--github")) console.warn(`未找到 ${spec.label} 安装包：${spec.filename}`);
    return null;
  }
  const stat = fs.statSync(filePath);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return {
    id: spec.id,
    os: spec.os,
    arch: spec.arch,
    label: spec.label,
    detail: spec.detail,
    filename: spec.filename,
    latestAlias: spec.latestAlias,
    sizeBytes: stat.size,
    sizeFormatted: `${(stat.size / (1024 * 1024)).toFixed(1)} MB`,
    sha256,
    directDownloadUrl: `/downloads/${spec.latestAlias}`,
    versionedDownloadUrl: `/downloads/${spec.filename}`,
    githubDownloadUrl: `https://github.com/chopperH0824/pageport/releases/download/v${version}/${spec.filename}`,
    mtime: stat.mtime
  };
}

let assets = [
  readInstaller({
    id: "mac",
    os: "macOS",
    arch: "arm64",
    label: "macOS",
    detail: "Apple Silicon · macOS 13+",
    filename: `PagePort-${version}-arm64.dmg`,
    latestAlias: "PagePort-latest-arm64.dmg"
  }),
  readInstaller({
    id: "windows",
    os: "Windows",
    arch: "x64",
    label: "Windows",
    detail: "Windows 10/11 x64",
    filename: `PagePort-${version}-x64-setup.exe`,
    latestAlias: "PagePort-latest-x64-setup.exe"
  })
].filter(Boolean);

let publishedAt;
if (process.argv.includes("--github")) {
  const response = await fetch(`https://api.github.com/repos/chopperH0824/pageport/releases/tags/v${version}`, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`GitHub Release 查询失败：${response.status}`);
  const release = await response.json();
  if (release.draft || release.prerelease || release.tag_name !== `v${version}` || !release.published_at) {
    throw new Error("只能同步匹配版本的已发布正式 Release");
  }
  publishedAt = release.published_at;
  assets = ["mac", "windows"].map((id) => {
    const filename = id === "mac" ? `PagePort-${version}-arm64.dmg` : `PagePort-${version}-x64-setup.exe`;
    const asset = release.assets.find((item) => item.name === filename);
    if (!asset || asset.state !== "uploaded" || !asset.size || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
      throw new Error(`正式 Release 缺少有效安装包或摘要：${filename}`);
    }
    return {
      id, os: id === "mac" ? "macOS" : "Windows", arch: id === "mac" ? "arm64" : "x64",
      label: id === "mac" ? "macOS" : "Windows",
      detail: id === "mac" ? "Apple Silicon · macOS 13+" : "Windows 10/11 x64",
      filename,
      latestAlias: id === "mac" ? "PagePort-latest-arm64.dmg" : "PagePort-latest-x64-setup.exe",
      sizeBytes: asset.size, sizeFormatted: `${(asset.size / (1024 * 1024)).toFixed(1)} MB`,
      sha256: asset.digest.slice(7),
      directDownloadUrl: `/downloads/${filename}`, versionedDownloadUrl: `/downloads/${filename}`,
      githubDownloadUrl: asset.browser_download_url
    };
  });
}
const hasInstallers = assets.some((item) => item.id === "mac") && assets.some((item) => item.id === "windows");
if (!hasInstallers) {
  throw new Error(`v${version} 安装包不齐。请先准备安装包，或使用 --github 同步正式 Release。未修改官网。`);
}

if (hasInstallers) {
  const releaseDate = new Date(publishedAt || Math.max(...assets.map((item) => item.mtime.getTime())))
    .toISOString()
    .slice(0, 10);

  const nextMeta = {
    product: "PagePort",
    version,
    releaseDate,
    engine: "Mark 16.22.0 Built-in",
    githubReleaseUrl: `https://github.com/chopperH0824/pageport/releases/tag/v${version}`,
    githubRepoUrl: "https://github.com/chopperH0824/pageport",
    highlights: HIGHLIGHTS,
    assets: assets.map(({ mtime, ...asset }) => {
      void mtime;
      return asset;
    })
  };

  const jsonText = `${JSON.stringify(nextMeta, null, 2)}\n`;
  fs.mkdirSync(path.dirname(latestJsonPath), { recursive: true });
  fs.writeFileSync(latestJsonPath, jsonText, "utf8");

  const start = "<!-- release-meta:start -->";
  const end = "<!-- release-meta:end -->";
  const block = `${start}\n<script type="application/json" id="release-meta">\n${JSON.stringify(nextMeta, null, 2)}\n</script>\n${end}`;
  let html = fs.readFileSync(indexPath, "utf8");
  if (!html.includes(start) || !html.includes(end)) {
    console.error("site/index.html 缺少 release-meta 标记，未写入页面内嵌版本数据。");
    process.exit(1);
  }
  html = html.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  const $ = load(html);
  $("#nav-version").text(`v${version}`);
  $("#release-box-title").text(`PagePort v${version} 正式版`);
  $("#release-date-badge").text(releaseDate);
  $("#github-release-link").attr("href", nextMeta.githubReleaseUrl);
  $("#release-highlights-list").empty();
  for (const text of HIGHLIGHTS) $("<li>").text(text).appendTo("#release-highlights-list");
  for (const asset of assets) {
    const id = asset.id;
    $(`#download-${id}-meta`).text(`${id === "mac" ? "DMG" : "安装程序"} · v${version} · ${asset.sizeFormatted}`);
    $(`#download-${id}-file, #install-${id === "mac" ? "dmg" : "exe"}-name`).text(asset.filename);
    $(`#package-${id}-file`).text(`${asset.filename} · ${asset.sizeFormatted}`);
    $(`#sha-${id}-text`).text(`${asset.label} SHA-256: ${asset.sha256.slice(0, 8)}…${asset.sha256.slice(-8)}`);
    $(`#download-${id}, #package-${id}-link`).attr("href", asset.versionedDownloadUrl);
  }
  const primary = assets.find((asset) => asset.id === "mac");
  $("#download-installer").attr("href", primary.versionedDownloadUrl);
  $("#download-meta").text(`DMG · v${version} · ${primary.sizeFormatted}`);
  $("#download-file").text(primary.filename);
  $("#sha-text").text(`macOS SHA-256: ${primary.sha256.slice(0, 8)}…${primary.sha256.slice(-8)}`);
  fs.writeFileSync(indexPath, $.html(), "utf8");

  console.log(`已更新本地下载站版本数据：v${version}`);
  for (const asset of assets) {
    console.log(`  ${asset.label}: ${asset.filename} (${asset.sizeFormatted})`);
    console.log(`  SHA-256: ${asset.sha256}`);
  }
}

const shouldDeploy = process.argv.includes("--deploy");
if (!shouldDeploy) {
  console.log("未连接服务器。需要同步时再显式执行 --deploy。");
  process.exit(0);
}

// Never publish metadata that refers to files absent from the deployment.
for (const asset of assets) {
  const local = path.join(releaseDir, asset.filename);
  if (!fs.existsSync(local) || fs.statSync(local).size !== asset.sizeBytes
    || crypto.createHash("sha256").update(fs.readFileSync(local)).digest("hex") !== asset.sha256) {
    throw new Error(`部署前必须备齐并校验安装包：${asset.filename}`);
  }
}

const sshHost = process.env.PAGEPORT_SSH_HOST;
const remoteRoot = process.env.PAGEPORT_REMOTE_DIR || "/var/www/pageport";
if (!sshHost || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(sshHost)
  || !/^\/[a-zA-Z0-9/_-]+$/.test(remoteRoot)) {
  throw new Error("部署需要有效的 PAGEPORT_SSH_HOST 与绝对远程目录");
}
console.log(`正在同步官网与安装包到 ${sshHost}:${remoteRoot} ...`);
execFileSync("ssh", [sshHost, `mkdir -p ${remoteRoot}/downloads ${remoteRoot}/assets`], {
  stdio: "inherit"
});
const publishAssets = hasInstallers ? assets : [];
for (const asset of publishAssets) {
  const localFile = path.join(releaseDir, asset.filename);
  execFileSync(
    "rsync",
    ["-avz", localFile, `${sshHost}:${remoteRoot}/downloads/${asset.filename}`],
    { stdio: "inherit" }
  );
  const remoteHash = execFileSync("ssh", [sshHost, `sha256sum ${remoteRoot}/downloads/${asset.filename}`],
    { encoding: "utf8" }).trim().split(/\s+/)[0];
  if (remoteHash !== asset.sha256) throw new Error(`服务器安装包摘要不一致：${asset.filename}`);
  execFileSync(
    "ssh",
    [
      sshHost,
      `ln -sfn ${remoteRoot}/downloads/${asset.filename} ${remoteRoot}/downloads/${asset.latestAlias}`
    ],
    { stdio: "inherit" }
  );
}
execFileSync(
  "rsync",
  ["-avz", "--exclude=.DS_Store", `${siteDir}/`, `${sshHost}:${remoteRoot}/`],
  { stdio: "inherit" }
);
console.log("下载站同步完成：https://pageport.chopperh.me");
