/**
 * dsh-deliverable-menu —— 节点半边。
 *
 * 两件事：
 *  1. 交付卡片右键菜单的宿主（纯 UI 在 lib/client.js，这里不需要服务端能力）；
 *  2. 给「代码导航」标签页提供工作区符号索引与文件读写：
 *
 *       POST /dsh-deliverable-menu/api
 *         { method:'index', sessionId, force? }        → { root, files, symbols, scanned }
 *         { method:'read',  sessionId, path }          → { path, text, lang, mtime }
 *         { method:'write', sessionId, path, text }    → { ok, mtime }
 *         { method:'find',  sessionId, query }         → { symbols, files }
 *
 * 安全边界：所有路径必须落在会话 cwd 之内；Host 必须是本机回环
 * （与 DSH 自身 /api 网关同一条信任前提），避免任意网页 POST 到本机端口。
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  branches,
  checkout,
  commit,
  diffFile,
  log,
  pull,
  push,
  repoRoot,
  stage,
  status as gitStatus,
  unstage,
} from './git.js'
import { isRunnable, launchFile, revealPath, runFile } from './run.js'
import {
  BINARY_EXT,
  MAX_DEPTH,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_SYMBOLS,
  MAX_TEXT_BYTES,
  SKIP_DIRS,
  TREE_SKIP_DIRS,
  langOf,
  scanText,
} from './scan.js'

export const name = 'dsh-deliverable-menu'

/** webServer 注册路由；sessions 解析会话 cwd。 */
export const inject = ['webServer', 'sessions']

const API_PATH = '/dsh-deliverable-menu/api'
/** 提示音资源（GET，不走 API 的 POST 通道）。 */
const ASSET_PATH = '/dsh-deliverable-menu/assets'
/** 允许对外提供的资源白名单：名字 → 文件名。 */
const ASSET_FILES = {
  'cue-ask.wav': 'cue-ask.wav',
  'cue-done.wav': 'cue-done.wav',
}
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const INDEX_TTL_MS = 300_000
const BODY_LIMIT = 8 * 1024 * 1024
const READ_BATCH = 48

/** cwd → { at, data } */
const indexCache = new Map()

// ---------------------------------------------------------------- HTTP 工具

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  if (res.headersSent) {
    res.destroy?.()
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.from(chunk)
    size += buf.length
    if (size > BODY_LIMIT) throw new Error('请求体过大')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Host 头只接受回环地址。 */
function trustedHost(req) {
  const raw = req.headers?.host
  const host = String((Array.isArray(raw) ? raw[0] : raw) ?? '').toLowerCase()
  if (!host) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
}

/** 请求路径 → cwd 内的绝对路径；越界返回 null。 */
function resolveInRoot(root, target) {
  if (!target) return null
  let abs
  try {
    abs = isAbsolute(target) ? resolve(target) : resolve(root, target)
  } catch {
    return null
  }
  const base = resolve(root)
  if (abs === base) return abs
  return abs.startsWith(base + sep) ? abs : null
}

// ---------------------------------------------------------------- 工作区索引

async function walk(root, includeAny = false) {
  const files = []
  const queue = [{ dir: root, depth: 0 }]
  while (queue.length > 0 && files.length < MAX_FILES) {
    const { dir, depth } = queue.shift()
    let list
    try {
      list = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of list) {
      if (files.length >= MAX_FILES) break
      if (ent.isSymbolicLink()) continue
      const name = ent.name
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        if (depth + 1 <= MAX_DEPTH) queue.push({ dir: join(dir, name), depth: depth + 1 })
        continue
      }
      if (!ent.isFile()) continue
      if (includeAny) {
        const dot = name.lastIndexOf('.')
        const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
        if (BINARY_EXT.has(ext)) continue
      } else {
        if (name.endsWith('.min.js') || name.endsWith('.map')) continue
        if (langOf(name) === 'text') continue
      }
      files.push(join(dir, name))
    }
  }
  return files
}

function looksBinary(buffer) {
  const n = Math.min(buffer.length, 4096)
  for (let i = 0; i < n; i++) if (buffer[i] === 0) return true
  return false
}

