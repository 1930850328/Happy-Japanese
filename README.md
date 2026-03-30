# YuruNihongo

轻松、治愈、偏动漫氛围的日语自学网页，基于 `React + Vite + TypeScript`。

## 功能

- 短视频沉浸式学习流
- 句子 / 单词解析、罗马音、语法命中和本地备注
- 每日目标、连续打卡、收藏回看
- 艾宾浩斯复习队列
- 高频单词速记库
- 本地番剧原片切片后自动接入首页短视频模块

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 自动切片并导入短视频模块

如果你已经把独立切片仓库 `anime-learning-slicer` 放在当前项目同级目录，可以直接在本仓库根目录执行：

```bash
npm run ingest:video -- --input F:\path\to\episode01.mkv --anime "Bocchi the Rock!" --episode "EP01"
```

这条命令会自动完成：

1. 调用 `anime-learning-slicer`
2. 对原片进行切片
3. 生成字幕、封面和知识点元数据
4. 自动同步到 `public/generated-slices`
5. 让首页短视频模块自动加载这些切片

如果你想要“丢一个视频进去就自动处理”，可以启动监听模式：

```bash
npm run watch:video-inbox
```

默认监听目录是：

```text
..\anime-learning-slicer\inbox
```

把 `mp4 / mkv / mov / webm / avi` 视频放进去后，切片会自动生成并导入首页短视频流。

如果同名字幕文件存在，也会自动拾取：

- `episode01.ass`
- `episode01.srt`
- `episode01.vtt`

如果同名 JSON 存在，也会自动覆盖元数据和切片参数：

```json
{
  "animeTitle": "Bocchi the Rock!",
  "episodeTitle": "EP01",
  "publishedSlug": "bocchi-ep01",
  "minClips": 6,
  "maxClips": 12,
  "minDurationSec": 12,
  "maxDurationSec": 45
}
```

## 部署到 Vercel

项目已包含 `vercel.json`，支持 SPA 路由刷新。

```bash
npm run build
```

输出目录为：

```text
dist
```

## 内容说明

- 默认公开视频素材来自公开资源
- 私有本地视频只在你自己的本地工作流中处理
- 自动切片结果会落到 `public/generated-slices`
- 浏览器端也会定时扫描这批自动生成的切片并更新首页短视频流
