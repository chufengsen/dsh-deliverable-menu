# dsh-deliverable-menu

DeepSeek Harness（DSH）增强插件。**v1.6**，把 VS Code 那套"看代码 + 改代码 + 管改动"搬进 DSH 右侧栏。

## 入口只有一处：会话窗口顶部的一个 Git 按钮

```
┌ 会话标题栏（右上）            [⑂ Git ③]  ← 唯一入口，数字是改动文件数
└────────────────────────────────────────────
   点它 → 右侧栏展开「源代码管理」页：
   ┌ 分支 master ↑1 ↓0          [↓拉取] [↑推送] [⟳]
   ├ [文件] [更改 3] [搜索]      ← 页内三个视图，对应 VS Code 的活动栏
   ├ 文件： 📄+  📁+  🔍  ⟳  + 当前项目文件树（Git 状态着色）
   │         └ 点文件 → 「代码导航」页（高亮查看 / 编辑 / Ctrl+点击跳转定义 / 联想）
   ├ 更改： 提交框 + 暂存的更改 / 更改 / 未跟踪 + 最近提交
   │         └ 点文件 → 右侧**再分一格**：左右并排 diff（左旧右新，红删绿增）
   └ 搜索： 输入关键字（Aa 大小写 / .* 正则）→ 按文件分组 → 点命中跳行
```

输入框里**不再有任何图标**；其它入口都收进这一个页面里。

## 需求对照

| 需求 | 状态 |
| --- | --- |
| 唯一 Git 入口在会话窗口顶部 | ✅ `conversation.session.header.utilities` |
| 点开后侧栏展开、有新建 + 文件目录 | ✅ 默认落在「文件」视图（新建文件/文件夹 + 项目文件树） |
| Git（VS Code 式：暂存/提交/历史/分支/push/pull） | ✅ 「更改」视图 |
| 左右并排 diff | ✅ 点更改里的文件，右栏分第二格 |
| 文件查看 / 编辑 / 保存 | ✅ 代码导航页（点文件树里的文件进入） |
| 新建文件 / 新建文件夹 | ✅ 文件视图工具栏（行内输入，Enter 创建） |
| 查找 | ✅ 「搜索」视图（跨文件、Aa / .*） |
| Ctrl+左键跳转定义 / 联想 | ✅ 代码导航页（Alt+← 返回；联想 ≥2 字符自动弹） |

另外：交付卡片右键菜单（打开 / 打开所在文件夹 / 复制路径）。

## 文件树（资源管理器）

- **显示规则与索引不同**：文件树只隐藏版本库元数据（`.git` / `.hg` / `.svn`），
  `build`、`dist`、`node_modules`、`__pycache__` 等一律照常显示并可展开
  （符号索引/全局搜索仍然跳过它们以省 IO——两者用不同的过滤表 `TREE_SKIP_DIRS` / `SKIP_DIRS`）
- 每个文件前显示**文件类型图标**：直接复用 DSH 的 `@deepseek-ai/dsh-client-ui-primitives` 里的
  `FileTypeIcon` / `IconFolderCloseRegular` / `IconFolderOpenRegular`，和 DSH 内置文件树一致
  （拿不到 primitives 时退回自带 SVG，不会空白）
- 目录展开/收起时文件夹图标会切换；文件右侧保留 Git 状态字母（M/A/D/U）
- **右键菜单**（VS Code 资源管理器同款）：

  | 在哪里点 | 菜单项 |
  | --- | --- |
  | 目录上 | 新建文件、新建文件夹、在资源管理器中打开、刷新 |
  | 文件上 | 打开、**运行**、在资源管理器中显示、复制相对路径 |
  | 空白处 | 新建文件、新建文件夹、刷新（都在根目录） |

