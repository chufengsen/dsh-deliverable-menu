/**
 * dsh-deliverable-menu 契约测试（无浏览器、无 DSH）。
 *
 * 验证三件事：
 *   1. 客户端模块能被 __ModuleLoader__ 加载，导出 apply / inject；
 *   2. apply 只注册到 deliverables.file.actions，descriptor 合法；
 *   3. 组件在拿到槽位 props 后能渲染出「⋯」按钮（含右键所需的 aria 属性）。
 *
 * 运行：node test/contract.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entry = join(here, '..', 'lib', 'client.js')
const source = readFileSync(entry, 'utf8')

// ---------------------------------------------------------------- 加载模块

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (mod) => {
      captured = mod
    },
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener: () => {},
  removeEventListener: () => {},
}

// 极简 React 兼容层：只为在无渲染器环境里调用组件函数
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useEffect: () => {},
}

const loads = []
const Icon = (props) => React.createElement('svg', { 'data-icon': 'stub', ...(props || {}) })
const requireStub = (name) => {
  loads.push(name)
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      FileTypeIcon: Icon,
      IconFolderCloseRegular: Icon,
      IconFolderOpenRegular: Icon,
      IconSearchOutlineRegular: Icon,
    }
  }
  throw new Error(`unexpected require: ${name}`)
}

// 执行 lib/client.js（它以 window.__ModuleLoader__.load 启动）
new Function('window', source)(globalThis.window)

assert.ok(captured, '客户端模块应调用 window.__ModuleLoader__.load')
assert.equal(captured.id, 'dsh-deliverable-menu', '模块 id 必须与包名一致')
assert.equal(typeof captured.factory, 'function', 'factory 必须是函数')

const mod = captured.factory(requireStub)
assert.equal(typeof mod.apply, 'function', '应导出 apply')
assert.ok(Array.isArray(mod.inject), '应导出 inject 数组')
assert.deepEqual(mod.inject, ['slots'], 'inject 只声明 slots（侧栏走可选注入）')
assert.ok(loads.includes('react'), 'require react')
assert.ok(
  loads.includes('@deepseek-ai/dsh-client-ui-primitives'),
  'require DSH primitives（文件图标用它的，和内置文件树一致）',
)
console.log('[ok] 模块契约：apply / inject / id 正确')

// ---------------------------------------------------------------- 槽位注册

const registered = []
const tabs = []
const opened = { tabs: [], resources: [] }
const forkCalls = []
const promptCalls = []
const shadeCalls = []
const skinDisposed = []
const ctx = {
  slots: {
    inject: (name, run) => {
      registered.push({ name, run })
      return run()
    },
    register: (descriptor, component) => {
      registered.push({ descriptor, component })
      return () => {}
    },
  },
  sidebarRight: {
    openTab: (kind, options) => opened.tabs.push({ kind, options }),
    openResource: (address, options) => opened.resources.push({ address, options }),
  },
  sidebarRightTabs: {
    register: (definition) => {
      tabs.push(definition)
      return () => {}
    },
  },
  effect: (fn) => fn(),
  theme: {
    shade: (source, tokens) => {
      shadeCalls.push({ source, tokens })
      return () => skinDisposed.push(source)
    },
  },
  remote: {
    session: {
      fork: async (req) => {
        forkCalls.push(req)
        return { sessionId: 'side-1' }
      },
      prompt: async (req) => {
        promptCalls.push(req)
        return { accepted: true }
      },
    },
  },
  sessions: {
    get: (id) => ({
      id,
      open: () => {},
      getSnapshot: () => ({ running: false, blank: false }),
      eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} },
    }),
  },
  // 可选注入：依赖齐全时用同一 ctx 当 scope
  inject: (deps, cb) => {
    if (deps.some((d) => !ctx[d])) return false
    cb(ctx)
    return true
  },
}

mod.apply(ctx)

const injectCall = registered.find((r) => r.name === 'deliverables.file.actions')
assert.ok(injectCall, '必须 inject 到 deliverables.file.actions')

const reg = registered.find((r) => r.descriptor && r.descriptor.name === 'deliverables.file.actions')
assert.ok(reg, '必须调用 slots.register')
assert.equal(reg.descriptor.name, 'deliverables.file.actions', '注册的槽名正确')
assert.equal(reg.descriptor.id, 'deliverable-menu', '注册 id 稳定（用于去重/卸载）')
assert.equal(typeof reg.component, 'function', '组件是函数组件')
const tailReg = registered.find(
  (r) => r.descriptor && r.descriptor.name === 'conversation.chat.turnTail',
)
assert.ok(tailReg, '同时注册了回合结尾槽位 conversation.chat.turnTail')
assert.equal(tailReg.component, globalThis.window.__dshDeliverableMenu ? tailReg.component : null)
assert.equal(typeof tailReg.component, 'function', '回合结尾组件是函数组件')
console.log('[ok] 槽位注册：deliverables.file.actions + conversation.chat.turnTail')

// ---------------------------------------------------------------- 组件渲染

const actions = []
const element = reg.component({
  actionUrl: 'dsh-resource://presented/session/x/1/0',
  available: true,
  pending: false,
  onAction: (action) => actions.push(action),
})

assert.ok(element, '组件应返回元素')
assert.equal(element.type, 'button', '根节点是 button')
assert.equal(element.props.type, 'button', 'type=button 防止表单提交')
assert.equal(element.props['aria-haspopup'], 'menu', '需要 aria-haspopup')
assert.equal(element.props['aria-label'], '更多操作', '需要可读的无障碍标签')
assert.ok(String(element.props.className).includes('dsh-dpm-trigger'), '使用插件样式类')
assert.equal(element.children[0].children[0], '\u22EF', '按钮内容是 ⋯')
assert.equal(element.props['data-pending'], undefined, '非 pending 时不带 data-pending')
console.log('[ok] 组件渲染：⋯ 按钮 + aria 属性')

// pending 态
const pendingEl = reg.component({ available: true, pending: true, onAction: () => {} })
assert.equal(pendingEl.props['data-pending'], '1', 'pending 时标记 data-pending')
console.log('[ok] pending 态标记正确')

// ---------------------------------------------------------------- 输入框右侧按钮

const headReg = registered.find((r) => r.descriptor && r.descriptor.name === 'conversation.session.header.utilities')
assert.ok(headReg, '必须注册到 conversation.session.header.utilities（会话窗口顶部）')
assert.equal(headReg.descriptor.id, 'dsh-git-button', '按钮注册 id 稳定')
assert.equal(typeof headReg.descriptor.inject, 'function', '用 inject(sessionId) 拿会话')
assert.deepEqual(headReg.descriptor.inject('s-42'), { sessionId: 's-42' }, 'inject 透传 sessionId')

const gitBtn = headReg.component({ sessionId: 's-42' })
assert.equal(gitBtn.type, 'button', '只有一个 Git 按钮（不再是输入框里那排图标）')
assert.ok(String(gitBtn.props.className).includes('dsh-ib-btn'))
assert.ok(gitBtn.props.title.startsWith('源代码管理'), '按钮标题是源代码管理')
gitBtn.props.onClick()
assert.equal(opened.tabs.length, 1, '点 Git 应打开侧栏页')
assert.equal(opened.tabs[0].kind, 'dsh-git')
assert.equal(opened.tabs[0].options.params.sessionId, 's-42', '把会话带进标签页参数')
// 不再注册输入框按钮
assert.equal(
  registered.filter((r) => r.descriptor && r.descriptor.name === 'conversation.input.right').length,
  0,
  '输入框右侧不再放按钮',
)
console.log('[ok] 会话窗口顶部：唯一 Git 按钮 → 打开侧栏')

// ---------------------------------------------------------------- 侧边栏五个页

const ids = tabs.map((t) => t.id).sort()
assert.deepEqual(ids, ['dsh-code', 'dsh-git', 'dsh-git-diff', 'dsh-side'], '注册四个页类型（Git / 对比 / 代码导航 / 侧边会话）')
const diffType = tabs.find((t) => t.id === 'dsh-git-diff')
assert.deepEqual(diffType.patterns, ['dsh-resource://dsh-git-diff/**'], '对比页认领 dsh-resource 地址')

const bodies = registered.filter((r) => r.descriptor && r.descriptor.name === 'sidebar.right.pane.tab')
const bodyKeys = bodies.map((b) => b.descriptor.key).sort()
assert.deepEqual(bodyKeys, ids, '四个正文都挂在 sidebar.right.pane.tab')
for (const b of bodies) assert.equal(typeof b.component, 'function', `${b.descriptor.key} 正文是组件`)

const gitBody = bodies.find((b) => b.descriptor.key === 'dsh-git')
const gitEl = gitBody.component({})
assert.ok(String(gitEl.props.className).includes('dsh-src'), '源代码管理页根节点')
const diffBody = bodies.find((b) => b.descriptor.key === 'dsh-git-diff')
const diffEl = diffBody.component({})
assert.ok(String(diffEl.props.className).includes('dsh-diff'), '对比页根节点')
const codeBody = bodies.find((b) => b.descriptor.key === 'dsh-code')
const codeEl = codeBody.component({})
// CodePanel 返回的是 NavTab 元素，再渲染一层才拿到根节点
const codeInner = codeEl.type(codeEl.props)
assert.ok(String(codeInner.props.className).includes('dsh-nav'), '代码导航页根节点')
// 合并页里应能切出 文件 / 更改 / 搜索 三个视图
const tabTexts = []
const collectText = (n, out) => {
  if (n == null) return
  if (typeof n === 'string') { out.push(n); return }
  if (Array.isArray(n)) { n.forEach((c) => collectText(c, out)); return }
  if (typeof n === 'object') collectText(n.children, out)
}
const scan = (n) => {
  if (n == null) return
  if (Array.isArray(n)) { n.forEach(scan); return }
  if (typeof n !== 'object') return
  const cls = String((n.props && n.props.className) || '')
  if (cls.includes('dsh-src-tab')) {
    const out = []
    collectText(n.children, out)
    tabTexts.push(out.join(''))
  }
  scan(n.children)
}
scan(gitEl)
assert.equal(tabTexts.length, 4, '四个视图标签')
assert.ok(tabTexts.includes('文件'), '合并页有「文件」视图')
assert.ok(tabTexts.some((t) => t.startsWith('更改')), '合并页有「更改」视图')
assert.ok(tabTexts.includes('搜索'), '合并页有「搜索」视图')
assert.ok(tabTexts.includes('侧边会话'), '合并页有「侧边会话」视图')
console.log('[ok] 侧边栏：三个页类型，Git 页内含 文件/更改/搜索 视图')

// ---------------------------------------------------------------- 主题

// 主题引擎要用的最小 DOM/存储桩（applyTheme 在调用时才读 document）
globalThis.localStorage = {
  store: {},
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null
  },
  setItem(k, v) {
    this.store[k] = String(v)
  },
}
globalThis.document = globalThis.document || {}
// ensureStyle() / 皮肤注入需要这几个
const styleNodes = []
globalThis.document.querySelector = () => null
globalThis.document.createElement = () => {
  const el = {
    dataset: {},
    style: {},
    textContent: '',
    id: '',
    parentNode: null,
    setAttribute() {},
    appendChild() {},
    addEventListener() {},
    remove() {},
  }
  styleNodes.push(el)
  return el
}
globalThis.document.getElementById = (id) => styleNodes.find((el) => el.id === id) || null
globalThis.document.querySelectorAll = () => []
globalThis.document.head = {
  appendChild(el) {
    el.parentNode = {
      removeChild() {
        const i = styleNodes.indexOf(el)
        if (i >= 0) styleNodes.splice(i, 1)
      },
    }
  },
}
globalThis.document.body = { appendChild() {}, removeChild() {} }
globalThis.document.documentElement = {
  dataset: {},
  style: {
    props: {},
    setProperty(k, v) {
      this.props[k] = v
    },
    removeProperty(k) {
      delete this.props[k]
    },
  },
}

const themer = globalThis.window.__dshDeliverableMenu
assert.ok(Array.isArray(themer.THEME_PRESETS), '有预设主题')
assert.ok(themer.THEME_PRESETS.length >= 5, '至少 5 套预设')
assert.ok(
  themer.THEME_PRESETS.every((t) => /^#[0-9a-fA-F]{6}$/.test(t.accent) && t.name),
  '每套主题都有合法主色与名字',
)

const lightVars = themer.themeVars(themer.THEME_PRESETS[0])
assert.equal(lightVars['--dshq-accent'], themer.THEME_PRESETS[0].accent, '主色写进变量')
assert.equal(lightVars['--dshq-bubble-out'], themer.THEME_PRESETS[0].accent, '发出气泡用主色')
assert.equal(lightVars['--dshq-bubble-in'], '#ffffff', '浅色主题收到的气泡是白底')
assert.equal(lightVars['--dshq-on-accent'], '#ffffff', '主色上的文字是白色')

const darkTheme = themer.THEME_PRESETS.find((t) => t.dark)
assert.ok(darkTheme, '有一套暗色主题')
const darkVars = themer.themeVars(darkTheme)
assert.equal(darkVars['--dshq-bubble-in'], 'rgba(255,255,255,.10)', '暗色主题收到的气泡是半透明白')
assert.equal(darkVars['--dshq-on-accent'], '#0f1218', '暗色主题主色上的文字是深色')

// 应用主题 → 写到 documentElement 的 CSS 变量 + 持久化
themer.applyTheme({ id: 'custom', name: '自定义', accent: '#ff0055', chatBg: '#101010' }, true)
const style = globalThis.document.documentElement.style
assert.equal(style.props['--dshq-accent'], '#ff0055', '主色写入 CSS 变量')
assert.equal(style.props['--dshq-chat-bg'], '#101010', '聊天背景写入 CSS 变量')
const saved = JSON.parse(globalThis.localStorage.getItem('dsh-deliverable-menu:theme'))
assert.equal(saved.accent, '#ff0055', '主题被持久化')
assert.equal(saved.chatBg, '#101010', '背景也被持久化')

// 恢复：换回默认后 restoreTheme 应读回自定义主题
themer.applyTheme(themer.THEME_PRESETS[0], false)
themer.restoreTheme()
assert.equal(style.props['--dshq-accent'], '#ff0055', 'restoreTheme 读回上次保存的主题')
console.log('[ok] 主题：预设 / 明暗气泡变量 / 写入 CSS 变量 / 持久化与恢复')

// 主题按钮：一排色块 + 自定义取色
const themeEl = themer.ThemeButton({})
const themeBtn = [].concat(themeEl.children).flat(3).find((c) => c && c.type === 'button')
assert.ok(themeBtn, '有主题按钮')
themeBtn.props.onClick()
const themeEl2 = themer.ThemeButton({})
assert.ok(String(themeEl2.props.className).includes('dshq-theme'), '主题入口根节点')
console.log('[ok] 主题入口：按钮可展开（色块 + 自定义取色）')

// 全局 QQ 皮肤：走 ctx.theme.shade 覆盖 DSH 设计 token
const tokens = themer.qqTokens({ accent: '#12b7f5' })
assert.equal(tokens['--dsw-alias-brand-primary'].light, '#12b7f5', '主色映射到 brand token')
assert.equal(tokens['--dsw-alias-brand-primary'].dark, '#12b7f5', '亮暗都给了值')
assert.equal(tokens['--dsw-specific-bubble'].light, '#12b7f5', '自己发的气泡（DSH 的 .bubble 读这个 token）')
assert.equal(tokens['--dsw-specific-bubble-highlight'].light, '#ffffff', '强调底色（-highlight）是白的')
for (const key of ['--dsw-alias-bg-base', '--dsw-alias-focus-ring-color']) {
  assert.ok(tokens[key] && tokens[key].light && tokens[key].dark, `${key} 有亮暗两值`)
}
assert.equal(tokens['--dsw-radius-lg'].light, '14px', '圆角也调了（QQ 更圆）')
assert.ok(
  Object.values(tokens).every((v) => v && typeof v.light === 'string' && typeof v.dark === 'string'),
  'shade 要求每个 token 都是 {light,dark} 对象',
)

// apply() 时默认就应用了一次（未存偏好 → 默认开启）
assert.equal(shadeCalls.length, 1, '启动时默认应用一次')
assert.equal(shadeCalls[0].source, 'dsh-deliverable-menu', '层身份用包名（同 source 再调会替换整层）')
assert.equal(themer.isGlobalSkinOn(), true, '默认是开启状态')

const css = themer.skinCss({ accent: '#12b7f5' })
assert.ok(css.includes('--dsw-alias-brand-primary:#12b7f5'), 'CSS 覆盖主色 token')
assert.ok(css.includes('--dsw-specific-bubble:#12b7f5'), 'CSS 覆盖自己发的气泡（.bubble 用的就是它）')
assert.ok(css.includes('[class*="_bubble"]'), '另外直接给 .bubble 上色（token 被覆盖时也稳）')
assert.ok(css.includes('border-radius:18px'), '气泡圆角 18px')
assert.ok(css.includes('--dsw-radius-xl:18px'), '圆角 token 也覆盖（.bubble 读 radius-xl）')
assert.ok(css.includes('--dsw-specific-sidebar-fill:#dceef9'), '侧栏底色用 token 覆盖（不直接刷容器背景）')
assert.ok(css.includes('--dsw-radius-lg:14px'), 'CSS 覆盖圆角')
assert.ok(css.includes('body[data-ds-dark-theme]'), '带深色模式块')
assert.ok(css.startsWith(':root,body{'), '同时命中 :root 与 body（DSH 在 body 上解析材质别名）')

assert.equal(themer.setGlobalSkin(true, { accent: '#12b7f5' }, true), true, '手工开启成功')
const skinEl = styleNodes.find((el) => el.id === 'dsh-deliverable-menu/skin.css')
assert.ok(skinEl, '注入了皮肤样式表')
assert.ok(skinEl.textContent.includes('--dsw-alias-brand-primary:#12b7f5'), '样式表内容正确')
assert.equal(shadeCalls.length, 2, '再调 shade（同 source 替换整层，不叠加）')
assert.equal(shadeCalls[1].tokens['--dsw-alias-brand-primary'].light, '#12b7f5', '换成新主色')
assert.equal(globalThis.localStorage.getItem('dsh-deliverable-menu:global-skin'), '1', '开关被持久化')

themer.setGlobalSkin(false, {}, true)
assert.equal(skinDisposed.length, 1, '关闭时调用 disposer 还原')
assert.equal(styleNodes.includes(skinEl), false, '关闭时把皮肤样式表移除')
assert.equal(themer.isGlobalSkinOn(), false, '状态为已关闭')
assert.equal(globalThis.localStorage.getItem('dsh-deliverable-menu:global-skin'), '0')
console.log('[ok] 全局 QQ 皮肤：CSS 覆盖 token（brand/气泡/底色/圆角/深色块）+ shade + 开关与还原')

// 强制重绘：摘样式表 → reflow → 挂回去（治"侧栏收起后白块"）
themer.setGlobalSkin(true, { accent: '#12b7f5' }, false)
const liveSkin = styleNodes.find((el) => el.id === 'dsh-deliverable-menu/skin.css')
assert.ok(liveSkin, '皮肤样式表在')
assert.doesNotThrow(() => themer.forceRepaint(), 'forceRepaint 不应抛错')
const afterRepaint = styleNodes.find((el) => el.id === 'dsh-deliverable-menu/skin.css')
assert.ok(afterRepaint, '重绘后样式表仍然挂回 head')
assert.ok(
  afterRepaint.textContent.includes('--dsw-alias-brand-primary:#12b7f5'),
  '重绘后样式内容完整（不是空表）',
)
assert.notEqual(afterRepaint, liveSkin, '确实是"换了一张新表"（新节点才会触发全量重算）')
console.log('[ok] 强制重绘：摘表→reflow→挂回，内容不丢')

// 气泡布局规则已移除（它会命中轮次容器 → 整段被涂成色块），只靠 token 给气泡上色
assert.ok(
  !themer.skinCss({ accent: '#12b7f5' }).includes('[data-chat-node-key'),
  '皮肤里不再有气泡布局规则（不会把整轮涂成色块）',
)
assert.ok(
  themer.skinCss({ accent: '#12b7f5' }).includes('--dsw-specific-bubble:#12b7f5'),
  '气泡颜色仍通过 token 生效',
)
// 深底自动白字、浅底自动深字（不用用户手动选文字色）
const lightBubble = themer.skinCss({ accent: '#12b7f5', bubbleOut: '#95ec69' })
const darkBubble = themer.skinCss({ accent: '#12b7f5', bubbleOut: '#112233' })
assert.ok(/color:#1f2937 !important\}/.test(lightBubble), '浅色气泡配深色字')
assert.ok(/color:#ffffff !important\}/.test(darkBubble), '深色气泡配白字')

// 双击选词：全文件同名高亮（按标识符边界，不该命中 recount / count_x）
const findOcc = globalThis.window.__dshDeliverableMenu.findWordOccurrences
const src2 = ['int count;', 'count = 1;', 'int recount = count + count_x;', '// count 注释也算'].join('\n')
const occ = findOcc(src2, 'count')
assert.equal(occ.length, 4, '只匹配整词 count（4 处；recount / count_x 不算）')
assert.deepEqual(occ[0], { line: 1, start: 4, end: 9 }, '第一行的偏移正确')
assert.ok(occ.every((o) => o.end - o.start === 5), '每处长度等于词长')
const occLimited = findOcc(src2, 'count', 2)
assert.equal(occLimited.length, 2, 'limit 生效')
assert.deepEqual(findOcc(src2, '<=>'), [], '非标识符不匹配')
assert.deepEqual(findOcc(src2, ''), [], '空词不匹配')
console.log('[ok] 双击选词：整词匹配（排除 recount/count_x）+ 行号偏移 + limit')

// 打开文件：树固定在第一格，代码固定开在第二格（同一 contentId，不会越分越多）
const api2 = globalThis.window.__dshDeliverableMenu
const codeType = tabs.find((t) => t.id === 'dsh-code')
assert.ok(codeType, '注册了代码页类型')
assert.ok(!codeType.multiple, '单标签模式（多标签会让 preferNewPane 每次分新栏）')
assert.equal(codeType.title(), '代码', '标题固定为「代码」')

api2.openCodeTab('s-1', 'src/a.c', 12)
const firstTab = opened.tabs[opened.tabs.length - 1]
assert.equal(firstTab.kind, 'dsh-code')
assert.equal(firstTab.options.preferNewPane, true, '始终 preferNewPane：首次分栏、之后只 reveal')
assert.deepEqual(firstTab.options.params, {}, '内容靠 openState 切换，不靠 params')

// 连点同一文件 600ms 内只开一次
const before = opened.tabs.length
api2.openCodeTab('s-1', 'src/a.c', 12)
assert.equal(opened.tabs.length, before, '同一文件短时间重复打开被去重')
console.log('[ok] 代码导航：树固定一格 + 右侧单一「代码」格（不会越分越多）')

// 递归收集节点（.flat 只压平数组，不会进入 children）
const walkNodes = (nodes, acc = []) => {
  for (const node of [].concat(nodes).flat(5)) {
    if (!node || typeof node !== 'object') continue
    if (node.type) {
      acc.push(node)
      walkNodes(node.children || [], acc)
    }
  }
  return acc
}

// Markdown 渲染：标题 / 段落（行内格式）/ 列表 / 代码块 / 表格 / 引用
const md = [
  '# 大标题',
  '',
  '普通段落 **加粗** 和 `inline` 以及 [链接](https://x.y)。',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '| 列1 | 列2 |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '> 引用文本',
].join('\n')
const blocks = themer.renderMarkdown(md)
const types = blocks.map((b) => b.type)
assert.deepEqual(types, ['h1', 'p', 'ul', 'pre', 'table', 'blockquote'], '块级结构正确')

const inlineTypes = walkNodes(blocks[1].children).map((x) => x.type)
assert.ok(inlineTypes.includes('strong'), '行内加粗 → <strong>')
assert.ok(inlineTypes.includes('code'), '行内代码 → <code>')
assert.ok(inlineTypes.includes('a'), '链接 → <a>')

assert.equal(walkNodes(blocks[2].children).filter((x) => x.type === 'li').length, 2, '两条列表项')

const preNodes = walkNodes(blocks[3].children)
assert.ok(
  preNodes.some((x) => String(x.props.className || '').includes('dsh-nav-code')),
  '代码块复用代码区配色',
)

const tableNodes = walkNodes(blocks[4].children).map((x) => x.type)
assert.ok(tableNodes.includes('thead') && tableNodes.includes('tbody'), '表格有表头与表体')
assert.equal(tableNodes.filter((x) => x === 'th').length, 2, '两列表头')
assert.equal(tableNodes.filter((x) => x === 'td').length, 2, '两个单元格')

// 行内解析细节
const inline = themer.renderInline('a **b** `c` ~~d~~ [e](f)', 'k')
const kinds = inline.filter((x) => x && x.type).map((x) => x.type)
assert.deepEqual(kinds, ['strong', 'code', 'del', 'a'], '行内格式齐全')
console.log('[ok] Markdown：标题/段落/列表/代码块/表格/引用 + 行内格式')

// 文件卡片：大小格式化 + 类型色块
const fmt = globalThis.window.__dshDeliverableMenu.formatBytes
assert.equal(fmt(0), '0 B')
assert.equal(fmt(512), '512 B')
assert.equal(fmt(1024), '1 KB')
assert.equal(fmt(14643), '14.3 KB', '14.3 KB（小于 10 保留一位小数）')
assert.equal(fmt(10171187), '9.7 MB')
assert.equal(fmt(1048576), '1 MB')

const chip = globalThis.window.__dshDeliverableMenu.fileChipMeta
assert.deepEqual(chip({ type: 'dir', name: 'src' }), { kind: 'dir', label: '' }, '目录用文件夹图标')
assert.deepEqual(chip({ type: 'file', name: 'wifi-config-design.md' }), { kind: 'md', label: 'MD' })
assert.deepEqual(chip({ type: 'file', name: 'ScannerOTA.exe' }), { kind: 'exe', label: 'EXE' })
assert.deepEqual(chip({ type: 'file', name: 'dy_mqtt.c' }), { kind: 'code', label: 'C' })
assert.deepEqual(chip({ type: 'file', name: 'package.json' }), { kind: 'json', label: 'JSON' })
assert.deepEqual(chip({ type: 'file', name: 'LICENSE' }), { kind: 'file', label: 'F' }, '无扩展名兜底')
console.log('[ok] 文件卡片：KB/MB 格式化 + 按扩展名分类（md/exe/code/json/dir）')

// 回合结尾卡片：从 git 状态挑"本轮改动"
const tail = globalThis.window.__dshDeliverableMenu.tailChangedFiles
const tailFiles = [
  { path: 'z.md', status: 'M' },
  { path: 'a/big.exe', status: '?' },
  { path: 'build/', status: '?', untrackedDir: true },
  { path: 'a.md', status: 'A' },
  { path: 'b.txt', status: 'M' },
  { path: 'y.md', status: 'M' },
]
const picked = tail(tailFiles, 4)
assert.equal(picked.length, 4, '最多 4 张卡')
assert.deepEqual(picked.map((x) => x.path), ['a.md', 'a/big.exe', 'b.txt', 'y.md'], '按路径排序 + 截断')
assert.deepEqual(picked[0], { path: 'a.md', name: 'a.md', status: 'A' }, '带出文件名与状态')
assert.ok(!picked.some((x) => x.path.endsWith('/')), '目录条目被排除')
assert.deepEqual(tail([], 4), [], '空列表返回空')
assert.deepEqual(tail(null, 4), [], 'null 也不炸')
console.log('[ok] 回合结尾卡片：过滤目录 + 排序 + 截断 4 张')

// turnTail 上下文解析：scope 优先，其次 props / turn
const ctxOf = globalThis.window.__dshDeliverableMenu.resolveTailContext
assert.deepEqual(ctxOf({ scope: { sessionId: 's1', cwd: '/w' } }), { sessionId: 's1', cwd: '/w' })
assert.deepEqual(ctxOf({ sessionId: 's2' }), { sessionId: 's2', cwd: '' }, '顶层 sessionId 兜底')
assert.deepEqual(
  ctxOf({ turn: { sessionId: 's3', cwd: '/p' } }),
  { sessionId: 's3', cwd: '/p' },
  'turn 里也认',
)
assert.deepEqual(ctxOf({}), { sessionId: '', cwd: '' }, '都没有时返回空串（不抛错）')
console.log('[ok] turnTail 上下文：scope → props → turn 三级回退')

// 产物 vs 改动：打包出来的 exe/zip 要单独成组
const art = globalThis.window.__dshDeliverableMenu.isArtifactFile
assert.equal(art('dist/ScannerOTA.exe'), true, 'dist 下的 exe 是产物')
assert.equal(art('ScannerOTA.exe'), true, '裸 exe 也是产物')
assert.equal(art('release/app.zip'), true, 'zip 是产物')
assert.equal(art('cli_launcher.py'), false, '源码不算产物')
assert.equal(art('CLI.md'), false, '文档不算产物')
assert.equal(art(''), false, '空路径不算')

const split = globalThis.window.__dshDeliverableMenu.splitTailFiles
const grouped = split(
  [
    { path: 'dist/ScannerOTA.exe', status: '?' },
    { path: 'cli_launcher.py', status: 'M' },
    { path: 'CLI.md', status: 'M' },
    { path: 'build/app.zip', status: '?' },
    { path: 'src/main.c', status: 'M' },
  ],
  4,
)
assert.deepEqual(grouped.artifacts.map((x) => x.path), ['build/app.zip', 'dist/ScannerOTA.exe'], '产物组')
assert.deepEqual(grouped.edits.map((x) => x.path), ['cli_launcher.py', 'CLI.md', 'src/main.c'], '改动组（zh 排序：_ 在 . 之前）')
assert.equal(grouped.total, 5, '总数是全部改动')

const limited = split([{ path: 'a.exe' }, { path: 'b.exe' }, { path: 'c.exe' }], 2)
assert.equal(limited.artifacts.length, 2, '产物组也遵守 limit')
console.log('[ok] 回合结尾：产物/改动分组（exe、zip、dist/ 归产物）')

// 合并两个数据源：最近扫描到的产物 + git 改动（同路径只出现一次）
const mergeGroups = globalThis.window.__dshDeliverableMenu.buildTailGroups
const merged = mergeGroups(
  {
    recentFiles: [
      { path: 'dist/ScannerOTA.exe', name: 'ScannerOTA.exe', size: 123 },
      { path: 'dist/app.zip', name: 'app.zip', size: 456 },
    ],
    gitFiles: [
      { path: 'dist/ScannerOTA.exe', status: '?' },
      { path: 'src/main.c', status: 'M' },
      { path: 'build/old.dll', status: '?' },
      { path: 'dist/', status: '?', untrackedDir: true },
    ],
  },
  4,
)
assert.deepEqual(
  merged.artifacts.map((x) => x.path),
  ['dist/ScannerOTA.exe', 'dist/app.zip', 'build/old.dll'],
  '产物 = 最近扫描优先 + git 里的产物，且同路径去重',
)
assert.deepEqual(merged.edits.map((x) => x.path), ['src/main.c'], '源码进改动组')
assert.equal(merged.total, 3, 'total 只数 git 里的有效条目（目录不算）')
assert.equal(merged.artifacts[0].size, 123, '最近产物带 size')
console.log('[ok] 回合结尾分组：最近产物 + git 改动 合并去重')

// 长文本折叠：字符数与高度双阈值
const fold = globalThis.window.__dshDeliverableMenu.shouldFoldLongText
assert.equal(fold(3000, 900), true, '又长又高 → 折叠')
assert.equal(fold(3000, 200), false, '长但不占屏 → 不折')
assert.equal(fold(300, 1200), false, '高但很短 → 不折')
assert.equal(fold(1200, 421), true, '刚好过阈值 → 折')

const label = globalThis.window.__dshDeliverableMenu.longTextLabel
assert.equal(label(12345), '长文本 · 1.2 万字符')
assert.equal(label(10000), '长文本 · 1 万字符')
assert.equal(label(3400), '长文本 · 3.4 千字符')
assert.equal(label(800), '长文本 · 800 字符')
console.log('[ok] 长文本折叠：双阈值判定 + 万/千字符标签')

// 提示音：地址走节点端 GET 路由
const cues = globalThis.window.__dshDeliverableMenu.CUE_URL
assert.equal(cues.ask, '/dsh-deliverable-menu/assets/cue-ask.wav')
assert.equal(cues.done, '/dsh-deliverable-menu/assets/cue-done.wav')
assert.equal(
  globalThis.window.__dshDeliverableMenu.isWindowUnfocused(),
  false,
  '没有 document 时按"聚焦"处理（不补提醒）',
)
console.log('[ok] 提示音：ask/done 两个地址 + 无 document 时不补提醒')

// 提示音：playCue 在没有 Audio 的环境下要"安静失败"，不能抛
const cuePlay = globalThis.window.__dshDeliverableMenu.playCue
const cueRes = await cuePlay('ask')
assert.equal(cueRes.ok, false)
assert.equal(cueRes.error, 'no-audio')
console.log('[ok] 提示音：无 Audio 环境静默失败（返回 {ok:false}）')

// 结构自检（排查用）仍然可用
const report = themer.inspectChatDom()
assert.ok(typeof report === 'string' && report.includes('# 对话行'), '自检返回可读报告')
console.log('[ok] 已移除气泡布局规则（只保留 token 上色）+ 结构自检可用')

console.log('\n全部通过：客户端契约 23 组断言')
