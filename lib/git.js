/**
 * Git 后端（节点侧）：只调用 git 命令行，不依赖任何库。
 *
 * 与 VS Code 的语义对齐：
 *   「更改」   = 工作区 vs 索引      → git diff
 *   「暂存的更改」= 索引 vs HEAD     → git diff --cached
 * 未跟踪文件没有 diff，这里按"整文件新增"合成一份，保证并排视图也能显示。
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/** 候选 git 路径：环境变量 → PATH → 常见安装位置。 */
const CANDIDATES = [
  process.env.DSH_GIT_PATH,
  'git',
  'C:/Program Files/Git/cmd/git.exe',
  'C:/Program Files (x86)/Git/cmd/git.exe',
  'D:/Git/cmd/git.exe',
  'D:/Git/bin/git.exe',
].filter(Boolean)

let resolvedBin

function run(bin, args, cwd, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
        // 绝不进入交互提示：拿不到凭据就失败返回，避免面板卡死
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
      },
      (err, stdout, stderr) =>
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
        }),
    )
  })
}

/** 第一个能响应 --version 的 git。 */
export async function gitBin() {
  if (resolvedBin !== undefined) return resolvedBin
  for (const candidate of CANDIDATES) {
    if (candidate !== 'git' && !existsSync(candidate)) continue
    const probe = await run(candidate, ['--version'], process.cwd(), 5000)
    if (probe.ok) {
      resolvedBin = candidate
      return candidate
    }
  }
  resolvedBin = null
  return null
}

/** 在 cwd 里跑一条 git 命令。 */
export async function git(cwd, args, timeout) {
  const bin = await gitBin()
  if (!bin) return { ok: false, error: '找不到 git 可执行文件（可设 DSH_GIT_PATH）' }
  const out = await run(bin, args, cwd, timeout)
  return { ...out, error: out.ok ? undefined : (out.stderr || out.stdout || `git ${args.join(' ')} 失败`).trim() }
}

const ROOT_TTL_MS = 60_000
/** cwd → { root, at }：仓库根不会变，缓存 60 秒，省掉每次 status 的一次 spawn。 */
const rootCache = new Map()

/** 仓库根目录；不是仓库返回 null。 */
export async function repoRoot(cwd) {
  const hit = rootCache.get(cwd)
  if (hit && Date.now() - hit.at < ROOT_TTL_MS) return hit.root
  const out = await git(cwd, ['rev-parse', '--show-toplevel'])
  const root = out.ok ? out.stdout.trim() || null : null
  rootCache.set(cwd, { root, at: Date.now() })
  return root
}

/** 仓库根变了（新建仓库/移除 .git）时手动失效。 */
export function forgetRepoRoot(cwd) {
  rootCache.delete(cwd)
}

/**
 * 解析 `status --porcelain=v2 --branch -z`（一次调用拿到分支/上游/领先落后/文件列表）。
 * 记录以 NUL 分隔；`#` 开头是分支头，`1/2` 是普通/重命名条目，`?` 未跟踪。
 */
/** v2 里的 '.' 表示该侧无变化，归一成空白以对齐 v1 语义。 */
function norm(ch) {
  return !ch || ch === '.' ? ' ' : ch
}

function parsePorcelainV2(text) {
  let branch = ''
  let upstream = ''
  let ahead = 0
  let behind = 0
  let hasHead = false
  const files = []
  const records = String(text).split('\u0000')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec) continue
    if (rec.startsWith('# branch.oid ')) {
      hasHead = !rec.endsWith('(initial)')
      continue
    }
    if (rec.startsWith('# branch.head ')) {
      branch = rec.slice('# branch.head '.length)
      continue
    }
    if (rec.startsWith('# branch.upstream ')) {
      upstream = rec.slice('# branch.upstream '.length)
      continue
    }
    if (rec.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(rec)
      if (m) {
        ahead = Number(m[1]) || 0
        behind = Number(m[2]) || 0
      }
      continue
    }
    if (rec.startsWith('1 ')) {
      const parts = rec.split(' ')
      const xy = parts[1] || '..'
      files.push({ path: parts.slice(8).join(' '), x: norm(xy[0]), y: norm(xy[1]) })
      continue
    }
    if (rec.startsWith('2 ')) {
      // 2 <XY> ... <X><score> <path>\0<origPath>：下一条记录是旧路径，消费掉
      const parts = rec.split(' ')
      const xy = parts[1] || '..'
      files.push({ path: parts.slice(9).join(' '), x: norm(xy[0]), y: norm(xy[1]) })
      i += 1
      continue
    }
    if (rec.startsWith('? ')) {
      const path = rec.slice(2)
      files.push({ path, x: '?', y: '?', untrackedDir: path.endsWith('/') })
      continue
    }
    // '! ' 被忽略的文件：不列
  }
  return { branch, upstream, ahead, behind, hasHead, files }
}

