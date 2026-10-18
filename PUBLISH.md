# 发布到 DSH 插件市场

> 仓库：https://github.com/chufengsen/dsh-deliverable-menu
> 本地已 `git init` + 提交 + 配好 `origin`（只需 `git push -u origin main`）。
>
> 本文的每一条都来自实查：市场应用 `dshmarket@1.66.32` 的 README、它的数据源，
> 以及 `https://awesome-dsh-plugin.com/plugins.json` 的真实条目结构。

## 市场的收录机制（先搞清这个，别走弯路）

DSH 插件市场**没有自己的发布服务**，它是这么工作的：

```
awesome-dsh-plugin/awesome-dsh-plugin   (GitHub 仓库，人工 PR 审核)
        │  CI 每日生成
        ▼
https://awesome-dsh-plugin.com/plugins.json   ← dshmarket 每次打开都实时拉这个
        │  dshmarket 按条目里的 npm 名 / tarball 直链安装
        ▼
你的插件包（npm 或 GitHub Release .tgz）
```

所以「发布到市场」= **① 让包可被安装（npm / GitHub Release）+ ② 往精选列表提一个 PR**。
`dshmarket` 自己的 README 原话：

> 这个仓库是市场应用本身，不是插件目录。市场里的插件列表来自精选列表 awesome-dsh-plugin——
> 想让你的插件上架，请去**那边**提 PR（在列表里加一条即可，站点和本市场会自动收录，通常一天内生效）。

## 你现在的状态（已核对）

| 项 | 状态 |
|---|---|
| 包名 `dsh-deliverable-menu` | `npm view` 返回 404 → **npm 上没有同名包，可用**（若发布时撞名，改成 `@你的npm用户名/dsh-deliverable-menu`） |
| `package.json` | 已有 `main` / `exports` / `files` / `license` / `keywords` / `dsh.bundle` / `dsh.client` ✓ |
| 本地安装 | 目前是 `file:` 装法（`install.mjs` 直接改 profile），**发布后要走 npm 装法** |
| 打包内容 | 见下方 `npm pack --dry-run` 的输出，只有 `lib/`、`cordis.patch.yml`、README |

---

## 第 0 步：仓库必须公开

`awesome-dsh-plugin` 的 CI 要抓你仓库的 README / stars / 提交记录来生成条目，
**私有仓库抓不到**（匿名访问 GitHub 私有仓库一律 404，看起来就像"仓库不存在"）。

改成公开：仓库页 → **Settings → General → 拉到最下面 Danger Zone → Change visibility → Public**。

## 第 1 步：发布到 npm

```bash
cd dsh-plugins/dsh-deliverable-menu

# 1) 先干跑，确认打进包里的东西（不该有 test/ 和 开发脚本）
npm pack --dry-run

# 2) 登录（第一次）
npm login

# 3) 发布（public，scope 包要带 --access public）
npm publish --access public
```

发布前建议补三个字段（npm 不强制，但市场页面/仓库链接会好看很多）：

```json
"repository": { "type": "git", "url": "git+https://github.com/chufengsen/dsh-deliverable-menu.git" },
"homepage": "https://github.com/chufengsen/dsh-deliverable-menu#readme",
"publishConfig": { "access": "public" }
```

> 版本号就是市场的更新依据：市场按 npm 上的 `version` 对比已装版本，所以**每次改完记得 bump**。

## 第 2 步（二选一）：GitHub Release tarball

不想发 npm 也可以，市场条目支持 `tarball` 直链（plugins.json 里 `dsh-prompt-polish` 就是这么发的）：

```bash
npm pack                                  # 得到 dsh-deliverable-menu-1.30.0.tgz
gh release create v1.30.0 dsh-deliverable-menu-1.30.0.tgz   # 上传为 release 资产
```

然后把 release 资产的直链填进条目（见下）。

## 第 3 步：往精选列表提 PR

仓库：`github.com/awesome-dsh-plugin/awesome-dsh-plugin`

