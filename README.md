# YuruNihongo

轻松、治愈、偏动漫氛围的日语自学网页，基于 `React + Vite + TypeScript`。

## 功能

- 短视频沉浸式学习流，支持公开 YouTube 视频和本地私有视频导入
- 句子 / 单词解析、罗马音、语法命中和本地备注
- 每日目标、连续打卡、收藏回看
- 艾宾浩斯复习队列
- 高频单词速记库

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 一键部署到 Vercel

1. 将项目推到你的 Git 仓库。
2. 在 Vercel 导入该仓库。
3. 构建命令使用 `npm run build`，输出目录使用 `dist`。

项目已包含 `vercel.json`，支持 SPA 路由刷新。

## 内容说明

- 默认视频素材来自公开视频和公开教学资源。
- 私有导入视频只保存在当前浏览器的 IndexedDB 中，不会上传。
- 词汇、例句和知识点为精选静态内容，适合 v1 自学使用。
