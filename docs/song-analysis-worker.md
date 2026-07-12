# 本地 Codex 歌词分析服务

本服务直接复用本机 Codex 的登录状态，不需要 `OPENAI_API_KEY`。首次使用前，确保 Codex 桌面端已经登录，然后在项目根目录运行：

```bash
pnpm worker:song-analysis
```

保持该终端运行，再打开歌曲页面。页面需要重新生成学习索引时，会把整首歌词交给本地 Codex 分析；正常耗时约 1–3 分钟。

服务默认只监听 `127.0.0.1:4319`。可用下面的地址确认它已经启动：

```text
http://127.0.0.1:4319/health
```

可选配置：

- `SONG_ANALYSIS_PORT`：修改本地端口。
- `VITE_SONG_ANALYSIS_URL`：让前端连接不同的本地地址，修改后需重新构建前端。
- `SONG_ANALYSIS_ORIGINS`：额外允许访问服务的前端来源，多个来源用逗号分隔。
- `CODEX_MODEL`：指定本机 Codex 可用的模型；不设置时沿用 Codex 默认模型。

worker 会把 Codex 输出限制为固定 JSON 结构，并在本地再次检查：释义必须是中文、不能是占位文案、表达必须真实存在于对应歌词、置信度不得低于 0.8。不通过的条目不会显示到学习页面。
