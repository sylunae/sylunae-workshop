# Windows 发版与更新

## 首次配置

1. 将 `.github/workflows/release-windows.yml` 合入仓库默认分支 `master`。在仓库的 **Actions** 页就能看到 **发布 Windows 版**。
2. 如果仓库禁用了 Actions，在 **Settings → Actions → General** 允许工作流使用 GitHub 官方 Actions 和 `pnpm/action-setup`。
3. 工作流使用 GitHub 自带的 `GITHUB_TOKEN`。构建任务只读仓库，发布任务申请 `contents: write` 创建 Release。现有公开仓库的 Release 可供客户端直接下载。

## 每次发版

1. 平时把改动正常合入 `master`。想发版时，打开 **Actions → 发布 Windows 版 → Run workflow**，分支选 `master`。
2. 填写比历史正式标签更高的版本号，例如 `0.1.5`。留空 **commit** 会打包点击运行时的默认分支提交，也可以填已合入默认分支的完整提交 SHA。**notes** 可选，留空由 GitHub 生成更新说明。
3. 想先试跑就勾选 **仅构建验证**。检查和打包完成后，从运行记录的 **Artifacts** 下载安装包。正式发布时取消勾选后重新运行。
4. 在运行记录里查看进度。Windows 任务会按锁文件安装依赖、跑测试、设置本次构建版本并生成 NSIS 安装包。发布任务将安装包、差分文件和 `latest.yml` 上传到草稿，上传完成后公开为最新正式版，并为目标提交建立版本标签。

版本号写入 Actions 这次使用的构建副本。Git 工作树和 Android 版本继续独立管理。工作流失败时可在运行日志中定位失败步骤。如果发布步骤留下未完成的草稿，删除该草稿后可重试。已发布的版本用更高的版本号修正。

## 本地更新

首次从 [GitHub Releases](https://github.com/sylunae/sylunae-workshop/releases) 下载带有更新功能的 Windows 安装包，直接覆盖安装。之后客户端启动和运行期间会检查更新，也可在 **设置 → 关于 → 应用更新** 手动检查。下载完成后点击标题栏或设置页的 **重启并更新**。应用会保存待写入的数据，覆盖安装并重新打开。

验证时，在旧版创建一条笔记、保留一项收藏和一条本地媒体记录。升级后检查版本号、笔记内容和收藏，并播放原有媒体。安装升级沿用现有应用 ID、安装方式和用户数据目录。