- 现在的要求是 **一个条目一个文件**（keyed by slug），放在 `data/` 目录下，由 `entries.mjs` 管理；
  **不用**手动生成 README（CI 自动生成），也**没有**"提交满 1 天 / 10 次 commit"这类门槛了。
- 新增文件 `data/dsh-deliverable-menu.<扩展名>`（按仓库里已有条目的实际后缀照抄即可），内容照这个结构填：

```jsonc
{
  "name": "dsh-deliverable-menu",
  "owner": "chufengsen",
  "url": "https://github.com/chufengsen/dsh-deliverable-menu",
  "category": "<按仓库 README 的分类表挑一个，如 ui / devtools>",
  "description": {
    "en": "VS Code-style Git panel with side-by-side diff, file tree (new/rename/delete/run), cross-file search, code navigation (include jump, go-to-def, hover docs), side chat that forks the session, and right-click on deliverable cards.",
    "zh": "VS Code 式 Git 面板（并排 diff）、文件树（新建/重命名/删除/运行）、跨文件搜索、代码导航（include 跳转/跳定义/悬停注释）、《继承会话上下文的侧边会话》、交付卡片右键菜单。"
  },
  "npm": "dsh-deliverable-menu"
  // 想带图再加： "screenshots": ["https://raw.githubusercontent.com/chufengsen/dsh-deliverable-menu/main/shots/panel.png"]
}
```

- 只发 GitHub Release 的话，把 `"npm"` 换成
  `"tarball": "https://github.com/chufengsen/dsh-deliverable-menu/releases/download/v1.30.0/dsh-deliverable-menu-1.30.0.tgz"`。
- `capabilities` / `capabilityRedLines` / `install` / `stars` / `downloads` 这些**不用你写**，
  是 CI 扫描 + 生成出来的（`capabilityCheckedAt` 就是扫描时间戳）。
- 截图：可选。想显示的话，在**你自己仓库**的 `package.json` 旁放 `screenshots.json`
  （相对路径数组），比塞绝对 URL 更好维护。

**审核会关心什么**（写 PR 描述时可以直接说明）：

| 能力 | 本插件是否使用 | 说明 |
|---|---|---|
| `fs-read` | 是 | 只读当前会话工作区内的文件（有路径穿越防护，越界返回 403） |
| `fs-write` | 是 | 新建/重命名文件；仅限会话工作区 |
| `env` | 否 | 不读环境变量 |
| `network` | 否 | 全程本地，只起 127.0.0.1 上的 RPC 端点 |
| `llm` | 否 | 不调用模型（侧边会话走的是宿主自己的 `session.prompt`） |

## 第 4 步：验证收录

```bash
# 收录生效后（通常一天内），用市场自己的安装命令验证
dsh plugin --profile web add dsh-deliverable-menu

# 或者直接看 JSON 里有没有你
curl -s https://awesome-dsh-plugin.com/plugins.json | grep -o '"name": *"dsh-deliverable-menu"'
```

然后在 DSH 的「插件市场 → 已安装」里应该能看到它，来源显示为 **npm**（而不是现在的 `file:`）。

---

## 常见坑

1. **`files` 漏了东西**：包发上去但运行时找不到模块。发布前务必 `npm pack --dry-run` 看清单。
2. **`dsh` 字段别照抄本地 profile 的 `bundles`**：那是安装器写给**profile** 的，不是包自己的；
   包里的 `dsh` 只需要 `bundle.patch` + `client.inject/platform`（本包已经是对的）。
3. **版本号忘了 bump**：市场按版本判断更新，版本不变就永远显示"已是最新"。
4. **把私有路径写进包里**：`install.mjs` 里的 `file:` 路径是本地安装用的，发布包可以不带它，
   但**别删**，你本地还得用它装回桌面版。
5. **`main` 指错**：本包是 `type: module` + `main: lib/index.js`，客户端是 `./client` 导出，
   `cordis.patch.yml` 负责把两者挂到宿主，三者缺一不可。
