# 丝月工坊

丝月工坊是一个本地优先的个人工具总站，使用 React、TypeScript、Vite 与 Electron 构建。桌面版使用 SQLite 保存数据，网页轻量版使用 IndexedDB。

Android 客户端通过 Capacitor 复用现有前端，使用私有目录、原生 SQLite 与 Media3 后台播放器。构建、安装及电脑数据迁移见 [Android 开发与使用说明](docs/android.md)。

## 首版功能

- 匿名读取并缓存一个 Bangumi 用户的公开收藏，支持五类条目、筛选、排序和详情查看
- 桌面端本地音乐资料库、播放队列、随机与循环播放、失效文件重新定位
- Tiptap 所见即所得笔记、文件夹、标签、置顶、全文搜索和回收站
- 目标、里程碑、自动进度、逾期提示、完成与归档视图
- 浅色、深色、跟随系统，以及 JSON 全量备份与恢复

## 开发与构建

```bash
npm install
npm run dev:web
npm run dev:desktop
npm run test
npm run build:web
npm run build:desktop
npm run package:win
```

网页生产文件输出到 `dist/`，Electron 构建输出到 `out/`，Windows 安装包输出到 `release/`。

## UI 组件

项目使用 shadcn/ui + Tailwind CSS v4 作为基础 UI 层，组件源码位于 `src/components/ui`。新增标准交互时优先复用现有组件，或使用官方 CLI 添加：

```bash
npx shadcn@latest add <component>
```

应用的品牌配色和浅/深色 token 仍统一在 `src/styles.css` 中维护。请使用 Dialog、AlertDialog 等组件代替浏览器原生 `alert` / `confirm` / `prompt`，以兼容 Electron。

## 数据说明

- Electron 数据库位于系统分配的应用数据目录，数据库名为 `sylunae-workshop.sqlite`。
- 网页版数据保存在当前浏览器的 `sylunae-workshop` IndexedDB 中。
- 音乐文件不会被复制或删除；应用只保存文件路径和元数据索引。
- 备份包含设置、收藏缓存、笔记、目标和音乐索引，不包含音乐原文件。
- Bangumi 集成只读取公开收藏，不需要登录，也不会写回用户账号。