- **运行有两种语义**（右键里分开给，因为差别很大）：

  | 菜单项 | 做什么 | 适用 |
  | --- | --- | --- |
  | **运行** | `cmd /c start "" <文件>` —— **和资源管理器里双击完全一致**：GUI 程序自己开窗口、控制台程序自己弹控制台；进程分离、不捕获输出、**没有超时**，插件退出也不影响它 | `.exe/.com/.jar/.py/.js/.sh/.bat/.cmd/.ps1` |
  | **运行并查看输出** | 当控制台程序跑，把 stdout/stderr/退出码收进浮层（60 秒超时） | `.py/.js/.mjs/.cjs/.sh/.bat/.cmd/.ps1` |
  | **编译并运行** | 先用 `gcc/g++/clang` 编到系统临时目录再跑，编译错误一并显示（编译 60 秒超时） | `.c/.cpp/.cc/.cxx` |

  不支持的类型置灰，提示带扩展名（如「不支持 .h」）。
  `.c` 需要本机装有编译器，否则提示「没有找到可用的 gcc / clang」。
  浮层标题分四种：运行中 / **已启动（双击方式）** / 运行完成 / 运行结束（退出码 N）——最后一种是程序跑完了但返回非零，不算失败。
  **只按扩展名映射、不拼 shell 字符串**。
- 新建仍是行内输入：在目标目录里出现输入框，Enter 创建 / Esc 取消；目录没展开时会先自动展开。

## 代码主题：VS Code Dark+

代码区（查看 + 编辑）用 VS Code 默认深色主题 **Dark+** 的官方配色，并按 VS Code 的**语义**着色：

| 元素 | 颜色 | 备注 |
| --- | --- | --- |
| 背景 / 正文 | `#1E1E1E` / `#D4D4D4` | |
| 行号 / 当前行 | `#858585` / 行高亮 `#2A2D2E` | 行号栏 48px 右对齐 |
| 注释 | `#6A9955` | |
| 字符串、`#include` 路径 | `#CE9178` | `<stdio.h>` 与 `"x.h"` 同色 |
| 数字 | `#B5CEA8` | |
| 控制流（`if/for/return/await/elif…`） | `#C586C0` | 紫色 |
| 声明关键字（`class/const/struct/typedef…`） | `#569CD6` | 蓝色 |
| 预处理指令（`#include` / `#define`） | `#C586C0` | |
| 类型 / 类名 | `#4EC9B0` | 青色 |
| 函数名 | `#DCDCAA` | 黄色 |
| **变量 / 参数 / 成员** | `#9CDCFE` | 浅蓝——VS Code 里最常见的那个色 |
| 宏 / 全大写常量 | `#4FC1FF` | 亮蓝 |
| 括号配对 | `#FFD700` / `#DA70D6` / `#179FFF` | 按嵌套深度三色循环 |

`_t` 结尾的标识符（`TaskHandle_t` / `uint32_t`）以及常见内建类型自动按**类型**着色，
宏按全大写识别；其余标识符都是变量色——这一点是"像不像 VS Code"的关键：
之前所有普通标识符都留成白色，整片代码会糊成一片。
字号 13px / 行高 20px（VS Code 默认 14/21，侧栏窄一点取 13）。

类型/函数名这一类**语义着色来自符号索引**（只对索引里存在的名字生效），其余靠词法。
文件头（路径 + 按钮）和悬停浮窗也同步改成深色（`#252526` / `#CCCCCC`），编辑模式的
textarea 同样深底浅字、光标 `#AEAFAD`、选区 `#264F78`。

> 并排 **diff 保持浅色**：红删绿增的底色在白底上更容易分辨（VS Code 的深色 diff 是给深色编辑器配的）。

## 全局 QQ 主题（整个 DSH 应用）

**默认开启**。两根管道同时上，保证"整个应用"都变色：

1. **CSS 覆盖 DSH 设计 token**（主通道，一定生效）——插件往 `<head>` 注入一张
   `dsh-deliverable-menu/skin.css`：

