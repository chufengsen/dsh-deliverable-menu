/**
 * Git 功能集成测试：真 git 仓库 + 假 ctx/req/res。
 *
 * 覆盖：非仓库、分支、改/增/删文件的状态、未暂存与已暂存的 diff、
 * 暂存、提交、历史，以及客户端 unified diff → 并排行的解析。
 *
 *   node test/git.test.mjs
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as plugin from '../lib/index.js'

let passed = 0
const ok = (label, extra = '') => {
  passed += 1
  console.log(`  [ok] ${label}${extra ? `   ${extra}` : ''}`)
}

// ---------------------------------------------------------------- 造一个真仓库

const root = await mkdtemp(join(tmpdir(), 'dpm-git-'))
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'Test')
await writeFile(join(root, 'a.txt'), 'line1\nline2\nline3\n', 'utf8')
git('add', '.')
git('commit', '-q', '-m', 'init')
await writeFile(join(root, 'a.txt'), 'line1\nline2 changed\nline3\nline4\n', 'utf8')
await writeFile(join(root, 'b.txt'), 'brand new\nsecond\n', 'utf8')
await mkdir(join(root, 'sub'), { recursive: true })
await writeFile(join(root, 'sub', 'c.py'), 'def hello():\n    return 1\n', 'utf8')
git('add', 'sub/c.py')
await writeFile(join(root, 'sub', 'c.py'), 'def hello():\n    return 2\n', 'utf8')

// ---------------------------------------------------------------- 挂载

const routes = []
const ctx = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  sessions: { get: (id) => (id === 's1' ? { header: { cwd: root } } : undefined) },
  effect: (fn) => fn(),
}
plugin.apply(ctx)
// apply() 先注册音频资产路由（/assets，只 GET），再注册 API 路由（/api）。
// 按 URL 取，不按顺序取——否则 POST 会撞上资产路由的 405。
const route = routes.find((r) => String(r.path || '').endsWith('/api'))
assert.ok(route, '找到 API 路由')

function call(body) {
  const payload = Buffer.from(JSON.stringify(body))
  const req = {
    method: 'POST',
    url: '/dsh-deliverable-menu/api',
    headers: { host: '127.0.0.1:3456' },
    [Symbol.asyncIterator]() {
      let done = false
      return {
        next: async () => {
          if (done) return { done: true, value: undefined }
          done = true
          return { done: false, value: payload }
        },
      }
    },
  }
  const state = { status: 0, text: '' }
  const res = {
    headersSent: false,
    writeHead(status) {
      state.status = status
      this.headersSent = true
    },
    write(chunk) {
      state.text += String(chunk)
      return true
    },
    end(chunk) {
      if (chunk !== undefined) state.text += String(chunk)
    },
    destroy() {},
  }
  return route.handler(req, res).then(() => ({
    status: state.status,
    data: state.text ? JSON.parse(state.text) : {},
  }))
}

// ---------------------------------------------------------------- 状态

const st = await call({ method: 'gitStatus', sessionId: 's1' })
assert.equal(st.data.ok, true)
assert.equal(st.data.isRepo, true, '识别为仓库')
assert.ok(st.data.branch.length > 0, '有分支名')
const byPath = Object.fromEntries(st.data.files.map((f) => [f.path, f]))
assert.equal(byPath['a.txt'].y, 'M', 'a.txt 工作区已修改')
assert.equal(byPath['b.txt'].x, '?', 'b.txt 未跟踪')
assert.equal(byPath['sub/c.py'].x, 'A', 'sub/c.py 是新文件且已暂存')
ok('状态：分支 + 修改/未跟踪/已暂存', `${st.data.files.length} 个文件`)

// ---------------------------------------------------------------- 未暂存 diff

const d1 = await call({ method: 'gitDiff', sessionId: 's1', path: 'a.txt', staged: false })
assert.equal(d1.data.ok, true)
assert.ok(d1.data.unified.includes('-line2'), 'diff 含删除行')
assert.ok(d1.data.unified.includes('+line2 changed'), 'diff 含新增行')
ok('未暂存 diff：取出 +/- 行')

// 未跟踪文件没有 git diff，应合成"整文件新增"
const d2 = await call({ method: 'gitDiff', sessionId: 's1', path: 'b.txt', staged: false })
assert.equal(d2.data.ok, true)
assert.ok(d2.data.unified.includes('+brand new'), '未跟踪文件合成新增 diff')
ok('未跟踪文件：合成整文件新增 diff')

// 未跟踪目录要折叠成一条（VS Code 的 -unormal 行为），否则 build 产物会淹没面板
await mkdir(join(root, 'out'), { recursive: true })
for (let i = 0; i < 5; i++) await writeFile(join(root, 'out', `gen${i}.txt`), 'x\n')
const stDir = await call({ method: 'gitStatus', sessionId: 's1' })
const outEntries = stDir.data.files.filter((f) => f.path.startsWith('out'))
assert.equal(outEntries.length, 1, '未跟踪目录只出现一条，不是 5 条')
assert.ok(outEntries[0].path.endsWith('/'), '目录条目以 / 结尾')
assert.equal(outEntries[0].untrackedDir, true, '带 untrackedDir 标记')
ok('未跟踪目录折叠：5 个文件 → 1 条目录项')

// ---------------------------------------------------------------- 已暂存 diff

const d3 = await call({ method: 'gitDiff', sessionId: 's1', path: 'sub/c.py', staged: true })
assert.equal(d3.data.ok, true)
assert.ok(d3.data.unified.includes('+    return 1'), '暂存 diff 对比的是索引 vs HEAD')
assert.ok(!d3.data.unified.includes('+    return 2'), '工作区的新改动不在暂存 diff 里')
ok('暂存 diff：索引 vs HEAD')

// ---------------------------------------------------------------- 暂存 / 取消 / 提交

const stageRes = await call({ method: 'gitStage', sessionId: 's1', path: 'a.txt' })
assert.equal(stageRes.data.ok, true)
const st2 = await call({ method: 'gitStatus', sessionId: 's1' })
const a2 = st2.data.files.find((f) => f.path === 'a.txt')
assert.equal(a2.x, 'M', 'a.txt 变成已暂存')
ok('暂存：a.txt 进入索引')

const unstageRes = await call({ method: 'gitUnstage', sessionId: 's1', path: 'a.txt' })
assert.equal(unstageRes.data.ok, true)
const st3 = await call({ method: 'gitStatus', sessionId: 's1' })
const a3 = st3.data.files.find((f) => f.path === 'a.txt')
assert.equal(a3.x, ' ', 'a.txt 取消暂存后索引干净')
assert.equal(a3.y, 'M', '改动回到工作区')
ok('取消暂存：回到工作区')

await call({ method: 'gitStage', sessionId: 's1', path: 'a.txt' })
const commitRes = await call({ method: 'gitCommit', sessionId: 's1', message: 'update a.txt' })
assert.equal(commitRes.data.ok, true, commitRes.data.error || '')
const st4 = await call({ method: 'gitStatus', sessionId: 's1' })
assert.ok(!st4.data.files.some((f) => f.path === 'a.txt'), '提交后 a.txt 不再出现在变更里')
ok('提交：a.txt 已入库')

const emptyCommit = await call({ method: 'gitCommit', sessionId: 's1', message: '   ' })
assert.equal(emptyCommit.data.ok, false, '空提交说明被拒绝')
ok('提交：空说明拒绝')

const logs = await call({ method: 'gitLog', sessionId: 's1', limit: 5 })
assert.ok(logs.data.commits.length >= 2, '至少两条提交')
assert.equal(logs.data.commits[0].subject, 'update a.txt', '最新提交在最前')
ok('历史：条数与顺序', logs.data.commits.map((c) => c.subject).join(' | '))

// ---------------------------------------------------------------- 安全与边界

const escape = await call({ method: 'gitStage', sessionId: 's1', path: '../evil.txt' })
assert.equal(escape.status, 400, '越界路径被拒绝')
ok('越界路径拒绝（400）')

const notRepoDir = await mkdtemp(join(tmpdir(), 'dpm-norepo-'))
const ctx2 = {
  webServer: { register: () => () => {} },
  sessions: { get: () => ({ header: { cwd: notRepoDir } }) },
  effect: (fn) => fn(),
}
const routes2 = []
ctx2.webServer.register = (r) => {
  routes2.push(r)
  return () => {}
}
plugin.apply(ctx2)
const route2 = routes2.find((r) => String(r.path || '').endsWith('/api'))
assert.ok(route2, '找到 API 路由（第二轮挂载）')
const res2 = await (async () => {
  const req = {
    method: 'POST',
    url: '/dsh-deliverable-menu/api',
    headers: { host: '127.0.0.1:1' },
    [Symbol.asyncIterator]() {
      let done = false
      return {
        next: async () => {
          if (done) return { done: true, value: undefined }
          done = true
          return { done: false, value: Buffer.from(JSON.stringify({ method: 'gitStatus', sessionId: 'x' })) }
        },
      }
    },
  }
  let text = ''
  const res = { headersSent: false, writeHead() {}, write() {}, end(b) { text += String(b || '') }, destroy() {} }
  await route2.handler(req, res)
  return JSON.parse(text)
})()
assert.equal(res2.isRepo, false, '非仓库返回 isRepo=false')
ok('非仓库：isRepo=false（面板提示而不是报错）')

// ---------------------------------------------------------------- 分支 / 远程操作

const br = await call({ method: 'gitBranches', sessionId: 's1' })
assert.ok(br.data.ok && br.data.branches.length >= 1, '至少一个本地分支')
assert.equal(br.data.branches.filter((b) => b.current).length, 1, '恰好一个当前分支')
const currentBranch = br.data.branches.find((b) => b.current).name
ok('分支列表：当前分支标记唯一', currentBranch)

git('branch', 'feature-x')
const br2 = await call({ method: 'gitBranches', sessionId: 's1' })
assert.ok(br2.data.branches.some((b) => b.name === 'feature-x'), '新分支出现在列表')

const co = await call({ method: 'gitCheckout', sessionId: 's1', branch: 'feature-x' })
assert.equal(co.data.ok, true, co.data.error || '')
const afterCo = await call({ method: 'gitStatus', sessionId: 's1' })
assert.equal(afterCo.data.branch, 'feature-x', '切换后分支名变了')
ok('切换分支：feature-x')

const coBack = await call({ method: 'gitCheckout', sessionId: 's1', branch: currentBranch })
assert.equal(coBack.data.ok, true, coBack.data.error || '')
ok('切回原分支')

const coBad = await call({ method: 'gitCheckout', sessionId: 's1', branch: 'no-such-branch' })
assert.equal(coBad.data.ok, false, '不存在的分支失败')
assert.ok(String(coBad.data.error).length > 0, '带错误说明')
ok('切换分支：不存在的分支报错')

const coEmpty = await call({ method: 'gitCheckout', sessionId: 's1', branch: '  ' })
assert.equal(coEmpty.data.ok, false, '空分支名被拒绝')
ok('切换分支：空名字拒绝')

// 没有 remote 时 push / pull 必须优雅失败（不能挂起）
const pushRes = await call({ method: 'gitPush', sessionId: 's1' })
assert.equal(pushRes.data.ok, false, '无远端时 push 失败')
assert.ok(String(pushRes.data.error).length > 0, 'push 返回错误说明')
ok('推送：无远端时优雅失败', String(pushRes.data.error).slice(0, 40))

const pullRes = await call({ method: 'gitPull', sessionId: 's1' })
assert.equal(pullRes.data.ok, false, '无上游时 pull 失败')
assert.ok(String(pullRes.data.error).length > 0, 'pull 返回错误说明')
ok('拉取：无上游时优雅失败', String(pullRes.data.error).slice(0, 40))

// ---------------------------------------------------------------- 客户端 diff 解析

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load: (m) => {
      loaded = m
    },
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
}
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useEffect: () => {},
}
const { readFileSync } = await import('node:fs')
const { dirname } = await import('node:path')
const { fileURLToPath } = await import('node:url')
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
new Function('window', source)(globalThis.window)
loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require ${name}`)
})
const { parseUnified } = globalThis.window.__dshDeliverableMenu

const rows = parseUnified(d1.data.unified)
const kinds = rows.map((r) => r.kind)
assert.ok(kinds.includes('hunk'), '解析出 hunk 头')
assert.ok(kinds.includes('del') && kinds.includes('add'), '解析出删除/新增行')

const ctxRow = rows.find((r) => r.kind === 'ctx')
assert.ok(ctxRow && ctxRow.leftNo === ctxRow.rightNo, '上下文行两侧行号一致')

const delRow = rows.find((r) => r.kind === 'del')
assert.ok(delRow.leftNo > 0 && delRow.rightNo === undefined, '删除行只有左侧行号')
const addRow = rows.find((r) => r.kind === 'add')
assert.ok(addRow.rightNo > 0 && addRow.leftNo === undefined, '新增行只有右侧行号')

// 行号在 hunk 内连续递增
const bodyRows = rows.filter((r) => r.kind === 'ctx' || r.kind === 'add' || r.kind === 'del')
let prevLeft = -1
let prevRight = -1
for (const r of bodyRows) {
  if (r.leftNo !== undefined) {
    assert.ok(r.leftNo > prevLeft, `左侧行号递增（${r.leftNo} > ${prevLeft}）`)
    prevLeft = r.leftNo
  }
  if (r.rightNo !== undefined) {
    assert.ok(r.rightNo > prevRight, `右侧行号递增（${r.rightNo} > ${prevRight}）`)
    prevRight = r.rightNo
  }
}
ok('并排解析：hunk / 上下文 / 增删 + 两侧行号单调', `${rows.length} 行`)

// ---------------------------------------------------------------- 清理

await rm(root, { recursive: true, force: true })
await rm(notRepoDir, { recursive: true, force: true })
unlink(join(root, 'a.txt')).catch(() => {})

console.log(`\n全部通过：${passed} 项`)
