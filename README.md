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

切片链路的长期升级方案记录在 [`docs/slicing-pipeline-plan.md`](docs/slicing-pipeline-plan.md)。这份计划把生产级切片从浏览器自研流程迁移到可维护、可扩展的 CLI / Worker 管线，并定义了 manifest v2、阶段产物、验证标准和实施顺序。

当前仓库已经是 monorepo，切片 CLI 位于 `packages/anime-learning-slicer`。可以直接在本仓库根目录执行：

```bash
npm run ingest:video -- --input F:\path\to\episode01.mkv --anime "Bocchi the Rock!" --episode "EP01"
```

这条命令会自动完成：

1. 调用 monorepo 内的 `packages/anime-learning-slicer`
2. 使用 FFmpeg 对原片进行真实裁切
3. 优先读取视频内嵌字幕；没有字幕轨时使用 Transformers.js Whisper ASR 生成日语时间轴字幕
4. 使用开源字幕解析、Kuromoji 和 Wanakana 生成中文字幕、封面和知识点元数据
5. 自动同步到 `public/generated-slices`
6. 让首页短视频模块自动加载这些切片

如果你想要“丢一个视频进去就自动处理”，可以启动监听模式：

```bash
npm run watch:video-inbox
```

默认监听目录是：

```text
./inbox
```

把 `mp4 / mkv / mov / webm / avi` 视频放进去后，切片会自动生成并导入首页短视频流。

如果视频自带字幕轨，CLI 会优先尝试提取；如果同名字幕文件存在，也会自动拾取。它们是内部生产素材，不是页面要求用户额外上传的文件：

- `episode01.ass`
- `episode01.srt`
- `episode01.vtt`

如果没有日语字幕轨或同名字幕，CLI 会自动使用开源 ASR 生成日语字幕；如果视频只有中文字幕轨，它会作为翻译时间轴合并进 ASR 结果，不再被误当作日语原文。默认模型是 `onnx-community/whisper-small_timestamped`，可以按机器性能调整：

```bash
npm run ingest:video -- --input ./episode01.mp4 --asrModel onnx-community/whisper-base_timestamped
```

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

如果你想让“我的”页面里导入的视频文件保存到网站，而不是浏览器本地，需要先创建 Cloudflare R2 Bucket，并在 Vercel 项目里配置：

- `MEDIA_STORAGE_PROVIDER=r2`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`
- `VIDEO_UPLOAD_PASSWORD`（可选，推荐）

其中：

- `R2_ACCOUNT_ID` 是 Cloudflare 账户 ID；如果你想手动指定 S3 兼容 endpoint，也可以改用 `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 是 R2 API Token 里的 S3 凭证
- `R2_BUCKET` 是视频 Bucket 名
- `R2_PUBLIC_BASE_URL` 是 Bucket 的公开访问域名，例如 `https://media.example.com`
- `VIDEO_UPLOAD_PASSWORD` 如果配置了，就会保护站内上传入口，避免任何访客都能往你的网站传视频
- 如果不配置 `VIDEO_UPLOAD_PASSWORD`，网站端视频上传也可以正常工作，只是上传入口不会额外做密码校验

R2 Bucket 还需要配置 CORS，允许你的网站域名直接 `PUT` 视频到 R2。示例：

```json
[
  {
    "AllowedOrigins": ["https://你的域名.com", "http://localhost:4173"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"]
  }
]
```

配置完成后，页面导入会变成：

1. 本地预览和切片分析仍然在浏览器里完成
2. 点击导入后，前端向站点 API 申请 R2 上传地址，然后把视频直传到 R2
3. 浏览器本地只保留字幕、知识点、切片区间和导入记录

注意：

- 现在“视频文件”已经改为网站存储
- 收藏、笔记、目标、学习记录、复习队列、设置、导入视频元数据也已经改成网站端持久化
- 浏览器本地现在只保留一个云端档案 ID，用来把当前设备映射到对应的云端学习数据
- 如果你清空了浏览器本地存储，这个档案 ID 会丢失；旧的云端数据还在，但当前版本还没有做“找回档案 ID”的界面
- 旧版本里“只存在浏览器 Blob、还没有站内 URL”的本地视频，当前不会自动上传迁移；这类老数据需要重新导入一次
- 站内上传 API 走的是 `api/video-upload.mjs` / `api/video-delete.mjs`，本地如果只跑 `npm run dev`，这两条接口不会由 Vite 直接托管；要测试上传请用已部署站点或 `vercel dev`

## 内容说明

- 默认公开视频素材来自公开资源
- 页面导入的视频文件会上传到你的网站存储
- 导入后的字幕、知识点和切片元数据也会跟随学习状态一起保存在网站端
- 自动切片结果会落到 `public/generated-slices`
- 浏览器端也会定时扫描这批自动生成的切片并更新首页短视频流