```css
:root,body{
  --dsw-alias-brand-primary:#12b7f5 !important;      /* 按钮/链接/选中态 */
  --dsw-alias-brand-text:#12b7f5 !important;
  --dsw-alias-focus-ring-color:#12b7f5 !important;
  --dsw-specific-bubble-highlight:#12b7f5 !important; /* 自己发的消息气泡 */
  --dsw-specific-bubble:#ffffff !important;           /* 收到的消息气泡 */
  --dsw-alias-bg-base:#f3f8fc !important;             /* 主窗口底色 */
  --dsw-alias-bg-layer-1:#ffffff !important;          /* 卡片/面板 */
  --dsw-alias-bg-layer-2:#f7fbff !important;
  --dsw-specific-sidebar-fill:#eaf3fa !important;     /* 侧栏底色 */
  --dsw-alias-interactive-bg-hover:rgba(18,183,245,.10) !important;
  --dsw-radius-lg:14px !important;                    /* 圆角更圆（QQ 风格） */
  --dsw-radius-md:10px !important;
  --dsw-radius-panel:16px !important;
}
body[data-ds-dark-theme]{ /* 深色模式同一套，换成深底 */ }
```

2. **`ctx.theme.shade('dsh-deliverable-menu', token→{light,dark})`**（辅通道）——
   少数组件是从主题快照读 token 的，CSS 覆盖不到，shade 补上；关闭时 `dispose()` 还原。

选关：主题面板里勾掉「QQ 主题应用到整个 DSH」→ 立刻移除样式表并 dispose，恢复原样；
状态存 `localStorage['dsh-deliverable-menu:global-skin']`，**没存过默认开**。

### 整窗调色盘 + 效果开关

主题面板里「整窗配色（自定义）」是一组 8 个取色器，**每一个都直接映射到 DSH 的 token**：

| 取色器 | token |
| --- | --- |
| 主题色 | `--dsw-alias-brand-primary` / `-brand-text` / `-focus-ring-color` |
| 页面底色 | `--dsw-alias-bg-base` |
| 面板底 | `--dsw-alias-bg-layer-1` |
| 侧栏底色 | `--dsw-specific-sidebar-fill` |
| 我的气泡 | `--dsw-specific-bubble-highlight` |
| 对方气泡 | `--dsw-specific-bubble` |
| 聊天背景 | 对话区渐变底色 |
| 正文颜色 | `--dsw-alias-label-primary` |

「效果」开关（v1.21 起只剩渐变；**磨砂玻璃已移除**）：

```css
/* 渐变背景：整窗斜向渐变，固定在视口 */
body{
  background-image:linear-gradient(160deg,#12b7f526 0%,transparent 42%),
                   linear-gradient(200deg,#f3f8fc 0%,#f7fbff 100%) !important;
  background-attachment:fixed !important;
}
```

**为什么删掉磨砂**：`backdrop-filter` 会让被作用元素独立成合成层，侧边栏收起时
Chromium 有时不失效该层，原位置会留一块**没重绘的白底板**（控件还在、还能点，但看不见）。
实测"强制重绘"也没能彻底压住，所以直接把这一档砍掉，不再提供可能弄坏界面的选项。
同理**不再覆盖 `--dsw-specific-sidebar-fill`**（收起后那条窄栏读的就是它，上色就是一块实心块）。

> 为什么用 token 而不是改类名：DSH 的 UI 类是 CSS Modules 哈希名（`_heroOptions_a1b2c3`），
> 改它们一升级就碎。token 是官方约定，覆盖后所有读取该 token 的组件一起变。

### 聊天气泡

DSH 的气泡样式（源码里的 CSS module，已核对）：

```css
.xxx_bubble{
  background: var(--dsw-specific-bubble);   /* ← 自己发的消息就是这个 */
  border-radius: var(--dsw-radius-xl);
  color: var(--dsw-alias-label-primary);
  padding: 10px 16px;
}
```

所以皮肤做三件事：

