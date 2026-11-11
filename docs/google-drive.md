# Google Drive 备份与恢复

Windows 和 Android 都可以手动上传和恢复。两台设备连接同一个 Google 账号。最后成功发布的备份成为云端最新版，上传时复用云端已有的文件。恢复会替换此设备的本地数据，并保留一次回退机会。

## 一次性配置

1. 在 Google Cloud Console 创建一个项目，并在该项目启用 [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)。
2. 打开 **Google Auth Platform**，填写应用名称和联系邮箱。个人 Google 账号选择 **External（外部）**。保持 **Testing（测试）** 时，在 **Audience → Test users** 加入要用于备份的 Google 账号。在 **Data Access** 添加权限 `https://www.googleapis.com/auth/drive.appdata`。测试授权七天后过期，届时可重新连接。长期使用可在 Audience 查看发布状态和适用的验证要求。
3. 在同一项目的 **Clients** 创建 **Desktop app（桌面应用）** 客户端，下载 OAuth 客户端 JSON。把文件留在本机，桌面端会通过文件选择器读取它。
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

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加变量 `GOOGLE_DRIVE_DESKTOP_CLIENT_ID` 和 Secret `GOOGLE_DRIVE_DESKTOP_CLIENT_SECRET`，分别填同一项目下 Desktop OAuth JSON 中的 `installed.client_id` 和 `installed.client_secret`。发版流程会把桌面 OAuth 客户端配置写入主进程。用户安装后可以直接连接 Google Drive。已导入的自定义配置继续优先使用。

本机打包可在 `.env.local` 设置 `MAIN_VITE_GOOGLE_DRIVE_CLIENT_ID` 和 `MAIN_VITE_GOOGLE_DRIVE_CLIENT_SECRET`。桌面 OAuth 客户端属于公开客户端。用户授权令牌继续由各自的系统安全存储保存。[Google 桌面 OAuth 说明](https://developers.google.com/identity/protocols/oauth2/native-app)

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
2. 在 Windows 正式版连接 Google Drive。如果安装包未配置内置客户端，可导入之前的 Desktop OAuth JSON。开发版和正式版各自保存授权状态。
3. 在原 Google Cloud 项目中为正式包创建 Android 客户端，包名用 `studio.sylunae.workshop`，SHA-1 用正式 APK 的签名值。用同一个 Google 账号连接后，即可查看此前在该项目下上传的备份。OAuth 客户端 JSON 留在本机。

## 第一次备份与验证

从源码测试时，在 Windows 运行 `pnpm dev:desktop`。手机可安装 `pnpm run package:android:debug` 生成的 APK，调试版和正式版使用各自独立的本地数据。

1. 在电脑的丝月工坊准备一条带图片的笔记、图片库的一张原图和一首音乐。在 **设置 → 数据与备份 → Google Drive 备份**，点 **连接 Google Drive**。如果该按钮尚未出现，先点 **导入桌面 OAuth 配置**，选择步骤 3 的 JSON。在系统浏览器选择测试账号并授权。
2. 在电脑点 **备份到 Google Drive → 开始上传**，等到提示「备份已发布」。如果列出缺失文件，先在工坊重新定位这些文件或移除失效索引。
3. 在手机准备一条便于辨认的本地测试笔记。在同一设置入口点 **连接 Google Drive**，选择电脑使用的账号。点 **从 Google Drive 恢复**，核对设备、时间和数量，再点 **下载并恢复**。
4. 手机开启飞行模式，重新打开工坊。确认笔记附件能显示、图片库能打开原图、音乐能播放。可点 **回退本次恢复**，确认手机上原来的测试笔记回来。
5. 在电脑只修改一条笔记后再次备份。确认上传数量只包含变化的数据文件，原来的音乐和图片应显示为复用。手机重新恢复后能看到修改后的笔记。
6. 在 Android 修改一条测试笔记并上传，再在 Windows 恢复。确认笔记显示新内容，并用 Windows 的 **回退本次恢复** 验证本地回退。
7. 用较大的测试媒体检查中断行为。上传新版本时断网，手机此时仍能查到上一次成功发布的备份。手机下载时断网，原有手机数据仍可使用。恢复网络后重试。

Drive 网页不会显示应用专用空间的文件。云端历史清单和已上传文件暂时保留，两端界面恢复最新发布的版本。备份会复制本地原件，外部图片链接仍然依赖原链接可用。已下载的官方白噪音资源可在手机资源管理中单独下载，自定义白噪音随备份恢复。

Google 官方说明可参见 [创建 OAuth 客户端](https://developers.google.com/workspace/guides/create-credentials)、[应用专用空间](https://developers.google.com/workspace/drive/api/guides/appdata) 和 [测试用户与授权期限](https://support.google.com/cloud/answer/15549945)。
