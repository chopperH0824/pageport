# SignPath Foundation 开源代码签名申请与配置指南

本项目已完成 [SignPath Foundation 开源项目代码签名规范](https://signpath.org/terms.html) 所需的仓库声明、官网声明（`Code signing policy`）与 GitHub Actions 自动签名流水线接入。

---

## 第一步：提交免费开源代码签名申请

申请地址：<https://signpath.org/apply>（**不是** signpath.io 的控制台；控制台只用于审核通过后配置项目）。

该表单字段与 `signpath.io` 控制台的「4 步引导」无关，必须逐字按下表填写：

| 表单字段 | 填写内容 |
| --- | --- |
| **Project Name** | `PagePort` |
| **Repository URL** | `https://github.com/chopperH0824/pageport` |
| **Homepage URL** | `https://pageport.chopperh.me` |
| **Download URL** | `https://pageport.chopperh.me/#download` |
| **Privacy Policy URL** | `https://pageport.chopperh.me/#code-signing-policy` |
| **Wikipedia URL (optional)** | 留空 |
| **Tagline** | `Local-first Confluence document publisher for macOS and Windows` |
| **Category** | 选择最接近的 *Developer Tools*（若无则选 *Productivity* / *Office*） |
| **Description** | `PagePort is an open-source, local-first desktop publisher for Confluence Server / Data Center, powered by the bundled Mark engine (16.22.0). It imports Markdown, DOCX, HTML and Confluence Word exports, converts them locally on 127.0.0.1, then updates an existing page the user explicitly names, with a pre-publish snapshot, version-conflict protection and structural readback. Passwords are transient and never persisted.` |
| **Reputation** | 见下方「Reputation 建议写法」 |
| **Maintainer Type** | `Individual`（个人维护者） |
| **Build System** | `GitHub Actions` |
| **First Name** | 你的名字（同时是 SignPath 中创建的账号名） |
| **Last Name** | 你的姓氏 |
| **Email** | 你的邮箱（接收审核结果） |
| **Company Name** | 可留空（个人项目） |
| **Primary Discovery Channel** | 如实选择；若列表中有 *AI assistant / ChatGPT* 或 *Search engine*，按实际情况选择 |
| **Please specify the exact source (optional)** | `Microsoft Learn: Code signing options for Windows app developers` |

必填但最容易填错的三项：

- **Repository URL 必须是 GitHub 仓库地址**，不是官网地址（常见错误：误填 `https://pageport.chopperh.me`）。
- **Homepage URL 不能为空**，填官网根地址 `https://pageport.chopperh.me`。
- **Download URL 页面必须出现 "uses the SignPath Foundation for code signing" 字样**，本仓库 `site/index.html` 的 `#code-signing-policy` 区块已满足；该区块与下载区在同一页面，因此 `#download` 可用。

### Reputation 建议写法

SignPath 会人工核对「项目是否已有可验证的外部信任信号」。仓库很新、尚无媒体提及或第三方引用时，**不要编造下载量或被报道记录**，如实说明可直接验证的公开事实：

```
Public MIT-licensed repository with a documented release history and published
installers: https://github.com/chopperH0824/pageport/releases
Public download site with versioned installers, SHA-256 digests and a
code-signing policy section: https://pageport.chopperh.me
Continuous integration on GitHub-hosted runners for every commit
(Linux tests + native Windows build, packaging, install/uninstall checks).
```

若之后出现博客、社区讨论、包管理器收录等真实外部引用，再补充链接可显著提高通过率。

### 提交前检查

- GitHub 账号 `chopperH0824` 已开启 2FA（SignPath 强制要求）。
- 勾选 **SignPath Foundation Code of Conduct**。
- 勾选 **存储并处理个人数据** 的同意项（否则表单无法提交）。
- **不要**勾选营销邮件（可选，与审核无关）。

---

## 第二步：审核通过后在 SignPath 后台配置

审核通过后（通常约 3–7 个工作日），登录 SignPath 后台并配置：

1. **Trusted Build System**:
   - 关联 `GitHub.com`，并安装 [SignPath GitHub App](https://github.com/apps/signpath) 授权给 `chopperH0824/pageport` 仓库。
2. **Project**:
   - **Slug**: `pageport`
3. **Artifact Configuration**:
   - **Slug**: `nsis-installer`
   - 使用以下 XML 配置（仅对 PagePort 自身构建的 Windows 安装程序签名，遵守 SignPath 元数据校验要求，且不对上游 `mark.exe` 签名）：

```xml
<artifact-configuration xmlns="http://signpath.io/schema/artifact-configuration/v1">
  <zip-file>
    <pe-file path="PagePort-*-x64-setup.exe" min-version="0.6.0.0">
      <file-version>{{version}}</file-version>
      <product-name>PagePort</product-name>
      <sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

4. **Signing Policy**:
   - **Slug**: `release-signing`
   - **Trusted Build System**:关联仓库 `chopperH0824/pageport`，工作流 `.github/workflows/ci.yml`。
5. **CI User & API Token**:
   - 在 SignPath 创建 CI Submitter Token，复制生成的 `API Token` 以及右上角的 `Organization ID`。

---

## 第三步：在 GitHub 仓库配置 Secrets / Variables

打开 GitHub 仓库 `Settings → Secrets and variables → Actions`：

- **Repository Secrets**:
  - `SIGNPATH_API_TOKEN`: 填入 SignPath 生成的 CI API Token
  - `SIGNPATH_ORGANIZATION_ID`: 填入 SignPath 的 Organization UUID（也可填在 Repository Variables 中）
- **可选 Repository Variables**（若保持上文默认 Slug 则无需配置）：
  - `SIGNPATH_PROJECT_SLUG`: 默认 `pageport`
  - `SIGNPATH_SIGNING_POLICY_SLUG`: 默认 `release-signing`
  - `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`: 默认 `nsis-installer`

配置完成后，`.github/workflows/ci.yml` 中的 `Sign Windows installer with SignPath` 步骤会自动激活，产出的 `PagePort-<version>-x64-setup.exe` 即自带 SignPath Foundation 数字签名。
