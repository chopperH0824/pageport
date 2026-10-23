import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { load } from "cheerio";

const root = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("site/index.html", root), "utf8");
const $ = load(html);
const meta = JSON.parse(fs.readFileSync(new URL("site/downloads/latest.json", root), "utf8"));
const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8"));

test("download site embeds the same published version and installer metadata", () => {
  assert.deepEqual(JSON.parse($("#release-meta").text()), meta);
  assert.equal(meta.version, pkg.version);
  assert.equal($("#nav-version").text(), `v${pkg.version}`);
  assert.equal(meta.assets.length, 2);
  for (const asset of meta.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.sizeBytes > 0);
    assert.ok(asset.filename.includes(`-${meta.version}-`));
    assert.equal(asset.versionedDownloadUrl, `/downloads/${asset.filename}`);
    assert.equal(asset.githubDownloadUrl,
      `https://github.com/chopperH0824/pageport/releases/download/v${meta.version}/${asset.filename}`);
  }
});

test("platform selector shares exactly one installer link", () => {
  assert.equal($("#download a").length, 1);
  assert.equal($("#download [data-download-os]").length, 2);
  assert.equal($("#download [aria-pressed=true]").length, 1);
  assert.equal($("#download-installer").attr("href"), meta.assets[0].versionedDownloadUrl);
  assert.equal($("#download-file").text(), meta.assets[0].filename);
  assert.equal($("#copy-sha").length, 1);
});

test("download page assets and section links resolve locally", () => {
  const ids = new Set();
  $("[id]").each((_, el) => {
    const id = $(el).attr("id");
    assert.ok(!ids.has(id), `duplicate id: ${id}`);
    ids.add(id);
  });
  $("a[href^='#']").each((_, el) => {
    const target = $(el).attr("href").slice(1);
    if (target) assert.ok(ids.has(target), `missing anchor: ${target}`);
  });
  $("[src^='./'], link[href^='./']").each((_, el) => {
    const relative = $(el).attr("src") || $(el).attr("href");
    assert.ok(fs.existsSync(new URL(`site/${relative}`, root)), `missing asset: ${relative}`);
  });
  assert.ok(!html.includes("xattr -cr"), "do not suggest removing quarantine recursively");
  assert.ok(!html.includes("0.4.0"), "no stale installer fallback");
});
