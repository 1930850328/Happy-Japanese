# 云端 Codex 学习信息 Worker

歌曲导入只保存音频、歌词和元数据。学习信息由独立的常驻 Worker 异步执行 Codex Agent 生成；浏览器不连接用户电脑，也不要求用户拉取项目或运行命令。

## 运行链路

```text
hxf-yuri.cn
  -> /api/song-assets 保存歌曲并立即返回
  -> 独立调用 /api/song-analysis 创建或恢复任务
  -> Redis / BullMQ
  -> song-analysis Worker
  -> Codex app-server（stdio）加载 generate-song-learning-info skill
  -> 回调 /api/song-analysis 保存学习索引到 TOS
  -> 前端轮询进度并刷新歌曲数据
```

歌曲保存接口不连接 Redis。独立的学习信息接口负责读取 TOS 中的权威歌词、限流、去重、入队和查询。Worker 使用只读临时 Codex 线程，通过项目内 skill 生成内容，再执行中文释义、原文匹配和置信度校验。

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

免费 Key Value 不保证重启后保留队列数据。歌曲记录会持久化确定性任务 ID，页面重新打开时会根据 TOS 中的歌词恢复丢失任务；需要队列本身持久化时再升级为付费实例。

检查线上 API 是否看到 Worker：

```bash
curl https://hxf-yuri.cn/api/song-analysis
```

正常响应应包含 `"workerAvailable":true`。

## 任务语义

- 任务 ID 根据规范化歌词内容生成，相同歌曲与歌词不会重复调用 Agent。
- 导入成功后立即结束导入状态，学习信息任务在独立链路中自动启动。
- 页面刷新会根据歌曲记录恢复轮询；Redis 丢失任务时会用同一个任务 ID 重新入队。
- 已完成结果默认在 Redis 保留 7 天，并受最大结果数限制。
- 失败任务由 BullMQ 自动重试，最终失败状态通过 Worker 回调保存到歌曲记录。
- 单个 Worker 串行执行 Codex。需要更多并发时增加 Worker 副本，不在同一 Codex 进程中并发执行。
- Worker 任务使用 `approvalPolicy: never`、`sandbox: read-only` 和临时线程。学习策略只维护在 `.agents/skills/generate-song-learning-info/SKILL.md`，运行时包装层只传输入和输出 Schema。