1. `--dsw-specific-bubble` ← 「我的气泡」颜色（**不是** `-highlight`，那个聊天区没用到）
2. `--dsw-radius-xl: 18px`（气泡真正的圆角 token）
3. 再补一条 `[class*="_bubble"]:not([class*="dsh-"]){background:…;border-radius:18px;color:…}` ——
   CSS Modules 的哈希只在前缀，`_bubble` 后缀稳定；这样即使组件内联覆盖了 token 也能保住，
   **并按背景亮度自动选文字色**（深底白字 / 浅底深字）

## 左侧边栏：图标收纳（rail）

DSH **本身就有**这个模式（`html[data-sidebar-collapsed="true"]`），折叠后只留图标 + 悬停提示，
和 Codex / VS Code 的 activity bar 一样。

- 界面里：点侧边栏里的「收起侧边栏」
- 快捷键：**Ctrl+Alt+B**（插件帮你点那个按钮，找不到时会提示）

> 没有用 CSS 硬改宽度/隐藏文字 —— 那是哈希类名，一升级就碎；直接复用 DSH 自带的折叠态最稳。

## 侧边会话（继承完整上下文）

右侧栏「源代码管理」页的第 4 个视图 `[侧边会话]`：点「开始」会**从当前会话 fork 一个新会话**
（DSH 的 `session.fork`，继承当前对话的完整事件前缀），然后在面板里独立提问——
不污染主对话，主对话继续做别的事。

- **fork**：`ctx.remote.session.fork({ sessionId })` → 返回新会话 id
- **提问**：`ctx.remote.session.prompt({ sessionId, content: [{ type: 'text', text }] })`
- **读取回答**：`ctx.sessions.get(id)` → 客户端 Session 对象 → `.open()`；
  事件窗口 `session.eventSource.getSnapshot().entries` + `.subscribe()`（另加 900ms 轮询兜底）
- **渲染**：从事件里递归提取 `{type:'text', text}` 片段，按事件类型分 user / assistant；
  连续的同角色流式片段合并成一个气泡，工具调用不显示（回答里的工具过程仍在分支会话里）
- **停止**：`session.cancel()`

限制：面板里只显示纯文本（不渲染 Markdown/代码块/工具卡片）；想知道完整过程可以打开那个分支
会话（它会出现在 DSH 的会话列表里）。

## 跳转与悬停（对齐 VS Code）

| 动作 | 行为 |
| --- | --- |
| **Ctrl+点击标识符** | 跳定义（同文件优先 → 全库同名）；`Alt+←` 返回 |
| **Ctrl+点击 `#include "x.h"`** | **跳到头文件**：同目录 → 逐级向上 → 全库后缀匹配（模拟 `-I` 路径） |
| **Ctrl+点击 `<stdio.h>`** | 提示"系统头文件，不在工作区"，不乱跳 |
| **悬停在可跳转的词上** | 出现**下划线**（CSS Custom Highlight，不改 DOM），Ctrl 按下时指针变手型 |
| **悬停 380ms** | 弹出**注释浮窗**：类型徽标 + 名字 + `文件:行` + 上方紧邻的注释块 |
| **双击标识符** | 全文件**同名整词高亮**（VS Code 的 occurrence highlight），头部显示 `word · N 处`；`Esc` 取消 |

双击高亮用 CSS Custom Highlight API 一次塞多个 Range，不改 DOM、不重排；
匹配按标识符边界（`recount` / `count_x` 不会命中 `count`），最多高亮 800 处。
| 悬停在头文件上 | 浮窗显示**该文件开头的注释**（读一次并缓存） |

注释提取规则：定义行上方紧邻的 `//` 连续行、`/** … */` 块、Python 的 `#` 行、Markdown 标题；
中间隔空行则不取（避免误挂到别的函数上）。

**跳不到的情况会明说，不再静默**：
- `「xTaskCreate」不在索引里（可能是会话目录之外的头文件或未收录的符号）`
- `「stdio.h」是系统头文件，不在工作区`
- 索引只覆盖**会话工作区目录**；FreeRTOS/SDK 这类放在工作区之外的源码，`#include` 解析和符号跳转都到不了（VS Code 靠 `c_cpp_properties.json` 的 includePath，我们暂时没做配置项）。

