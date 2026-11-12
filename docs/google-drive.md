# Google Drive 备份与恢复

Windows 和 Android 支持自动同步及手动备份与恢复。两台设备需要连接同一个 Google 账号。上传会复用云端已有的文件，恢复会保留一次本地回退机会。

## 开启自动同步

在两台设备的 **设置 → 数据与备份 → Google Drive 备份** 分别打开 **自动同步**。云端已有备份时，第一次先在要保留数据的设备上手动上传，再到另一台设备手动恢复一次。这样两台设备就从同一个版本开始同步。如果之前已经用当前版本手动完成过这两个步骤，可以直接打开开关。

- 停止编辑后约 5 秒开始上传。连续编辑时，笔记最多间隔约 10 秒写入本地，每约 60 秒尝试上传最新快照。
- 启动、切回应用或恢复联网时会检查云端。应用可见且没有正在输入的内容时，只有云端有改动就自动应用新版。导航记录、侧栏、天气缓存、番茄钟运行状态和生日提醒发送记录保留在本机。
- Windows 正常关窗会先保存，并给最后一轮上传最多 20 秒。Android 退到后台会保存并尝试上传，系统暂停应用后会等到下次打开再继续。断网和强制结束后，已落盘的改动会在下次运行时检查并补传。
- 两端都有改动时，会在设置里提示处理。核对两边的内容后，手动上传要保留的版本，再在另一台设备上恢复。回退上一次恢复会关闭本机自动同步。

### 笔记独立同步

升级 Windows 和 Android 后，现有的 **自动同步** 开关也会启用笔记独立同步。启动或切回应用时先检查笔记清单，按笔记和文件夹传输改动。笔记附件按内容复用，有新附件的笔记会在所需附件下载并校验后更新。首次升级会从现有云端备份中的笔记和文件夹建立清单，已有备份的设备继续使用原来的同步版本作为比较基准。

不同笔记上的修改可以自动合并。同一篇笔记两边都修改时保留本机内容，并把另一端的内容保存为「同步冲突副本」。后台更新不会替换正在输入的笔记，切换笔记或离开编辑框后会再检查。设置中可以查看上次笔记同步时间。

手动备份仍包含全部数据。执行手动恢复后，会关闭本机自动同步，避免立即把恢复出的旧笔记推到另一端。重新开启前先核对笔记内容。

## 维护者一次性配置

1. 在 Google Cloud Console 创建一个项目，并在该项目启用 [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)。
2. 打开 **Google Auth Platform**，填写应用名称和联系邮箱。个人 Google 账号选择 **External（外部）**。保持 **Testing（测试）** 时，在 **Audience → Test users** 加入要用于备份的 Google 账号。在 **Data Access** 添加权限 `https://www.googleapis.com/auth/drive.appdata`。测试授权七天后过期，届时可重新连接。长期使用可在 Audience 查看发布状态和适用的验证要求。
3. 在同一项目的 **Clients** 创建 **Desktop app（桌面应用）** 客户端，下载 OAuth 客户端 JSON，供发版和本机开发配置使用。
4. 在 **Clients** 创建 **Android** 客户端。根据安装的 APK 选择下表中的包名，并填入该 APK 对应签名的 **SHA-1**。Android 客户端创建完成后即可使用，手机上无需导入 JSON。

| 安装的 APK | 包名 | signingReport 中查看 |
| --- | --- | --- |
| 调试版 | `studio.sylunae.workshop.debug` | `Variant: debug` |
| 正式版 | `studio.sylunae.workshop` | `Variant: release` |

在项目根目录用 PowerShell 获取 SHA-1。如果 JDK 和 SDK 已在环境变量里，直接运行最后一行即可。使用项目自带的本地 Android 工具目录时，先运行前两行。

~~~powershell
$env:JAVA_HOME = (Resolve-Path .android-tools/jdk).Path
$env:ANDROID_HOME = (Resolve-Path .android-tools/sdk).Path
.\android\gradlew.bat -p android :app:signingReport
~~~

只有实际安装的构建类型需要配置。正式版签名尚未创建时，先按 [Android 构建说明](android.md) 打包一次，再取 release 的 SHA-1。手机需要可用的 Google Play 服务。

## Windows 发布配置

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加变量 `GOOGLE_DRIVE_DESKTOP_CLIENT_ID` 和 Secret `GOOGLE_DRIVE_DESKTOP_CLIENT_SECRET`，分别填同一项目下 Desktop OAuth JSON 中的 `installed.client_id` 和 `installed.client_secret`。发版流程会校验这两项并将其写入主进程。在 Google Auth Platform 的 **Audience** 将用户类型设为 **External**，并将发布状态切换到 **In production**，让测试名单之外的用户也能授权。用户安装后点击 **连接 Google Drive**，在系统浏览器登录自己的 Google 账号并授权即可。

