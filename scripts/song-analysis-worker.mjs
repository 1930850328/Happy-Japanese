import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const PORT = Number.parseInt(process.env.SONG_ANALYSIS_PORT || '4319', 10)
const CODEX_ENTRY = fileURLToPath(new URL('../node_modules/@openai/codex/bin/codex.js', import.meta.url))
const MAX_BODY_BYTES = 1024 * 1024
const MAX_LINES = 250
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_CODEX_MODEL = 'gpt-5.6-luna'

const allowedOrigins = new Set([
  'https://yuru-nihongo-study.vercel.app',
  'https://www.hxf-yuri.cn',
  'https://hxf-yuri.cn',
  ...String(process.env.SONG_ANALYSIS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
])

function isAllowedOrigin(origin) {
  if (!origin) return true
  if (allowedOrigins.has(origin)) return true
  try {
    const url = new URL(origin)
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch {
    return false
  }
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
  response.setHeader('Cache-Control', 'no-store')
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function normalizeInput(value) {
  if (!value || typeof value !== 'object') throw new Error('请求格式不正确')
  const songId = String(value.songId || '').trim().slice(0, 200)
  const title = String(value.title || '').trim().slice(0, 300)
  const artist = String(value.artist || '').trim().slice(0, 300)
  if (!songId) throw new Error('缺少 songId')
  if (!Array.isArray(value.lyricLines) || value.lyricLines.length === 0) throw new Error('缺少歌词')
  if (value.lyricLines.length > MAX_LINES) throw new Error(`歌词不能超过 ${MAX_LINES} 行`)

  const lyricLines = value.lyricLines.map((line, index) => {
    const id = String(line?.id || `line-${index + 1}`).trim().slice(0, 200)
    const ja = String(line?.ja || '').trim().slice(0, 1000)
    const zh = String(line?.zh || '').trim().slice(0, 1000)
    if (!id || !ja) throw new Error(`第 ${index + 1} 行歌词不完整`)
    return { id, ja, zh }
  })

  return { songId, title, artist, lyricLines }
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'songId', 'lines'],
  properties: {
    version: { type: 'integer', enum: [1] },
    songId: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lineId', 'translationZh', 'items'],
        properties: {
          lineId: { type: 'string' },
          translationZh: { type: 'string' },
          items: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['expression', 'reading', 'meaningZh', 'kind', 'explanationZh', 'stage', 'confidence'],
              properties: {
                expression: { type: 'string' },
                reading: { type: 'string' },
                meaningZh: { type: 'string' },
                kind: { type: 'string', enum: ['word', 'grammar'] },
                explanationZh: { type: 'string' },
                stage: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
    },
  },
}

function createPrompt(input) {
  return `你是一名严谨的日语教师。请结合整首歌的上下文，把歌词制作成面向中文母语学习者的高质量学习索引。

硬性要求：
1. 每行给出自然、准确的简体中文翻译；不要逐字硬译，也不要凭空补剧情。
2. 每行只挑 1-4 个真正值得学习的词、固定搭配或语法；助词只有在构成明确语法时才选。
3. expression 必须是该行日文中的连续原文，不能改写。
4. meaningZh 必须是该上下文里的明确中文义，禁止“词义待补充”“待确认”等占位内容，禁止把日文原样当中文释义。
5. explanationZh 要说明它在本句中的用法或语感，不能只重复释义。
6. reading 用平假名。confidence 只表示你对当前上下文判断的信心；低于 0.8 的条目不要输出。
7. 保留每一个 lineId，顺序与输入一致。只输出符合所给 JSON Schema 的 JSON。
8. 不要调用任何工具，不要访问文件或网络。

输入：
${JSON.stringify(input)}`
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(value)
}

function validateAnalysis(raw, input) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines)) throw new Error('Codex 返回结果格式不正确')
  const sourceById = new Map(input.lyricLines.map((line) => [line.id, line]))
  const resultById = new Map()

  for (const resultLine of raw.lines) {
    const lineId = String(resultLine?.lineId || '')
    const sourceLine = sourceById.get(lineId)
    if (!sourceLine || resultById.has(lineId)) continue
    const translationZh = String(resultLine.translationZh || '').trim()
    const items = Array.isArray(resultLine.items) ? resultLine.items : []
    const validItems = items.slice(0, 4).flatMap((item) => {
      const expression = String(item?.expression || '').trim()
      const reading = String(item?.reading || '').trim()
      const meaningZh = String(item?.meaningZh || '').trim()
      const explanationZh = String(item?.explanationZh || '').trim()
      const confidence = Number(item?.confidence)
      const kind = item?.kind
      const stage = item?.stage
      const invalidMeaning = !meaningZh || /待补充|待确认|未知|不明/.test(meaningZh) || meaningZh === expression || !containsChinese(meaningZh)
      if (!expression || !sourceLine.ja.includes(expression) || invalidMeaning || !explanationZh || !containsChinese(explanationZh)) return []
      if (!['word', 'grammar'].includes(kind) || !['beginner', 'intermediate', 'advanced'].includes(stage)) return []
      if (!Number.isFinite(confidence) || confidence < 0.8 || confidence > 1) return []
      return [{ expression, reading, meaningZh, explanationZh, confidence, kind, stage }]
    })
    resultById.set(lineId, {
      lineId,
      translationZh: translationZh && containsChinese(translationZh) ? translationZh : sourceLine.zh,
      items: validItems,
    })
  }

  const lines = input.lyricLines.map((line) => resultById.get(line.id) || {
    lineId: line.id,
    translationZh: line.zh,
    items: [],
  })
  if (!lines.some((line) => line.items.length > 0)) throw new Error('Codex 没有返回通过质量校验的学习内容')
  return { version: 1, songId: input.songId, lines }
}