async function buildIndex(root) {
  const candidates = await walk(root)
  const listed = []
  const symbols = []
  let scanned = 0
  for (let i = 0; i < candidates.length; i += READ_BATCH) {
    if (symbols.length >= MAX_SYMBOLS) break
    const slice = candidates.slice(i, i + READ_BATCH)
    const loaded = await Promise.all(
      slice.map(async (full) => {
        try {
          const info = await stat(full)
          if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
          const buffer = await readFile(full)
          if (looksBinary(buffer)) return null
          return { full, size: info.size, text: buffer.toString('utf8') }
        } catch {
          return null
        }
      }),
    )
    for (const item of loaded) {
      if (!item) continue
      const rel = relative(root, item.full).split(sep).join('/')
      const lang = langOf(rel)
      listed.push({ path: rel, lang, size: item.size })
      scanned += 1
      for (const sym of scanText(item.text, lang)) {
        symbols.push({ name: sym.name, kind: sym.kind, line: sym.line, path: rel, lang })
        if (symbols.length >= MAX_SYMBOLS) break
      }
    }
  }
  return { root, files: listed, symbols, scanned, at: Date.now() }
}

async function indexFor(root, force) {
  const cached = indexCache.get(root)
  if (!force && cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.data
  const data = await buildIndex(root)
  indexCache.set(root, { at: Date.now(), data })
  return data
}

// ---------------------------------------------------------------- 模糊检索

/** 子序列模糊匹配；返回 score，-1 表示不匹配。 */
function fuzzyScore(text, query) {
  const haystack = String(text).toLowerCase()
  const needle = String(query).toLowerCase()
  if (!needle) return 0
  let hi = 0
  let score = 0
  let streak = 0
  for (let qi = 0; qi < needle.length; qi++) {
    const found = haystack.indexOf(needle[qi], hi)
    if (found < 0) return -1
    streak = found === hi ? streak + 1 : 0
    score += 10 - Math.min(9, found - hi) + streak * 6
    hi = found + 1
  }
  if (haystack.startsWith(needle)) score += 40
  return score - haystack.length * 0.05
}

function findIn(index, query) {
  const q = String(query || '').trim()
  if (!q) return { symbols: [], files: [] }
  const symbols = []
  for (const sym of index.symbols) {
    const score = fuzzyScore(sym.name, q)
    if (score > 0) symbols.push({ ...sym, score })
  }
  symbols.sort((a, b) => b.score - a.score || a.name.length - b.name.length)
  const files = []
  for (const file of index.files) {
    const base = file.path.slice(file.path.lastIndexOf('/') + 1)
    const score = Math.max(fuzzyScore(base, q), fuzzyScore(file.path, q) - 20)
    if (score > 0) files.push({ ...file, score })
  }
  files.sort((a, b) => b.score - a.score)
  return { symbols: symbols.slice(0, 200), files: files.slice(0, 60) }
}

// ---------------------------------------------------------------- 文件树 / 新建 / 全文搜索

function toRel(root, abs) {
  return relative(root, abs).split(sep).join('/')
}


/** "产物"扩展名（和客户端 ARTIFACT_EXTS 保持一致的白名单）。 */
const ARTIFACT_EXT = new Set([
  'exe', 'dll', 'msi', 'msix', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'appimage',
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'whl', 'jar', 'apk', 'ipa', 'iso',
  'pdf', 'png', 'jpg', 'jpeg', 'svg', 'mp4', 'bin', 'hex', 'elf', 'so', 'a', 'lib',
])

/** 产物目录（在这些目录里即使扩展名不认识也当产物）。 */
const ARTIFACT_DIR = ['dist', 'build', 'release', 'out', 'bin', 'target', 'artifacts']

/**
 * 找"最近产出的产物"：按 mtime 过滤，比解析构建命令更可靠。
 * @param {string} root - 工作区根
 * @param {number} sinceMs - 只收 mtime ≥ 这个时间戳的文件
 * @returns {Promise<{files: Array, scanned: number}>}
 */
async function recentArtifacts(root, sinceMs) {
  const out = []
  let scanned = 0
  const skip = new Set([...TREE_SKIP_DIRS, 'node_modules', '__pycache__', '.venv', 'venv', 'dist-newstyle'])
  const walk = async (dir, depth) => {
    if (depth > 6 || out.length >= 60) return
    let list = []
    try {
      list = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of list) {
      const name = ent.name
      if (ent.isSymbolicLink()) continue
      const full = join(dir, name)
      if (ent.isDirectory()) {
        if (skip.has(name)) continue
        await walk(full, depth + 1)
        continue
      }
      scanned += 1
      const ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || ''
      const inArtifactDir = ARTIFACT_DIR.some((d) => `/${toRel(root, full)}`.toLowerCase().includes(`/${d}/`))
      if (!ARTIFACT_EXT.has(ext) && !inArtifactDir) continue
      try {
        const info = await stat(full)
        if (info.mtimeMs < sinceMs) continue
        out.push({ path: toRel(root, full), name, size: info.size, mtime: info.mtimeMs })
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  await walk(root, 0)
  out.sort((a, b) => b.mtime - a.mtime)
  return { files: out.slice(0, 12), scanned }
}

/** 列一层目录（目录优先，名称不区分大小写排序）。 */
async function listDir(root, relPath) {
  const abs = resolveInRoot(root, relPath || '.')
  if (!abs) throw new Error('路径越界')
  const list = await readdir(abs, { withFileTypes: true })
  const out = []
  for (const ent of list) {
    if (ent.isSymbolicLink()) continue
    const name = ent.name
    const isDir = ent.isDirectory()
    if (isDir && TREE_SKIP_DIRS.has(name)) continue
    const full = join(abs, name)
    let size = 0
    if (!isDir) {
      try {
        size = (await stat(full)).size
      } catch {
        continue
      }
    }
    out.push({
      name,
      path: toRel(root, full),
      type: isDir ? 'dir' : 'file',
      size,
      runnable: isDir ? false : isRunnable(name),
    })
  }
  out.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name, 'zh', { sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1,
  )
  const LIMIT = 2000
  if (out.length > LIMIT) return { entries: out.slice(0, LIMIT), total: out.length, truncated: true }
  return { entries: out, total: out.length, truncated: false }
}

/** 新建目录（支持多级）。 */
async function createDir(root, relPath) {
  const rel = String(relPath || '').trim().replace(/\\/g, '/')
  if (!rel) throw new Error('目录名为空')
  const abs = resolveInRoot(root, rel)
  if (!abs) throw new Error('路径越界')
  await mkdir(abs, { recursive: true })
  indexCache.delete(resolve(root))
  return toRel(root, abs)
}

/** 新建文件（父目录自动创建；已存在时报错，不覆盖）。 */
async function createFile(root, relPath, text = '') {
  const rel = String(relPath || '').trim().replace(/\\/g, '/')
  if (!rel) throw new Error('文件名为空')
  const abs = resolveInRoot(root, rel)
  if (!abs) throw new Error('路径越界')
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
  indexCache.delete(resolve(root))
  return toRel(root, abs)
}

/** 跨文件文本搜索（普通串或正则），返回 行级命中。 */
async function searchInFiles(root, query, opts = {}) {
  const q = String(query || '')
  if (!q) return { matches: [], scanned: 0, truncated: false }
  const maxResults = Math.min(2000, Number(opts.maxResults) || 300)
  const caseSensitive = opts.caseSensitive === true
  let re = null
  if (opts.regex) {
    try {
      re = new RegExp(q, caseSensitive ? 'g' : 'gi')
    } catch (error) {
      throw new Error(`正则无效：${error.message}`)
    }
  }
  const needle = caseSensitive ? q : q.toLowerCase()
  const files = await walk(root, true)
  const matches = []
  let scanned = 0
  let truncated = false
  for (const full of files) {
    let buffer
    try {
      const info = await stat(full)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
      buffer = await readFile(full)
    } catch {
      continue
    }
    if (looksBinary(buffer)) continue
    scanned += 1
    const rel = toRel(root, full)
    const lines = buffer.toString('utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 4000) continue
      if (re) {
        re.lastIndex = 0
        let m = re.exec(line)
        while (m) {
          matches.push({ path: rel, line: i + 1, col: m.index + 1, len: m[0].length, text: line.slice(0, 240) })
          if (m[0].length === 0) re.lastIndex += 1
          if (matches.length >= maxResults) {
            truncated = true
            break
          }
          m = re.exec(line)
        }
      } else {
        const hay = caseSensitive ? line : line.toLowerCase()
        let from = 0
        for (;;) {
          const at = hay.indexOf(needle, from)
          if (at < 0) break
          matches.push({ path: rel, line: i + 1, col: at + 1, len: needle.length, text: line.slice(0, 240) })
          from = at + needle.length
          if (matches.length >= maxResults) {
            truncated = true
            break
          }
        }
      }
      if (truncated) break
    }
    if (truncated) break
  }
  return { matches, scanned, truncated }
}

// ---------------------------------------------------------------- 插件入口

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ASSET_PATH,
      handler: async (req, res) => {
        try {
          if (!trustedHost(req)) {
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('forbidden')
            return
          }
          if (String(req.method || 'GET').toUpperCase() !== 'GET') {
            res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('method not allowed')
            return
          }
          const url = new URL(String(req.url || ''), 'http://127.0.0.1')
          const name = decodeURIComponent(url.pathname.slice(ASSET_PATH.length).replace(/^\/+/, ''))
          const file = ASSET_FILES[name]
          if (!file) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
          }
          const full = join(ASSET_DIR, file)
          // 600 KB 的音频直接读进内存发出去：比 stream.pipe 少一层兼容坑（假的 res 也能测）
          const buf = await readFile(full)
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'content-length': String(buf.length),
            'cache-control': 'public, max-age=86400',
          })
          res.end(buf)
        } catch (err) {
          try {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end(`error: ${err && err.message}`)
          } catch (_) {
            /* 忽略 */
          }
        }
      },
    }),
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PATH,
        handler: async (req, res) => {
          try {
            if (!trustedHost(req)) {
              sendJson(res, 403, { ok: false, error: 'forbidden: non-loopback host' })
              return
            }
            if (String(req.method || 'GET').toUpperCase() !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            const body = await readBody(req)
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            const session = sessionId ? ctx.sessions?.get?.(sessionId) : undefined
            const root = session?.header?.cwd ?? session?.cwd
            if (!root || typeof root !== 'string') {
              sendJson(res, 400, { ok: false, error: '会话没有可用的工作区目录' })
              return
            }
            const method = typeof body.method === 'string' ? body.method : ''

            if (method === 'index') {
              const data = await indexFor(root, body.force === true)
              sendJson(res, 200, {
                ok: true,
                root: data.root,
                files: data.files,
                symbols: data.symbols,
                scanned: data.scanned,
                at: data.at,
              })
              return
            }

            if (method === 'find') {
              const data = await indexFor(root, false)
              sendJson(res, 200, { ok: true, ...findIn(data, body.query) })
              return
            }

            // ------------------------------------------------------ 文件树 / 新建 / 搜索
            if (method === 'tree') {
              const listed = await listDir(root, body.path)
              sendJson(res, 200, {
                ok: true,
                root,
                entries: listed.entries,
                total: listed.total,
                truncated: listed.truncated,
              })
              return
            }

            if (method === 'mkdir' || method === 'newFile') {
              const rel = String(body.path || '').trim().replace(/\\/g, '/')
              if (!rel) {
                sendJson(res, 400, { ok: false, error: '路径为空' })
                return
              }
              if (!resolveInRoot(root, rel)) {
                sendJson(res, 403, { ok: false, error: '路径越界' })
                return
              }
              try {
                const created =
                  method === 'mkdir'
                    ? await createDir(root, rel)
                    : await createFile(root, rel, typeof body.text === 'string' ? body.text : '')
                sendJson(res, 200, { ok: true, path: created })
              } catch (error) {
                const status = error && error.code === 'EEXIST' ? 409 : 500
                sendJson(res, status, { ok: false, error: String((error && error.message) || error) })
              }
              return
            }

            if (method === 'run' || method === 'launch' || method === 'reveal') {
              const abs = resolveInRoot(root, String(body.path || ''))
              if (!abs) {
                sendJson(res, 403, { ok: false, error: '路径越界' })
                return
              }
              let info
              try {
                info = await stat(abs)
              } catch {
                sendJson(res, 404, { ok: false, error: '文件不存在' })
                return
              }
              if (method === 'reveal') {
                const out = await revealPath(abs, info.isDirectory())
                sendJson(res, out.ok ? 200 : 500, out)
                return
              }
              if (!info.isFile()) {
                sendJson(res, 400, { ok: false, error: '只能运行文件' })
                return
              }
              if (method === 'launch') {
                if (!isRunnable(abs)) {
                  sendJson(res, 400, { ok: false, error: '不支持运行该类型文件' })
                  return
                }
                const launched = await launchFile(abs)
                sendJson(res, launched.ok ? 200 : 500, launched)
                return
              }
              const out = await runFile(abs)
              sendJson(res, 200, out)
              return
            }

            if (method === 'search') {
              const result = await searchInFiles(root, body.query, {
                regex: body.regex === true,
                caseSensitive: body.caseSensitive === true,
                maxResults: body.maxResults,
              })
              sendJson(res, 200, { ok: true, ...result })
              return
            }

            // ---------------------------------------------------------- Git
            if (method === 'artifacts') {
              const since = Number(body.sinceMs) > 0 ? Number(body.sinceMs) : Date.now() - 45 * 60 * 1000
              sendJson(res, 200, { ok: true, ...(await recentArtifacts(root, since)) })
              return
            }

            if (method === 'gitStatusAt') {
              const cwd = typeof body.cwd === 'string' ? body.cwd : ''
              if (!cwd) {
                sendJson(res, 400, { ok: false, error: '缺少 cwd' })
                return
              }
              sendJson(res, 200, { ok: true, ...(await gitStatus(cwd)) })
              return
            }

            if (method === 'gitStatus') {
              sendJson(res, 200, { ok: true, ...(await gitStatus(root)) })
              return
            }

            if (method === 'gitDiff') {
              const repo = await repoRoot(root)
              if (!repo) {
                sendJson(res, 400, { ok: false, error: '当前会话目录不是 git 仓库' })
                return
              }
              const rel = String(body.path || '')
              if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
                sendJson(res, 400, { ok: false, error: '非法路径' })
                return
              }
              const result = await diffFile(repo, rel.split(sep).join('/'), body.staged === true)
              if (result.ok && result.unified && result.unified.length > 2 * 1024 * 1024) {
                sendJson(res, 200, {
                  ok: true,
                  staged: result.staged,
                  tooLarge: true,
                  unified: '',
                  size: result.unified.length,
                })
                return
              }
              sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, ...result } : result)
              return
            }

            if (method === 'gitStage' || method === 'gitUnstage' || method === 'gitCommit') {
              const repo = await repoRoot(root)
              if (!repo) {
                sendJson(res, 400, { ok: false, error: '当前会话目录不是 git 仓库' })
                return
              }
              if (method === 'gitCommit') {
                const out = await commit(repo, body.message)
                sendJson(res, out.ok ? 200 : 400, { ok: out.ok, error: out.error, stdout: out.stdout })
                return
              }
              const rel = String(body.path || '')
              if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
                sendJson(res, 400, { ok: false, error: '非法路径' })
                return
              }
              const out = method === 'gitStage' ? await stage(repo, rel) : await unstage(repo, rel)
              indexCache.delete(resolve(root))
              sendJson(res, out.ok ? 200 : 400, { ok: out.ok, error: out.error })
              return
            }

            if (method === 'gitLog') {
              const repo = await repoRoot(root)
              sendJson(res, 200, { ok: true, commits: repo ? await log(repo, body.limit) : [] })
              return
            }

            if (method === 'gitBranches') {
              const repo = await repoRoot(root)
              sendJson(res, 200, { ok: true, branches: repo ? await branches(repo) : [] })
              return
            }

            if (method === 'gitCheckout' || method === 'gitPush' || method === 'gitPull') {
              const repo = await repoRoot(root)
              if (!repo) {
                sendJson(res, 400, { ok: false, error: '当前会话目录不是 git 仓库' })
                return
              }
              const out =
                method === 'gitCheckout'
                  ? await checkout(repo, body.branch)
                  : method === 'gitPush'
                    ? await push(repo)
                    : await pull(repo)
              indexCache.delete(resolve(root))
              sendJson(res, out.ok ? 200 : 400, {
                ok: out.ok,
                error: out.error,
                stdout: (out.stdout || '').slice(0, 4000),
              })
              return
            }

            if (method === 'read') {
              const abs = resolveInRoot(root, String(body.path || ''))
              if (!abs) {
                sendJson(res, 403, { ok: false, error: '路径越界' })
                return
              }
              const info = await stat(abs)
              if (!info.isFile()) {
                sendJson(res, 400, { ok: false, error: '不是文件' })
                return
              }
              if (info.size > MAX_TEXT_BYTES) {
                sendJson(res, 413, { ok: false, error: `文件过大（${info.size} 字节）` })
                return
              }
              const buffer = await readFile(abs)
              if (looksBinary(buffer)) {
                sendJson(res, 415, { ok: false, error: '二进制文件，不能以文本打开' })
                return
              }
              sendJson(res, 200, {
                ok: true,
                path: relative(root, abs).split(sep).join('/'),
                text: buffer.toString('utf8'),
                lang: langOf(abs),
                mtime: info.mtimeMs,
              })
              return
            }

            if (method === 'write') {
              const abs = resolveInRoot(root, String(body.path || ''))
              if (!abs) {
                sendJson(res, 403, { ok: false, error: '路径越界' })
                return
              }
              const text = typeof body.text === 'string' ? body.text : ''
              if (Buffer.byteLength(text) > MAX_TEXT_BYTES) {
                sendJson(res, 413, { ok: false, error: '内容过大' })
                return
              }
              await writeFile(abs, text, 'utf8')
              const info = await stat(abs)
              indexCache.delete(resolve(root))
              sendJson(res, 200, { ok: true, mtime: info.mtimeMs })
              return
            }

            sendJson(res, 404, { ok: false, error: `未知方法 ${method}` })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error?.message || error) })
          }
        },
      }),
    'dsh-deliverable-menu: /api 路由',
  )

  ctx.effect(() => () => indexCache.clear(), 'dsh-deliverable-menu: 索引缓存')
}
