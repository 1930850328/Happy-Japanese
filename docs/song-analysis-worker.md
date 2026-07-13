# 云端 Codex 歌词分析 Worker

歌曲学习索引使用独立的常驻 Worker 执行 Codex Agent。浏览器不连接用户电脑，也不要求用户拉取项目或运行命令。

## 运行链路

```text
hxf-yuri.cn
  -> /api/song-analysis
  -> Redis / BullMQ
  -> song-analysis Worker
  -> Codex app-server（stdio）
  -> Redis 中的任务结果
  -> 前端轮询并保存学习索引
```

Vercel API 只负责校验、限流、去重、入队和查询。Worker 使用只读、无工具的临时 Codex 线程分析歌词，并继续执行中文释义、原文匹配和置信度校验。

## 必要环境变量

Vercel 和 Worker 必须连接同一个 Redis：

```dotenv
SONG_ANALYSIS_REDIS_URL=rediss://default:password@redis.example.com:6380/0
SONG_ANALYSIS_QUEUE_PREFIX=happy-japanese
```

Worker 可选配置：

```dotenv
CODEX_MODEL=
SONG_ANALYSIS_AGENT_TIMEOUT_MS=300000
SONG_ANALYSIS_JOB_ATTEMPTS=2
SONG_ANALYSIS_RETRY_DELAY_MS=5000
```

Vercel API 可选配置：

```dotenv
SONG_ANALYSIS_ALLOWED_ORIGINS=https://hxf-yuri.cn,https://www.hxf-yuri.cn
SONG_ANALYSIS_RATE_LIMIT_MAX=10
SONG_ANALYSIS_RATE_LIMIT_WINDOW_SECONDS=3600
SONG_ANALYSIS_RESULT_TTL_SECONDS=604800
SONG_ANALYSIS_RESULT_MAX_COUNT=500
```

生产环境应使用 TLS Redis 地址，不要把 Redis 端口直接暴露到公网。

## 构建与登录

构建 Worker 镜像：

```bash
docker build -f Dockerfile.song-analysis-worker -t happy-japanese-song-worker .
docker volume create happy-japanese-codex
```

在 Worker 主机上完成一次 Codex 设备登录。凭证只保存在 Docker volume，不写入镜像或仓库：

```bash
docker run --rm -it \
  -v happy-japanese-codex:/data/codex \
  --entrypoint node \
  happy-japanese-song-worker \
  node_modules/@openai/codex/bin/codex.js login --device-auth
```

确认登录状态：

```bash
docker run --rm \
  -v happy-japanese-codex:/data/codex \
  --entrypoint node \
  happy-japanese-song-worker \
  node_modules/@openai/codex/bin/codex.js login status
```

## 启动 Worker

复制配置模板并在服务器上填写真实 Redis 地址。`worker.env` 已被 Git 忽略：

```bash
cp worker.env.example worker.env
```

然后用 Compose 启动：

```bash
docker compose -f docker-compose.song-analysis-worker.yml up -d --build
```

也可以直接运行容器：

```bash
docker run -d \
  --name happy-japanese-song-worker \
  --restart unless-stopped \
  --env-file worker.env \
  -v happy-japanese-codex:/data/codex \
  happy-japanese-song-worker
```

Worker 每 10 秒向 Redis 写入短期心跳。没有活跃 Worker 时，API 拒绝创建新任务，避免用户一直等待无人消费的队列。

检查日志：

```bash
docker logs -f happy-japanese-song-worker
```

如果使用 Compose，查看日志的命令是：

```bash
docker compose -f docker-compose.song-analysis-worker.yml logs -f
```

## Render 托管部署

仓库根目录的 `render.yaml` 会创建：

- 新加坡区的 Starter Background Worker；
- 1 GB 持久磁盘，挂载到 `/data/codex`；
- 免费的 Redis 兼容 Key Value 队列。

在 Render 创建 Blueprint 后，从 Worker 的 Shell 页面执行一次：

```bash
node node_modules/@openai/codex/bin/codex.js login --device-auth
```

登录状态会保存在持久磁盘。Render Worker 使用 Key Value 的内部地址；Vercel 则需要配置同一个 Key Value 的 External URL：

```dotenv
SONG_ANALYSIS_REDIS_URL=rediss://default:password@external-host:6379
SONG_ANALYSIS_QUEUE_PREFIX=happy-japanese
```

免费 Key Value 不保证重启后保留队列数据，适合个人使用和初期验证；需要持久化时再升级为付费实例。

检查线上 API 是否看到 Worker：

```bash
curl https://hxf-yuri.cn/api/song-analysis
```

正常响应应包含 `"workerAvailable":true`。

## 任务语义

- 任务 ID 根据规范化歌词内容生成，相同歌曲与歌词不会重复调用 Agent。
- 已完成结果默认在 Redis 保留 7 天，并受最大结果数限制。
- 失败任务由 BullMQ 自动重试；用户再次提交失败任务时可以重新入队。
- 单个 Worker 串行执行 Codex。需要更多并发时增加 Worker 副本，不在同一 Codex 进程中并发执行。
- Worker 任务使用 `approvalPolicy: never`、`sandbox: read-only` 和临时线程，并禁止 Agent 使用工具或网络。