function parseJsonMessage(text) {
  const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(value)
}

class CodexAppServer {
  constructor() {
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.turns = new Map()
    this.jobs = new Map()
    this.currentJob = null
    this.analysisQueue = Promise.resolve()
  }

  updateJob(job, phase, message) {
    job.phase = phase
    job.message = message
    job.updatedAt = Date.now()
  }

  getJobSnapshot(job) {
    const queuedJobs = [...this.jobs.values()].filter((item) => item.phase === 'queued')
    const queueIndex = queuedJobs.indexOf(job)
    return {
      songId: job.songId,
      phase: job.phase,
      message: job.message,
      elapsedMs: Date.now() - job.createdAt,
      queuePosition: queueIndex >= 0 ? queueIndex + 1 : 0,
      model: process.env.CODEX_MODEL || DEFAULT_CODEX_MODEL,
    }
  }

  listJobs() {
    return [...this.jobs.values()].map((job) => this.getJobSnapshot(job))
  }

  async ensureStarted() {
    if (this.child && !this.child.killed) return
    const child = spawn(process.execPath, [CODEX_ENTRY, 'app-server', '--listen', 'stdio://', '--disable', 'remote_plugin'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line))
    child.stderr.on('data', (chunk) => {
      const value = String(chunk)
      if (this.currentJob && value.includes('stream disconnected')) {
        this.updateJob(this.currentJob, 'reconnecting', 'Codex 连接中断，正在自动重试')
      }
      if (this.currentJob && value.includes('falling back to HTTP')) {
        this.updateJob(this.currentJob, 'analyzing', '已切换到 HTTP，正在生成歌词解析')
      }
      process.stderr.write(`[codex] ${chunk}`)
    })
    child.once('exit', (code, signal) => this.handleExit(code, signal))
    await this.request('initialize', {
      clientInfo: { name: 'happy-japanese-song-worker', title: 'Happy Japanese Song Worker', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    }, 30_000)
    this.notify('initialized', {})
  }

  handleLine(line) {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || 'Codex 请求失败'))
      else pending.resolve(message.result)
      return
    }
    if (message.id !== undefined && message.method) {
      this.write({ id: message.id, result: { decision: 'decline' } })
      return
    }
    const turnId = message.params?.turn?.id || message.params?.turnId
    if (!turnId) return
    const turn = this.turns.get(turnId)
    if (!turn) return
    if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage') {
      turn.messages.push(message.params.item.text || '')
      if (this.currentJob) this.updateJob(this.currentJob, 'generating', 'Codex 已生成结果，正在接收内容')
    }
    if (message.method === 'turn/completed') {
      this.turns.delete(turnId)
      if (message.params?.turn?.status === 'completed') turn.resolve(turn.messages.join('\n'))
      else turn.reject(new Error(message.params?.turn?.error?.message || `Codex 分析${message.params?.turn?.status || '失败'}`))
    }
  }

  handleExit(code, signal) {
    const error = new Error(`Codex 服务意外退出 (${code ?? signal ?? 'unknown'})`)
    this.child = null
    for (const pending of this.pending.values()) pending.reject(error)
    for (const turn of this.turns.values()) turn.reject(error)
    this.pending.clear()
    this.turns.clear()
  }

  write(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex 服务未启动')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex ${method} 请求超时`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.write({ id, method, params })
    })
  }

  notify(method, params) {
    this.write({ method, params })
  }

  analyze(input) {
    const existing = this.jobs.get(input.songId)
    if (existing) return existing.promise

    const job = {
      songId: input.songId,
      phase: 'queued',
      message: '任务已进入队列',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      promise: null,
    }
    const task = async () => {
      this.currentJob = job
      try {
        this.updateJob(job, 'starting', '正在启动本地 Codex')
        await this.ensureStarted()
        this.updateJob(job, 'preparing', '正在创建歌词分析任务')
        const threadResult = await this.request('thread/start', {
          cwd: process.cwd(),
          ephemeral: true,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          model: process.env.CODEX_MODEL || DEFAULT_CODEX_MODEL,
        })
        const threadId = threadResult?.thread?.id
        if (!threadId) throw new Error('Codex 未创建分析线程')
        this.updateJob(job, 'analyzing', 'Codex 正在理解整首歌词')
        const turnResult = await this.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: createPrompt(input) }],
          model: process.env.CODEX_MODEL || DEFAULT_CODEX_MODEL,
          effort: 'low',
          summary: 'none',
          outputSchema,
        })
        const turnId = turnResult?.turn?.id
        if (!turnId) throw new Error('Codex 未开始分析')
        const text = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.turns.delete(turnId)
            reject(new Error('Codex 歌词分析超过 5 分钟，任务已终止'))
          }, REQUEST_TIMEOUT_MS)
          this.turns.set(turnId, {
            messages: [],
            resolve: (value) => { clearTimeout(timer); resolve(value) },
            reject: (error) => { clearTimeout(timer); reject(error) },
          })
        })
        this.updateJob(job, 'validating', '正在校验翻译、词义和语法')
        return validateAnalysis(parseJsonMessage(text), input)
      } finally {
        if (this.currentJob === job) this.currentJob = null
      }
    }
    const result = this.analysisQueue.then(task, task)
    job.promise = result
    this.jobs.set(input.songId, job)
    this.analysisQueue = result.catch(() => {})
    void result.then(() => {
      this.updateJob(job, 'completed', '分析完成')
      setTimeout(() => this.jobs.get(input.songId) === job && this.jobs.delete(input.songId), 30_000)
    }).catch((error) => {
      this.updateJob(job, 'failed', error instanceof Error ? error.message : '歌词分析失败')
      setTimeout(() => this.jobs.get(input.songId) === job && this.jobs.delete(input.songId), 30_000)
    })
    return result
  }
}