/**
 * 仓库状态。
 * 只跑 **2 次** git（rev-parse 定仓库根 + 一条 porcelain=v2 --branch 拿全），
 * 旧实现是 6 次（rev-parse ×4 + rev-list + status），在 Windows 上每次 spawn 30~80ms，
 * 面板打开/轮询时会把主进程和 UI 拖住。
 * @returns {Promise<{isRepo:boolean, root?:string, branch?:string, upstream?:string,
 *   ahead?:number, behind?:number, hasHead?:boolean, files?:Array<{path:string,x:string,y:string}>}>}
 */
export async function status(cwd) {
  const root = await repoRoot(cwd)
  if (!root) return { isRepo: false }
  // --no-optional-locks：后台轮询不刷新索引、不抢锁（VS Code 同样这么做）
  // --untracked-files=normal：**未跟踪目录折叠成一条**（"build/"），
  //   用 =all 会把目录里每个文件都列出来，几万个 build 产物直接把面板淹没。
  // --no-renames：不做重命名检测（实测少 ~20%，重命名显示成"删+增"可以接受）
  const out = await git(root, [
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    '--untracked-files=normal',
    '--no-renames',
  ])
  if (!out.ok) {
    return { isRepo: true, root, branch: '', upstream: '', ahead: 0, behind: 0, files: [], error: out.error }
  }
  return { isRepo: true, root, ...parsePorcelainV2(out.stdout) }
}

/** 未跟踪文件合成一份"整文件新增"的 unified diff。 */
async function syntheticAddDiff(root, relPath) {
  const text = await readFile(`${root}/${relPath}`, 'utf8').catch(() => '')
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const body = lines.map((line) => `+${line}`).join('\n')
  return `--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`
}

/**
 * 单个文件的 unified diff。
 * @param {string} root - 仓库根
 * @param {string} path - 相对仓库根的路径
 * @param {boolean} staged - true 取索引 vs HEAD，false 取工作区 vs 索引
 */
export async function diffFile(root, path, staged) {
  const base = ['diff', '--no-color', '--no-ext-diff', '--no-renames', '--unified=3']
  const args = staged ? [...base, '--cached', '--', path] : [...base, '--', path]
  const out = await git(root, args)
  if (!out.ok) return { ok: false, error: out.error }
  let unified = out.stdout
  if (!unified && !staged) {
    unified = await syntheticAddDiff(root, path)
  }
  return {
    ok: true,
    unified,
    staged: Boolean(staged),
    binary: /Binary files .* differ/.test(unified),
    empty: unified.trim().length === 0,
  }
}

/** 暂存一个文件。 */
export async function stage(root, path) {
  return git(root, ['add', '--', path])
}

/** 取消暂存。 */
export async function unstage(root, path) {
  const restore = await git(root, ['restore', '--staged', '--', path])
  if (restore.ok) return restore
  return git(root, ['reset', '-q', 'HEAD', '--', path])
}

/** 提交（只提交已暂存内容）。 */
export async function commit(root, message) {
  const text = String(message || '').trim()
  if (!text) return { ok: false, error: '提交说明不能为空' }
  return git(root, ['commit', '-m', text])
}

/** 最近若干条提交（用于面板底部展示）。 */
export async function log(root, limit = 12) {
  const out = await git(root, ['log', `-${Math.max(1, Math.min(50, limit))}`, '--pretty=%h\u001f%an\u001f%ar\u001f%s'])
  if (!out.ok) return []
  return out.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, when, subject] = line.split('\u001f')
      return { hash, author, when, subject }
    })
}

/** 本地分支列表（含当前分支标记）。 */
export async function branches(root) {
  const out = await git(root, ['branch', '--format=%(refname:short)\u001f%(HEAD)'])
  if (!out.ok) return []
  return out.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split('\u001f')
      return { name, current: head === '*' }
    })
}

/** 切换分支（工作区有冲突改动时 git 会拒绝，错误原样返回）。 */
export async function checkout(root, branch) {
  const name = String(branch || '').trim()
  if (!name) return { ok: false, error: '分支名为空' }
  if (name.startsWith('-')) return { ok: false, error: '非法分支名' }
  return git(root, ['checkout', name], 60000)
}

/** git push（非交互）。 */
export async function push(root) {
  return git(root, ['push'], 120000)
}

/** git pull --ff-only（避免自动产生合并提交）。 */
export async function pull(root) {
  return git(root, ['pull', '--ff-only'], 120000)
}
