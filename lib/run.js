/**
 * 「运行文件」与「在资源管理器中显示」。
 *
 * 运行只走**解释器白名单**：按扩展名映射到 python/node/bash/cmd/powershell，
 * 不接受任意命令，也不拼 shell 字符串（execFile 直接传数组参数）。
 */

import { execFile, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'

/** 扩展名 → 启动方式。 */
const RUNNERS = {
  '.exe': (p) => [p, []],
  '.com': (p) => [p, []],
  '.py': (p) => ['python', [p]],
  '.js': (p) => ['node', [p]],
  '.mjs': (p) => ['node', [p]],
  '.cjs': (p) => ['node', [p]],
  '.sh': (p) => ['bash', [p]],
  '.bat': (p) => ['cmd', ['/c', p]],
  '.cmd': (p) => ['cmd', ['/c', p]],
  '.ps1': (p) => ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', p]],
  '.jar': (p) => ['java', ['-jar', p]],
}

/** 需要先编译的扩展名 → 候选编译器。 */
const COMPILE_TARGETS = {
  '.c': ['gcc', 'clang'],
  '.cpp': ['g++', 'clang++'],
  '.cc': ['g++', 'clang++'],
  '.cxx': ['g++', 'clang++'],
}

/** 可运行的扩展名列表（客户端用来决定菜单项是否可用）。 */
export const RUNNABLE_EXT = Object.keys(RUNNERS)

/** 这个文件能不能在菜单里启用「运行」。 */
export function isRunnable(path) {
  const ext = extname(String(path || '')).toLowerCase()
  return Boolean(RUNNERS[ext] || COMPILE_TARGETS[ext])
}

/** 跑一条命令，捕获输出（不抛异常）。 */
function exec(cmd, args, cwd, timeoutMs, env) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
        env: env || process.env,
      },
      (err, stdout, stderr) =>
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err && typeof err.code !== 'number' ? String(err.message) : undefined,
          timedOut: Boolean(err && err.killed),
        }),
    )
  })
}

/** 编译器探测结果缓存（ext → 可执行文件名 | null）。 */
const compilerCache = new Map()

/** 找到该扩展名可用的编译器。 */
async function findCompiler(ext) {
  if (compilerCache.has(ext)) return compilerCache.get(ext)
  for (const candidate of COMPILE_TARGETS[ext] || []) {
    const probe = await exec(candidate, ['--version'], process.cwd(), 5000)
    if (probe.ok) {
      compilerCache.set(ext, candidate)
      return candidate
    }
  }
  compilerCache.set(ext, null)
  return null
}

/**
 * 运行一个文件，捕获输出。
 * @param {string} abs - 绝对路径
 * @param {number} timeoutMs - 超时（默认 20 秒）
 * @returns {Promise<{ok:boolean, code?:number, command?:string, stdout?:string, stderr?:string, error?:string, timedOut?:boolean}>}
 */
export async function runFile(abs, timeoutMs = 60000) {
  const ext = extname(String(abs || '')).toLowerCase()

  // 需要编译的：找编译器 → 编到临时目录 → 跑
  if (COMPILE_TARGETS[ext]) {
    const compiler = await findCompiler(ext)
    if (!compiler) {
      return {
        ok: false,
        error: `没有找到可用的 ${COMPILE_TARGETS[ext].join(' / ')}，无法编译运行 ${ext} 文件`,
      }
    }
    const outDir = join(tmpdir(), `dsh-run-${process.pid}`)
    await mkdir(outDir, { recursive: true }).catch(() => {})
    const binName = basename(abs).replace(/\.[^.]+$/, '') + (process.platform === 'win32' ? '.exe' : '')
    const outPath = join(outDir, binName)
    const build = await exec(compiler, [abs, '-O0', '-o', outPath], dirname(abs), 60000)
    if (!build.ok) {
      return {
        ok: false,
        command: `${compiler} ${abs} -o ${outPath}`,
        stdout: build.stdout,
        stderr: build.stderr,
        error: build.error || '编译失败',
        code: build.code,
      }
    }
    const runOut = await exec(outPath, [], dirname(abs), timeoutMs, process.env)
    return {
      ...runOut,
      command: `${compiler} … && ${binName}`,
      stdout: `[编译通过] ${compiler}\n` + runOut.stdout,
    }
  }

  const make = RUNNERS[ext]
  if (!make) {
    return Promise.resolve({
      ok: false,
      error: `不支持直接运行 ${ext || '(无扩展名)'} 文件（可运行：exe / bat / py / js / sh / ps1 / jar / c / cpp）`,
    })
  }
  const [cmd, args] = make(abs)
  const out = await exec(cmd, args, dirname(abs), timeoutMs, {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  })
  return {
    ...out,
    command: [cmd, ...args].join(' '),
    stdout: out.stdout.slice(-20000),
    stderr: out.stderr.slice(-20000),
  }
}

/**
 * 「双击运行」：交给 Windows 外壳去启动（`cmd /c start "" <file>`），
 * 分离进程 + 不捕获输出 + 不设超时。
 *
 * 这与 {@link runFile} 的区别很关键：
 *   - runFile   ：当控制台程序跑，管道收 stdout/stderr，20 秒超时会杀掉子进程
 *   - launchFile：当双击，GUI 程序自己开窗口、控制台程序自己弹控制台，
 *                 插件进程退出也不影响它
 * @param {string} abs - 绝对路径
 */
export function launchFile(abs) {
  return new Promise((resolve) => {
    try {
      const isWin = process.platform === 'win32'
      const child = isWin
        ? spawn('cmd.exe', ['/c', 'start', '', abs], {
            cwd: dirname(abs),
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          })
        : spawn('xdg-open', [abs], { cwd: dirname(abs), detached: true, stdio: 'ignore' })
      child.on('error', (error) => resolve({ ok: false, error: String(error.message) }))
      child.unref()
      // start 本身会立刻返回，等一小会儿只为捕获 spawn 级错误
      setTimeout(() => resolve({ ok: true, launched: true, command: `start "" ${abs}` }), 300)
    } catch (error) {
      resolve({ ok: false, error: String((error && error.message) || error) })
    }
  })
}

/**
 * 在系统文件管理器中显示（文件 → 选中它；目录 → 打开它）。
 * @param {string} abs - 绝对路径
 * @param {boolean} isDir - 是否目录
 */
export function revealPath(abs, isDir) {
  return new Promise((resolve) => {
    try {
      const args = process.platform === 'win32' ? (isDir ? [abs] : [`/select,${abs}`]) : [isDir ? abs : dirname(abs)]
      const exe = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      const child = spawn(exe, args, { detached: true, stdio: 'ignore' })
      child.on('error', (error) => resolve({ ok: false, error: String(error.message) }))
      child.unref()
      // explorer 的退出码不可靠，给它 300ms 启动时间后按成功返回
      setTimeout(() => resolve({ ok: true }), 300)
    } catch (error) {
      resolve({ ok: false, error: String((error && error.message) || error) })
    }
  })
}
