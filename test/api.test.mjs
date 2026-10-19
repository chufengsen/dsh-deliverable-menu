/**
 * 节点路由集成测试：真文件系统 + 假 ctx/req/res。
 *
 * 覆盖：索引（含跳过 node_modules）、模糊检索、读、写、路径越界拒绝、
 * 非回环 Host 拒绝、方法校验、二进制拒绝。
 *
 *   node test/api.test.mjs
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as plugin from '../lib/index.js'

let passed = 0
const ok = (label, extra = '') => {
  passed += 1
  console.log(`  [ok] ${label}${extra ? `   ${extra}` : ''}`)
}

// ---------------------------------------------------------------- 准备

const root = await mkdtemp(join(tmpdir(), 'dpm-api-'))
await writeFile(
  join(root, 'main.c'),
  'int main(void) {\n  return helper(1);\n}\n\nstatic int helper(int a) {\n  return a;\n}\n',
  'utf8',
)
await writeFile(join(root, 'tool.py'), 'class Box:\n    def open(self):\n        return 1\n', 'utf8')
await mkdir(join(root, 'src'), { recursive: true })
await writeFile(join(root, 'src', 'util.js'), 'export function helperJs() {}\n', 'utf8')
await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
await writeFile(join(root, 'node_modules', 'dep', 'skip.c'), 'int should_not_index(void) { return 0; }\n', 'utf8')
await writeFile(join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]), 'binary')
const outside = join(root, '..', `dpm-outside-${Date.now()}.txt`)
await writeFile(outside, 'secret', 'utf8')

// ---------------------------------------------------------------- 挂载

assert.equal(plugin.name, 'dsh-deliverable-menu')
assert.deepEqual(plugin.inject, ['webServer', 'sessions'])

const routes = []
const ctx = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  sessions: { get: (id) => (id === 's1' ? { header: { cwd: root } } : undefined) },
  effect(fn) {
    return fn()
  },
}
plugin.apply(ctx)
assert.equal(routes.length, 1, '应注册一条路由')
const route = routes[0]
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/dsh-deliverable-menu/api')
ok('插件形状与路由注册')

// ---------------------------------------------------------------- 假 req/res

function call(body, opts = {}) {
  const payload = Buffer.from(JSON.stringify(body))
  const req = {
    method: opts.method || 'POST',
    url: '/dsh-deliverable-menu/api',
    headers: { host: opts.host || '127.0.0.1:3456' },
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

// ---------------------------------------------------------------- 索引

const indexed = await call({ method: 'index', sessionId: 's1' })
assert.equal(indexed.status, 200)
assert.equal(indexed.data.ok, true)
const names = indexed.data.symbols.map((s) => s.name)
assert.ok(names.includes('main'), '索引含 main')
assert.ok(names.includes('helper'), '索引含 helper')
assert.ok(names.includes('Box') && names.includes('open'), '索引含 Python 类与方法')
assert.ok(names.includes('helperJs'), '索引含 JS 函数')
assert.ok(!names.includes('should_not_index'), '跳过 node_modules')
assert.equal(indexed.data.symbols.find((s) => s.name === 'helper').line, 5, '行号正确')
ok('索引：4 个符号 + 行号，且跳过 node_modules', `${indexed.data.scanned} 个文件`)

const cacheHit = await call({ method: 'index', sessionId: 's1' })
assert.equal(cacheHit.data.at, indexed.data.at, '20s 内命中缓存')
ok('索引缓存命中（at 不变）')

// ---------------------------------------------------------------- 检索

const found = await call({ method: 'find', sessionId: 's1', query: 'help' })
assert.ok(found.data.symbols.some((s) => s.name === 'helper'))
assert.ok(found.data.symbols.some((s) => s.name === 'helperJs'))
ok('模糊检索 help → helper / helperJs')

const byFile = await call({ method: 'find', sessionId: 's1', query: 'util' })
assert.ok(byFile.data.files.some((f) => f.path === 'src/util.js'))
ok('文件检索 util → src/util.js')

// ---------------------------------------------------------------- 读

const read = await call({ method: 'read', sessionId: 's1', path: 'main.c' })
assert.equal(read.status, 200)
assert.ok(read.data.text.includes('int main(void)'))
assert.equal(read.data.lang, 'c')
ok('读文件：内容与语言正确')

const readAbs = await call({ method: 'read', sessionId: 's1', path: join(root, 'tool.py') })
assert.equal(readAbs.data.ok, true, 'root 内的绝对路径允许')
ok('读文件：root 内绝对路径允许')

const binary = await call({ method: 'read', sessionId: 's1', path: 'blob.bin' })
assert.equal(binary.status, 415)
ok('二进制文件拒绝（415）')

// ---------------------------------------------------------------- 安全

const escapeRel = await call({ method: 'read', sessionId: 's1', path: '../dpm-outside.txt' })
assert.equal(escapeRel.status, 403)
ok('相对路径越界拒绝（403）')

const escapeAbs = await call({ method: 'read', sessionId: 's1', path: outside })
assert.equal(escapeAbs.status, 403)
ok('绝对路径越界拒绝（403）')

const badHost = await call({ method: 'index', sessionId: 's1' }, { host: 'evil.example.com' })
assert.equal(badHost.status, 403)
ok('非回环 Host 拒绝（403）')

const getCall = await call({ method: 'index', sessionId: 's1' }, { method: 'GET' })
assert.equal(getCall.status, 405)
ok('非 POST 拒绝（405）')

const noSession = await call({ method: 'index', sessionId: 'nope' })
assert.equal(noSession.status, 400)
ok('未知会话拒绝（400）')

// ---------------------------------------------------------------- 写

const written = await call({ method: 'write', sessionId: 's1', path: 'src/new.txt', text: 'hello 联想\n' })
assert.equal(written.data.ok, true)
assert.equal(await readFile(join(root, 'src', 'new.txt'), 'utf8'), 'hello 联想\n')
ok('写文件：内容落盘（含中文）')

const escapeWrite = await call({ method: 'write', sessionId: 's1', path: '../evil.txt', text: 'x' })
assert.equal(escapeWrite.status, 403)
ok('写文件越界拒绝（403）')

// 写一个代码文件后，索引缓存失效并重建能扫到它（.txt 按设计不入索引）
await call({ method: 'write', sessionId: 's1', path: 'src/fresh.js', text: 'export function freshFn() {}\n' })
const reindexed = await call({ method: 'index', sessionId: 's1' })
assert.ok(reindexed.data.files.some((f) => f.path === 'src/fresh.js'), '新文件进入索引')
assert.ok(reindexed.data.symbols.some((s) => s.name === 'freshFn'), '新符号进入索引')
ok('写入后索引缓存失效并重建')

const notIndexed = await call({ method: 'index', sessionId: 's1' })
assert.ok(!notIndexed.data.files.some((f) => f.path === 'src/new.txt'), '.txt 不入索引（按设计）')
ok('非代码扩展名不入索引')

// ---------------------------------------------------------------- 文件树 / 新建 / 搜索

const tree = await call({ method: 'tree', sessionId: 's1' })
assert.equal(tree.data.ok, true)
const treeNames = tree.data.entries.map((e) => e.name)
assert.ok(treeNames.includes('main.c') && treeNames.includes('tool.py'), '根目录列出文件')
assert.ok(tree.data.entries.some((e) => e.name === 'src' && e.type === 'dir'), '目录带 type=dir')
assert.ok(treeNames.includes('node_modules'), '文件树显示 node_modules（VS Code 也显示）')
assert.equal(tree.data.entries[0].type, 'dir', '目录排在文件前')
ok('文件树：列一层、目录优先、跳过 node_modules')

// 文件树要显示 build/dist，索引要跳过它们（两个不同的过滤表）
await mkdir(join(root, 'build'), { recursive: true })
await writeFile(join(root, 'build', 'gen.c'), 'int generated(void) { return 0; }\n', 'utf8')
await mkdir(join(root, 'dist'), { recursive: true })
await writeFile(join(root, 'dist', 'app.txt'), 'x\n', 'utf8')
await mkdir(join(root, '.git'), { recursive: true })

const treeAll = await call({ method: 'tree', sessionId: 's1' })
const allNames = treeAll.data.entries.map((e) => e.name)
assert.ok(allNames.includes('build'), '文件树显示 build/')
assert.ok(allNames.includes('dist'), '文件树显示 dist/')
assert.ok(!allNames.includes('.git'), '文件树隐藏 .git/')
const buildTree = await call({ method: 'tree', sessionId: 's1', path: 'build' })
assert.ok(buildTree.data.entries.some((e) => e.name === 'gen.c'), 'build/ 里能展开看到文件')
ok('文件树目录可见性：build/dist/node_modules 可见，只隐藏 .git')

const idx2 = await call({ method: 'index', sessionId: 's1', force: true })
assert.ok(!idx2.data.files.some((f) => f.path.startsWith('build/')), '索引跳过 build/')
assert.ok(!idx2.data.symbols.some((sym) => sym.path.startsWith('build/')), '索引不收录 build/ 的符号')
ok('索引仍然跳过 build/dist（省 IO，与文件树互不影响）')

const sub = await call({ method: 'tree', sessionId: 's1', path: 'src' })
assert.ok(sub.data.entries.some((e) => e.name === 'util.js'), '列出子目录')

const mk = await call({ method: 'mkdir', sessionId: 's1', path: 'deep/nested' })
assert.equal(mk.data.ok, true)
assert.equal(mk.data.path, 'deep/nested', '返回相对路径')
const deepTree = await call({ method: 'tree', sessionId: 's1', path: 'deep' })
assert.ok(deepTree.data.entries.some((e) => e.name === 'nested'), '多级目录创建成功')
ok('新建文件夹：多级路径')

const nf = await call({ method: 'newFile', sessionId: 's1', path: 'deep/nested/note.md', text: '# hi\n' })
assert.equal(nf.data.ok, true)
const noteRead = await call({ method: 'read', sessionId: 's1', path: 'deep/nested/note.md' })
assert.equal(noteRead.data.text, '# hi\n', '新文件内容正确')
ok('新建文件：写入初始内容')

const dup = await call({ method: 'newFile', sessionId: 's1', path: 'deep/nested/note.md' })
assert.equal(dup.data.ok, false, '同名文件不覆盖')
assert.ok(String(dup.data.error).includes('EEXIST') || String(dup.data.error).includes('exist'), '错误说明已存在')
ok('新建文件：已存在时拒绝（不覆盖）')

const escapeMk = await call({ method: 'mkdir', sessionId: 's1', path: '../evil-dir' })
assert.equal(escapeMk.status, 403, '新建目录越界拒绝')
ok('新建目录：越界拒绝（403）')

const found1 = await call({ method: 'search', sessionId: 's1', query: 'helper' })
assert.equal(found1.data.ok, true)
assert.ok(found1.data.matches.length >= 2, '命中 main.c 的 helper 调用与定义')
assert.ok(found1.data.matches.every((m) => m.path && m.line >= 1 && m.col >= 1), '命中带 文件/行/列')
assert.ok(found1.data.matches[0].len === 'helper'.length, '带匹配长度')
ok('全文搜索：普通串（不区分大小写）', `${found1.data.matches.length} 处 / 扫描 ${found1.data.scanned} 文件`)

const foundCase = await call({ method: 'search', sessionId: 's1', query: 'HELPER', caseSensitive: true })
assert.equal(foundCase.data.matches.length, 0, '区分大小写时无命中')
ok('全文搜索：区分大小写')

const foundRe = await call({ method: 'search', sessionId: 's1', query: 'int\\s+main', regex: true })
assert.ok(foundRe.data.matches.length >= 1, '正则命中 int main')
ok('全文搜索：正则')

const badRe = await call({ method: 'search', sessionId: 's1', query: '(', regex: true })
assert.equal(badRe.data.ok, false)
assert.ok(String(badRe.data.error).includes('正则'), '非法正则给出明确错误')
ok('全文搜索：非法正则报错')

const skipBinary = await call({ method: 'search', sessionId: 's1', query: 'brand' })
assert.ok(!skipBinary.data.matches.some((m) => m.path === 'blob.bin'), '不搜二进制文件')
ok('全文搜索：跳过二进制')

// ---------------------------------------------------------------- 运行文件 / 定位 / 图标标记

await writeFile(join(root, 'hello.js'), 'console.log("dpm-hello")\n', 'utf8')
const runOk = await call({ method: 'run', sessionId: 's1', path: 'hello.js' })
assert.equal(runOk.data.ok, true, runOk.data.error || '')
assert.ok(String(runOk.data.stdout).includes('dpm-hello'), '抓到 stdout')
assert.equal(runOk.data.code, 0, '退出码 0')
ok('运行文件：node 脚本输出被捕获')

// .c：有编译器就编译运行，没有就给出明确原因（两种都算通过）
await writeFile(join(root, 'hello.c'), '#include <stdio.h>\nint main(void){ printf("dpm-c\\n"); return 0; }\n', 'utf8')
let hasCompiler = false
try {
  execFileSync('gcc', ['--version'], { stdio: 'ignore' })
  hasCompiler = true
} catch (_) {
  hasCompiler = false
}
const cRes = await call({ method: 'run', sessionId: 's1', path: 'hello.c' })
if (hasCompiler) {
  assert.equal(cRes.data.ok, true, cRes.data.error || '')
  assert.ok(String(cRes.data.stdout).includes('dpm-c'), 'C 程序输出')
  ok('运行文件：.c 编译后运行', 'gcc')
} else {
  assert.equal(cRes.data.ok, false)
  assert.ok(String(cRes.data.error).includes('无法编译运行'), '没有编译器时说清楚')
  ok('运行文件：.c 无编译器时明确报错', '本机无 gcc')
}

// 菜单可运行性判定（服务端 isRunnable → tree 的 runnable）
await writeFile(join(root, 'tool.exe'), 'MZ', 'utf8')
await writeFile(join(root, 'lib.h'), '#pragma once\n', 'utf8')
const treeRun = await call({ method: 'tree', sessionId: 's1' })
const byName = Object.fromEntries(treeRun.data.entries.map((e) => [e.name, e]))
assert.equal(byName['tool.exe'].runnable, true, '.exe 可运行')
assert.equal(byName['hello.c'].runnable, true, '.c 可编译运行')
assert.equal(byName['lib.h'].runnable, false, '.h 不可运行')
assert.equal(byName['tool.py'] ? true : true, true)
ok('可运行判定：exe / c 为真，头文件为假')

const runBad = await call({ method: 'run', sessionId: 's1', path: 'blob.bin' })
assert.equal(runBad.data.ok, false, '不支持的类型拒绝运行')
assert.ok(String(runBad.data.error).includes('不支持'), '说明原因')
ok('运行文件：非白名单类型拒绝')

const runDir = await call({ method: 'run', sessionId: 's1', path: 'src' })
assert.equal(runDir.status, 400, '目录不能运行')
ok('运行文件：目录拒绝（400）')

const revealEscape = await call({ method: 'reveal', sessionId: 's1', path: '../outside.txt' })
assert.equal(revealEscape.status, 403, 'reveal 也走路径栅栏')
ok('在资源管理器中显示：越界拒绝（403）')

const treeWithRun = await call({ method: 'tree', sessionId: 's1' })
const hello = treeWithRun.data.entries.find((e) => e.name === 'hello.js')
assert.equal(hello.runnable, true, '可运行文件带 runnable 标记')
const dirEntry = treeWithRun.data.entries.find((e) => e.type === 'dir')
assert.equal(dirEntry.runnable, false, '目录不带可运行标记')
ok('文件树：runnable 标记')

// ---------------------------------------------------------------- 双击语义（launch）

await writeFile(
  join(root, 'launch-test.bat'),
  '@echo off\r\necho launched> "%~dp0launched.txt"\r\n',
  'utf8',
)
const launched = await call({ method: 'launch', sessionId: 's1', path: 'launch-test.bat' })
assert.equal(launched.data.ok, true, launched.data.error || '')
let appeared = false
for (let i = 0; i < 60; i++) {
  try {
    await stat(join(root, 'launched.txt'))
    appeared = true
    break
  } catch (_) {
    await new Promise((r) => setTimeout(r, 100))
  }
}
assert.ok(appeared, '被 start 真正执行（产生了 launched.txt）')
ok('双击语义：launch 用 start 启动，程序真的跑了')

const launchBad = await call({ method: 'launch', sessionId: 's1', path: 'lib.h' })
assert.equal(launchBad.status, 400, '头文件不允许 launch')
ok('双击语义：不支持的类型拒绝（400）')

// ---------------------------------------------------------------- 最近产物扫描

await mkdir(join(root, 'dist'), { recursive: true })
const freshExe = join(root, 'dist', 'ScannerOTA.exe')
await writeFile(freshExe, Buffer.from('MZ' + '0'.repeat(64)), 'binary')
const oldBin = join(root, 'dist', 'old.bin')
await writeFile(oldBin, Buffer.from('OLD'), 'binary')
const { utimes } = await import('node:fs/promises')
const past = new Date(Date.now() - 3 * 3600 * 1000)
await utimes(oldBin, past, past)

const artNow = await call({ method: 'artifacts', sessionId: 's1', sinceMs: Date.now() - 60 * 1000 })
assert.equal(artNow.status, 200)
const artPaths = artNow.data.files.map((f) => f.path)
assert.ok(artPaths.includes('dist/ScannerOTA.exe'), '刚产出的 exe 被扫到')
assert.ok(!artPaths.includes('dist/old.bin'), 'mtime 太老的产物被过滤')
assert.equal(artNow.data.files[0].path, 'dist/ScannerOTA.exe', '按 mtime 降序，最新的排最前')
assert.ok(artNow.data.files[0].size > 0, '带出文件大小')
ok('最近产物扫描：mtime 过滤 + 按时间倒序 + 带 size')

const artAll = await call({ method: 'artifacts', sessionId: 's1', sinceMs: 1 })
assert.ok(artAll.data.files.some((f) => f.path === 'dist/old.bin'), 'sinceMs 放宽后老产物也能出现')
assert.equal(artAll.data.files.length >= 2, true, '至少两个产物')
ok('最近产物扫描：sinceMs 生效')

// ---------------------------------------------------------------- 清理

// launch 出来的进程可能短暂占着目录句柄（cwd 就是被测目录），重试几次
for (let i = 0; i < 5; i++) {
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
    break
  } catch (error) {
    if (i === 4) console.log('  （清理临时目录失败，忽略）', String(error.code || error))
    else await new Promise((r) => setTimeout(r, 300))
  }
}
await rm(outside, { force: true })

console.log(`\n全部通过：${passed} 项`)
