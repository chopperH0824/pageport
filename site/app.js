(function () {
  function updateSectionNavigation() {
    const target = window.location.hash || "#download";
    document.querySelectorAll(".download-subnav a").forEach((link) => {
      const active = link.getAttribute("href") === target;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }
  window.addEventListener("hashchange", updateSectionNavigation);
  updateSectionNavigation();

  function readEmbeddedMeta() {
    const node = document.getElementById("release-meta");
    if (!node) return null;
    try {
      const data = JSON.parse(node.textContent);
      if (data && data.version && Array.isArray(data.assets)) return data;
    } catch {
      return null;
    }
    return null;
  }

  const STEPS = [
    {
      badge: "STEP 01 / 04",
      caption: "拖入或选择本地 .docx / .md 文档。Mac 与 Windows 都在本机完成解析，画面里的文稿是虚构示例。",
      fileStatus: "2.4 KB · 本机已转换",
      syncText: "发布稿已同步",
      versionText: "等待检查目标页",
      publishBtnText: "先检查目标页面",
      dots: [true, false, false],
      showDropBriefly: true
    },
    {
      badge: "STEP 02 / 04",
      caption: "在所见即所得画布中一键插入正文目录 [TOC]、五色状态胶囊与提示面板，发布时自动转换为 Confluence 原生宏。",
      fileStatus: "2.4 KB · 含 TOC 与状态宏",
      syncText: "宏与表格已同步",
      versionText: "等待检查目标页",
      publishBtnText: "检查目标页面",
      dots: [true, false, false],
      showDropBriefly: false
    },
    {
      badge: "STEP 03 / 04",
      caption: "输入目标页 HTTPS 链接核对线上版本（v12），自动拉取原页面 HTML 备份到本机，并确认 0 张缺图、0 个阻塞项。",
      fileStatus: "2.4 KB · 预检通过",
      syncText: "0 阻塞项 · 可发布",
      versionText: "v12 (已备份原稿至本机)",
      publishBtnText: "核对标题并确认发布",
      dots: [true, true, false],
      showDropBriefly: false
    },
    {
      badge: "STEP 04 / 04",
      caption: "二次确认页面标题后执行版本锁保护替换，线上版本升至 v13，并自动回读核对章节、表格与图片数量完全一致。",
      fileStatus: "2.4 KB · 已发布 v13",
      syncText: "线上回读核验一致",
      versionText: "v12 → v13 (发布成功)",
      publishBtnText: "发布完成 · 回读核验通过",
      dots: [true, true, true],
      showDropBriefly: false
    }
  ];

  const STEP_DURATION_MS = 4800;
  const TICK_MS = 60;

  let currentStep = 0;
  let elapsedMs = 0;
  let isAutoPlaying = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dropTimer = null;
  const shaByOs = { mac: "", windows: "" };
  let selectedDownloadOs = detectOs() || "mac";
  let releaseMetadata = null;

  const stageEl = document.getElementById("app-stage");
  const dropOverlayEl = document.getElementById("stage-drop-overlay");
  const stepButtons = Array.from(document.querySelectorAll(".step-trigger"));
  const progressBars = Array.from(document.querySelectorAll(".step-progress-bar"));
  const captionBadgeEl = document.getElementById("caption-step-badge");
  const captionTextEl = document.getElementById("caption-text");
  const fileStatusEl = document.getElementById("stage-file-status");
  const syncTextEl = document.getElementById("stage-sync-text");
  const versionTextEl = document.getElementById("stage-version-text");
  const publishBtnTextEl = document.getElementById("stage-publish-btn-text");
  const pubDots = [
    document.getElementById("pub-dot-1"),
    document.getElementById("pub-dot-2"),
    document.getElementById("pub-dot-3")
  ];
  const toggleAutoplayBtn = document.getElementById("toggle-autoplay-btn");
  const autoplayLabelEl = document.getElementById("autoplay-label");
  const prevStepBtn = document.getElementById("prev-step-btn");
  const nextStepBtn = document.getElementById("next-step-btn");

  function renderStep(index) {
    currentStep = (index + STEPS.length) % STEPS.length;
    elapsedMs = 0;

    const stepData = STEPS[currentStep];
    if (stageEl) {
      stageEl.setAttribute("data-step", String(currentStep));
    }

    stepButtons.forEach((btn, idx) => {
      const isActive = idx === currentStep;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.tabIndex = isActive ? 0 : -1;
      btn.id = `step-tab-${idx}`;
      btn.setAttribute("aria-controls", "app-stage");
    });
    if (stageEl) stageEl.setAttribute("aria-labelledby", `step-tab-${currentStep}`);

    progressBars.forEach((bar, idx) => {
      if (idx < currentStep) {
        bar.style.width = "100%";
      } else if (idx > currentStep) {
        bar.style.width = "0%";
      } else {
        bar.style.width = isAutoPlaying ? "4%" : "100%";
      }
    });

    if (captionBadgeEl) captionBadgeEl.textContent = stepData.badge;
    if (captionTextEl) captionTextEl.textContent = stepData.caption;
    if (fileStatusEl) fileStatusEl.textContent = stepData.fileStatus;
    if (syncTextEl) {
      syncTextEl.innerHTML = `<span class="live-dot" style="width:6px;height:6px;"></span><span>${stepData.syncText}</span>`;
    }
    if (versionTextEl) versionTextEl.textContent = stepData.versionText;
    if (publishBtnTextEl) publishBtnTextEl.textContent = stepData.publishBtnText;

    pubDots.forEach((dot, idx) => {
      if (!dot) return;
      dot.classList.toggle("done", Boolean(stepData.dots[idx]));
    });

    if (dropTimer) {
      clearTimeout(dropTimer);
      dropTimer = null;
    }
    if (dropOverlayEl) {
      if (stepData.showDropBriefly) {
        dropOverlayEl.classList.add("show-drop");
        dropTimer = setTimeout(() => {
          dropOverlayEl.classList.remove("show-drop");
        }, 1650);
      } else {
        dropOverlayEl.classList.remove("show-drop");
      }
    }
  }

  function setAutoPlay(enabled) {
    isAutoPlaying = enabled;
    if (toggleAutoplayBtn) toggleAutoplayBtn.setAttribute("aria-pressed", String(enabled));
    if (autoplayLabelEl) {
      autoplayLabelEl.textContent = isAutoPlaying
        ? "自动演示中 · 点击暂停"
        : "已定格当前步 · 点击继续";
    }
    if (!isAutoPlaying && progressBars[currentStep]) {
      progressBars[currentStep].style.width = "100%";
    }
  }

  stepButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-step-index") || 0);
      setAutoPlay(false);
      renderStep(idx);
    });
    btn.addEventListener("keydown", (event) => {
      const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? STEPS.length - 1
        : currentStep + (event.key === "ArrowRight" ? 1 : -1);
      setAutoPlay(false);
      renderStep(index);
      stepButtons[currentStep].focus();
    });
  });

  if (toggleAutoplayBtn) {
    toggleAutoplayBtn.addEventListener("click", () => {
      setAutoPlay(!isAutoPlaying);
    });
  }

  if (prevStepBtn) {
    prevStepBtn.addEventListener("click", () => {
      setAutoPlay(false);
      renderStep(currentStep - 1);
    });
  }

  if (nextStepBtn) {
    nextStepBtn.addEventListener("click", () => {
      setAutoPlay(false);
      renderStep(currentStep + 1);
    });
  }

  setInterval(() => {
    if (!isAutoPlaying || document.hidden) return;
    elapsedMs += TICK_MS;
    const pct = Math.min(100, (elapsedMs / STEP_DURATION_MS) * 100);
    if (progressBars[currentStep]) {
      progressBars[currentStep].style.width = `${pct.toFixed(1)}%`;
    }
    if (elapsedMs >= STEP_DURATION_MS) {
      renderStep(currentStep + 1);
    }
  }, TICK_MS);

  function detectOs() {
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "windows";
    if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
    return "";
  }

  function setStageOs(os) {
    const next = os === "windows" ? "windows" : "mac";
    if (stageEl) stageEl.setAttribute("data-os", next);
    const label = document.getElementById("stage-os-label");
    if (label) label.textContent = next === "windows" ? "Windows 示意" : "macOS 示意";
    document.querySelectorAll("[data-os-choice]").forEach((btn) => {
      const on = btn.getAttribute("data-os-choice") === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function markCurrentOs(os) {
    document.querySelectorAll(".download-row").forEach((card) => {
      const match = Boolean(os) && card.getAttribute("data-os") === os;
      card.classList.toggle("is-current", match);
      const tag = card.querySelector(".recommend-tag");
      if (tag) tag.hidden = !match;
    });
    document.querySelectorAll(".install-panel").forEach((panel) => {
      panel.classList.toggle("is-current", Boolean(os) && panel.id === `install-${os}`);
    });
  }

  document.querySelectorAll("[data-os-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setStageOs(btn.getAttribute("data-os-choice"));
    });
  });

  function bindCopyButton(btnId, getText, defaultLabelBuilder) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const textToCopy = getText();
      if (!textToCopy) return;
      try {
        await navigator.clipboard.writeText(textToCopy);
        const targetSpan = btn.querySelector("span") || btn;
        const prev = targetSpan.textContent;
        targetSpan.textContent = "已复制到剪贴板";
        setTimeout(() => {
          targetSpan.textContent = defaultLabelBuilder ? defaultLabelBuilder() : prev;
        }, 1800);
      } catch {
        window.prompt("请复制以下内容：", textToCopy);
      }
    });
  }

  function formatShortSha(label, sha) {
    if (!sha || sha.length < 16) return `${label} SHA-256: ${sha || "—"}`;
    return `${label} SHA-256: ${sha.slice(0, 8)}…${sha.slice(-8)}`;
  }

  function assetHref(asset) {
    if (!asset || !asset.filename) return "#download";
    const host = window.location.hostname;
    const localPreview = window.location.protocol === "file:"
      || host === "localhost"
      || host === "127.0.0.1";
    if (localPreview) return asset.githubDownloadUrl || `https://github.com/chopperH0824/pageport/releases/download/v${releaseMetadata.version}/${asset.filename}`;
    return asset.versionedDownloadUrl || asset.directDownloadUrl || "#download";
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.textContent = value;
  }

  function setHrefs(ids, href) {
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el && href) el.setAttribute("href", href);
    });
  }

  bindCopyButton("copy-sha", () => shaByOs[selectedDownloadOs],
    () => formatShortSha(selectedDownloadOs === "mac" ? "macOS" : "Windows", shaByOs[selectedDownloadOs]));

  function selectDownload(os) {
    selectedDownloadOs = os === "windows" ? "windows" : "mac";
    document.querySelectorAll("[data-download-os]").forEach((button) => {
      const selected = button.dataset.downloadOs === selectedDownloadOs;
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const asset = releaseMetadata?.assets?.find((item) => item.id === selectedDownloadOs);
    const link = document.getElementById("download-installer");
    const copy = document.getElementById("copy-sha");
    if (!asset) {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      setText("download-meta", "此系统安装包暂未提供");
      setText("download-file", "请查看 GitHub Releases");
      setText("sha-text", "暂无校验摘要");
      copy.disabled = true;
      return;
    }
    link.removeAttribute("aria-disabled");
    copy.disabled = false;
    link.href = assetHref(asset);
    link.setAttribute("aria-label", `下载 ${asset.label} 安装包`);
    setText("download-meta", `${selectedDownloadOs === "mac" ? "DMG" : "安装程序"} · v${releaseMetadata.version} · ${asset.sizeFormatted}`);
    setText("download-file", asset.filename);
    setText("sha-text", formatShortSha(asset.label, asset.sha256));
    copy.title = `复制 ${asset.label} 安装包 SHA-256`;
    setStageOs(selectedDownloadOs);
  }

  document.querySelectorAll("[data-download-os]").forEach((button) => {
    button.addEventListener("click", () => selectDownload(button.dataset.downloadOs));
  });
  function applyAsset(os, asset, version) {
    if (!asset) return;
    const label = os === "mac" ? "macOS" : "Windows";
    const kind = os === "mac" ? "DMG" : "安装程序";
    shaByOs[os] = asset.sha256 || "";
    setText(`download-${os}-meta`, `${kind} · v${version} · ${asset.sizeFormatted || ""}`);
    setText(`download-${os}-file`, asset.filename);
    setText(`package-${os}-file`, `${asset.filename} · ${asset.sizeFormatted || ""}`);
    setText(`sha-${os}-text`, formatShortSha(label, asset.sha256));
    setHrefs(
      os === "mac" ? ["download-mac", "package-mac-link"] : ["download-windows", "package-windows-link"],
      assetHref(asset)
    );
    if (os === "mac") setText("install-dmg-name", asset.filename);
    if (os === "windows") setText("install-exe-name", asset.filename);
  }

  function applyMetadata(meta) {
    if (!meta || typeof meta !== "object") return;
    releaseMetadata = meta;
    const version = meta.version;
    setText("nav-version", `v${version}`);
    setText("release-box-title", `PagePort v${version} 正式版`);
    if (meta.releaseDate) setText("release-date-badge", meta.releaseDate);

    const ghLink = document.getElementById("github-release-link");
    if (ghLink && meta.githubReleaseUrl) {
      ghLink.setAttribute("href", meta.githubReleaseUrl);
    }

    const assets = Array.isArray(meta.assets) ? meta.assets : [];
    applyAsset("mac", assets.find((item) => item.id === "mac"), version);
    applyAsset("windows", assets.find((item) => item.id === "windows"), version);
    selectDownload(selectedDownloadOs);

    const highlightsList = document.getElementById("release-highlights-list");
    if (highlightsList && Array.isArray(meta.highlights) && meta.highlights.length > 0) {
      highlightsList.replaceChildren();
      meta.highlights.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        highlightsList.appendChild(li);
      });
    }
  }

  const currentOs = detectOs();
  markCurrentOs(currentOs);
  setStageOs(currentOs || "mac");
  renderStep(0);
  if (stageEl) stageEl.setAttribute("role", "tabpanel");
  setAutoPlay(isAutoPlaying);

  const embedded = readEmbeddedMeta();
  if (embedded) applyMetadata(embedded);

  if (window.location.protocol.startsWith("http")) {
    fetch("./downloads/latest.json", { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.version) applyMetadata(data);
      })
      .catch(() => {});
  }
})();