## Markdown 渲染

打开 `.md` / `.markdown` 默认进**渲染预览**（深色，跟随代码区配色），右上角可切「预览 / 源码」：

- 标题 h1–h6、段落、**粗**/*斜*/~~删~~/`行内代码`、[链接](url)
- 有序/无序列表（按缩进分层）、引用块、分割线
- **围栏代码块复用代码区的分词**，所以和源码视图同样有 Dark+ 语法配色
- 表格（`| a | b |` + 分隔行）→ 真 `<table>`，带表头底色
- 不渲染内联 HTML（安全，避免把文档里的标签当代码执行）
- 链接只标色 + 悬停显示 URL，点击被拦下（不让整个应用跳走）

渲染器是自己写的（无第三方依赖，约 180 行），实测渲染本仓库 600 行的 README：
104 个顶层块 / 14 个 h2 / 9 张表 / 6 个代码块，无异常。

## 实现（都是查 DSH 源码确认的扩展点）

| 环节 | 做法 | 依据 |
| --- | --- | --- |
| 头部按钮 | 注册进 `conversation.session.header.utilities`（`kind: list`, `scope: session`），`inject: (sessionId) => ({sessionId})` | `ui-conversation/lib/client.js` 槽位声明 |
| 右栏页类型 | `ctx.sidebarRightTabs.register({id, kind, patterns?, title})` | `ui-sidebar-right/README.zh.md`「扩展席位」 |
| 右栏正文 | `ctx.slots.register({name:'sidebar.right.pane.tab', key:id}, Body)` + `useTabInfo()` 读 `tab.navigation.params` | 同上（另有"打开时记参数"的兜底） |
| 开页 / 开对比 | `openTab(kind,{params})` / `openResource('dsh-resource://dsh-git-diff/file', {params, preferNewPane:true})` | 同上；`preferNewPane` 分栏 |

> **代码页方案（B）**：树固定在右栏第一格，代码固定开在第二格（`preferNewPane: true`）。
> 关键机制见 dockkit 源码：`preferNewPane` 只有在"
> 目标内容**尚未打开**"时才 `planSplitPane`；同一 `contentId` 已存在时只会 `reveal`。
> 所以**每次都传 `preferNewPane: true` 是安全的** —— 第一次分栏，之后只切过去，不会越分越多。
> 文件内容靠 `openState` + 轮询切换（params 传空），因此**不要**给代码页加 `multiple: true`：
> 那会把 contentId 变成 uuid，于是每次点文件都分出一个新格（这个坑踩过）。
| Git | 节点侧 `execFile('git',…)`：`status --porcelain=v1 -z`、`diff`、`diff --cached`、`add`、`restore --staged`、`commit`、`log`、`branch`、`checkout`、`push`、`pull --ff-only` | `lib/git.js`；git 路径按 `DSH_GIT_PATH`→PATH→常见安装位置探测；全程 `GIT_TERMINAL_PROMPT=0` 不卡凭据 |
| 文件树 / 新建 / 搜索 | 节点路由方法 `tree` / `mkdir` / `newFile` / `search` | `lib/index.js`；搜索复用索引的选择规则并额外包含 .txt/.log 等文本 |
| 并排 diff | 解析 unified diff 的 hunk 行：上下文行两侧同号、`-` 只占左列、`+` 只占右列；单个滚动容器 + 4 列网格 | `lib/client.js` 的 `parseUnified` |
| 卡片右键 | 注册进 `deliverables.file.actions`，接管 `[data-presented-file]` 的 `contextmenu` | `ui-deliverables/lib/client.js` |

**安全**：所有路径必须落在会话 cwd 内（越界 403）；新建文件用 `flag:'wx'` 不覆盖已有文件（已存在 409）；
Git 只操作 cwd 所在仓库；push/pull 需要二次点击确认；路由只接受回环 Host。

