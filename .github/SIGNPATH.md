# SignPath Foundation 开源代码签名申请与配置指南

本项目已完成 [SignPath Foundation 开源项目代码签名规范](https://signpath.org/terms.html) 所需的仓库声明、官网声明（`Code signing policy`）与 GitHub Actions 自动签名流水线接入。

---

## 第一步：提交免费开源代码签名申请

1. 打开申请页面：<https://signpath.io/solutions/open-source-community>（点击 **Apply Now** / **Apply for free signing**）。
2. 按以下信息填写表单：
   - **Project Name**: `PagePort`
   - **Project Website / Download Page**: `https://pageport.chopperh.me`
   - **Source Code Repository URL**: `https://github.com/chopperH0824/pageport`
   - **Open Source License**: `MIT License` (<https://github.com/chopperH0824/pageport/blob/main/LICENSE>)
   - **Code Signing Policy URL**:
     - GitHub 首页：<https://github.com/chopperH0824/pageport#code-signing-policy>
     - 下载官网：<https://pageport.chopperh.me/#code-signing-policy>
   - **Project Description**:
     > PagePort is an open-source, local-first desktop publisher (macOS & Windows) for Confluence Server / Data Center powered by Mark. It converts Markdown, DOCX, and HTML documents locally on 127.0.0.1 and updates user-specified Confluence pages with backup and version-conflict protection.
   - **GitHub Usernames (Committers / Reviewers / Approvers)**: `chopperH0824`（请确保 GitHub 账号已开启 2FA 双因素认证，SignPath 强制要求）。

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
