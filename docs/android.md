# Android 客户端

Android 客户端使用 Capacitor 8，继续复用 React、Vite、现有主题、页面和组件。Electron 桌面端保持独立构建。Android 最低版本为 7.0（API 24），建议使用较新的 Android System WebView。

## 构建与安装

已有 Android Studio 时配置 JDK 21、Android SDK 36、Build Tools 35/36。Windows 也可以运行下面的脚本将构建工具安装到项目的 `.android-tools`，不修改全局 Java 和 SDK 环境变量：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
pnpm install --frozen-lockfile
pnpm run package:android
```

签名 Release APK 输出到 `release/Sylunae-Workshop-0.1.1-Android.apk`，可传到手机直接安装。首次构建会在 `.android-signing` 创建自用签名，之后复用该签名。**请备份整个 `.android-signing` 文件夹，包括密钥和属性文件；丢失后无法用原签名覆盖升级。** 此目录、SDK 和本地机器路径均不进入 Git。

开发包使用 `pnpm run package:android:debug`。Debug 使用独立的 `.debug` 包名和数据目录，可以和正式版共存，设备测试不修改正式版数据。

```powershell
pnpm run build:android  # 构建前端并同步到 Android 工程
pnpm run open:android   # 使用 Android Studio 打开工程
pnpm run test:android   # 已连接手机/已启动模拟器时执行原生测试

# 新版本
$env:ORG_GRADLE_PROJECT_workshopVersionName = '0.1.7'
$env:ORG_GRADLE_PROJECT_workshopVersionCode = '1007'
pnpm run package:android
```

正式包内置前端资源，离线即可启动，不依赖电脑运行开发服务器。网络服务如 Bangumi、天气和可选资源下载仍需要网络。

## GitHub 发版与手机更新

在 GitHub 仓库的 **Settings → Secrets and variables → Actions → New repository secret** 添加原有签名的两个 Secrets。使用当前正式包的签名，升级时才能保留手机上的私有数据。

- `ANDROID_KEYSTORE_BASE64` 使用现有 `.android-signing/release.keystore` 的 Base64。可在本机 PowerShell 运行 `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path '.android-signing/release.keystore').Path)) | Set-Clipboard`，直接粘贴到 Secret 输入框。
- `ANDROID_SIGNING_PROPERTIES` 使用现有 `.android-signing/signing.properties` 的完整内容。可运行 `Get-Content -Raw .android-signing/signing.properties | Set-Clipboard` 后粘贴。

在 **Actions → 发布 Android 版 → Run workflow** 选 `master`，填写版本号（例如 `0.1.5`）。每段最多为 2099、999、999，工作流会按 `主版本 × 1,000,000 + 次版本 × 1,000 + 补丁版本` 生成递增的 Android 版本代码。勾选 **仅构建验证** 可先下载 Actions 产物。未配置正式签名时，试跑会用临时签名，只适合空白测试设备。取消勾选即可发布 `android-v0.1.5`，该标签与 Windows 更新分开。

本机如需用原签名构建同样的版本，可以临时设置 `ORG_GRADLE_PROJECT_workshopVersionName=0.1.5` 和 `ORG_GRADLE_PROJECT_workshopVersionCode=1005`，再执行 `pnpm run package:android`。

旧版手机首次手动覆盖安装含更新功能的正式 APK。随后在 **设置 → 关于 → 应用更新** 点 **检查更新 → 下载并安装**。Android 首次会要求允许丝月工坊安装应用，授权后返回再次点击。应用会校验 APK、保存待写入的数据并打开系统安装确认。覆盖安装后重新打开丝月工坊，核对版本号、已有笔记、收藏和本地音乐。

## 电脑调试与热更新

打开 Android 模拟器，或在手机启用开发者选项和 USB 调试，通过 USB 连接并允许电脑调试。然后运行：

```powershell
pnpm run dev:android
# 多台设备时，指定 adb devices 显示的序列号：
pnpm run dev:android emulator-5554
```

此命令启动本机 Vite，通过 `adb reverse` 转发 5173 端口，安装并打开独立的 Debug 客户端。手机不需要和电脑处于同一 Wi-Fi。首次编译后，修改 `src/**/*.tsx` 或 `src/styles.css` 并保存，React/CSS 会热更新。Debug 与正式版数据隔离；可在 Debug 版导入备份来调试真实内容。

在电脑 Chrome 打开 `chrome://inspect/#devices`，找到该客户端的 WebView，点击 Inspect，可查看 DOM、样式、Console 和网络请求。Java、原生插件、权限、Manifest、依赖变更需要停止并重新运行上述命令。Ctrl+C 停止调试，并恢复本地 Android 工程的生产配置。

只调整共享页面布局时，也可用 `pnpm run dev:web`，在浏览器开发者工具启用手机设备模式；浏览器不会拥有 Android 的文件与后台播放能力。验证这些功能应使用 Debug 客户端。