## 安装

**A. 从 npm 装（换台电脑最省事，不用 clone 源码）**

```bash
curl -L -o install.mjs https://raw.githubusercontent.com/chufengsen/dsh-deliverable-menu/main/install.mjs
node install.mjs --from-npm            # 装 npm 上的 latest
node install.mjs --from-npm 1.31.1     # 装指定版本
```

它会 `npm install` 拉包 → 复制到 profile 的 `node_modules` → 写 `bundles` 与
`dependencies: "^1.31.1"`（真实 semver，之后 pnpm 能自己解析），实测一次约 3 秒。

**B. 从源码装（改了代码想立刻生效时用）**

```bash
git clone https://github.com/chufengsen/dsh-deliverable-menu.git
cd dsh-deliverable-menu && node install.mjs
node install.mjs --uninstall  # 卸载
```

装完**重启 DeepSeek Harness**。改前会备份 `package.json`，可重复执行。
源码装法会在 `dependencies` 里写 `file:` 指向源码目录，**别删/别移动**；
npm 装法写的是 `^版本号`，没这个包袱。

## 性能（实测：为什么之前点一下会卡）

这台机器上 **`git --version` 单独就要 ~750 ms**（Git for Windows + 杀软/沙箱扫描），
所以瓶颈是**进程启动次数**，不是 git 本身的计算。旧实现一次状态刷新要 6 次 spawn：

| 项目 | 旧 | 新 |
| --- | --- | --- |
| 一次 git 状态 | `rev-parse`×4 + `rev-list` + `status` = **6 次 spawn**（实测中位 **1579 ms**） | `status --porcelain=v2 --branch` 一条拿全；仓库根再缓存 60 秒 → **1 次 spawn**（实测中位 **317 ms**，**5×**） |
| 谁在调 | 面板 **4 秒**轮询 + 文件视图**自己再调一次** + 每次 status 变化**重拉 git log** ≈ 打开面板就 13 次 spawn | 面板 **10 秒**轮询（窗口隐藏跳过、同刻只允许一个请求在飞），文件视图直接用面板的 status，git log 只在提交后拉 |
| 切页 | 每次切回来重新拉状态 | 5 秒内复用缓存，不 spawn |
| 符号索引 | 20 秒 TTL，每次进代码页都可能重扫 | 服务端 5 分钟 TTL + 客户端 60 秒复用；扫描上限 1500 文件 / 256 KB |
| 打开文件 | 每次 render 都把整篇重新 token 化（上限 2000 行） | token 化按 (text, lang) 记忆化，上限 800 行 |
| 目录刷新 | 逐个目录 `await`（每次一串 IPC） | 一次 `Promise.all` 并行 |

另两处对齐 VS Code 的做法：`--no-optional-locks`（后台轮询不刷新索引、不抢锁）、
`--no-renames`（不做重命名检测，实测再少 ~20%）。

### 变更数爆炸与"卡死"（v1.12）

如果面板显示几万条变更、点一下就像卡死，根因是 `git status --untracked-files=all`：
它会把**未跟踪目录里的每个文件**逐个列出来（`build/`、`dist/`、`node_modules/`、SDK 目录…）。
VS Code 用的是 `-u` 默认的 `normal`——**未跟踪目录折叠成一条** `build/`。

| 项 | 旧 | 新 |
| --- | --- | --- |
| 未跟踪目录 | `--untracked-files=all`，几万个文件逐条列出 | `--untracked-files=normal`，目录折叠为一条（带 `untrackedDir` 标记，点击提示去文件树展开） |
| 中文/入口 | 徽标数字 = 条目数（虚高） | 同左，但条目数现在是真实值 |
| 渲染 | 变更列表**全量渲染**（60k 行 DOM → 卡死） | 每段最多 400 行 + 末尾"还有 N 项"；行加 `content-visibility:auto` 让浏览器跳过屏外布局 |
| 对比页 | 整篇渲染 | 最多 3000 行；diff 超过 2 MB 不展开（提示用外部工具） |
| 文件树 | 单层全量渲染 | 单层最多 2000 项，超出提示"共 N 项，仅显示前 2000" |