本机开发和打包可在 `.env.local` 设置 `MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID` 和 `MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET`。桌面 OAuth 客户端属于公开客户端。用户授权令牌继续由各自的系统安全存储保存。旧版已有的授权可继续使用，断开后重新连接会使用安装包内置的客户端。若旧客户端属于另一个 Google Cloud 项目，重新连接后将访问新项目的应用专用空间。[Google 桌面 OAuth 说明](https://developers.google.com/identity/protocols/oauth2/native-app)

## OAuth 公开页面

项目提供以下独立页面，主页页脚与「设置 → 关于 → 法律与隐私」均有入口：

- `privacy.html`：隐私权政策。
- `terms.html`：应用服务条款。

运行 `npm run build:web` 后，将整个 `dist/` 发布到你控制的公开 HTTPS 站点（也可放在子目录）。例如站点为 `https://你的域名/`，则在 Google Auth Platform → Branding 填写主页 `https://你的域名/`、隐私权政策 `https://你的域名/privacy.html`、应用服务条款 `https://你的域名/terms.html`。这些是部署后的地址格式，不是已经上线的链接。

两份页面的正文在开发服务器及构建时直接生成到 HTML，无需登录、JavaScript 或本地应用数据库即可阅读；应用内复用同一份文案，通过现有弹窗阅读。静态托管应直接提供两个 HTML 文件，不要将它们重写成应用首页。Electron 构建也包含相同页面，资源使用构建后的相对路径。

发布前确认政策中的提供者（sylunae）、项目反馈入口、数据处理方式与实际部署一致；Google Cloud 的用户支持邮箱应填写你实际维护的邮箱。当前页面提供项目 Issue 作为联系入口，没有虚构联系邮箱。公开页面若另外接入分析、代理或托管日志服务，需要同步补充相应数据处理说明。

在无痕窗口确认这三个 HTTPS 地址无需登录即可访问，再将站点域名加入 Authorized domains，并按 Google 要求完成域名所有权验证。切换 Audience → In production 与品牌验证是不同步骤；页面准备完成不代表已经发布或通过审核。当前 `drive.appdata` 属于非敏感权限，但品牌验证等要求仍以控制台对该项目显示的要求为准。

官方说明：[品牌验证及主页／政策要求](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)、[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)、[应用专用空间权限](https://developers.google.com/workspace/drive/api/guides/appdata)。

## 从测试版切换到正式版

1. 从 [GitHub Releases](https://github.com/sylunae/sylunae-workshop/releases) 下载 Windows 安装包和 Android 正式 APK。Android 正式包使用与旧版相同的签名时，可直接覆盖安装。
2. 在 Windows 正式版点击 **连接 Google Drive**，在系统浏览器登录并授权。开发版和正式版各自保存授权状态。
3. 在原 Google Cloud 项目中为正式包创建 Android 客户端，包名用 `studio.sylunae.workshop`，SHA-1 用正式 APK 的签名值。用同一个 Google 账号连接后，即可查看此前在该项目下上传的备份。OAuth 客户端 JSON 留在本机。

## 第一次备份与验证

从源码测试时，在 Windows 运行 `pnpm dev:desktop`。手机可安装 `pnpm run package:android:debug` 生成的 APK，调试版和正式版使用各自独立的本地数据。

桌面开发版没有配置 `.env.local` 且没有现有授权时，可在 **设置 → 数据与备份 → Google Drive 备份 → 导入桌面 OAuth 配置** 选择同一 Google Cloud 项目下载的 **Desktop app** 客户端 JSON，再点击 **连接 Google Drive**。

1. 在电脑的丝月工坊准备一条带图片的笔记、图片库的一张原图和一首音乐。在 **设置 → 数据与备份 → Google Drive 备份**，点 **连接 Google Drive**。在系统浏览器选择测试账号并授权。
2. 在电脑点 **备份到 Google Drive → 开始上传**，等到提示「备份已发布」。如果列出缺失文件，先在工坊重新定位这些文件或移除失效索引。
3. 在手机准备一条便于辨认的本地测试笔记。在同一设置入口点 **连接 Google Drive**，选择电脑使用的账号。点 **从 Google Drive 恢复**，核对设备、时间和数量，再点 **下载并恢复**。
4. 手机开启飞行模式，重新打开工坊。确认笔记附件能显示、图片库能打开原图、音乐能播放。可点 **回退本次恢复**，确认手机上原来的测试笔记回来。
5. 在电脑只修改一条笔记后再次备份。确认上传数量只包含变化的数据文件，原来的音乐和图片应显示为复用。手机重新恢复后能看到修改后的笔记。
6. 在 Android 修改一条测试笔记并上传，再在 Windows 恢复。确认笔记显示新内容，并用 Windows 的 **回退本次恢复** 验证本地回退。
7. 用较大的测试媒体检查中断行为。上传新版本时断网，手机此时仍能查到上一次成功发布的备份。手机下载时断网，原有手机数据仍可使用。恢复网络后重试。

Drive 网页不会显示应用专用空间的文件。云端历史清单和已上传文件暂时保留，两端界面恢复最新发布的版本。备份会复制本地原件，外部图片链接仍然依赖原链接可用。已下载的官方白噪音资源可在手机资源管理中单独下载，自定义白噪音随备份恢复。

Google 官方说明可参见 [创建 OAuth 客户端](https://developers.google.com/workspace/guides/create-credentials)、[应用专用空间](https://developers.google.com/workspace/drive/api/guides/appdata) 和 [测试用户与授权期限](https://support.google.com/cloud/answer/15549945)。