热更新仅用于开发；正式包仍内置构建产物。Release 构建会拒绝包含开发服务器 URL 的配置，防止误打包。Android Studio 主要负责原生工程、日志、模拟器和打包，无需用它重写 React UI。

## 电脑内容迁移到手机

1. 在电脑版「设置 → 数据与备份」导出完整备份或笔记、任务等局部备份。
2. 使用 USB、文件传输或其他现有方式将 JSON 备份与需要的音乐、图片传到手机。
3. 在手机版设置中导入备份，检查确认弹窗后应用数据。笔记图片随笔记备份迁移。
4. 在「音乐 → 添加音乐 → 从文件导入」批量选择音频。文件会复制到应用私有目录，不再依赖 Downloads 中的原文件。
5. 对唯一匹配的电脑音乐索引，导入会保留原 ID、专辑归属和编辑信息，更新为手机私有路径。匹配不明确时单独导入，避免误关联；也可使用「重新定位」手动选择文件。

本地 JSON 备份只记录音乐和图片库的索引，手机上需要重新导入或定位对应原文件。也可以用 [Google Drive 备份](google-drive.md) 将 Windows 工坊数据和媒体原件一起恢复到 Android。卸载应用会删除其私有数据和媒体。

## 存储与播放

- 应用数据使用原生 SQLite，按数据域增量保存；笔记单独按行写入。每个 JSON 值在 SQLite 和原生桥中以最多 128 KiB 的二进制分块存取，兼容旧版大 JSON 行。完整导入先暂存，全部传输完成后在一个事务内替换；切后台前提交笔记编辑并排空保存队列。
- 大备份先在原生端流式整理，内嵌图片和音频独立落盘，页面只接收整理后的 JSON。完整/局部备份导出时重新嵌入附件，保持原有备份格式兼容。失败会显示错误并保留原数据，不提前关闭确认框。
- 音乐使用流式文件复制导入，也支持 HTTPS 音频直链下载，按文件摘要保存到 `files/music/<sha256>/<文件名>`。封面另存文件，图片缩略图写入缓存目录，不把音频内容放进普通应用状态。
- 文件选择和导出使用 Android 系统选择器，不需要「所有文件访问」权限。
- Media3 `ExoPlayer + MediaSessionService` 管理整份播放队列、循环、随机、音量和进度。切后台、锁屏和自动切歌不依赖 WebView JavaScript。支持系统媒体面板、锁屏和耳机控制；拔耳机暂停并处理音频焦点。
- 白噪音复用同一个原生播放器，和音乐互斥播放。内置白噪音首次播放复制到私有目录；其他音频可下载或自行导入。
- 从最近任务划掉页面时，正在播放的服务继续运行；系统「强行停止」、设备重启或系统终止服务会停止播放。
- 音乐元信息编辑保存在私有目录中的旁车文件和资料库内，不改写原音频标签。

## 平台差异

任务箱、笔记本、收藏馆以及普通工具继续使用共享代码。Markdown、图片处理结果和音频剪辑通过系统文件保存器导出。

首版不提供电脑文件夹持续扫描、FFmpeg/yt-dlp 下载和媒体转码、LibreOffice 转换；相关入口在 Android 隐藏或显示明确的平台说明。图片、UTF-8 文本转换与音频 WAV 剪辑仍可用，具体可解码格式受设备支持限制。

番茄钟使用系统定时通知，启动时按需请求通知与精确提醒权限。权限被拒绝或设备省电策略限制时提醒可能延迟，前台计时仍基于绝对结束时间校正。生日沿用打开 App 时检查、补发一次当前提醒的策略；首版不承诺 App 被系统终止后的生日通知。

## 验证

- `pnpm run typecheck`：共享 Web/Electron TypeScript。
- `pnpm test`：现有业务回归及跨设备路径、重复导入和歧义关联测试。
- 原生 `:app:lintDebug`、`:app:assembleDebugAndroidTest`：Android 静态检查与设备测试编译。
- `BackgroundPlaybackTest`：真实 Media3 播放，在 Activity 停止、屏幕熄灭后自动切换下一首，并校验暂停、定位、上一首和私有文件路径边界；通过 ContentResolver 导入音频，确认重复导入去重、原文件删除后私有副本仍完整。
- `BridgeIntegrationTest`：真实 WebView 到 Capacitor 的调用，验证 SQLite 回滚、笔记图片字节和私有文件 URL 可读。通过设备或模拟器运行，不依赖截图验收。
- `LargeBackupImportTest`：旧版超过 CursorWindow 容量的 JSON 行读取；生成约 95 MB 的完整备份，流式整理附件，经过界面确认导入，并重新创建页面验证数据保留。测试文件为合成数据，不包含个人备份内容。

模拟器验证不能替代目标手机厂商的省电策略验证。实际使用时还需在自己的手机上检查锁屏、蓝牙耳机、通知权限和较大音乐文件导入。