实测（本仓库 17 条 `-uall` / 2 条 `-unormal`）；在你的工程里未跟踪目录越大，差距越明显。


## 自检

```bash
node --check lib/client.js lib/index.js lib/scan.js lib/git.js
node test/contract.test.mjs   # 客户端契约：9 组断言
node test/scan.test.mjs       # 符号索引：10 项
node test/api.test.mjs        # 文件路由：27 项
node test/git.test.mjs        # Git 功能：19 项（真 git 仓库）
```

**已验证（9 组断言 + 56 项）**：
- 契约：卡片槽、**会话头部唯一 Git 按钮**（点击 → `openTab('dsh-git')`、`conversation.input.right` 不再注册）、
  三个页类型 + 三个正文、**合并页内含 文件/更改/搜索 三个视图**、对比页 `preferNewPane`、
  缺侧边栏服务时降级不报错、并排两列网格样式；
- 符号：C（宏/struct/匿名 typedef/Allman 函数，排除 if/for）、Python、JS/TS（含 interface）、Go、Rust、
  Shell、Markdown 标题、超长行、注释行、行号；
- 文件路由：索引（跳过 node_modules、20 秒缓存）、读/写、二进制 415、越界 403（读/写/新建）、
  非回环 403、非 POST 405、未知会话 400、**文件树（目录优先、跳过 node_modules）**、
  **多级新建目录**、**新建文件（含初始内容、已存在 409 不覆盖）**、
  **全文搜索（普通串/正则/大小写、带 文件+行+列+长度、非法正则报错、跳过二进制）**；
- Git：分支、改/增/未跟踪、未暂存与已暂存 diff、未跟踪文件合成整文件 diff、暂存/取消暂存、
  提交（空说明拒绝）、历史顺序、越界 400、非仓库、**分支列表/切换/不存在的分支/空名字**、
  **push/pull 无远端时优雅失败（不挂起）**、并排解析（hunk/上下文/增删 + 两侧行号单调）。

**未验证**：真实界面效果。沙箱里 Electron 的 GPU/渲染进程会被环境杀掉
（`GPU process isn't usable` / `Desktop renderer exited: killed`），且应用拒绝
`--remote-debugging-port`（`bad option`）。已做 A/B 对照证明与插件无关。

**本机自测路径**：重启 DSH → 会话标题栏右上点「⑂ Git」→ 右侧栏展开（默认「文件」视图，
能看到项目目录和 📄+/📁+ 两个新建按钮）→ 点「更改」→ 点某个文件 → 右栏分第二格出并排对比；
点「搜索」→ 搜关键字 → 点命中跳行；在「文件」里点一个源码文件 → 代码导航页打开，
Ctrl+点击函数名跳定义。

## 已知限制

- 对比按 hunk 对齐，不做行内词级高亮；超大文件整篇渲染，没有虚拟滚动。
- 代码导航的索引是**正则启发式**，不是语言服务（函数指针/宏展开/多行声明/重载会漏或指错）；
  联想是**词级**，不做类型推导。
- 编辑器是 textarea：无语法高亮与撤销栈，适合小改。
- 文件树没有重命名/删除/拖拽；搜索没有替换与 include/exclude 过滤。
- push/pull 依赖本机 git 的凭据配置（SSH agent / credential helper），插件不接管认证。
- 通过局域网 IP 访问 DSH 时，本插件路由会 403（只信任回环 Host）；卡片菜单不受影响。
- 依赖 DSH 三处内部契约：`conversation.input.right`、`sidebar.right.pane.tab` + `sidebarRightTabs`、
  `deliverables.file.actions` + 卡片 DOM。升级 DSH 后若改名，对应入口会失效。

## 调试钩子

`window.__dshDeliverableMenu = { openMenu, closeMenu, parseUnified, version }`。
