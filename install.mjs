/**
 * 把本插件装进 DSH 的 desktop profile（幂等，可重复执行）。
 *
 * 做三件事：
 *   1. 复制包到 <DSH_HOME>/profiles/desktop/node_modules/<包名>
 *   2. 在 profile 的 package.json 里把包名追加进 dsh.profile.bundles（末尾）
 *   3. 在 dependencies 里登记 `file:<本包绝对路径>`
 *
 * 第 3 步是给插件市场看的：dshmarket 的「已安装」列表只读 dependencies
 * （lib/profile.js 的 readInstalled() 遍历 manifest.dependencies），
 * 只写 bundles 的包在市场的界面里完全看不到。
 *
 * desktop profile 由 Electron 应用独占管理（CLI 拒绝修改它），所以这里直接改
 * 应用自己也在读的那两个位置；加载顺序上把本插件放在最后，避免影响既有 bundle。
 *
 *   node install.mjs [--dsh-home <路径>] [--uninstall] [--from-npm [版本]]
 *
 * 换台电脑最省事的装法（不用 clone 源码）：
 *   node install.mjs --from-npm            # 装 npm 上的 latest
 *   node install.mjs --from-npm 1.31.1     # 装指定版本
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_NAME = 'dsh-deliverable-menu'
const PROFILE = 'desktop'

const args = process.argv.slice(2)
const homeArg = args.indexOf('--dsh-home')
const DSH_HOME = homeArg >= 0 ? args[homeArg + 1] : process.env.DSH_HOME || join(homedir(), '.dsh')
const UNINSTALL = args.includes('--uninstall')
// --from-npm [版本]：从 npm registry 拉包安装（换台电脑时最省事，不用 clone 源码）
const npmIdx = args.indexOf('--from-npm')
const FROM_NPM = npmIdx >= 0
const NPM_VERSION =
  FROM_NPM && args[npmIdx + 1] && !args[npmIdx + 1].startsWith('--') ? args[npmIdx + 1] : 'latest'

const here = dirname(fileURLToPath(import.meta.url))
const profileDir = join(DSH_HOME, 'profiles', PROFILE)
const profilePkgPath = join(profileDir, 'package.json')
const targetDir = join(profileDir, 'node_modules', PKG_NAME)

if (!existsSync(profilePkgPath)) {
  console.error(`[错误] 找不到 profile：${profilePkgPath}`)
  console.error('       请确认 DSH 桌面端装过并至少启动过一次，或用 --dsh-home 指定。')
  process.exit(1)
}

const raw = readFileSync(profilePkgPath, 'utf8')
const pkg = JSON.parse(raw)
pkg.dsh ??= {}
pkg.dsh.profile ??= {}
pkg.dsh.profile.bundles ??= []
pkg.dependencies ??= {}
const bundles = pkg.dsh.profile.bundles
const inBundles = bundles.includes(PKG_NAME)

// 本地源码安装 → file: 指向源码目录；从 npm 安装 → 写真实 semver（pnpm 可自行解析）
let depSpec = `file:${here.replace(/\\/g, '/')}`

if (UNINSTALL) {
  const idx = bundles.indexOf(PKG_NAME)
  if (idx >= 0) bundles.splice(idx, 1)
  delete pkg.dependencies[PKG_NAME]
  writeProfile()
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  console.log(`[卸载] 已从 bundles / dependencies 移除，并删除 ${targetDir}`)
  process.exit(0)
}

// 1) 复制包（本地源码 或 从 npm registry 拉）
rmSync(targetDir, { recursive: true, force: true })
mkdirSync(dirname(targetDir), { recursive: true })

let installedVersion = null
if (FROM_NPM) {
  const tmp = join(dirname(profilePkgPath), `.install-tmp-${Date.now()}`)
  mkdirSync(tmp, { recursive: true })
  try {
    console.log(`[1/3] 从 npm 拉取 ${PKG_NAME}@${NPM_VERSION} …`)
    // 用 npm install --prefix 让 npm 自己解包（跨平台，不依赖系统的 tar）
    execFileSync(
      'npm',
      ['install', '--prefix', tmp, '--no-audit', '--no-fund', `${PKG_NAME}@${NPM_VERSION}`],
      { stdio: 'inherit', shell: process.platform === 'win32' },
    )
    const pkgDir = join(tmp, 'node_modules', PKG_NAME)
    if (!existsSync(join(pkgDir, 'package.json'))) throw new Error('npm install 没有产出包目录')
    installedVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
    cpSync(pkgDir, targetDir, { recursive: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`[1/3] 已从 npm 安装 ${PKG_NAME}@${installedVersion} → ${targetDir}`)
} else {
  cpSync(here, targetDir, {
    recursive: true,
    filter: (src) => !src.includes(`${join(here, '.git')}`) && !src.includes(`${join(here, 'node_modules')}`),
  })
  console.log(`[1/3] 已复制源码 → ${targetDir}`)
}

// 2) 登记 bundle（决定是否随 DSH 启动加载）
if (inBundles) {
  console.log(`[2/3] bundles 已包含 ${PKG_NAME}（未重复插入）`)
} else {
  bundles.push(PKG_NAME)
  console.log(`[2/3] 已追加到 dsh.profile.bundles（第 ${bundles.length} 项）`)
}

// 3) 登记依赖（决定插件市场「已安装」里是否出现）
if (FROM_NPM) depSpec = `^${installedVersion}`
const oldSpec = pkg.dependencies[PKG_NAME]
if (oldSpec === depSpec) {
  console.log(`[3/3] dependencies 已登记 ${depSpec}`)
} else {
  pkg.dependencies[PKG_NAME] = depSpec
  console.log(`[3/3] 已写入 dependencies：${depSpec}`)
}

writeProfile()

console.log('\n完成。重启 DeepSeek Harness 后生效。')
console.log('验证：交付卡片右侧会出现「⋯」，或直接右键卡片 → 打开 / 打开所在文件夹。')
console.log(
  FROM_NPM
    ? `插件市场 →「已安装」里应能看到本插件（来源 npm ${PKG_NAME}@${installedVersion}）。`
    : '插件市场 →「已安装」里应能看到本插件（来源显示为本地 file:）。',
)

function writeProfile() {
  const backup = `${profilePkgPath}.bak-${Date.now()}`
  renameSync(profilePkgPath, backup)
  writeFileSync(profilePkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  console.log(`       profile 已更新（备份：${backup}）`)
}