const codex = new CodexAppServer()

const server = createServer(async (request, response) => {
  setCorsHeaders(request, response)
  const origin = request.headers.origin
  if (origin && !isAllowedOrigin(origin)) return sendJson(response, 403, { error: '不允许的来源' })
  if (request.method === 'OPTIONS') return sendJson(response, 204, {})
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`)
  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    return sendJson(response, 200, { ok: true, provider: 'codex-app-server', busy: codex.jobs.size > 0, jobs: codex.listJobs() })
  }
  if (request.method === 'GET' && requestUrl.pathname === '/status') {
    const job = codex.jobs.get(requestUrl.searchParams.get('songId') || '')
    return sendJson(response, 200, job ? codex.getJobSnapshot(job) : { phase: 'idle', message: '等待任务' })
  }
  if (request.method === 'POST' && requestUrl.pathname === '/analyze') {
    try {
      const input = normalizeInput(await readJsonBody(request))
      const analysis = await codex.analyze(input)
      return sendJson(response, 200, analysis)
    } catch (error) {
      console.error('[song-analysis]', error)
      return sendJson(response, 500, { error: error instanceof Error ? error.message : '歌词分析失败' })
    }
  }
  return sendJson(response, 404, { error: 'Not Found' })
})

server.listen(PORT, HOST, () => {
  console.log(`Song analysis worker: http://${HOST}:${PORT}`)
  console.log('The worker uses your local Codex login and does not require OPENAI_API_KEY.')
})
