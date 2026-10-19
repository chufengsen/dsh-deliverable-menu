/**
 * dsh-deliverable-menu —— 浏览器半边。两块功能：
 *
 * 一、交付卡片右键菜单
 *   往 `deliverables.file.actions`（kind=list，由 ui-deliverables 声明）注册一个
 *   「⋯ 更多操作」按钮，并把**整张卡片**的右键接管为同款菜单：
 *     打开 → props.onAction('open')；打开所在文件夹 → props.onAction('reveal')；复制路径
 *   槽位契约：props = { actionUrl, available, pending, onAction(action, application?) }
 *   文件绝对路径来自卡片根节点 `[data-presented-file]` 内 `button[title]`。
 *
 * 二、「代码导航」页（注册进 better-sidebar 的 registerTab）
 *   - 符号搜索：按定义名/文件名模糊匹配工作区索引（索引在节点半边 lib/scan.js）
 *   - 源码查看：行号 + 关键字/字符串/注释高亮
 *   - Ctrl+左键跳转定义（Alt+← 返回），可跨文件
 *   - 就地编辑 + 保存（Ctrl+S），输入联想（≥2 字符自动弹，Ctrl+空格强制，↑↓/Enter/Esc）
 *
 *   文件树 / 新建文件与文件夹 / 全局查找 / 暂存提交等 Git 操作**不在本插件里**——
 *   那些 better-sidebar 已经实现，这里只补它缺的「跳转定义」和「联想」。
 *
 * 菜单与补全弹层都用纯 DOM / position:fixed，不依赖 react-dom portal。
 */

window.__ModuleLoader__.load({
  id: 'dsh-deliverable-menu',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /**
     * DSH 的 UI 基础组件（图标、按钮…）。用它就能和内置文件树长得一模一样；
     * 拿不到时全部降级为本插件自己的 SVG 图标。
     */
    let prim = null
    try {
      prim = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (err) {
      prim = null
    }

    const STYLE_ID = 'dsh-deliverable-menu/menu.css'
    const CARD_SELECTOR = '[data-presented-file]'
    const PATH_SELECTOR = 'button[title]'

    // ------------------------------------------------------------------ 样式

    const CSS = `
.dsh-dpm-trigger{
  box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;border:0;border-radius:7px;background:transparent;
  color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;font:inherit;
  font-size:15px;line-height:1;flex:none;
}
.dsh-dpm-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-dpm-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}
.dsh-dpm-trigger[data-pending]{opacity:.5;cursor:progress}

.dsh-dpm-menu{
  position:fixed;z-index:2147483000;box-sizing:border-box;min-width:186px;max-width:300px;
  padding:4px;border-radius:10px;background:var(--dsw-alias-bg-elevated,#fff);
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.10));
  box-shadow:0 10px 28px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.06);
  font-size:13px;color:var(--dsw-alias-label-primary,#1f2937);
  visibility:hidden;
}
.dsh-dpm-menu[data-open]{visibility:visible}
.dsh-dpm-head{
  padding:5px 9px 4px;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,#8b93a1);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-dpm-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-dpm-item{
  box-sizing:border-box;display:flex;align-items:baseline;gap:8px;width:100%;
  padding:7px 9px;border:0;border-radius:7px;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer;
}
.dsh-dpm-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-dpm-item:disabled{opacity:.45;cursor:default}
.dsh-dpm-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:-2px}
.dsh-dpm-hint{
  margin-left:auto;flex:none;font-size:11px;
  color:var(--dsw-alias-label-tertiary,#9aa3b2);
}
`

    /** 「代码导航」页样式。 */
    const NAV_CSS = `.dsh-nav{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-nav-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-nav-input{flex:1;min-width:0;height:26px;box-sizing:border-box;padding:0 8px;
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.14));border-radius:7px;
  background:var(--dsw-alias-bg-elevated,#fff);color:inherit;font:inherit;outline:none}
.dsh-nav-input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.dsh-nav-btn{height:26px;padding:0 8px;border:1px solid transparent;border-radius:7px;
  background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;cursor:pointer;flex:none}
.dsh-nav-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06));
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-nav-btn:disabled{opacity:.45;cursor:default}
.dsh-nav-btn[data-primary]{color:var(--dsw-alias-brand-primary,#2563eb)}
.dsh-nav-status{padding:4px 10px 6px;font-size:11px;line-height:16px;flex:none;
  color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dsh-nav-status[data-error]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-nav-list{flex:1;min-height:0;overflow:auto;padding:0 6px 8px}
.dsh-nav-group{padding:6px 6px 2px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dsh-nav-item{display:flex;width:100%;align-items:baseline;gap:6px;padding:5px 7px;
  border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;
  text-align:left;cursor:pointer}
.dsh-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-nav-kind{flex:none;width:16px;text-align:center;font-size:10px;color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.dsh-nav-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace)}
.dsh-nav-meta{flex:none;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dsh-nav-head{display:flex;align-items:center;gap:6px;padding:6px 10px;flex:none;
  background:#252526;border-bottom:1px solid #3c3c3c;
  border-radius:8px 8px 0 0}
.dsh-nav-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px;
  color:#cccccc;direction:rtl;text-align:left}
.dsh-nav-head .dsh-nav-btn{color:#cccccc}
.dsh-nav-head .dsh-nav-btn:hover:not(:disabled){background:#37373d;color:#fff}
/* 代码区：VS Code 默认深色主题（Dark+）配色 */
.dsh-nav-code{flex:1;min-height:0;overflow:auto;padding:6px 0;background:#1e1e1e;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:13px;line-height:20px;
  cursor:text;user-select:text;color:#d4d4d4}
.dsh-nav-code[data-ctrl]{cursor:pointer}
.dsh-nav-line{display:flex;white-space:pre;padding:0 10px 0 0;border-radius:0}
.dsh-nav-line.is-cur{background:#2a2d2e}
.dsh-nav-ln{flex:none;width:48px;padding-right:12px;text-align:right;
  color:#858585;user-select:none;background:#1e1e1e}
.dsh-nav-line.is-cur .dsh-nav-ln{color:#c6c6c6}
.dsh-nav-line code{flex:1;font:inherit}
/* Dark+ 语义色 */
.dsh-nav-kw{color:#569cd6}      /* 声明关键字：class/const/struct… */
.dsh-nav-ctl{color:#c586c0}     /* 控制流：if/for/return/await… */
.dsh-nav-pp{color:#c586c0}      /* 预处理：#include/#define */
.dsh-nav-str{color:#ce9178}     /* 字符串 */
.dsh-nav-num{color:#b5cea8}     /* 数字 */
.dsh-nav-cm{color:#6a9955}      /* 注释 */
.dsh-nav-type{color:#4ec9b0}    /* 类型/类名（来自符号索引） */
.dsh-nav-fn{color:#dcdcaa}      /* 函数名（来自符号索引） */
.dsh-nav-id{color:inherit}
.dsh-nav-var{color:#9cdcfe}     /* 变量 / 参数 / 成员 */
.dsh-nav-const{color:#4fc1ff}   /* 宏 / 全大写常量 */
.dsh-nav-br0{color:#ffd700}     /* 括号配对 1（金） */
.dsh-nav-br1{color:#da70d6}     /* 括号配对 2（紫红） */
.dsh-nav-br2{color:#179fff}     /* 括号配对 3（蓝） */
.dsh-nav-edit{flex:1;min-height:0;width:100%;box-sizing:border-box;resize:none;
  padding:6px 10px;border:0;outline:none;background:#1e1e1e;color:#d4d4d4;caret-color:#aeafad;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:13px;line-height:20px;
  tab-size:2}
.dsh-nav-edit::selection{background:#264f78}
.dsh-nav-empty{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;
  text-align:center;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dsh-nav-comp{position:fixed;z-index:2147483000;min-width:180px;max-width:320px;max-height:260px;
  overflow:auto;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-elevated,#fff);
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.12));
  box-shadow:0 10px 26px rgba(15,23,42,.16);font-size:12px}
.dsh-nav-comp-item{display:flex;align-items:baseline;gap:6px;padding:5px 7px;border-radius:6px;cursor:pointer}
.dsh-nav-comp-item[data-active]{background:var(--dsw-alias-interactive-bg-hover,rgba(37,99,235,.12))}
.dsh-nav-comp-kind{flex:none;width:14px;font-size:10px;color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.dsh-nav-comp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace)}
::highlight(dsh-hover-word){text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}
/* 双击选中的词：整篇同名一起高亮（VS Code 的 occurrence highlight） */
::highlight(dsh-word-match){background-color:rgba(18,183,247,.32)}
/* Markdown 预览（跟随 Dark+ 深色） */
.dsh-md{flex:1;min-height:0;overflow:auto;padding:10px 16px 28px;background:#1e1e1e;
  color:#d4d4d4;font-size:13px;line-height:1.75;word-break:break-word}
.dsh-md-h{margin:16px 0 8px;font-weight:600;line-height:1.35;color:#e6e6e6}
.dsh-md-h1{font-size:20px;border-bottom:1px solid #3c3c3c;padding-bottom:6px}
.dsh-md-h2{font-size:17px;border-bottom:1px solid #333;padding-bottom:4px}
.dsh-md-h3{font-size:15px}.dsh-md-h4{font-size:14px}
.dsh-md-h5,.dsh-md-h6{font-size:13px;color:#c9c9c9}
.dsh-md-p{margin:7px 0}
.dsh-md-list{margin:6px 0;padding-left:20px}
.dsh-md-list li{margin:2px 0}
.dsh-md-li-nested{list-style:circle}
.dsh-md-ic{background:#2d2d2d;border-radius:4px;padding:1px 5px;font-size:12px;color:#ce9178;
  font-family:var(--ds-font-family-code,Consolas,monospace)}
.dsh-md-pre{margin:8px 0;padding:8px 10px;border-radius:8px;background:#252526;overflow:auto}
.dsh-md-block{display:block;font-size:12px;line-height:19px;background:transparent;padding:0}
.dsh-md-block .dsh-nav-line{padding-right:0}
.dsh-md-link{color:#4daafc;text-decoration:none;border-bottom:1px dashed rgba(77,170,252,.5);
  cursor:pointer}
.dsh-md-link:hover{border-bottom-style:solid}
.dsh-md-quote{margin:8px 0;padding:4px 10px;border-left:3px solid #569cd6;color:#a8b1bd;
  background:rgba(86,156,214,.08);border-radius:0 6px 6px 0}
.dsh-md-table{border-collapse:collapse;margin:10px 0;font-size:12px}
.dsh-md-table th,.dsh-md-table td{border:1px solid #3c3c3c;padding:4px 9px;text-align:left}
.dsh-md-table th{background:#252526;color:#e6e6e6;font-weight:600}
.dsh-md-hr{border:0;border-top:1px solid #3c3c3c;margin:14px 0}
.dsh-md-switch{display:inline-flex;gap:2px;margin-right:2px;flex:none}
.dsh-md-switch .dsh-nav-btn[aria-pressed]{background:#37373d;color:#fff}
.dsh-nav-match{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:5px;
  background:rgba(18,183,247,.22);color:#9cdcfe;white-space:nowrap}
.dsh-hover{position:fixed;z-index:2147483000;max-width:460px;padding:8px 10px;border-radius:6px;
  background:#252526;border:1px solid #454545;
  box-shadow:0 10px 26px rgba(0,0,0,.45);font-size:12px;line-height:18px;
  color:#d4d4d4;pointer-events:none}
.dsh-hover-head{display:flex;align-items:baseline;gap:6px;margin-bottom:4px}
.dsh-hover-kind{flex:none;font-size:10px;padding:0 5px;border-radius:3px;line-height:15px;
  background:#264f78;color:#9cdcfe}
.dsh-hover-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-weight:600;color:#dcdcaa}
.dsh-hover-loc{flex:none;font-size:11px;color:#858585}
.dsh-hover-doc{margin:0;max-height:190px;overflow:auto;white-space:pre-wrap;word-break:break-word;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px;line-height:17px;
  color:#cccccc}
`

    /** 输入框右侧按钮 + 源代码管理页 + 并排对比。 */
    const GIT_CSS = `
.dsh-ib-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;
  border:1px solid transparent;border-radius:7px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:12px;line-height:1;flex:none}
.dsh-ib-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06));
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-ib-btn[aria-pressed="true"]{color:var(--dsw-alias-brand-primary,#2563eb);
  background:var(--dsw-alias-interactive-bg-hover,rgba(37,99,235,.10))}
.dsh-ib-btn svg{display:block;flex:none}
.dsh-ib-btn .dsh-ib-count{font-size:10px;padding:0 4px;border-radius:5px;
  background:var(--dsw-alias-state-warning-secondary,#f59e0b);color:#fff;line-height:14px}

.dsh-git{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-git-head{display:flex;align-items:center;gap:6px;padding:8px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-git-branch{display:inline-flex;align-items:center;gap:4px;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,Consolas,monospace);
  font-size:11px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dsh-git-badge{flex:none;font-size:10px;padding:0 4px;border-radius:5px;line-height:14px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.08));color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-git-spacer{flex:1}
.dsh-git-commit{display:flex;gap:6px;padding:8px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-git-msg{flex:1;min-width:0;height:26px;box-sizing:border-box;padding:0 8px;
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.14));border-radius:7px;
  background:var(--dsw-alias-bg-elevated,#fff);color:inherit;font:inherit;outline:none}
.dsh-git-msg:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.dsh-git-btn{height:26px;padding:0 9px;border:1px solid transparent;border-radius:7px;
  background:var(--dshq-accent,#2563eb);color:var(--dshq-on-accent,#fff);font:inherit;cursor:pointer;flex:none}
.dsh-git-btn:disabled{opacity:.45;cursor:default}
.dsh-git-btn[data-quiet]{background:transparent;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-git-btn[data-quiet]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-git-body{flex:1;min-height:0;overflow:auto;padding:2px 6px 10px}
.dsh-git-sec{display:flex;align-items:center;gap:6px;padding:7px 6px 3px;font-size:11px;
  color:var(--dsw-alias-label-tertiary,#8b93a1);text-transform:none}
.dsh-git-sec-count{margin-left:auto;font-size:10px}
.dsh-git-row{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;
  padding:4px 6px;border:0;border-radius:6px;background:transparent;color:inherit;
  font:inherit;text-align:left;cursor:pointer;
  content-visibility:auto;contain-intrinsic-size:auto 26px}
.dsh-git-more{padding:6px 8px;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.dsh-git-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-git-row[data-active]{background:var(--dsw-alias-interactive-bg-hover,rgba(37,99,235,.12))}
.dsh-git-st{flex:none;width:12px;text-align:center;font-family:var(--ds-font-family-code,Consolas,monospace);
  font-size:11px;font-weight:600}
.dsh-git-st[data-k="M"]{color:#d97706}
.dsh-git-st[data-k="A"]{color:#059669}
.dsh-git-st[data-k="D"]{color:#dc2626}
.dsh-git-st[data-k="U"]{color:#7c3aed}
.dsh-git-name{flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace)}
.dsh-git-dir{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa3b2);direction:rtl;text-align:left}
.dsh-git-act{flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:20px;height:20px;border-radius:5px;opacity:0;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-git-row:hover .dsh-git-act{opacity:1}
.dsh-git-act:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.10))}
.dsh-git-empty{padding:24px 14px;text-align:center;font-size:12px;line-height:20px;
  color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dsh-git-log{margin-top:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-git-logrow{display:flex;gap:8px;padding:3px 6px;font-size:11px;
  color:var(--dsw-alias-label-tertiary,#8b93a1);overflow:hidden;white-space:nowrap}
.dsh-git-logh{flex:none;font-family:var(--ds-font-family-code,Consolas,monospace)}

.dsh-diff{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1f2937);background:var(--dsw-alias-bg-elevated,#fff)}
.dsh-diff-head{display:flex;align-items:center;gap:8px;padding:7px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-diff-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px}
.dsh-diff-tag{flex:none;font-size:10px;padding:1px 5px;border-radius:5px;line-height:14px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(37,99,235,.12));
  color:var(--dsw-alias-brand-primary,#2563eb)}
.dsh-diff-body{flex:1;min-height:0;overflow:auto;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:12px;line-height:18px}
.dsh-diff-hunk{padding:2px 10px;margin:2px 0;
  background:var(--dsw-alias-interactive-bg-hover,rgba(37,99,235,.07));
  color:var(--dsw-alias-label-secondary,#4b5563);font-size:11px;white-space:pre}
.dsh-diff-row{display:grid;grid-template-columns:46px minmax(0,1fr) 46px minmax(0,1fr);white-space:pre}
.dsh-diff-no{box-sizing:border-box;padding:0 6px;text-align:right;
  color:var(--dsw-alias-label-tertiary,#b6bcc8);user-select:none;font-size:11px}
.dsh-diff-code{box-sizing:border-box;padding:0 8px;overflow:hidden;text-overflow:clip}
.dsh-diff-code.is-add{background:rgba(16,185,129,.14)}
.dsh-diff-code.is-del{background:rgba(239,68,68,.14)}
.dsh-diff-code.is-blank{background:rgba(15,23,42,.035)}
.dsh-diff-no.is-del{background:rgba(239,68,68,.10)}
.dsh-diff-no.is-add{background:rgba(16,185,129,.10)}
`

    /** 文件树 / 全文搜索 / 分支菜单。 */
    const TOOLS_CSS = `
.dsh-files{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-files-head{display:flex;align-items:center;gap:6px;padding:7px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-files-root{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px;
  color:var(--dsw-alias-label-tertiary,#8b93a1);direction:rtl;text-align:left}
.dsh-files-body{flex:1;min-height:0;overflow:auto;padding:4px 4px 12px}
/* 卡片视图（仿产物卡片：圆角 + 类型色块 + 名称/大小 + 悬停 ↗） */
.dsh-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:8px;padding:2px}
.dsh-card{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:11px;min-width:0;
  background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid rgba(15,23,42,.07);
  cursor:pointer;transition:background .12s,box-shadow .12s}
.dsh-card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(18,183,245,.08));
  box-shadow:0 1px 3px rgba(15,23,42,.10)}
.dsh-card-chip{flex:none;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;
  justify-content:center;font-size:9px;font-weight:700;letter-spacing:.2px;
  background:#eceff3;color:#5b6472;overflow:hidden}
.dsh-card-chip[data-k="dir"]{background:#eef1f5;color:#5b6472}
.dsh-card-chip[data-k="md"]{background:#e6f4ea;color:#1a7f37}
.dsh-card-chip[data-k="exe"]{background:#fde8e8;color:#c62828;font-size:8px}
.dsh-card-chip[data-k="code"]{background:#e8eefc;color:#2f5bd0}
.dsh-card-chip[data-k="json"]{background:#fff4e0;color:#a06000;font-size:8px}
.dsh-card-text{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.dsh-card-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2937);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-card-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dsh-card-open{flex:none;opacity:0;color:var(--dshq-accent,#12b7f5);transition:opacity .12s}
.dsh-card:hover .dsh-card-open{opacity:1}
.dsh-nav-btn[aria-pressed]{background:rgba(18,183,245,.14);color:var(--dshq-accent,#12b7f5)}
/* 回合结尾的「本轮改动」卡片条（贴在对话气泡下方） */
.dsh-tail{margin:8px 0 2px;padding:0}
.dsh-tail-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.dsh-tail-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#5b6472)}
.dsh-tail-count{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dsh-card--sm{padding:7px 9px;border-radius:10px}
.dsh-card-meta[data-s="A"]{color:#1a7f37}
.dsh-card-meta[data-s="?"]{color:#8a6d00}
.dsh-card-meta[data-s="D"]{color:#c62828}
.dsh-file-row{display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;
  cursor:pointer;white-space:nowrap;user-select:none;
  content-visibility:auto;contain-intrinsic-size:auto 24px}
.dsh-file-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-file-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;
  color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-file-caret{flex:none;width:12px;text-align:center;font-size:9px;
  color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.dsh-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
  font-family:var(--ds-font-family-code,Consolas,monospace)}
.dsh-file-mark{flex:none;width:12px;text-align:center;font-size:10px;font-weight:600}
.dsh-file-mark[data-k="M"]{color:#d97706}
.dsh-file-mark[data-k="A"]{color:#059669}
.dsh-file-mark[data-k="D"]{color:#dc2626}
.dsh-file-mark[data-k="U"]{color:#7c3aed}
.dsh-run{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483000;
  width:min(760px,88vw);max-height:72vh;display:flex;flex-direction:column;border-radius:12px;
  background:var(--dsw-alias-bg-elevated,#fff);
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.12));
  box-shadow:0 18px 44px rgba(15,23,42,.22)}
.dsh-run-head{display:flex;align-items:center;gap:8px;padding:8px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-run-title{flex:none;font-size:12px;font-weight:600}
.dsh-run-cmd{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px;
  color:var(--dsw-alias-label-tertiary,#8b93a1);direction:rtl;text-align:left}
.dsh-run-body{margin:0;padding:10px;overflow:auto;max-height:60vh;white-space:pre-wrap;word-break:break-word;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px;line-height:17px;
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-file-input{box-sizing:border-box;width:calc(100% - 16px);margin:2px 8px;height:22px;
  padding:0 6px;border:1px solid var(--dsw-alias-brand-primary,#2563eb);border-radius:5px;
  background:var(--dsw-alias-bg-elevated,#fff);color:inherit;font:inherit;outline:none;
  font-family:var(--ds-font-family-code,Consolas,monospace)}

.dsh-search{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1f2937)}
.dsh-search-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-search-input{flex:1;min-width:0;height:26px;box-sizing:border-box;padding:0 8px;
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.14));border-radius:7px;
  background:var(--dsw-alias-bg-elevated,#fff);color:inherit;font:inherit;outline:none}
.dsh-search-input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.dsh-search-opt{flex:none;height:24px;padding:0 6px;border:1px solid transparent;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;
  font-size:11px;cursor:pointer}
.dsh-search-opt[aria-pressed="true"]{color:var(--dsw-alias-brand-primary,#2563eb);
  border-color:var(--dsw-alias-brand-primary,#2563eb)}
.dsh-search-body{flex:1;min-height:0;overflow:auto;padding:2px 4px 12px}
.dsh-search-file{display:flex;align-items:center;gap:6px;padding:5px 8px;margin-top:2px;
  border-radius:6px;cursor:pointer;font-size:11px;
  color:var(--dsw-alias-label-secondary,#4b5563)}
.dsh-search-file:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-search-count{flex:none;margin-left:auto;font-size:10px;
  color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.dsh-search-hit{display:flex;gap:6px;padding:3px 8px 3px 22px;border-radius:5px;cursor:pointer;
  font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px;white-space:pre;
  overflow:hidden}
.dsh-search-hit:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-search-ln{flex:none;width:34px;text-align:right;
  color:var(--dsw-alias-label-tertiary,#b6bcc8)}
.dsh-search-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dsh-search-text mark{background:rgba(250,204,21,.45);color:inherit;border-radius:2px}

.dsh-git-menu{position:absolute;left:8px;right:8px;top:38px;z-index:20;max-height:260px;
  overflow:auto;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-elevated,#fff);
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.12));
  box-shadow:0 10px 26px rgba(15,23,42,.16)}
.dsh-git-menuitem{display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:6px;
  cursor:pointer;font-family:var(--ds-font-family-code,Consolas,monospace);font-size:11px}
.dsh-git-menuitem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-git-menuitem[data-cur]{color:var(--dsw-alias-brand-primary,#2563eb);font-weight:600}
.dsh-git-head{position:relative}
.dsh-git-btn[data-armed]{background:var(--dsw-alias-state-error-primary,#dc2626)}

.dsh-src{display:flex;flex-direction:column;height:100%;min-height:0}
.dsh-side{display:flex;flex-direction:column;flex:1;min-height:0;font-size:12px;
  color:var(--dsw-alias-label-primary,#1f2937);background:var(--dshq-chat-bg,transparent)}
.dsh-side-head{display:flex;align-items:center;gap:6px;padding:7px 10px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-side-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-side-list{flex:1;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
/* QQ 风格气泡：自己发右对齐主色底，收到左对齐浅底带描边 */
.dsh-side-msg{display:flex;flex-direction:column;align-items:flex-start;max-width:100%}
.dsh-side-msg.is-user{align-items:flex-end}
.dsh-side-role{font-size:10px;margin-bottom:2px;color:var(--dsw-alias-label-tertiary,#9aa3b2)}
.dsh-side-msg.is-user .dsh-side-role{text-align:right}
.dsh-side-bubble{max-width:84%;white-space:pre-wrap;word-break:break-word;line-height:18px;
  padding:7px 10px;border-radius:12px 12px 12px 4px;
  background:var(--dshq-bubble-in,#fff);border:1px solid var(--dshq-chat-border,rgba(15,23,42,.10));
  color:var(--dshq-chat-text,inherit)}
.dsh-side-msg.is-user .dsh-side-bubble{background:var(--dshq-bubble-out,#2563eb);
  border-color:transparent;border-radius:12px 12px 4px 12px;color:var(--dshq-on-accent,#fff)}
.dsh-side-composer{display:flex;gap:6px;padding:8px;flex:none;
  border-top:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-side-input{flex:1;min-width:0;box-sizing:border-box;resize:vertical;padding:6px 8px;
  border:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.14));border-radius:8px;
  background:var(--dsw-alias-bg-elevated,#fff);color:inherit;font:inherit;outline:none}
.dsh-side-input:focus{border-color:var(--dshq-accent,#2563eb)}
.dshq-theme{position:relative;margin-left:auto;display:inline-flex}
.dshq-theme-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;
  border:1px solid transparent;border-radius:6px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:12px;flex:none}
.dshq-theme-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06));
  color:var(--dsw-alias-label-primary,#1f2937)}
.dshq-theme-dot{width:10px;height:10px;border-radius:50%;flex:none;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.dshq-theme-panel{position:absolute;right:0;top:30px;z-index:30;width:236px;padding:10px;
  border-radius:10px;background:var(--dsw-alias-bg-elevated,#fff);
  border:1px solid var(--dshq-chat-border,rgba(15,23,42,.12));
  box-shadow:0 12px 30px rgba(15,23,42,.18)}
.dshq-status{font-size:11px;line-height:15px;margin:0 0 8px;
  color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dshq-status[data-on]{color:var(--dshq-accent,#12b7f5)}
.dshq-theme-title{font-size:11px;margin:2px 0 6px;
  color:var(--dsw-alias-label-tertiary,#8b93a1)}
.dshq-swatches{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.dshq-swatch{width:26px;height:26px;border-radius:50%;border:0;cursor:pointer;color:#fff;
  font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.10)}
.dshq-swatch[data-active]{box-shadow:0 0 0 2px var(--dsw-alias-bg-elevated,#fff),
  0 0 0 4px var(--dshq-accent,#2563eb)}
.dshq-switch{display:flex;align-items:flex-start;gap:6px;margin:2px 0 8px;font-size:11px;
  line-height:15px;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer}
.dshq-switch input{margin:1px 0 0;flex:none}
.dshq-hint{font-size:11px;line-height:15px;margin:0 0 8px;
  color:var(--dsw-alias-state-warning-primary,#b45309)}
.dshq-custom{display:flex;flex-direction:column;gap:6px}
.dshq-palette{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;margin-bottom:10px}
.dshq-palette .dshq-field{gap:6px;font-size:11px}
.dshq-palette input[type="color"]{width:28px;height:20px}
.dshq-field{display:flex;align-items:center;gap:8px;font-size:12px;
  color:var(--dsw-alias-label-secondary,#4b5563)}
.dshq-field input[type="color"]{width:34px;height:22px;padding:0;border:0;background:transparent;
  cursor:pointer}
.dsh-src-switch{display:flex;flex-wrap:wrap;gap:2px;padding:6px 8px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(15,23,42,.08))}
.dsh-src-tab{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;
  border:1px solid transparent;border-radius:6px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:12px}
.dsh-src-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06))}
.dsh-src-tab[aria-pressed="true"]{color:var(--dshq-accent,#2563eb);
  background:color-mix(in srgb, var(--dshq-accent,#2563eb) 12%, transparent)}
.dsh-src-tab-badge{font-size:10px;padding:0 4px;border-radius:5px;line-height:14px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.10));
  color:var(--dsw-alias-label-secondary,#6b7280)}
.dsh-src-tab[aria-pressed="true"] .dsh-src-tab-badge{background:rgba(37,99,235,.18);color:inherit}
.dsh-changes{display:flex;flex-direction:column;flex:1;min-height:0}
.dsh-src > .dsh-files,
.dsh-src > .dsh-search,
.dsh-src > .dsh-changes{flex:1;min-height:0}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-deliverable-menu'
      style.dataset.pluginCss = STYLE_ID
      style.textContent = CSS + NAV_CSS + GIT_CSS + TOOLS_CSS
      document.head.appendChild(style)
    }

    // ------------------------------------------------------------------ 工具

    function basename(p) {
      const s = String(p || '')
      const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
      return i >= 0 ? s.slice(i + 1) : s
    }

    function readCardPath(node) {
      const card = node && node.closest ? node.closest(CARD_SELECTOR) : null
      if (!card) return ''
      const anchor = card.querySelector(PATH_SELECTOR)
      return (anchor && anchor.getAttribute('title')) || ''
    }

    // ------------------------------------------------------------------ 菜单

    /** 当前打开的菜单关闭函数（同时只允许一个菜单）。 */
    let closeCurrent = null

    function closeMenu() {
      if (closeCurrent) closeCurrent()
    }

    /**
     * 在视口坐标 (x, y) 弹出菜单。
     * @param {{x:number,y:number,path:string,available:boolean,pending:boolean,onAction:(action:string)=>void}} opts
     */
    /**
     * 通用右键菜单（纯 DOM，和交付卡片菜单同一套外观）。
     * @param {{x:number,y:number,title?:{text:string,title?:string},items:Array<object>}} options
     *   items 元素：{ label, hint?, disabled?, onClick } 或 { separator: true }
     */
    function showContextMenu(options) {
      closeMenu()
      if (typeof document === 'undefined' || !document.body) return
      const { x, y, title, items } = options

      const menu = document.createElement('div')
      menu.className = 'dsh-dpm-menu'
      menu.setAttribute('role', 'menu')
      menu.addEventListener('contextmenu', (e) => e.preventDefault())

      if (title && title.text) {
        const head = document.createElement('div')
        head.className = 'dsh-dpm-head'
        head.textContent = title.text
        head.title = title.title || ''
        menu.appendChild(head)
      }

      const addItem = (item) => {
        if (item.separator) {
          const sep = document.createElement('div')
          sep.className = 'dsh-dpm-sep'
          menu.appendChild(sep)
          return
        }
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'dsh-dpm-item'
        btn.setAttribute('role', 'menuitem')
        btn.disabled = Boolean(item.disabled)
        const text = document.createElement('span')
        text.textContent = item.label
        btn.appendChild(text)
        if (item.hint) {
          const h = document.createElement('span')
          h.className = 'dsh-dpm-hint'
          h.textContent = item.hint
          btn.appendChild(h)
        }
        btn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          close()
          if (typeof item.onClick === 'function') item.onClick()
        })
        menu.appendChild(btn)
      }

      for (const item of items || []) addItem(item)

      document.body.appendChild(menu)

      // 先在最内侧定位，再用实测尺寸把它钳制在视口内
      const rect = menu.getBoundingClientRect()
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8)
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8)
      menu.style.left = `${Math.min(Math.max(8, x), maxLeft)}px`
      menu.style.top = `${Math.min(Math.max(8, y), maxTop)}px`
      menu.dataset.open = '1'

      const onPointerDown = (e) => {
        if (!menu.contains(e.target)) close()
      }
      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
        }
      }
      const onViewportChange = () => close()

      const timer = window.setTimeout(() => {
        document.addEventListener('mousedown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onViewportChange, true)
        window.addEventListener('resize', onViewportChange, true)
      }, 0)

      function close() {
        window.clearTimeout(timer)
        document.removeEventListener('mousedown', onPointerDown, true)
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('scroll', onViewportChange, true)
        window.removeEventListener('resize', onViewportChange, true)
        menu.remove()
        if (closeCurrent === close) closeCurrent = null
      }

      closeCurrent = close
    }

    /** 交付卡片的右键菜单（复用通用菜单）。 */
    function openMenu(opts) {
      const { x, y, path, available, pending, onAction } = opts
      const items = []
      if (available) {
        items.push({
          label: pending ? '打开中…' : '打开',
          hint: '默认应用',
          disabled: pending,
          onClick: () => onAction('open'),
        })
        items.push({ label: '打开所在文件夹', disabled: pending, onClick: () => onAction('reveal') })
      } else {
        items.push({ label: '打开', hint: '无桌面能力', disabled: true })
        items.push({ label: '打开所在文件夹', disabled: true })
      }
      items.push({ separator: true })
      items.push({
        label: '复制路径',
        disabled: !path,
        onClick: () => {
          try {
            if (path && navigator.clipboard) navigator.clipboard.writeText(path)
          } catch (_) {
            /* 剪贴板不可用时静默 */
          }
        },
      })
      showContextMenu({
        x,
        y,
        title: { text: path ? basename(path) : '产物', title: path || '' },
        items,
      })
    }

    // ------------------------------------------------------------------ 组件

    /**
     * 交付卡片右侧的「⋯」按钮：点击打开菜单，同时把整张卡片的右键接管为同款菜单。
     * @param {object} props - 槽位注入的 props，见文件头注释。
     */
    function ActionButton(props) {
      const triggerRef = React.useRef(null)
      const latest = React.useRef(props)
      latest.current = props

      const openAt = React.useCallback((x, y) => {
        const p = latest.current || {}
        openMenu({
          x,
          y,
          path: readCardPath(triggerRef.current),
          available: p.available !== false,
          pending: p.pending === true,
          onAction: (action) => {
            if (typeof p.onAction === 'function') p.onAction(action)
          },
        })
      }, [])

      // 右键挂在卡片根节点上：槽位节点只是卡片的孙子节点，需要向上找
      React.useEffect(() => {
        const el = triggerRef.current
        if (!el) return undefined
        const card = el.closest(CARD_SELECTOR)
        if (!card) return undefined
        const onContextMenu = (e) => {
          e.preventDefault()
          e.stopPropagation()
          openAt(e.clientX, e.clientY)
        }
        card.addEventListener('contextmenu', onContextMenu)
        return () => card.removeEventListener('contextmenu', onContextMenu)
      }, [openAt])

      return React.createElement(
        'button',
        {
          ref: triggerRef,
          type: 'button',
          className: 'dsh-dpm-trigger',
          title: '更多操作（也可直接右键卡片）',
          'aria-label': '更多操作',
          'aria-haspopup': 'menu',
          'data-pending': props.pending === true ? '1' : undefined,
          onClick: (e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openAt(r.right - 2, r.bottom + 4)
          },
        },
        React.createElement('span', { 'aria-hidden': 'true' }, '\u22EF'),
      )
    }

    // ================================================================== 代码导航
    //
    // 为什么不复用 better-sidebar 的编辑器：那是一个打包好的 CodeMirror 实例，
    // 不对外暴露扩展点，没法给它挂补全/跳转。所以本页自带一个最小编辑器：
    // 只读时用高亮层（可 Ctrl+点击），编辑时切 textarea（带联想）。
    // 文件树/新建/查找/保存/Git 仍由 better-sidebar 提供，这里不重复实现。

    const NAV_API = '/dsh-deliverable-menu/api'
    const MAX_RENDER_LINES = 800
    /** 代码行高（px）：CSS 与 scrollToLine 必须一致。 */
    const CODE_LINE_H = 20
    /** 对比页最多渲染多少行（再多就卡了，VS Code 是虚拟滚动，我们截断并提示）。 */
    const MAX_DIFF_ROWS = 3000

    /** 符号类型 → 单字符图标。 */
    function glyph(kind) {
      if (kind === 'func') return 'ƒ'
      if (kind === 'class') return 'C'
      if (kind === 'type') return 'T'
      if (kind === 'macro') return '#'
      if (kind === 'var') return 'v'
      if (typeof kind === 'string' && kind.startsWith('h')) return kind.toUpperCase()
      return '·'
    }

    const KW_LIST = {
      c: 'auto break case char const continue default do double else enum extern float for if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while'.split(' '),
      cpp: 'auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'.split(' '),
      python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self'.split(' '),
      js: 'async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new return static super switch this throw try typeof var void while yield true false null undefined'.split(' '),
      ts: 'abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let namespace new null number object private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield'.split(' '),
      go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'.split(' '),
      rust: 'as break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' '),
      java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try void volatile while true false null'.split(' '),
      shell: 'case do done elif else esac fi for function if in local return select then until while echo export cd'.split(' '),
      lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '),
    }
    const KW_CACHE = new Map()

    /** 语言的关键字集合（懒构造）。 */
    function keywordsOf(lang) {
      if (!KW_CACHE.has(lang)) KW_CACHE.set(lang, new Set(KW_LIST[lang] || []))
      return KW_CACHE.get(lang)
    }

    /** 语言的注释前缀（高亮用）。 */
    function commentOf(lang) {
      if (lang === 'python' || lang === 'shell' || lang === 'yaml' || lang === 'toml') return '#'
      if (lang === 'lua') return '--'
      if (lang === 'html' || lang === 'markdown') return ''
      return '//'
    }

    /** 找到行内第一个不在引号里的注释起点。 */
    function indexOfComment(line, prefix) {
      if (!prefix) return -1
      let quote = ''
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quote) {
          if (ch === '\\') i += 1
          else if (ch === quote) quote = ''
          continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch
          continue
        }
        if (line.startsWith(prefix, i)) return i
      }
      return -1
    }

    /** VS Code Dark+ 里按"控制流"着色的关键字（紫色 #C586C0）。 */
    const CONTROL_KW = new Set(
      (
        'if else for while do return break continue switch case default goto try catch finally throw ' +
        'yield await elif except raise pass del assert lambda then fi done esac foreach match loop until select when'
      ).split(' '),
    )

    /** 常见内建类型名（不走索引也按类型着色，如 uint32_t / size_t）。 */
    const BUILTIN_TYPES = new Set(
      (
        'uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t size_t ssize_t ptrdiff_t ' +
        'intptr_t uintptr_t intmax_t uintmax_t bool _Bool va_list FILE time_t clock_t off_t pid_t ' +
        'BYTE WORD DWORD QWORD BOOL HANDLE UINT INT8 UINT8 INT16 UINT16 INT32 UINT32 INT64 UINT64 ' +
        'u8 u16 u32 u64 s8 s16 s32 s64 f32 f64'
      ).split(' '),
    )

    /** 括号配对颜色数（VS Code Dark+ 默认三色循环）。 */
    const BRACKET_COLORS = 3

    /**
     * 整篇 token 化（跨行状态：块注释、括号深度）。
     * 比逐行 token 多解决三件事：跨行块注释、括号配对着色、语义分色。
     * @param {string} text - 文件全文
     * @param {string} lang - 语言键
     * @param {{types:Set<string>, funcs:Set<string>}} [dict] - 符号表
     * @returns {Array<Array<{t:string, c?:string}>>} 每行的 token 数组
     */
    function tokenizeLines(text, lang, dict) {
      const lines = String(text || '').split(/\r?\n/).slice(0, MAX_RENDER_LINES)
      const state = { inBlock: false, depth: 0 }
      return lines.map((line) => tokenizeLine(line, lang, dict, state))
    }

    /** 单行 token 化，state 在行间传递。 */
    function tokenizeLine(line, lang, dict, state) {
      const parts = []
      const kws = keywordsOf(lang)
      const commentPrefix = commentOf(lang)
      const n = line.length
      const BR = '()[]{}'
      let i = 0
      let buf = ''
      const flush = () => {
        if (buf) {
          parts.push({ t: buf })
          buf = ''
        }
      }
      const classify = (name) => {
        if (kws.has(name)) return CONTROL_KW.has(name) ? 'ctl' : 'kw'
        if (dict && dict.types && dict.types.has(name)) return 'type'
        if (dict && dict.funcs && dict.funcs.has(name)) return 'fn'
        if (/^[A-Z][A-Z0-9_]{2,}$/.test(name)) return 'const'
        if (/_t$/.test(name) || BUILTIN_TYPES.has(name)) return 'type'
        return 'var'
      }

      // 行首预处理指令：整段 pp，#include 的 <...>/"..." 按字符串
      if (!state.inBlock) {
        const pp = /^(\s*#\s*[A-Za-z_]+)(\s*)(<[^>]*>|"(?:\\.|[^"\\])*")?/.exec(line)
        if (pp) {
          if (pp[1]) parts.push({ t: pp[1], c: 'pp' })
          if (pp[2]) parts.push({ t: pp[2] })
          if (pp[3]) parts.push({ t: pp[3], c: 'str' })
          i = pp[0].length
        }
      }

      while (i < n) {
        if (state.inBlock) {
          const close = line.indexOf('*/', i)
          if (close < 0) {
            parts.push({ t: line.slice(i), c: 'cm' })
            return parts
          }
          parts.push({ t: line.slice(i, close + 2), c: 'cm' })
          i = close + 2
          state.inBlock = false
          continue
        }
        if (commentPrefix && line.startsWith(commentPrefix, i)) {
          flush()
          parts.push({ t: line.slice(i), c: 'cm' })
          return parts
        }
        const ch = line[i]
        if (ch === '/' && line[i + 1] === '*') {
          flush()
          const close = line.indexOf('*/', i + 2)
          if (close < 0) {
            parts.push({ t: line.slice(i), c: 'cm' })
            state.inBlock = true
            return parts
          }
          parts.push({ t: line.slice(i, close + 2), c: 'cm' })
          i = close + 2
          continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          flush()
          let j = i + 1
          while (j < n) {
            if (line[j] === '\\') {
              j += 2
              continue
            }
            if (line[j] === ch) {
              j += 1
              break
            }
            j += 1
          }
          parts.push({ t: line.slice(i, j), c: 'str' })
          i = j
          continue
        }
        if (BR.includes(ch)) {
          flush()
          if (ch === ')' || ch === ']' || ch === '}') state.depth = Math.max(0, state.depth - 1)
          parts.push({ t: ch, c: 'br' + (state.depth % BRACKET_COLORS) })
          if (ch === '(' || ch === '[' || ch === '{') state.depth += 1
          i += 1
          continue
        }
        if (ch >= '0' && ch <= '9' && !/[A-Za-z0-9_]/.test(line[i - 1] || '')) {
          const m = /^[0-9][0-9a-fA-FxX._]*/.exec(line.slice(i))
          if (m) {
            flush()
            parts.push({ t: m[0], c: 'num' })
            i += m[0].length
            continue
          }
        }
        if (/[A-Za-z_$]/.test(ch)) {
          const m = /^[A-Za-z_$][\w$]*/.exec(line.slice(i))
          const name = m[0]
          flush()
          parts.push({ t: name, c: classify(name) })
          i += name.length
          continue
        }
        buf += ch
        i += 1
      }
      flush()
      return parts
    }

    /**
     * 单行 token 化（调试/测试用；不保留跨行状态）。
     * @param {string} line - 一行源码
     * @param {string} lang - 语言键
     * @param {object} [dict] - 符号表
     */
    function tokensOf(line, lang, dict) {
      return tokenizeLine(line, lang, dict, { inBlock: false, depth: 0 })
    }

    /** 子序列模糊打分。 */
    function fuzzy(text, query) {
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

    /**
     * 鼠标位置 → { word, line(1-based), col(0-based) }。
     * 行号来自行容器的 data-line，列号用 Range 量到该行的行首。
     */
    function pointAt(x, y) {
      let node = null
      let offset = 0
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y)
        if (range) {
          node = range.startContainer
          offset = range.startOffset
          // 命中整行容器时退到它内部的文本节点
          if (node && node.nodeType === 1) {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
            const first = walker.nextNode()
            if (first) {
              node = first
              offset = 0
            }
          }
        }
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y)
        if (pos) {
          node = pos.offsetNode
          offset = pos.offset
        }
      }
      if (!node) return null
      const el = node.nodeType === 1 ? node : node.parentElement
      const lineEl = el && el.closest ? el.closest('[data-line]') : null
      if (!lineEl) return null
      const line = Number(lineEl.dataset.line) || 0
      const codeEl = lineEl.querySelector('code')
      let col = 0
      if (codeEl && node.nodeType === 3) {
        const r = document.createRange()
        r.selectNodeContents(codeEl)
        r.setEnd(node, offset)
        col = r.toString().length
      }
      const text = (codeEl && codeEl.textContent) || ''
      const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch)
      let s = col
      let e = col
      while (s > 0 && isWord(text[s - 1])) s -= 1
      while (e < text.length && isWord(text[e])) e += 1
      const word = text.slice(s, e)
      return { word: /^[A-Za-z_$][\w$]*$/.test(word) ? word : '', line, col }
    }

    /** 解析 `#include "x.h"` / `<x.h>`：点在引号内的路径上才算命中。 */
    function includeAt(lineText, col) {
      const m = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(lineText || '')
      if (!m) return null
      const start = lineText.indexOf(m[2])
      const end = start + m[2].length
      if (col < start || col > end) return null
      return { target: m[2], system: m[1] === '<' }
    }

    /** 头文件解析：同目录 → 逐级向上 → 全库后缀匹配。 */
    function resolveInclude(name, currentPath, files) {
      const norm = String(name || '').replace(/\\/g, '/')
      if (!norm) return null
      const dir = currentPath && currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''
      const set = new Set((files || []).map((f) => f.path))
      const candidates = []
      if (dir) candidates.push(`${dir}/${norm}`)
      let up = dir
      while (up && up.includes('/')) {
        up = up.slice(0, up.lastIndexOf('/'))
        candidates.push(`${up}/${norm}`)
      }
      candidates.push(norm)
      for (const c of candidates) if (set.has(c)) return c
      const suffix = `/${norm}`
      const hits = (files || []).filter((f) => f.path.endsWith(suffix))
      if (hits.length === 0) return null
      hits.sort((a, b) => a.path.length - b.path.length)
      return hits[0].path
    }

    /** 取定义行上方紧邻的注释块（// 连续行或 / * … * / 块）。 */
    function docAbove(lines, lineNo) {
      let i = (lineNo || 1) - 2
      const collected = []
      while (i >= 0 && collected.length < 12) {
        const raw = lines[i]
        const t = (raw || '').trim()
        if (!t) {
          if (collected.length === 0) {
            i -= 1
            continue
          }
          break
        }
        if (t.startsWith('//') || t.startsWith('#') || t.startsWith('///')) {
          collected.unshift(t)
          i -= 1
          continue
        }
        if (t.endsWith('*/')) {
          const block = []
          let j = i
          while (j >= 0) {
            block.unshift((lines[j] || '').trim())
            if ((lines[j] || '').trim().startsWith('/*')) break
            j -= 1
          }
          collected.unshift(...block)
          i = j - 1
          break
        }
        break
      }
      const text = collected
        .join('\n')
        .replace(/^\s*\/\*\*?/, '')
        .replace(/\*\/\s*$/, '')
        .replace(/^\s*\/\/\/?/gm, '')
        .replace(/^\s*\*+ ?/gm, '')
        .replace(/^\s*#+ ?/gm, '')
        .trim()
      return text
    }

    /** 文件开头第一段注释（用于头文件浮窗）。 */
    function fileHeaderComment(text) {
      const lines = String(text || '').split(/\r?\n/)
      const head = []
      let started = false
      for (let i = 0; i < Math.min(lines.length, 40); i++) {
        const t = lines[i].trim()
        if (!t) {
          if (started) break
          continue
        }
        if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#')) {
          started = true
          head.push(t)
          continue
        }
        break
      }
      return docAbove(head.map((l) => l).concat(['x']), head.length + 1)
    }

    /** 按路径读文件文本（带缓存，浮窗用）。 */
    const textCache = new Map()

    async function readCachedText(sessionId, path) {
      if (textCache.has(path)) return textCache.get(path)
      const data = await callApi('read', { path }, sessionId)
      const text = data && data.ok ? data.text : ''
      if (textCache.size > 40) textCache.clear()
      textCache.set(path, text)
      return text
    }

    /** 估算 textarea 光标在屏幕上的位置（弹补全用）。 */
    function caretBox(ta) {
      const before = ta.value.slice(0, ta.selectionStart)
      const rows = before.split('\n')
      const line = rows.length - 1
      const col = rows[rows.length - 1].length
      const cs = window.getComputedStyle(ta)
      const lineH = parseFloat(cs.lineHeight) || 19
      const padL = parseFloat(cs.paddingLeft) || 10
      const padT = parseFloat(cs.paddingTop) || 6
      const charW = (parseFloat(cs.fontSize) || 12) * 0.6
      const rect = ta.getBoundingClientRect()
      return {
        x: rect.left + padL + col * charW - ta.scrollLeft,
        y: rect.top + padT + (line + 1) * lineH - ta.scrollTop + 2,
      }
    }

    /** 调本插件的节点路由。 */
    async function callApi(method, payload, sessionId) {
      const res = await fetch(NAV_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, sessionId, ...payload }),
      })
      try {
        return await res.json()
      } catch (_) {
        return { ok: false, error: `HTTP ${res.status}` }
      }
    }

    /**
     * 「代码导航」页：符号搜索 / 源码查看 / Ctrl+点击跳定义 / 输入联想 / 就地编辑保存。
     * @param {object} props - better-sidebar 的 tab props，`props.scope.sessionId` 是会话 id。
     */
    function NavTab(props) {
      const sessionId =
        (props && props.scope && props.scope.sessionId) || (props && props.sessionId) || ''

      const [query, setQuery] = React.useState('')
      const [symbols, setSymbols] = React.useState([])
      const [files, setFiles] = React.useState([])
      const [indexInfo, setIndexInfo] = React.useState(null)
      const [doc, setDoc] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [editing, setEditing] = React.useState(false)
      /** Markdown 默认看渲染结果，可切回源码。 */
      const [mdMode, setMdMode] = React.useState('preview')
      const [dirty, setDirty] = React.useState(false)
      const [status, setStatus] = React.useState('')
      const [error, setError] = React.useState('')
      const [comp, setComp] = React.useState(null)
      const [jumps, setJumps] = React.useState([])

      const codeRef = React.useRef(null)
      const taRef = React.useRef(null)
      const docRef = React.useRef(null)
      docRef.current = doc

      // ---------------------------------------------------------------- 索引

      const loadIndex = React.useCallback(
        async (force) => {
          if (!sessionId) {
            setError('没有会话上下文，无法定位工作区')
            return
          }
          // 60 秒内复用上一次结果（切页/切文件时不要反复扫工作区）
          if (!force && lastIndex && lastIndex.sessionId === sessionId && Date.now() - lastIndex.at < 60_000) {
            setSymbols(lastIndex.symbols)
            setFiles(lastIndex.files)
            setIndexInfo(lastIndex.info)
            setStatus(`索引 ${lastIndex.info.scanned} 个文件 / ${lastIndex.symbols.length} 个符号（缓存）`)
            return
          }
          setStatus(force ? '正在重建索引…' : '正在建立索引…')
          setError('')
          const data = await callApi('index', { force: force === true }, sessionId)
          if (!data || !data.ok) {
            setError((data && data.error) || '索引失败')
            setStatus('')
            return
          }
          const info = { root: data.root, scanned: data.scanned }
          lastIndex = { sessionId, at: Date.now(), symbols: data.symbols || [], files: data.files || [], info }
          setSymbols(data.symbols || [])
          setFiles(data.files || [])
          setIndexInfo(info)
          setStatus(`索引 ${data.scanned} 个文件 / ${(data.symbols || []).length} 个符号`)
        },
        [sessionId],
      )

      React.useEffect(() => {
        loadIndex(false)
      }, [loadIndex])

      // ---------------------------------------------------------------- 检索

      const results = React.useMemo(() => {
        const q = query.trim()
        if (!q) return null
        const syms = []
        for (const s of symbols) {
          const score = fuzzy(s.name, q)
          if (score > 0) syms.push({ ...s, score })
        }
        syms.sort((a, b) => b.score - a.score || a.name.length - b.name.length)
        const fls = []
        for (const f of files) {
          const base = f.path.slice(f.path.lastIndexOf('/') + 1)
          const score = Math.max(fuzzy(base, q), fuzzy(f.path, q) - 20)
          if (score > 0) fls.push({ ...f, score })
        }
        fls.sort((a, b) => b.score - a.score)
        return { symbols: syms.slice(0, 120), files: fls.slice(0, 40) }
      }, [query, symbols, files])

      // ---------------------------------------------------------------- 打开文件

      const scrollToLine = (line) => {
        const el = codeRef.current
        if (!el) return
        el.scrollTop = Math.max(0, (line - 1) * CODE_LINE_H - el.clientHeight / 2 + CODE_LINE_H)
      }

      const openFile = React.useCallback(
        async (path, line) => {
          if (!sessionId || !path) return
          setStatus(`打开 ${path}`)
          const data = await callApi('read', { path }, sessionId)
          if (!data || !data.ok) {
            setError((data && data.error) || '打开失败')
            setStatus('')
            return
          }
          setError('')
          setStatus('')
          setDoc({ path: data.path, text: data.text, lang: data.lang, line: line || 1 })
          setDraft(data.text)
          setEditing(false)
          setDirty(false)
          setComp(null)
          window.requestAnimationFrame(() => scrollToLine(line || 1))
        },
        [sessionId],
      )

      // ---------------------------------------------------------------- 跳转

      // 从「文件」页 / 「查找」页点过来的目标：首次挂载按 props 打开，
      // 之后靠轮询 openState.code 切换（页已被打开时 openTab 只是聚焦，params 不一定更新）
      const wantPath = (props && props.path) || ''
      const wantLine = (props && props.line) || 1
      const lastToken = React.useRef(openState.code ? openState.code.token : 0)

      React.useEffect(() => {
        if (wantPath) openFile(wantPath, wantLine)
      }, [wantPath, wantLine, openFile])

      React.useEffect(() => {
        const timer = window.setInterval(() => {
          const target = openState.code
          if (!target || !target.path || target.token === lastToken.current) return
          lastToken.current = target.token
          openFile(target.path, target.line || 1)
        }, 350)
        return () => window.clearInterval(timer)
      }, [openFile])

      const back = React.useCallback(() => {
        if (jumps.length === 0) return
        const prev = jumps[jumps.length - 1]
        setJumps(jumps.slice(0, -1))
        openFile(prev.path, prev.line)
      }, [jumps, openFile])

      const backRef = React.useRef(back)
      backRef.current = back
      React.useEffect(() => {
        const onKey = (e) => {
          if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault()
            backRef.current()
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [])

      // ---------------------------------------------------------------- 事件

      const linesOfDoc = React.useMemo(() => (doc ? doc.text.split(/\r?\n/) : []), [doc && doc.text])

      /**
       * 光标处的跳转目标：先看 `#include`（解析成工程内文件），再看符号表。
       * @returns {{kind:string,name:string,path:string,line:number,system?:boolean,include?:boolean}|null}
       */
      const resolveTarget = React.useCallback(
        (info) => {
          if (!doc || !info) return null
          const lineText = linesOfDoc[info.line - 1] || ''
          const inc = includeAt(lineText, info.col)
          if (inc) {
            const target = resolveInclude(inc.target, doc.path, files)
            return { kind: 'include', name: inc.target, path: target || '', line: 1, system: inc.system, include: true }
          }
          if (!info.word) return null
          const cands = symbols.filter((s) => s.name === info.word)
          if (cands.length === 0) return null
          const same = cands.find((s) => s.path === doc.path)
          const pick = same || cands[0]
          return { kind: pick.kind, name: pick.name, path: pick.path, line: pick.line, count: cands.length }
        },
        [doc, files, symbols, linesOfDoc],
      )

      /** 双击选中的词 + 全文件同名词高亮（CSS Custom Highlight）。 */
      const [wordSel, setWordSel] = React.useState(null)

      const paintWord = React.useCallback(
        (word) => {
          try {
            if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('dsh-word-match')
          } catch (_) {
            /* 忽略 */
          }
          if (!word || !doc) {
            setWordSel(null)
            return
          }
          if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') {
            setWordSel({ word, count: findWordOccurrences(doc.text, word).length, unsupported: true })
            return
          }
          const occurrences = findWordOccurrences(doc.text, word, 800)
          const ranges = []
          for (const occ of occurrences) {
            const lineEl = codeRef.current && codeRef.current.querySelector(`[data-line="${occ.line}"]`)
            const range = rangeInLine(lineEl, occ.start, occ.end)
            if (range) ranges.push(range)
          }
          if (ranges.length === 0) {
            setWordSel(null)
            return
          }
          try {
            CSS.highlights.set('dsh-word-match', new Highlight(...ranges))
          } catch (_) {
            /* 忽略 */
          }
          setWordSel({ word, count: occurrences.length })
        },
        [doc],
      )

      const onCodeDoubleClick = (e) => {
        if (!doc || editing) return
        const info = pointAt(e.clientX, e.clientY)
        if (!info || !info.word) {
          paintWord('')
          return
        }
        e.preventDefault()
        window.getSelection && window.getSelection().removeAllRanges()
        paintWord(info.word)
      }

      // 换文件 / 进入编辑时清掉高亮；Esc 也清
      React.useEffect(() => {
        paintWord('')
        setMdMode('preview')
      }, [doc && doc.path, editing, paintWord])

      React.useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape') paintWord('')
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [paintWord])

      const onCodeMouseDown = (e) => {
        if (!(e.ctrlKey || e.metaKey)) return
        const info = pointAt(e.clientX, e.clientY)
        const target = resolveTarget(info)
        if (!target) {
          if (info && info.word) {
            e.preventDefault()
            setStatus(`「${info.word}」不在索引里（可能是会话目录之外的头文件或未收录的符号）`)
          }
          return
        }
        e.preventDefault()
        if (!target.path) {
          setStatus(target.system ? `「${target.name}」是系统头文件，不在工作区` : `找不到「${target.name}」`)
          return
        }
        clearHover()
        if (doc) setJumps((stack) => [...stack, { path: doc.path, line: doc.line || 1 }])
        openFile(target.path, target.line || 1)
      }

      // ---- 悬停：可跳转处加下划线，停 380ms 弹注释浮窗 ----
      const [hover, setHover] = React.useState(null)
      const hoverRef = React.useRef({ key: '', timer: 0 })

      const clearHover = React.useCallback(() => {
        window.clearTimeout(hoverRef.current.timer)
        hoverRef.current.key = ''
        setHover(null)
        try {
          if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('dsh-hover-word')
        } catch (_) {
          /* 老内核没有 Highlight API */
        }
      }, [])

      /**
     * 在某一行的 `<code>` 里，按行内字符偏移取一个 Range。
     * @param {Element} lineEl - 行容器
     * @param {number} start - 起始字符偏移
     * @param {number} end - 结束字符偏移
     * @returns {Range|null}
     */
    function rangeInLine(lineEl, start, end) {
      if (!lineEl) return null
      const codeEl = lineEl.tagName === 'CODE' ? lineEl : lineEl.querySelector('code')
      if (!codeEl) return null
      const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT)
      let acc = 0
      let startNode = null
      let startOff = 0
      let endNode = null
      let endOff = 0
      let node = walker.nextNode()
      while (node) {
        const len = node.nodeValue.length
        if (!startNode && acc + len >= start) {
          startNode = node
          startOff = start - acc
        }
        if (acc + len >= end) {
          endNode = node
          endOff = end - acc
          break
        }
        acc += len
        node = walker.nextNode()
      }
      if (!startNode || !endNode) return null
      try {
        const range = document.createRange()
        range.setStart(startNode, Math.max(0, Math.min(startOff, startNode.nodeValue.length)))
        range.setEnd(endNode, Math.max(0, Math.min(endOff, endNode.nodeValue.length)))
        return range
      } catch (_) {
        return null
      }
    }

    /** 给光标下的那个词加下划线（CSS Custom Highlight，不改 DOM）。 */
      const underlineAt = (info, target) => {
        try {
          if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return
          const el = codeRef.current
          const lineEl = el && el.querySelector(`[data-line="${info.line}"] code`)
          if (!lineEl) return
          const text = lineEl.textContent || ''
          const marker = /[A-Za-z0-9_$./<>"\\-]/
          let start = info.col
          let end = info.col
          while (start > 0 && marker.test(text[start - 1])) start -= 1
          while (end < text.length && marker.test(text[end])) end += 1
          if (target && target.include) {
            const m = /([<"])([^>"]+)[>"]/.exec(text)
            if (m) {
              start = text.indexOf(m[2])
              end = start + m[2].length
            }
          }
          const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
          let acc = 0
          let startNode = null
          let startOff = 0
          let endNode = null
          let endOff = 0
          let node = walker.nextNode()
          while (node) {
            const len = node.nodeValue.length
            if (!startNode && acc + len >= start) {
              startNode = node
              startOff = start - acc
            }
            if (acc + len >= end) {
              endNode = node
              endOff = end - acc
              break
            }
            acc += len
            node = walker.nextNode()
          }
          if (!startNode || !endNode) return
          const range = document.createRange()
          range.setStart(startNode, Math.max(0, Math.min(startOff, startNode.nodeValue.length)))
          range.setEnd(endNode, Math.max(0, Math.min(endOff, endNode.nodeValue.length)))
          CSS.highlights.set('dsh-hover-word', new Highlight(range))
        } catch (_) {
          /* 忽略：下划线只是锦上添花 */
        }
      }

      const onCodeMouseMove = (e) => {
        if (codeRef.current) codeRef.current.dataset.ctrl = e.ctrlKey || e.metaKey ? '1' : ''
        const info = pointAt(e.clientX, e.clientY)
        const target = resolveTarget(info)
        if (!target) {
          if (hoverRef.current.key) clearHover()
          return
        }
        const key = `${info.line}:${info.col}:${target.name}`
        if (key === hoverRef.current.key) return
        hoverRef.current.key = key
        window.clearTimeout(hoverRef.current.timer)
        setHover(null)
        underlineAt(info, target)
        const px = e.clientX
        const py = e.clientY
        hoverRef.current.timer = window.setTimeout(async () => {
          const loc = target.path ? `${target.path}${target.line > 1 ? `:${target.line}` : ''}` : ''
          setHover({ kind: target.kind, name: target.name, loc, doc: '', loading: true, x: px, y: py })
          let docText = ''
          try {
            if (target.include) {
              if (target.path) docText = fileHeaderComment(await readCachedText(sessionId, target.path))
            } else if (target.path === doc.path) {
              docText = docAbove(linesOfDoc, target.line)
            } else if (target.path) {
              const text = await readCachedText(sessionId, target.path)
              docText = docAbove(text.split(/\r?\n/), target.line)
            }
          } catch (_) {
            docText = ''
          }
          setHover((cur) => (cur && cur.key === key ? { ...cur, doc: docText, loading: false, key } : cur))
        }, 380)
      }

      // ---------------------------------------------------------------- 补全

      const suggest = (prefix, value) => {
        const lower = prefix.toLowerCase()
        const seen = new Set()
        const out = []
        const push = (v, kind) => {
          if (!v || v.length > 64 || seen.has(v)) return
          if (lower && !v.toLowerCase().startsWith(lower)) return
          seen.add(v)
          out.push({ v, kind })
        }
        const cur = docRef.current
        if (cur) for (const s of symbols) if (s.path === cur.path) push(s.name, s.kind)
        for (const s of symbols) push(s.name, s.kind)
        const words = value.match(/[A-Za-z_$][\w$]{2,}/g) || []
        for (let i = 0; i < words.length && i < 4000; i++) push(words[i], 'word')
        for (const k of keywordsOf(cur ? cur.lang : 'text')) push(k, 'kw')
        return out.slice(0, 60)
      }

      const updateComp = (ta, value) => {
        const caretPos = ta.selectionStart
        const m = /([A-Za-z_$][\w$]+)$/.exec(value.slice(0, caretPos))
        if (!m) {
          setComp(null)
          return
        }
        const prefix = m[1]
        const items = suggest(prefix, value)
        if (items.length === 0) {
          setComp(null)
          return
        }
        const box = caretBox(ta)
        setComp({ items, index: 0, prefixLen: prefix.length, x: box.x, y: box.y })
      }

      const acceptComp = (item) => {
        const ta = taRef.current
        if (!ta || !comp || !item) return
        const caretPos = ta.selectionStart
        const start = caretPos - comp.prefixLen
        const value = ta.value.slice(0, start) + item.v + ta.value.slice(caretPos)
        setDraft(value)
        setDirty(true)
        setComp(null)
        const next = start + item.v.length
        window.requestAnimationFrame(() => {
          const el = taRef.current
          if (!el) return
          el.selectionStart = next
          el.selectionEnd = next
          el.focus()
        })
      }

      const onEditInput = (e) => {
        const ta = e.currentTarget
        setDraft(ta.value)
        setDirty(true)
        updateComp(ta, ta.value)
      }

      const save = React.useCallback(async () => {
        const cur = docRef.current
        if (!cur || !sessionId) return
        const data = await callApi('write', { path: cur.path, text: draft }, sessionId)
        if (!data || !data.ok) {
          setError((data && data.error) || '保存失败')
          return
        }
        setDoc({ ...cur, text: draft })
        setEditing(false)
        setDirty(false)
        setStatus(`已保存 ${cur.path}`)
        loadIndex(true)
      }, [draft, sessionId, loadIndex])

      const onEditKey = (e) => {
        if (comp) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setComp({ ...comp, index: (comp.index + 1) % comp.items.length })
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setComp({ ...comp, index: (comp.index - 1 + comp.items.length) % comp.items.length })
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            acceptComp(comp.items[comp.index])
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setComp(null)
            return
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          save()
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
          e.preventDefault()
          const ta = taRef.current
          if (ta) updateComp(ta, ta.value)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
          setComp(null)
        }
      }

      // ---------------------------------------------------------------- 渲染

      const renderSearch = () => {
        if (!results) {
          return React.createElement(
            'div',
            { key: 'empty', className: 'dsh-nav-empty' },
            indexInfo
              ? `索引就绪：${indexInfo.scanned} 个文件 / ${symbols.length} 个符号。输入符号名或文件名开始搜索；打开源码后 Ctrl+点击标识符可跳定义，Alt+← 返回。`
              : '正在建立工作区索引…',
          )
        }
        const rows = []
        if (results.symbols.length > 0) {
          rows.push(
            React.createElement('div', { key: 'g-sym', className: 'dsh-nav-group' }, `符号 ${results.symbols.length}`),
          )
          for (let i = 0; i < results.symbols.length; i++) {
            const s = results.symbols[i]
            rows.push(
              React.createElement(
                'button',
                {
                  key: `s${i}`,
                  type: 'button',
                  className: 'dsh-nav-item',
                  title: `${s.path}:${s.line}`,
                  onClick: () => openFile(s.path, s.line),
                },
                [
                  React.createElement('span', { key: 'k', className: 'dsh-nav-kind' }, glyph(s.kind)),
                  React.createElement('span', { key: 'n', className: 'dsh-nav-name' }, s.name),
                  React.createElement('span', { key: 'm', className: 'dsh-nav-meta' }, `${s.path}:${s.line}`),
                ],
              ),
            )
          }
        }
        if (results.files.length > 0) {
          rows.push(
            React.createElement('div', { key: 'g-file', className: 'dsh-nav-group' }, `文件 ${results.files.length}`),
          )
          for (let i = 0; i < results.files.length; i++) {
            const f = results.files[i]
            rows.push(
              React.createElement(
                'button',
                {
                  key: `f${i}`,
                  type: 'button',
                  className: 'dsh-nav-item',
                  title: f.path,
                  onClick: () => openFile(f.path, 1),
                },
                [
                  React.createElement('span', { key: 'k', className: 'dsh-nav-kind' }, '≡'),
                  React.createElement('span', { key: 'n', className: 'dsh-nav-name' }, f.path),
                  React.createElement('span', { key: 'm', className: 'dsh-nav-meta' }, f.lang),
                ],
              ),
            )
          }
        }
        if (rows.length === 0) {
          return React.createElement(
            'div',
            { key: 'none', className: 'dsh-nav-empty' },
            `没有匹配「${query}」的符号或文件`,
          )
        }
        return React.createElement('div', { key: 'list', className: 'dsh-nav-list' }, rows)
      }

      // 符号表 → 类型名/函数名集合（VS Code 的语义着色靠它区分青色/黄色）
      const semDict = React.useMemo(() => {
        const types = new Set()
        const funcs = new Set()
        for (const sym of symbols) {
          if (sym.kind === 'class' || sym.kind === 'type') types.add(sym.name)
          else if (sym.kind === 'func') funcs.add(sym.name)
        }
        return { types, funcs }
      }, [symbols])

      // 高亮只算一次：以前每次 render（切行、面板状态变化）都会把整篇重新 token 化，
      // 大文件点开时能卡好几百毫秒。这里按 (text, lang, 符号表) 缓存；
      // 用整篇状态机（tokenizeLines）才能正确处理跨行块注释与括号配对。
      const tokenLines = React.useMemo(
        () => (doc ? tokenizeLines(doc.text, doc.lang, semDict) : []),
        [doc && doc.text, doc && doc.lang, semDict],
      )

      const renderDoc = () => {
        const text = editing ? draft : doc.text
        const lines = text.split(/\r?\n/)
        const shown = Math.min(lines.length, MAX_RENDER_LINES)
        const head = React.createElement('div', { key: 'head', className: 'dsh-nav-head' }, [
          jumps.length > 0
            ? React.createElement(
                'button',
                { key: 'back', type: 'button', className: 'dsh-nav-btn', title: '返回上一处（Alt+←）', onClick: back },
                '‹',
              )
            : null,
          React.createElement('span', { key: 'p', className: 'dsh-nav-path', title: doc.path }, doc.path),
          React.createElement('span', { key: 'ln', className: 'dsh-nav-meta' }, `L${doc.line || 1}`),
          editing
            ? React.createElement(
                'button',
                {
                  key: 'save',
                  type: 'button',
                  className: 'dsh-nav-btn',
                  'data-primary': '1',
                  disabled: !dirty,
                  onClick: save,
                },
                '保存',
              )
            : React.createElement(
                'button',
                {
                  key: 'edit',
                  type: 'button',
                  className: 'dsh-nav-btn',
                  onClick: () => {
                    setEditing(true)
                    setDraft(doc.text)
                    window.requestAnimationFrame(() => {
                      if (taRef.current) taRef.current.focus()
                    })
                  },
                },
                '编辑',
              ),
          React.createElement(
            'button',
            {
              key: 'close',
              type: 'button',
              className: 'dsh-nav-btn',
              title: '关闭文件',
              onClick: () => {
                setDoc(null)
                setEditing(false)
                setComp(null)
                setStatus('')
              },
            },
            '×',
          ),
        ])

        const isMd = Boolean(doc && /markdown/.test(doc.lang))
        const showMd = isMd && !editing && mdMode === 'preview'
        const body = showMd
          ? React.createElement(
              'div',
              { key: 'md', className: 'dsh-md' },
              renderMarkdown(doc.text),
            )
          : editing
          ? React.createElement('textarea', {
              key: 'ta',
              ref: taRef,
              className: 'dsh-nav-edit',
              value: draft,
              spellCheck: false,
              wrap: 'off',
              onChange: onEditInput,
              onKeyDown: onEditKey,
              onScroll: () => setComp(null),
            })
          : React.createElement(
              'div',
              {
                key: 'code',
                ref: codeRef,
                className: 'dsh-nav-code',
                title: 'Ctrl+点击跳转（含 #include 头文件）；悬停看定义',
                onMouseDown: onCodeMouseDown,
                onDoubleClick: onCodeDoubleClick,
                onMouseMove: onCodeMouseMove,
                onMouseLeave: clearHover,
                onScroll: clearHover,
              },
              lines.slice(0, shown).map((line, i) =>
                React.createElement(
                  'div',
                  {
                    key: i,
                    'data-line': i + 1,
                    className: `dsh-nav-line${i + 1 === (doc.line || 1) ? ' is-cur' : ''}`,
                  },
                  [
                    React.createElement('span', { key: 'n', className: 'dsh-nav-ln' }, i + 1),
                    React.createElement(
                      'code',
                      { key: 'c' },
                      (tokenLines[i] || []).map((t, ti) =>
                        t.c
                          ? React.createElement('span', { key: ti, className: `dsh-nav-${t.c}` }, t.t)
                          : t.t,
                      ),
                    ),
                  ],
                ),
              ),
            )

        return [head, body, shown < lines.length
          ? React.createElement('div', { key: 'more', className: 'dsh-nav-status' }, `文件共 ${lines.length} 行，仅显示前 ${shown} 行`)
          : null]
      }

      const compEl =
        comp && comp.items.length > 0
          ? React.createElement(
              'div',
              {
                key: 'comp',
                className: 'dsh-nav-comp',
                style: { left: `${Math.round(comp.x)}px`, top: `${Math.round(comp.y)}px` },
              },
              comp.items.slice(0, 12).map((it, i) =>
                React.createElement(
                  'div',
                  {
                    key: `${it.v}:${i}`,
                    className: 'dsh-nav-comp-item',
                    'data-active': i === comp.index ? '1' : undefined,
                    onMouseDown: (e) => {
                      e.preventDefault()
                      acceptComp(it)
                    },
                  },
                  [
                    React.createElement('span', { key: 'k', className: 'dsh-nav-comp-kind' }, glyph(it.kind)),
                    React.createElement('span', { key: 'n', className: 'dsh-nav-comp-name' }, it.v),
                  ],
                ),
              ),
            )
          : null

      const hoverEl = hover
        ? React.createElement(
            'div',
            {
              key: 'hover',
              className: 'dsh-hover',
              style: {
                left: `${Math.max(8, Math.min(hover.x + 14, (window.innerWidth || 1200) - 480))}px`,
                top: `${Math.max(8, Math.min(hover.y + 18, (window.innerHeight || 800) - 220))}px`,
              },
            },
            [
              React.createElement('div', { key: 'h', className: 'dsh-hover-head' }, [
                React.createElement('span', { key: 'k', className: 'dsh-hover-kind' }, hover.kind || 'sym'),
                React.createElement('span', { key: 'n', className: 'dsh-hover-name' }, hover.name),
                hover.loc
                  ? React.createElement('span', { key: 'l', className: 'dsh-hover-loc' }, hover.loc)
                  : null,
              ]),
              React.createElement(
                'pre',
                { key: 'd', className: 'dsh-hover-doc' },
                hover.loading ? '…' : hover.doc || '（没有注释）',
              ),
            ],
          )
        : null

      return React.createElement('div', { className: 'dsh-nav' }, [
        React.createElement('div', { key: 'bar', className: 'dsh-nav-bar' }, [
          React.createElement('input', {
            key: 'q',
            className: 'dsh-nav-input',
            value: query,
            placeholder: '搜索符号或文件…',
            onChange: (e) => setQuery(e.target.value),
          }),
          React.createElement(
            'button',
            {
              key: 'r',
              type: 'button',
              className: 'dsh-nav-btn',
              title: '重建索引',
              onClick: () => loadIndex(true),
            },
            '⟳',
          ),
        ]),
        status || error
          ? React.createElement(
              'div',
              { key: 'st', className: 'dsh-nav-status', 'data-error': error ? '1' : undefined },
              error || status,
            )
          : null,
        React.createElement(
          'div',
          { key: 'body', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
          doc ? renderDoc() : renderSearch(),
        ),
        compEl,
        hoverEl,
      ])
    }

    /**
     * 文件/目录图标：优先用 DSH primitives（和内置文件树一致），否则退回自带 SVG。
     * @param {{entry:object, expanded?:boolean, size?:number}} props
     */
    function FileGlyph(props) {
      const px = (props && props.size) || 15
      const entry = (props && props.entry) || {}
      if (prim) {
        if (entry.type === 'dir') {
          const Folder = props.expanded ? prim.IconFolderOpenRegular : prim.IconFolderCloseRegular
          if (Folder) return React.createElement(Folder, { size: px })
        } else if (typeof prim.FileTypeIcon === 'function') {
          return React.createElement(prim.FileTypeIcon, { path: entry.path, size: px })
        }
      }
      return icon(entry.type === 'dir' ? 'folder' : 'file', px - 1)
    }

    // ================================================================== 侧边栏：Git

    /** 打开时记下的参数：useTabInfo 不可用时的兜底。 */
    const openState = { git: null, diff: null, code: null }

    /** 代码导航页的导航序号：页面已打开时靠它轮询切换文件。 */
    let codeSeq = 0

    /**
     * 代码页是否已经"单独开过一格"。
     * 首次打开文件时用 preferNewPane 在右侧再分一格（左边文件树、右边文件内容）；
     * 之后复用那一格，不再继续分栏。
     */
    /** 同一文件的重复打开保护：600ms 内对同一路径只开一次（双击/连点不会开两格）。 */
    let lastCodeOpen = { path: '', at: 0 }

    /** 最近一次 git 状态：面板刷新后写这里，头部按钮直接复用（避免重复 spawn git）。 */
    let lastGitStatus = null

    /** 最近一次索引结果（模块级）：60 秒内切页不重复请求，避免每次打开代码页都触发扫描。 */
    let lastIndex = null

    /** 最近一次 git 状态的时间戳：面板切回来时若刚拉过，直接用缓存不 spawn。 */
    let lastGitStatusAt = 0

    /** 只能"双击启动"的类型（GUI/可执行，不捕获输出）。 */
    const LAUNCH_EXTS = ['.exe', '.com', '.jar']
    /** 可以"双击启动"，也可以捕获输出的类型。 */
    const CAPTURE_EXTS = ['.py', '.js', '.mjs', '.cjs', '.sh', '.bat', '.cmd', '.ps1']
    /** 需要先编译再运行的类型。 */
    const COMPILE_EXTS = ['.c', '.cpp', '.cc', '.cxx']

    /** 侧边栏控制器（apply 时绑定 ctx.sidebarRight）。 */
    let sidebarCtl = null

    /** 侧栏相关服务（apply 时填充）：侧边会话要用的 remote / sessions。 */
    const sidebarDeps = { remote: null, sessions: null }

    /** 转义正则元字符。 */
    function escapeRe(text) {
      return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    /**
     * 找出文本里某个"整词"的所有出现位置（按标识符边界匹配）。
     * @param {string} text - 整篇文本
     * @param {string} word - 要找的词
     * @param {number} [limit] - 最多返回多少处
     * @returns {Array<{line:number,start:number,end:number}>} line 从 1 开始，start/end 是行内偏移
     */
    function findWordOccurrences(text, word, limit) {
      const out = []
      if (!word || !/^[A-Za-z_$][\w$]*$/.test(word)) return out
      const re = new RegExp(`(?<![\\w$])${escapeRe(word)}(?![\\w$])`, 'g')
      const lines = String(text || '').split(/\r?\n/)
      const max = limit || 2000
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        re.lastIndex = 0
        let m = re.exec(line)
        while (m) {
          out.push({ line: i + 1, start: m.index, end: m.index + word.length })
          if (out.length >= max) return out
          m = re.exec(line)
        }
      }
      return out
    }

    /** 从侧栏容器的 DOM 属性读当前会话 id（params 缺失时的最后兜底）。 */
    function sessionFromDom(node) {
      const host = node && node.closest ? node.closest('[data-sidebar-right-session]') : null
      const id = host && host.getAttribute('data-sidebar-right-session')
      return typeof id === 'string' ? id : ''
    }

    /** 正文组件读取参数：优先框架 useTabInfo，其次打开时记下的状态。 */
    function readParams(props, kind) {
      const fallback = openState[kind] || {}
      const useInfo = props && props.useTabInfo
      if (typeof useInfo === 'function') {
        try {
          const info = useInfo()
          const params = info && info.tab && info.tab.navigation && info.tab.navigation.params
          if (params && typeof params === 'object') return Object.assign({}, fallback, params)
        } catch (_) {
          /* 老版本没有这个 hook */
        }
      }
      return fallback
    }

    /**
     * 打开（并展开）右侧栏的「源代码管理」页。
     * @returns {boolean} 是否成功发起
     */
    function openGitTab(sessionId) {
      const params = { sessionId: sessionId || '' }
      openState.git = params
      if (!sidebarCtl) {
        console.error('[dsh-deliverable-menu] ctx.sidebarRight 不可用（检查 inject 是否含 sidebarRight）')
        return false
      }
      try {
        if (typeof sidebarCtl.openTab === 'function') {
          sidebarCtl.openTab('dsh-git', { params })
          return true
        }
        // 老版本没有 openTab 时退回资源路由
        if (typeof sidebarCtl.openResource === 'function') {
          sidebarCtl.openResource('dsh-resource://dsh-git/page', { params })
          return true
        }
        console.error('[dsh-deliverable-menu] sidebarRight 既没有 openTab 也没有 openResource')
      } catch (err) {
        console.error('[dsh-deliverable-menu] 打开源代码管理失败：', err)
      }
      return false
    }

    function openCodeTab(sessionId, path, line) {
      codeSeq += 1
      openState.code = { sessionId, path: path || '', line: line || 1, token: codeSeq }
      if (!sidebarCtl) return
      const now = Date.now()
      if (path && lastCodeOpen.path === path && now - lastCodeOpen.at < 600) return
      lastCodeOpen = { path: path || '', at: now }
      try {
        // preferNewPane：第一次把右栏分出一格；之后这个 contentId 已存在，
        // dockkit 只会 reveal 已有标签，不会继续分栏（源码里 revealed !== undefined 就不 split）
        sidebarCtl.openTab('dsh-code', {
          params: {},
          preferNewPane: true,
        })
      } catch (err) {
        console.warn('[dsh-deliverable-menu] 打开代码导航失败：', err)
      }
    }

    // ------------------------------------------------------------------ 图标

    /**
     * 内联 SVG 图标（stroke=currentColor），避免依赖外部图标包。
     * @param {string} name - 图标名
     * @param {number} size - 边长
     */
    function icon(name, size = 14) {
      const paths = {
        branch: ['M6 3v12', 'M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'],
        file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
        folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
        filePlus: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M12 12v6', 'M9 15h6'],
        folderPlus: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 11v6', 'M9 14h6'],
        refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
        search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
        list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
        grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
        external: ['M14 4h6v6', 'M20 4l-9 9', 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'],
        chevronRight: ['M9 6l6 6-6 6'],
        chevronDown: ['M6 9l6 6 6-6'],
        arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
        arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
        check: ['M20 6L9 17l-5-5'],
        close: ['M18 6L6 18', 'M6 6l12 12'],
      }
      const d = paths[name] || paths.chevronRight
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { flex: 'none', display: 'block' },
        },
        d.map((p, i) => React.createElement('path', { key: i, d: p })),
      )
    }

    /** 在右侧另开一格显示并排对比（VS Code 的"列表在左、diff 在右"）。 */
    function openDiffTab(sessionId, path, staged) {
      openState.diff = { sessionId, path, staged: staged === true }
      if (!sidebarCtl) return
      const params = { sessionId, path, staged: staged === true }
      try {
        sidebarCtl.openResource('dsh-resource://dsh-git-diff/file', { params, preferNewPane: true })
      } catch (err) {
        try {
          sidebarCtl.openResource('dsh-resource://dsh-git-diff/file', { params })
        } catch (err2) {
          console.warn('[dsh-deliverable-menu] 打开对比失败：', err2)
        }
      }
    }

    /** unified diff → 并排行。 */
    function parseUnified(text) {
      const rows = []
      let oldNo = 0
      let newNo = 0
      const lines = String(text || '').split(/\r?\n/)
      for (const line of lines) {
        if (
          line.startsWith('diff --git') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('new file') ||
          line.startsWith('deleted file') ||
          line.startsWith('similarity index') ||
          line.startsWith('rename ')
        ) {
          continue
        }
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s*(.*)$/.exec(line)
        if (hunk) {
          oldNo = Number(hunk[1])
          newNo = Number(hunk[2])
          rows.push({ kind: 'hunk', text: line.trim() })
          continue
        }
        if (line.startsWith('\\')) continue
        if (line.startsWith('+')) {
          rows.push({ kind: 'add', rightNo: newNo, right: line.slice(1) })
          newNo += 1
          continue
        }
        if (line.startsWith('-')) {
          rows.push({ kind: 'del', leftNo: oldNo, left: line.slice(1) })
          oldNo += 1
          continue
        }
        if (line.startsWith(' ')) {
          rows.push({ kind: 'ctx', leftNo: oldNo, rightNo: newNo, left: line.slice(1), right: line.slice(1) })
          oldNo += 1
          newNo += 1
          continue
        }
        if (line.trim() === '') continue
        rows.push({ kind: 'meta', text: line })
      }
      return rows
    }

    /**
     * 会话窗口顶部（标题栏右侧）的 Git 入口 —— **唯一按钮**。
     * 点一下展开右侧栏并打开「源代码管理」页：里面是 新建 + 项目文件树 + 更改 + 搜索。
     */
    function GitButton(props) {
      const sessionId = (props && props.sessionId) || ''
      const [count, setCount] = React.useState(
        lastGitStatus && lastGitStatus.isRepo ? (lastGitStatus.files || []).length : -1,
      )

      React.useEffect(() => {
        if (!sessionId) return undefined
        let alive = true
        const tick = async () => {
          if (typeof document !== 'undefined' && document.hidden) return
          const st = await callApi('gitStatus', {}, sessionId)
          if (!alive) return
          lastGitStatus = st && st.ok ? st : null
          setCount(st && st.ok && st.isRepo ? (st.files || []).length : -1)
        }
        tick()
        // 徽标不需要实时：60 秒一次足够（面板打开后会顺带刷新它）
        const timer = window.setInterval(tick, 60000)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [sessionId])

      const [failed, setFailed] = React.useState(false)
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-ib-btn',
          'data-failed': failed ? '1' : undefined,
          title: failed
            ? '打开侧栏失败，详细原因见 DevTools 控制台'
            : count > 0
              ? `源代码管理（${count} 个改动）`
              : '源代码管理',
          onClick: () => {
            const ok = openGitTab(sessionId)
            setFailed(!ok)
            if (ok) window.setTimeout(() => setFailed(false), 2000)
          },
        },
        [
          icon('branch', 14),
          count > 0
            ? React.createElement('span', { key: 'n', className: 'dsh-ib-count' }, String(count))
            : null,
        ],
      )
    }

    /**
     * 「源代码管理」页：分支、暂存/更改/未跟踪分组、提交框、最近提交。
     * 布局对齐 VS Code：分组标题 + 文件行（状态字母 / 文件名 / 目录 / 悬停暂存按钮）。
     */
    /**
     * 「源代码管理」页（右栏，唯一入口，VS Code 式）：
     *   顶部：分支（可点切换）+ 领先/落后 + 拉取 + 推送 + 刷新
     *   切换：[文件] [更改 N] [搜索]
     *   文件：新建文件 / 新建文件夹 + 当前项目文件树（Git 着色）；点文件 → 代码导航页
     *   更改：提交框 + 暂存/更改/未跟踪 + 最近提交；点文件 → 右侧分栏并排对比
     *   搜索：跨文件文本搜索，点命中跳行
     */
    function SourcePanel(props) {
      const params = readParams(props, 'git')
      const rootRef = React.useRef(null)
      const [domSession, setDomSession] = React.useState('')
      const rawId = params && params.sessionId
      const propId = props && props.sessionId
      const sessionId =
        (typeof rawId === 'string' && rawId) || (typeof propId === 'string' && propId) || domSession || ''
      const [view, setView] = React.useState('files')
      const [status, setStatus] = React.useState(lastGitStatus)
      const [branchMenu, setBranchMenu] = React.useState(false)
      const [branchList, setBranchList] = React.useState([])
      const [armed, setArmed] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState('')
      const [error, setError] = React.useState('')
      const [reloadKey, setReloadKey] = React.useState(0)
      const [logKey, setLogKey] = React.useState(0)

      const loadStatus = React.useCallback(async () => {
        if (!sessionId) {
          setError('没有会话上下文')
          return
        }
        const data = await callApi('gitStatus', {}, sessionId)
        if (!data || !data.ok) {
          setError((data && data.error) || '读取 git 状态失败')
          return
        }
        setError('')
        setStatus(data)
        lastGitStatus = data
        lastGitStatusAt = Date.now()
      }, [sessionId])

      React.useEffect(() => {
        const id = sessionFromDom(rootRef.current)
        if (id) setDomSession(id)
      }, [])

      React.useEffect(() => {
        // 刚从别的视图切回来（5 秒内拉过）就直接用缓存，不再 spawn git
        if (lastGitStatus && Date.now() - lastGitStatusAt < 5000) return
        loadStatus()
      }, [loadStatus])

      // 对齐 VS Code：面板在屏幕上才轮询，且同一时刻只允许一个请求在飞
      React.useEffect(() => {
        let inflight = false
        const timer = window.setInterval(async () => {
          if (inflight || (typeof document !== 'undefined' && document.hidden)) return
          inflight = true
          try {
            await loadStatus()
          } finally {
            inflight = false
          }
        }, 10000)
        return () => window.clearInterval(timer)
      }, [loadStatus])

      const refreshAll = React.useCallback(async () => {
        setReloadKey((k) => k + 1)
        setLogKey((k) => k + 1)
        await loadStatus()
      }, [loadStatus])

      const act = async (method, payload, okText) => {
        setBusy(true)
        const data = await callApi(method, payload, sessionId)
        setBusy(false)
        if (!data || !data.ok) {
          setError((data && data.error) || '操作失败')
          return
        }
        setError('')
        if (okText) {
          setToast(okText)
          window.setTimeout(() => setToast(''), 2000)
        }
        await refreshAll()
      }

      const toggleBranches = async () => {
        if (branchMenu) {
          setBranchMenu(false)
          return
        }
        const data = await callApi('gitBranches', {}, sessionId)
        setBranchList((data && data.branches) || [])
        setBranchMenu(true)
      }

      const doCheckout = async (name) => {
        setBranchMenu(false)
        if (!status || name === status.branch) return
        await act('gitCheckout', { branch: name }, `已切换到 ${name}`)
      }

      /** 远程操作二次确认：3 秒内再点一次才执行。 */
      const armedRun = async (key, method, okText) => {
        if (armed && armed.key === key) {
          window.clearTimeout(armed.timer)
          setArmed(null)
          await act(method, {}, okText)
          return
        }
        const timer = window.setTimeout(() => setArmed(null), 3000)
        setArmed({ key, timer })
      }

      const remoteReady = Boolean(status && status.upstream)
      const changed = status && status.files ? status.files.length : 0

      const head = React.createElement('div', { key: 'head', className: 'dsh-git-head' }, [
        React.createElement(
          'button',
          {
            key: 'b',
            type: 'button',
            className: 'dsh-git-branch',
            title: status && status.upstream ? `上游 ${status.upstream}（点击切换分支）` : '点击切换分支',
            style: { background: 'transparent', border: 0, cursor: 'pointer', padding: 0, font: 'inherit' },
            onClick: toggleBranches,
          },
          [icon('branch', 12), ` ${(status && status.branch) || '—'}`],
        ),
        status && status.ahead > 0
          ? React.createElement('span', { key: 'a', className: 'dsh-git-badge', title: `领先上游 ${status.ahead}` }, `↑${status.ahead}`)
          : null,
        status && status.behind > 0
          ? React.createElement('span', { key: 'd', className: 'dsh-git-badge', title: `落后上游 ${status.behind}` }, `↓${status.behind}`)
          : null,
        React.createElement('span', { key: 's', className: 'dsh-git-spacer' }),
        React.createElement(
          'button',
          {
            key: 'pull',
            type: 'button',
            className: 'dsh-git-btn',
            'data-quiet': '1',
            'data-armed': armed && armed.key === 'pull' ? '1' : undefined,
            disabled: busy || !remoteReady,
            title: remoteReady ? (armed && armed.key === 'pull' ? '再点一次确认拉取' : '拉取（--ff-only）') : '未设置上游分支',
            onClick: () => armedRun('pull', 'gitPull', '已拉取'),
          },
          icon('arrowDown', 13),
        ),
        React.createElement(
          'button',
          {
            key: 'push',
            type: 'button',
            className: 'dsh-git-btn',
            'data-quiet': '1',
            'data-armed': armed && armed.key === 'push' ? '1' : undefined,
            disabled: busy || !remoteReady,
            title: remoteReady ? (armed && armed.key === 'push' ? '再点一次确认推送' : '推送') : '未设置上游分支',
            onClick: () => armedRun('push', 'gitPush', '已推送'),
          },
          icon('arrowUp', 13),
        ),
        React.createElement(
          'button',
          { key: 'r', type: 'button', className: 'dsh-git-btn', 'data-quiet': '1', title: '刷新', onClick: refreshAll },
          icon('refresh', 13),
        ),
        branchMenu
          ? React.createElement(
              'div',
              { key: 'menu', className: 'dsh-git-menu' },
              branchList.length === 0
                ? React.createElement('div', { className: 'dsh-git-empty' }, '没有其它本地分支')
                : branchList.map((b) =>
                    React.createElement(
                      'div',
                      {
                        key: b.name,
                        className: 'dsh-git-menuitem',
                        'data-cur': b.current ? '1' : undefined,
                        onClick: () => doCheckout(b.name),
                      },
                      [React.createElement('span', { key: 'i', style: { width: 12 } }, b.current ? icon('check', 12) : null), b.name],
                    ),
                  ),
            )
          : null,
      ])

      const tab = (key, label, badge) =>
        React.createElement(
          'button',
          {
            key,
            type: 'button',
            className: 'dsh-src-tab',
            'aria-pressed': view === key ? 'true' : 'false',
            onClick: () => setView(key),
          },
          [
            React.createElement('span', { key: 'l' }, label),
            badge
              ? React.createElement('span', { key: 'b', className: 'dsh-src-tab-badge' }, String(badge))
              : null,
          ],
        )

      const switcher = React.createElement('div', { key: 'sw', className: 'dsh-src-switch' }, [
        tab('files', '文件', 0),
        tab('changes', '更改', changed),
        tab('search', '搜索', 0),
        tab('side', '侧边会话', 0),
        React.createElement(ThemeButton, { key: 'theme' }),
      ])

      const notify = (msg) => {
        setToast(msg)
        window.setTimeout(() => setToast(''), 2600)
      }

      const body =
        view === 'side'
          ? React.createElement(SideChatPanel, { key: 'side', sessionId })
          : view === 'changes'
          ? React.createElement(ChangesView, { key: 'changes', sessionId, status, busy, act, logKey, notify })
          : view === 'search'
            ? React.createElement(SearchPanel, { key: 'search', sessionId })
            : React.createElement(FilesPanel, {
                key: 'files',
                sessionId,
                reloadKey,
                status,
                onSearch: () => setView('search'),
              })

      return React.createElement('div', { className: 'dsh-src', ref: rootRef }, [
        head,
        switcher,
        error || toast
          ? React.createElement(
              'div',
              { key: 'st', className: 'dsh-nav-status', 'data-error': error ? '1' : undefined },
              error || toast,
            )
          : null,
        body,
      ])
    }

    /**
     * 「更改」视图：提交框 + 三组文件 + 最近提交。
     * 状态由 SourcePanel 提供（它负责轮询），这里只负责渲染与动作触发。
     */
    function ChangesView(props) {
      const { sessionId, status, busy, act, logKey, notify } = props
      const MAX_ROWS = 400
      const [message, setMessage] = React.useState('')
      const [commits, setCommits] = React.useState([])
      const [active, setActive] = React.useState('')

      // 只随会话/提交变化拉一次；以前依赖 status，4 秒就重新 spawn 一次 git log
      React.useEffect(() => {
        let alive = true
        callApi('gitLog', { limit: 6 }, sessionId).then((data) => {
          if (alive) setCommits((data && data.commits) || [])
        })
        return () => {
          alive = false
        }
      }, [sessionId, logKey])

      const staged = []
      const changed = []
      const untracked = []
      for (const f of (status && status.files) || []) {
        const isUntracked = f.x === '?' && f.y === '?'
        if (isUntracked) {
          untracked.push(f)
          continue
        }
        if (f.x !== ' ' && f.x !== '?') staged.push(f)
        if (f.y !== ' ') changed.push(f)
      }

      const rowOf = (f, isStaged) => {
        const flag = isStaged ? f.x : f.y
        const letter = f.x === '?' ? 'U' : flag === 'D' ? 'D' : flag === 'A' ? 'A' : 'M'
        const slash = f.path.lastIndexOf('/')
        const name = slash >= 0 ? f.path.slice(slash + 1) : f.path
        const dir = slash >= 0 ? f.path.slice(0, slash) : ''
        const id = `${isStaged ? 's' : 'c'}:${f.path}`
        const isDirEntry = Boolean(f.untrackedDir) || String(f.path).endsWith('/')
        const open = () => {
          if (isDirEntry) {
            if (typeof notify === 'function') notify(`${f.path} 是未跟踪目录，去「文件」视图展开查看`)
            return
          }
          setActive(id)
          openDiffTab(sessionId, f.path, isStaged)
        }
        return React.createElement(
          'div',
          {
            key: id,
            className: 'dsh-git-row',
            'data-active': active === id ? '1' : undefined,
            title: isDirEntry ? `${f.path}（未跟踪目录）` : f.path,
            role: 'button',
            tabIndex: 0,
            onClick: open,
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                open()
              }
            },
          },
          [
            React.createElement('span', { key: 'st', className: 'dsh-git-st', 'data-k': letter }, letter),
            React.createElement('span', { key: 'n', className: 'dsh-git-name' }, name),
            React.createElement('span', { key: 'd', className: 'dsh-git-dir' }, dir),
            React.createElement(
              'span',
              {
                key: 'a',
                className: 'dsh-git-act',
                title: isStaged ? '取消暂存' : '暂存此文件',
                role: 'button',
                onClick: (e) => {
                  e.stopPropagation()
                  act(isStaged ? 'gitUnstage' : 'gitStage', { path: f.path })
                },
              },
              isStaged ? '\u2212' : '+',
            ),
          ],
        )
      }

      const section = (title, list, isStaged) => {
        if (list.length === 0) return null
        const rows = [
          React.createElement('div', { key: 'h', className: 'dsh-git-sec' }, [
            React.createElement('span', { key: 't' }, title),
            React.createElement('span', { key: 'c', className: 'dsh-git-sec-count' }, String(list.length)),
          ]),
          ...list.slice(0, MAX_ROWS).map((f) => rowOf(f, isStaged)),
        ]
        if (list.length > MAX_ROWS) {
          rows.push(
            React.createElement(
              'div',
              { key: 'more', className: 'dsh-git-more' },
              `还有 ${list.length - MAX_ROWS} 项未渲染（共 ${list.length}）—— 用「搜索」视图按名字过滤`,
            ),
          )
        }
        return React.createElement('div', { key: title }, rows)
      }

      const commitBox =
        status && status.isRepo && staged.length > 0
          ? React.createElement('div', { key: 'commit', className: 'dsh-git-commit' }, [
              React.createElement('input', {
                key: 'm',
                className: 'dsh-git-msg',
                value: message,
                placeholder: '提交说明（Ctrl+Enter 提交）',
                onChange: (e) => setMessage(e.target.value),
                onKeyDown: (e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && message.trim()) {
                    act('gitCommit', { message }, '已提交').then(() => setMessage(''))
                  }
                },
              }),
              React.createElement(
                'button',
                {
                  key: 'c',
                  type: 'button',
                  className: 'dsh-git-btn',
                  disabled: busy || !message.trim(),
                  onClick: async () => {
                    await act('gitCommit', { message }, '已提交')
                    setMessage('')
                  },
                },
                '提交',
              ),
            ])
          : null

      const body =
        !status ? null
        : !status.isRepo ? React.createElement('div', { className: 'dsh-git-empty' }, '当前工作区不是 git 仓库')
        : (status.files || []).length === 0 ? React.createElement('div', { className: 'dsh-git-empty' }, '没有改动')
        : React.createElement('div', { className: 'dsh-git-body' }, [
            section('暂存的更改', staged, true),
            section('更改', changed, false),
            section('未跟踪', untracked, false),
            commits.length > 0
              ? React.createElement('div', { key: 'log', className: 'dsh-git-log' }, [
                  React.createElement('div', { key: 'h', className: 'dsh-git-sec' }, '最近提交'),
                  ...commits.map((c) =>
                    React.createElement('div', { key: c.hash, className: 'dsh-git-logrow', title: `${c.author} · ${c.when}` }, [
                      React.createElement('span', { key: 'h', className: 'dsh-git-logh' }, c.hash),
                      React.createElement('span', { key: 's' }, c.subject),
                    ]),
                  ),
                ])
              : null,
          ])

      return React.createElement('div', { className: 'dsh-changes' }, [commitBox, body])
    }

    /** 「对比」页：左右并排，逐行对齐（上下文行两侧同号）。 */
    function DiffView(props) {
      const params = readParams(props, 'diff')
      const sessionId = params.sessionId || ''
      const path = params.path || ''
      const staged = params.staged === true
      const [diff, setDiff] = React.useState(null)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        if (!sessionId || !path) {
          setError('缺少文件参数')
          return () => {
            alive = false
          }
        }
        callApi('gitDiff', { path, staged }, sessionId).then((data) => {
          if (!alive) return
          if (!data || !data.ok) {
            setError((data && data.error) || '读取对比失败')
            return
          }
          setError('')
          setDiff(data)
        })
        return () => {
          alive = false
        }
      }, [sessionId, path, staged])

      const rows = React.useMemo(() => (diff ? parseUnified(diff.unified) : []), [diff])
      const changedCount = React.useMemo(
        () => rows.filter((r) => r.kind === 'add' || r.kind === 'del').length,
        [rows],
      )

      const head = React.createElement('div', { className: 'dsh-diff-head' }, [
        React.createElement('span', { key: 'p', className: 'dsh-diff-path', title: path }, path || '对比'),
        React.createElement('span', { key: 't', className: 'dsh-diff-tag' }, staged ? '暂存的更改' : '工作区改动'),
        React.createElement('span', { key: 'c', className: 'dsh-diff-tag' }, `${changedCount} 行`),
      ])

      if (error) {
        return React.createElement('div', { className: 'dsh-diff' }, [
          head,
          React.createElement('div', { key: 'e', className: 'dsh-git-empty' }, error),
        ])
      }

      if (!diff) {
        return React.createElement('div', { className: 'dsh-diff' }, [
          head,
          React.createElement('div', { key: 'l', className: 'dsh-git-empty' }, '正在读取对比…'),
        ])
      }

      if (diff.binary) {
        return React.createElement('div', { className: 'dsh-diff' }, [
          head,
          React.createElement('div', { key: 'b', className: 'dsh-git-empty' }, '二进制文件，无法以文本对比'),
        ])
      }

      if (diff.tooLarge) {
        return React.createElement('div', { className: 'dsh-diff' }, [
          head,
          React.createElement(
            'div',
            { key: 'l', className: 'dsh-git-empty' },
            `这个文件改动太大（${Math.round((diff.size || 0) / 1024)} KB），面板里不展开。\n用右键「在资源管理器中显示」拿外部对比工具看。`,
          ),
        ])
      }

      if (rows.length === 0) {
        return React.createElement('div', { className: 'dsh-diff' }, [
          head,
          React.createElement('div', { key: 'n', className: 'dsh-git-empty' }, '两侧内容相同（或文件未更改）'),
        ])
      }

      return React.createElement('div', { className: 'dsh-diff' }, [
        head,
        rows.length > MAX_DIFF_ROWS
          ? React.createElement(
              'div',
              { key: 'more', className: 'dsh-nav-status' },
              `对比共 ${rows.length} 行，仅显示前 ${MAX_DIFF_ROWS} 行`,
            )
          : null,
        React.createElement(
          'div',
          { key: 'body', className: 'dsh-diff-body' },
          rows.slice(0, MAX_DIFF_ROWS).map((r, i) => {
            if (r.kind === 'hunk' || r.kind === 'meta') {
              return React.createElement('div', { key: i, className: 'dsh-diff-hunk' }, r.text || '')
            }
            const leftClass = r.kind === 'del' ? 'is-del' : r.kind === 'add' ? 'is-blank' : ''
            const rightClass = r.kind === 'add' ? 'is-add' : r.kind === 'del' ? 'is-blank' : ''
            return React.createElement('div', { key: i, className: 'dsh-diff-row' }, [
              React.createElement(
                'span',
                { key: 'ln', className: `dsh-diff-no ${r.kind === 'del' ? 'is-del' : ''}` },
                r.leftNo === undefined ? '' : r.leftNo,
              ),
              React.createElement(
                'span',
                { key: 'lc', className: `dsh-diff-code ${leftClass}` },
                r.left === undefined ? '' : r.left,
              ),
              React.createElement(
                'span',
                { key: 'rn', className: `dsh-diff-no ${r.kind === 'add' ? 'is-add' : ''}` },
                r.rightNo === undefined ? '' : r.rightNo,
              ),
              React.createElement(
                'span',
                { key: 'rc', className: `dsh-diff-code ${rightClass}` },
                r.right === undefined ? '' : r.right,
              ),
            ])
          }),
        ),
      ])
    }

    /** 「代码导航」页的侧边栏包装：把 params 里的 sessionId 传给 NavTab。 */
    function CodePanel(props) {
      const params = readParams(props, 'code')
      return React.createElement(NavTab, {
        sessionId: params.sessionId || '',
        path: params.path || '',
        line: params.line || 1,
      })
    }

    // ================================================================== 主题

    /** 主题持久化键（存在 localStorage，重启后保留）。 */
    const THEME_KEY = 'dsh-deliverable-menu:theme'

    /** 预设主题：accent 是主色，chatBg 是聊天气泡区背景。 */
    const THEME_PRESETS = [
      { id: 'sky', name: 'QQ 蓝', accent: '#12b7f5', chatBg: '#f2fbff' },
      { id: 'mint', name: '薄荷绿', accent: '#07c160', chatBg: '#f2fbf6' },
      { id: 'sakura', name: '樱粉', accent: '#ff7fa8', chatBg: '#fff5f8' },
      { id: 'amber', name: '暖橙', accent: '#ff9f2e', chatBg: '#fff9f0' },
      { id: 'dusk', name: '暗夜', accent: '#5b8def', chatBg: '#1f2430', dark: true },
      { id: 'mono', name: '极简灰', accent: '#4b5563', chatBg: '#f6f7f9' },
    ]

    /** 当前主题。 */
    let currentTheme = THEME_PRESETS[0]

    /** `ctx.theme` 服务（可选注入）：用来给整个 DSH 套 QQ 皮肤。 */
    let globalThemeApi = null
    /** 当前全局皮肤层的 disposer。 */
    let globalSkinDispose = null
    /** 是否已把皮肤应用到整个 DSH（持久化在 localStorage）。 */
    const GLOBAL_SKIN_KEY = 'dsh-deliverable-menu:global-skin'
    let globalSkinOn = false

    /**
     * QQ 皮肤 = 一组 DSH 设计 token 的覆盖层（不是改类名，升级也不会碎）。
     * 走 `ctx.theme.shade()`：基础主题不动，层叠在它上面，移除即还原。
     * @param {object} theme - { accent, chatBg?, dark? }
     */
    function qqTokens(theme) {
      const accent = (theme && theme.accent) || '#12b7f5'
      const dark = Boolean(theme && theme.dark)
      const pair = (light, darkValue) => ({ light, dark: darkValue || light })
      return {
        // 主色：按钮 / 链接 / 选中态 / 焦点环
        '--dsw-alias-brand-primary': pair(accent),
        '--dsw-alias-brand-text': pair(accent),
        '--dsw-alias-focus-ring-color': pair(accent),
        // 气泡：DSH 的 `.bubble{background:var(--dsw-specific-bubble)}` 就是自己发的
        '--dsw-specific-bubble': pair(accent),
        '--dsw-specific-bubble-highlight': pair('#ffffff', 'rgba(255,255,255,.08)'),
        // 页面 / 侧栏底色：QQ 那种淡青白
        '--dsw-alias-bg-base': pair('#f3f8fc', '#11141a'),
        '--dsw-alias-bg-layer-1': pair('#ffffff', '#181c24'),
        // 悬停 / 选中：用主色的淡版
        '--dsw-alias-interactive-bg-hover': pair('rgba(18,183,245,.10)', 'rgba(18,183,245,.16)'),
        // 圆角：QQ 比 DSH 默认更圆
        '--dsw-radius-lg': pair('14px'),
        '--dsw-radius-md': pair('10px'),
        '--dsw-radius-panel': pair('16px'),
      }
    }

    /** 全局皮肤样式表 id（挂在 head 上，关掉即移除）。 */
    const SKIN_STYLE_ID = 'dsh-deliverable-menu/skin.css'

    /** 粗略判断颜色深浅（用于自动选气泡上的文字颜色）。 */
    function isDarkColor(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
      if (!m) return false
      const n = parseInt(m[1], 16)
      const r = (n >> 16) & 255
      const g = (n >> 8) & 255
      const b = n & 255
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55
    }

    /**
     * 主题对象 → 完整配色（没给的颜色按主色/默认值派生）。
     * @param {object} theme
     */
    function skinPalette(theme) {
      const t = theme || {}
      const accent = t.accent || '#12b7f5'
      return {
        accent,
        bgBase: t.bgBase || '#e9f4fc',
        bgLayer: t.bgLayer || '#ffffff',
        bgLayer2: t.bgLayer2 || '#e3f0fb',
        // 侧栏底色：默认给明显一点的浅蓝（近白会被误认为"白块"）
        sidebar: t.sidebarFill || '#dceef9',
        bubbleIn: t.bubbleIn || '#ffffff',
        // 气泡色**不跟主题色联动**：默认给独立的 QQ 蓝，改主题色不会改气泡
        bubbleOut: t.bubbleOut || '#12b7f5',
        text: t.text || '',
        glass: Boolean(t.glass),
        gradient: Boolean(t.gradient),
        dark: Boolean(t.dark),
      }
    }

    /**
     * 生成"整个 DSH"的皮肤 CSS：直接覆盖 DSH 的设计 token。
     *
     * 为什么要自己写 CSS 而不是只调 `ctx.theme.shade()`：shade 依赖主题服务就绪
     * （服务缺失/时序不对就静默无效），而 token 本质就是 CSS 变量 —— 直接写
     * `:root, body` 一定能覆盖到所有读取 token 的组件。两条通道都上，覆盖面最大。
     * @param {object} theme - { accent }
     */
    function skinCss(theme) {
      const p = skinPalette(theme)
      const accent = p.accent
      const mk = (list) => list.map((decl) => `${decl} !important`).join(';')

      const light = mk([
        `--dsw-alias-brand-primary:${accent}`,
        `--dsw-alias-brand-text:${accent}`,
        `--dsw-alias-focus-ring-color:${accent}`,
        // 注意：DSH 的聊天气泡 = `.bubble{background:var(--dsw-specific-bubble)}`
        `--dsw-specific-bubble:${p.bubbleOut}`,
        // -highlight 聊天区没用到，留着给别的组件当强调底
        `--dsw-specific-bubble-highlight:${p.bubbleIn}`,
        `--dsw-alias-bg-base:${p.bgBase}`,
        `--dsw-alias-bg-layer-1:${p.bgLayer}`,
        `--dsw-alias-bg-layer-2:${p.bgLayer2}`,
        `--dsw-specific-sidebar-fill:${p.sidebar}`,
        '--dsw-alias-interactive-bg-hover:rgba(18,183,245,.10)',
        '--dsw-radius-lg:14px',
        '--dsw-radius-md:10px',
        '--dsw-radius-xl:18px',
        '--dsw-radius-panel:16px',
        ...(p.text ? [`--dsw-alias-label-primary:${p.text}`] : []),
      ])
      const dark = mk([
        `--dsw-alias-brand-primary:${accent}`,
        `--dsw-alias-brand-text:${accent}`,
        `--dsw-alias-focus-ring-color:${accent}`,
        `--dsw-specific-bubble:${p.bubbleOut}`,
        '--dsw-specific-bubble-highlight:rgba(255,255,255,.08)',
        '--dsw-alias-bg-base:#11141a',
        '--dsw-alias-bg-layer-1:#181c24',
        '--dsw-alias-bg-layer-2:#1d2230',
        '--dsw-specific-sidebar-fill:#161c26',
        '--dsw-alias-interactive-bg-hover:rgba(18,183,245,.16)',
        '--dsw-radius-lg:14px',
        '--dsw-radius-md:10px',
        '--dsw-radius-panel:16px',
      ])

      const rules = [`:root,body{${light}}`, `body[data-ds-dark-theme]{${dark}}`]

      // 渐变背景：整窗一层淡色斜向渐变（暗色用主色的深版）
      if (p.gradient) {
        rules.push(
          `body{background-image:linear-gradient(160deg,${accent}26 0%,transparent 42%),` +
            `linear-gradient(200deg,${p.bgBase} 0%,${p.bgLayer2} 100%) !important;background-attachment:fixed !important}`,
        )
        rules.push(`body[data-ds-dark-theme]{background-image:linear-gradient(160deg,${accent}2e 0%,transparent 46%) !important}`)
      }

      // 气泡：DSH 用 CSS Modules 类名 `xxx_bubble`，后缀稳定（哈希只在前缀）。
      // 直接上色 + 按亮度自动选文字色，保证深底白字、浅底深字。
      const bubbleBg = p.bubbleOut
      const bubbleFg = isDarkColor(bubbleBg) ? '#ffffff' : '#1f2937'
      rules.push(
        `[class*="_bubble"]:not([class*="dsh-"]){background:${bubbleBg} !important;` +
          `border-radius:18px !important;color:${bubbleFg} !important}`,
      )
      return rules.join('\n')
    }

    /**
     * 界面结构自检：把对话行的真实属性与关键 token 的值整理成一段文本。
     * 角色前缀如果猜错，靠这个一次性校正（复制到剪贴板 + 打到控制台）。
     * @returns {string} 报告文本
     */
    function inspectChatDom() {
      const lines = []
      if (typeof document === 'undefined') return 'no document'
      const rows = document.querySelectorAll ? document.querySelectorAll('[data-chat-node-key]') : []
      lines.push(`# 对话行（共 ${rows.length}）`)
      for (let i = 0; i < Math.min(rows.length, 12); i++) {
        const el = rows[i]
        lines.push(
          `${i + 1}. kind=${el.getAttribute('data-chat-flow-kind') || '-'} key=${el.getAttribute('data-chat-node-key') || '-'}`,
        )
      }
      const body = document.body
      if (body && window.getComputedStyle) {
        const cs = window.getComputedStyle(body)
        for (const token of ['--dsw-alias-brand-primary', '--dsw-specific-bubble', '--dsw-specific-bubble-highlight']) {
          lines.push(`${token}=${cs.getPropertyValue(token).trim() || '(空)'}`)
        }
      }
      const text = lines.join('\n')
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(text)
      } catch (_) {
        /* 忽略 */
      }
      console.info('[dsh-deliverable-menu] 界面结构：\n' + text)
      return text
    }

    /**
     * 强制整页重绘：样式表摘下来、强制一次同步布局、再挂回去。
     *
     * 为什么需要：`backdrop-filter` 会让元素独立成合成层。侧边栏收起时
     * Chromium 有时不会让那一层失效，于是原位置留下一块**纯白底板**
     * （控件还在、还能点，只是没被重画）。改 DOM/CSS 变量都救不了这种"陈旧图层"，
     * 只有摘掉样式表再挂回去能可靠地触发全量样式重算与重绘。
     */
    function forceRepaint() {
      if (typeof document === 'undefined' || !document.head) return
      const el = document.getElementById ? document.getElementById(SKIN_STYLE_ID) : null
      if (!el) return
      const css = el.textContent
      el.parentNode && el.parentNode.removeChild(el)
      // 读一次布局属性，强制同步 reflow
      void (document.body && document.body.offsetHeight)
      const again = document.createElement('style')
      again.id = SKIN_STYLE_ID
      again.dataset.plugin = 'dsh-deliverable-menu'
      again.dataset.pluginCss = 'skin'
      again.textContent = css
      document.head.appendChild(again)
    }

    /** 布局变化（侧栏开合、窗口缩放）时做一次去抖重绘。 */
    function watchLayoutForRepaint() {
      if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return
      if (typeof document === 'undefined' || !document.body) return
      let timer = 0
      const schedule = () => {
        if (!globalSkinOn) return
        window.clearTimeout(timer)
        // 侧栏开合有动画，等它停下来再重绘，否则会重绘到一半
        timer = window.setTimeout(() => forceRepaint(), 220)
      }
      try {
        const ro = new ResizeObserver(schedule)
        ro.observe(document.body)
      } catch (_) {
        /* 老内核退回窗口 resize */
      }
      window.addEventListener('resize', schedule)
    }

    /** 把皮肤样式表写进/移出 head。 */
    function applySkinStyle(on, theme) {
      if (typeof document === 'undefined' || !document.head) return false
      let el = document.getElementById ? document.getElementById(SKIN_STYLE_ID) : null
      if (!on) {
        if (el && el.parentNode) el.parentNode.removeChild(el)
        return false
      }
      if (!el) {
        el = document.createElement('style')
        el.id = SKIN_STYLE_ID
        el.dataset.plugin = 'dsh-deliverable-menu'
        el.dataset.pluginCss = 'skin'
        document.head.appendChild(el)
      }
      el.textContent = skinCss(theme)
      return true
    }

    /** 开/关全局 QQ 皮肤（样式表 + 尽力调用 ctx.theme.shade）。 */
    function setGlobalSkin(on, theme, persist) {
      const next = Boolean(on)
      if (persist !== false) {
        try {
          localStorage.setItem(GLOBAL_SKIN_KEY, next ? '1' : '0')
        } catch (_) {
          /* 忽略 */
        }
      }

      if (!next) {
        applySkinStyle(false)
        if (globalSkinDispose) {
          try {
            globalSkinDispose()
          } catch (_) {
            /* 忽略 */
          }
          globalSkinDispose = null
        }
        globalSkinOn = false
        return false
      }

      const styled = applySkinStyle(true, theme)
      // 辅通道：某些组件是从主题快照读 token 的，CSS 覆盖不到，shade 能补上
      if (globalThemeApi && typeof globalThemeApi.shade === 'function') {
        try {
          globalSkinDispose = globalThemeApi.shade('dsh-deliverable-menu', qqTokens(theme))
        } catch (err) {
          console.error('[dsh-deliverable-menu] ctx.theme.shade 失败（CSS 通道仍然生效）：', err)
        }
      }
      globalSkinOn = true
      return styled
    }

    /**
     * 启动时恢复全局皮肤开关。
     * 没存过偏好时**默认开启**（用户要的就是把主界面做成 QQ 主题），
     * 关掉之后记住 '0' 就不会再自动开。
     */
    function restoreGlobalSkin(theme) {
      let on = true
      try {
        const raw = localStorage.getItem(GLOBAL_SKIN_KEY)
        on = raw === null ? true : raw === '1'
      } catch (_) {
        on = true
      }
      if (on) setGlobalSkin(true, theme, false)
      else globalSkinOn = false
    }

    /** 主题 → CSS 变量表。 */
    function themeVars(theme) {
      const dark = Boolean(theme && theme.dark)
      const accent = (theme && theme.accent) || THEME_PRESETS[0].accent
      return {
        '--dshq-accent': accent,
        '--dshq-chat-bg': (theme && theme.chatBg) || '',
        // 发出的气泡用主色；收到的是浅底（暗色主题用半透明白）
        '--dshq-bubble-out': accent,
        '--dshq-bubble-in': dark ? 'rgba(255,255,255,.10)' : '#ffffff',
        '--dshq-chat-text': dark ? '#e8eaee' : '',
        '--dshq-chat-border': dark ? 'rgba(255,255,255,.14)' : 'rgba(15,23,42,.10)',
        '--dshq-on-accent': dark ? '#0f1218' : '#ffffff',
      }
    }

    /**
     * 应用主题（写 CSS 变量到 documentElement），可选持久化。
     * @param {object} theme - { accent, chatBg?, dark?, name?, id? }
     * @param {boolean} persist - 是否写入 localStorage
     */
    function applyTheme(theme, persist) {
      currentTheme = theme
      const root = typeof document !== 'undefined' ? document.documentElement : null
      const vars = themeVars(theme)
      if (root && root.style) {
        for (const key of Object.keys(vars)) {
          if (vars[key]) root.style.setProperty(key, vars[key])
          else root.style.removeProperty(key)
        }
        root.dataset.dshTheme = theme && theme.dark ? 'dark' : 'light'
      }
      if (persist) {
        try {
          localStorage.setItem(THEME_KEY, JSON.stringify(theme))
        } catch (_) {
          /* 隐私模式等场景忽略 */
        }
      }
    }

    /** 启动时恢复上次的主题。 */
    function restoreTheme() {
      let saved = null
      try {
        saved = JSON.parse(localStorage.getItem(THEME_KEY) || 'null')
      } catch (_) {
        saved = null
      }
      applyTheme(saved && saved.accent ? saved : THEME_PRESETS[0], false)
    }

    /** 字节数 → 人类可读（14.3 KB / 9.7 MB）。 */
    function formatBytes(bytes) {
      const n = Number(bytes) || 0
      if (n <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let v = n
      let i = 0
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i += 1
      }
      // 整数就省掉小数位（1 KB 而不是 1.0 KB），非整数保留一位（14.3 KB）
      // ≥100 取整，其余保留一位小数（14.3 KB / 9.7 MB），整数省掉 ".0"
      const text = (i === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1)).replace(/\.0+$/, '')
      return `${text} ${units[i]}`
    }

    /** 卡片左侧小方块的类型标记（颜色靠 data-k）。 */
    function fileChipMeta(entry) {
      if (!entry || entry.type === 'dir') return { kind: 'dir', label: '' }
      const name = String(entry.name || '')
      const dot = name.lastIndexOf('.')
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
      if (ext === 'md' || ext === 'markdown') return { kind: 'md', label: 'MD' }
      if (ext === 'exe' || ext === 'dll' || ext === 'msi' || ext === 'sys') return { kind: 'exe', label: ext.toUpperCase() }
      if (['json', 'yml', 'yaml', 'toml', 'ini', 'cfg'].includes(ext)) return { kind: 'json', label: ext.toUpperCase() }
      if (
        ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'sh', 'lua'].includes(
          ext,
        )
      ) {
        return { kind: 'code', label: ext.slice(0, 3).toUpperCase() }
      }
      return { kind: 'file', label: ext ? ext.slice(0, 2).toUpperCase() : 'F' }
    }

    /** git 状态字符 → 中文标签（卡片右上角小字用）。 */
    const TAIL_STATUS_LABEL = {
      M: '修改',
      A: '新增',
      '?': '未跟踪',
      D: '删除',
      R: '重命名',
      C: '复制',
      U: '冲突',
    }

    /**
     * 从 git 状态里挑出要在"回合结尾卡片"里展示的文件。
     * 目录条目（以 / 结尾或 untrackedDir）跳过，其余按路径排序后截断。
     * @param {Array} files - gitStatus 的 files
     * @param {number} [limit] - 最多几张卡
     * @returns {Array}
     */
    function tailChangedFiles(files, limit) {
      const max = limit || 4
      const list = (Array.isArray(files) ? files : [])
        .filter((f) => f && f.path && !f.untrackedDir && !String(f.path).endsWith('/'))
        .map((f) => ({
          path: f.path,
          name: String(f.path).split('/').pop(),
          status: String(f.status || 'M').trim().charAt(0) || 'M',
        }))
      list.sort((a, b) => a.path.localeCompare(b.path, 'zh', { sensitivity: 'base' }))
      return list.slice(0, max)
    }

    // ================================================================== Markdown

    /**
     * 行内格式：`code` / **粗** / *斜* / ~~删~~ / [文字](链接)。
     * @param {string} text - 行内原文
     * @param {string} keyBase - React key 前缀
     * @returns {Array}
     */
    function renderInline(text, keyBase) {
      const nodes = []
      const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)|(\[([^\]]+)\]\(([^)]+)\))/g
      let last = 0
      let m = re.exec(text)
      let n = 0
      while (m) {
        if (m.index > last) nodes.push(text.slice(last, m.index))
        if (m[1]) {
          nodes.push(React.createElement('code', { key: `${keyBase}-c${n++}`, className: 'dsh-md-ic' }, m[1].slice(1, -1)))
        } else if (m[2]) {
          nodes.push(React.createElement('strong', { key: `${keyBase}-b${n++}` }, m[2].slice(2, -2)))
        } else if (m[3]) {
          nodes.push(React.createElement('em', { key: `${keyBase}-i${n++}` }, m[3].slice(1, -1)))
        } else if (m[4]) {
          nodes.push(React.createElement('del', { key: `${keyBase}-d${n++}` }, m[4].slice(2, -2)))
        } else if (m[5]) {
          nodes.push(
            React.createElement(
              'a',
              {
                key: `${keyBase}-a${n++}`,
                className: 'dsh-md-link',
                href: m[7],
                title: m[7],
                onClick: (e) => e.preventDefault(),
              },
              m[6],
            ),
          )
        }
        last = m.index + m[0].length
        m = re.exec(text)
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /** 代码块：复用代码区的分词（同样的 VS Code Dark+ 配色）。 */
    function renderCodeBlock(code, lang, key) {
      const lines = tokenizeLines(code, lang || 'text', {})
      return React.createElement(
        'pre',
        { key, className: 'dsh-md-pre' },
        React.createElement(
          'code',
          { className: 'dsh-nav-code dsh-md-block' },
          lines.map((tokens, i) =>
            React.createElement(
              'div',
              { key: i, className: 'dsh-nav-line' },
              tokens.map((tk, ti) =>
                tk.c
                  ? React.createElement('span', { key: ti, className: `dsh-nav-${tk.c}` }, tk.t)
                  : tk.t,
              ),
            ),
          ),
        ),
      )
    }

    /**
     * 极简 Markdown → React 节点：标题 / 列表 / 引用 / 代码块 / 表格 / 分割线 / 段落。
     * 不支持 HTML 内联（安全，也避免把文档里的标签当代码渲染）。
     * @param {string} text - Markdown 原文
     * @returns {Array} 块级节点数组
     */
    function renderMarkdown(text) {
      const lines = String(text || '').split(/\r?\n/)
      const out = []
      let i = 0
      let seq = 0
      const key = (tag) => `md-${seq++}-${tag}`

      while (i < lines.length) {
        const line = lines[i]

        // 代码块
        const fence = /^\s*```(\w*)\s*$/.exec(line)
        if (fence) {
          const lang = fence[1] || ''
          const buf = []
          i += 1
          while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
            buf.push(lines[i])
            i += 1
          }
          i += 1
          out.push(renderCodeBlock(buf.join('\n'), lang, key('pre')))
          continue
        }

        // 标题
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
          const level = heading[1].length
          out.push(
            React.createElement(`h${level}`, { key: key('h'), className: `dsh-md-h dsh-md-h${level}` }, [
              ...renderInline(heading[2], key('hi')),
            ]),
          )
          i += 1
          continue
        }

        // 分割线
        if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
          out.push(React.createElement('hr', { key: key('hr'), className: 'dsh-md-hr' }))
          i += 1
          continue
        }

        // 引用
        if (/^\s*>\s?/.test(line)) {
          const buf = []
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            buf.push(lines[i].replace(/^\s*>\s?/, ''))
            i += 1
          }
          out.push(
            React.createElement(
              'blockquote',
              { key: key('bq'), className: 'dsh-md-quote' },
              renderInline(buf.join(' '), key('bqi')),
            ),
          )
          continue
        }

        // 列表（按缩进分层）
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const ordered = /^\s*\d+\./.test(line)
          const items = []
          while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
            const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])
            const indent = Math.floor((m[1] || '').length / 2)
            items.push(
              React.createElement(
                'li',
                { key: key('li'), className: indent > 0 ? 'dsh-md-li-nested' : undefined, style: indent > 0 ? { marginLeft: `${indent * 14}px` } : undefined },
                renderInline(m[3], key('lii')),
              ),
            )
            i += 1
          }
          out.push(
            React.createElement(ordered ? 'ol' : 'ul', { key: key('ul'), className: 'dsh-md-list' }, items),
          )
          continue
        }

        // 表格（需要下一行是分隔行）
        if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:-]*-[\s:|-]*\|/.test(lines[i + 1] || '')) {
          const cellsOf = (row) =>
            row
              .trim()
              .replace(/^\|/, '')
              .replace(/\|$/, '')
              .split('|')
              .map((c) => c.trim())
          const header = cellsOf(line)
          i += 2
          const body = []
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
            body.push(cellsOf(lines[i]))
            i += 1
          }
          out.push(
            React.createElement('table', { key: key('tb'), className: 'dsh-md-table' }, [
              React.createElement(
                'thead',
                { key: 'h' },
                React.createElement(
                  'tr',
                  null,
                  header.map((c, ci) =>
                    React.createElement('th', { key: ci }, renderInline(c, key('th'))),
                  ),
                ),
              ),
              React.createElement(
                'tbody',
                { key: 'b' },
                body.map((row, ri) =>
                  React.createElement(
                    'tr',
                    { key: ri },
                    row.map((c, ci) => React.createElement('td', { key: ci }, renderInline(c, key('td')))),
                  ),
                ),
              ),
            ]),
          )
          continue
        }

        // 空行
        if (!line.trim()) {
          i += 1
          continue
        }

        // 段落：吃到空行或下一个块起始
        const buf = [line]
        i += 1
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^\s*(```|#{1,6}\s|>|\||([-*+]|\d+\.)\s)/.test(lines[i])
        ) {
          buf.push(lines[i])
          i += 1
        }
        out.push(
          React.createElement('p', { key: key('p'), className: 'dsh-md-p' }, renderInline(buf.join(' '), key('pi'))),
        )
      }
      return out
    }

    // ================================================================== 侧边会话

    /** 从事件负载里递归收集文本片段（兼容 {type:'text',text} 的各种嵌套）。 */
    function extractText(value, depth) {
      if (depth > 6 || value == null) return ''
      if (typeof value === 'string') return ''
      if (Array.isArray(value)) return value.map((v) => extractText(v, depth + 1)).join('')
      if (typeof value !== 'object') return ''
      if (value.type === 'text' && typeof value.text === 'string') return value.text
      let out = ''
      for (const key of Object.keys(value)) out += extractText(value[key], depth + 1)
      return out
    }

    /** 事件窗口 → [{id, role, text}]（只取 user / assistant 的文本，工具调用忽略）。 */
    function messagesFromSource(source) {
      const snap = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null
      const entries = (snap && snap.entries) || []
      const out = []
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const event = entry && entry.event
        const type = event && typeof event.type === 'string' ? event.type : ''
        if (!/assistant|user/.test(type)) continue
        const text = extractText(event.data, 0).trim()
        if (!text) continue
        const role = /user/.test(type) ? 'user' : 'assistant'
        const id = event.seq !== undefined ? `${event.seq}:${i}` : String(i)
        const prev = out[out.length - 1]
        // 流式片段：连续同角色且都是 transient 的合并成一个气泡
        if (prev && prev.role === role && entry.type === 'transient' && prev.transient) {
          prev.text += text
          continue
        }
        out.push({ id, role, text, transient: entry.type === 'transient' })
      }
      return out
    }

    /** 主题色块 + 自定义取色（QQ 那种一排色块）。 */
    function ThemeSwatch(props) {
      const { theme, active, onPick } = props
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dshq-swatch',
          'data-active': active ? '1' : undefined,
          title: theme.name,
          style: { background: theme.accent },
          onClick: () => onPick(theme),
        },
        active ? '✓' : '',
      )
    }

    /** 主题入口：预设色块 + 自定义（主色 / 聊天背景）+ 恢复默认。 */
    function ThemeButton() {
      const [open, setOpen] = React.useState(false)
      const [theme, setTheme] = React.useState(currentTheme || THEME_PRESETS[0])
      const [skinHint, setSkinHint] = React.useState('')

      const pick = (next) => {
        applyTheme(next, true)
        setTheme(next)
        // 全局皮肤跟着换色（shade 同 source 会替换整层）
        if (globalSkinOn) setGlobalSkin(true, next, false)
      }

      const panel = open
        ? React.createElement('div', { key: 'p', className: 'dshq-theme-panel' }, [
            React.createElement(
              'div',
              { key: 'st', className: 'dshq-status', 'data-on': globalSkinOn ? '1' : undefined },
              globalSkinOn ? '● 整个 DSH 正在使用这套主题' : '○ 整个 DSH 未套用主题（下面勾选开启）',
            ),
            React.createElement('div', { key: 'h', className: 'dshq-theme-title' }, '主题色'),
            React.createElement(
              'div',
              { key: 'sw', className: 'dshq-swatches' },
              THEME_PRESETS.map((preset) =>
                React.createElement(ThemeSwatch, {
                  key: preset.id,
                  theme: preset,
                  active: theme && theme.accent === preset.accent,
                  onPick: pick,
                }),
              ),
            ),
            React.createElement(
              'label',
              { key: 'g', className: 'dshq-switch' },
              [
                React.createElement('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: globalSkinOn,
                  onChange: (e) => {
                    const on = setGlobalSkin(e.target.checked, theme, true)
                    setTheme({ ...theme })
                    if (e.target.checked && !on) {
                      setSkinHint('样式表注入失败（没有 document.head），无法应用')
                    } else if (e.target.checked && !globalSkinDispose) {
                      setSkinHint('已用 CSS 覆盖 token 生效；ctx.theme 不可用，快照类组件可能仍是原色')
                    } else {
                      setSkinHint('')
                    }
                  },
                }),
                React.createElement('span', { key: 't' }, 'QQ 主题应用到整个 DSH（主窗口 / 对话框 / 侧栏，立即生效）'),
              ],
            ),
            skinHint
              ? React.createElement('div', { key: 'gh', className: 'dshq-hint' }, skinHint)
              : null,
            React.createElement(
              'button',
              {
                key: 'insp',
                type: 'button',
                className: 'dsh-nav-btn',
                style: { marginBottom: '8px', alignSelf: 'flex-start' },
                title: '复制对话区的 DOM 属性（气泡样式没生效时用它校正）',
                onClick: () => {
                  const text = inspectChatDom()
                  setSkinHint(text.split('\n').slice(0, 4).join(' · '))
                },
              },
              '复制界面结构（排查用）',
            ),
            React.createElement('div', { key: 'h2', className: 'dshq-theme-title' }, '整窗配色（自定义）'),
            React.createElement(
              'div',
              { key: 'c', className: 'dshq-palette' },
              [
                ['accent', '主题色', '#12b7f5'],
                ['bgBase', '页面底色', '#f3f8fc'],
                ['bgLayer', '面板底', '#ffffff'],
                ['sidebarFill', '侧栏底色', '#dceef9'],
                ['bubbleOut', '我的气泡', '#12b7f5'],
                ['bubbleIn', '对方气泡', '#ffffff'],
                ['chatBg', '聊天背景', '#f2fbff'],
                ['text', '正文颜色', '#1f2937'],
              ].map(([key, label, fallback]) =>
                React.createElement('label', { key, className: 'dshq-field' }, [
                  React.createElement(
                    'input',
                    {
                      key: 'i',
                      type: 'color',
                      value: (theme && theme[key]) || fallback,
                      onChange: (e) => pick({ ...theme, id: 'custom', name: '自定义', [key]: e.target.value }),
                    },
                  ),
                  React.createElement('span', { key: 't' }, label),
                ]),
              ),
            ),
            React.createElement('div', { key: 'h3', className: 'dshq-theme-title' }, '效果'),
            React.createElement(
              'label',
              { key: 'grad', className: 'dshq-switch' },
              [
                React.createElement('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: Boolean(theme && theme.gradient),
                  onChange: (e) => pick({ ...theme, id: 'custom', name: '自定义', gradient: e.target.checked }),
                }),
                React.createElement('span', { key: 't' }, '渐变背景（整窗斜向渐变）'),
              ],
            ),
            React.createElement(
              'button',
              {
                key: 'r',
                type: 'button',
                className: 'dsh-nav-btn',
                style: { alignSelf: 'flex-start', marginTop: '4px' },
                onClick: () => pick(THEME_PRESETS[0]),
              },
              '恢复默认',
            ),
          ])
        : null

      return React.createElement('div', { className: 'dshq-theme' }, [
        React.createElement(
          'button',
          {
            key: 'b',
            type: 'button',
            className: 'dshq-theme-btn',
            title: '主题（预设 / 自定义）',
            onClick: () => setOpen(!open),
          },
          React.createElement('span', {
            key: 'dot',
            className: 'dshq-theme-dot',
            style: { background: (theme && theme.accent) || '#12b7f5' },
          }),
          '主题',
        ),
        panel,
      ])
    }

    /**
     * 「侧边会话」视图：从当前会话 fork 一个继承完整上下文的新会话，
     * 在右侧栏里独立对话，不污染主对话。
     */
    function SideChatPanel(props) {
      const params = readParams(props, 'side')
      const sessionId = params.sessionId || (props && props.sessionId) || ''
      const remote = sidebarDeps.remote
      const sessions = sidebarDeps.sessions

      const [sideId, setSideId] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [error, setError] = React.useState('')
      const [messages, setMessages] = React.useState([])
      const [input, setInput] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [running, setRunning] = React.useState(false)
      const sessionRef = React.useRef(null)

      /** 挂到 fork 出来的会话上：open + 订阅事件窗口。 */
      const attach = React.useCallback(
        (id) => {
          if (!sessions || typeof sessions.get !== 'function') return
          const sess = sessions.get(id)
          if (!sess) {
            setError(`拿不到会话对象（${id}）`)
            return
          }
          sessionRef.current = sess
          try {
            sess.open()
          } catch (_) {
            /* 已打开会抛，忽略 */
          }
          const source = sess.eventSource
          const read = () => {
            setMessages(messagesFromSource(source))
            const snap = typeof sess.getSnapshot === 'function' ? sess.getSnapshot() : null
            if (snap) {
              setRunning(Boolean(snap.running))
              if (snap.blank) setStatus('新分支还没有消息')
              else if (snap.running) setStatus('分支会话正在回答…')
              else setStatus('分支会话已就绪')
              if (snap.lastAgentError) setError(String(snap.lastAgentError))
            }
          }
          read()
          if (source && typeof source.subscribe === 'function') {
            try {
              source.subscribe(read)
            } catch (_) {
              /* 订阅失败就靠轮询 */
            }
          }
        },
        [sessions],
      )

      // 轮询兜底（订阅不可用 / 漏事件）
      React.useEffect(() => {
        if (!sideId) return undefined
        const timer = window.setInterval(() => {
          const sess = sessionRef.current
          if (sess && sess.eventSource) {
            setMessages(messagesFromSource(sess.eventSource))
            const snap = typeof sess.getSnapshot === 'function' ? sess.getSnapshot() : null
            if (snap) setRunning(Boolean(snap.running))
          }
        }, 900)
        return () => window.clearInterval(timer)
      }, [sideId])

      /** 从当前会话开一个分支（继承完整上下文）。 */
      const forkNow = React.useCallback(async () => {
        if (!remote || !remote.session) {
          setError('拿不到 session 远程接口（ctx.remote.session）')
          return
        }
        if (!sessionId) {
          setError('没有会话上下文')
          return
        }
        setBusy(true)
        setError('')
        setStatus('正在从当前会话创建分支…')
        try {
          const res = await remote.session.fork({ sessionId })
          const id = (res && (res.sessionId || res.id || res.session)) || ''
          if (!id) {
            setError(`fork 返回里没有会话 id：${JSON.stringify(res)}`)
            setStatus('')
            return
          }
          setSideId(id)
          attach(id)
          setStatus('分支已创建（已继承当前对话的完整上下文）')
        } catch (err) {
          setError(String((err && err.message) || err))
          setStatus('')
        } finally {
          setBusy(false)
        }
      }, [remote, sessionId, attach])

      /** 发送到分支会话。 */
      const send = React.useCallback(async () => {
        const text = input.trim()
        if (!text || !sideId || busy) return
        if (!remote || !remote.session) {
          setError('拿不到 session 远程接口')
          return
        }
        setBusy(true)
        setError('')
        setInput('')
        try {
          await remote.session.prompt({
            sessionId: sideId,
            content: [{ type: 'text', text }],
          })
          setRunning(true)
          setStatus('已发送，等待回答…')
        } catch (err) {
          setError(String((err && err.message) || err))
          setInput(text)
        } finally {
          setBusy(false)
        }
      }, [input, sideId, busy, remote])

      /** 停止分支会话。 */
      const stop = React.useCallback(async () => {
        const sess = sessionRef.current
        try {
          if (sess && typeof sess.cancel === 'function') await sess.cancel()
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }, [])

      if (!remote || !sessions) {
        return React.createElement(
          'div',
          { className: 'dsh-side' },
          React.createElement(
            'div',
            { className: 'dsh-git-empty' },
            '当前环境不支持侧边会话（缺少 remote / sessions 服务）',
          ),
        )
      }

      const head = React.createElement('div', { key: 'head', className: 'dsh-side-head' }, [
        React.createElement(
          'span',
          { key: 't', className: 'dsh-side-title' },
          sideId ? `分支会话 · ${sideId.slice(0, 8)}` : '侧边会话（继承当前上下文）',
        ),
        running
          ? React.createElement(
              'button',
              { key: 'stop', type: 'button', className: 'dsh-git-btn', 'data-quiet': '1', title: '停止', onClick: stop },
              '停止',
            )
          : null,
        React.createElement(
          'button',
          {
            key: 'fork',
            type: 'button',
            className: 'dsh-git-btn',
            'data-quiet': '1',
            disabled: busy,
            title: sideId ? '再开一个分支' : '从当前会话创建分支',
            onClick: forkNow,
          },
          sideId ? '新分支' : '开始',
        ),
      ])

      const list = React.createElement(
        'div',
        { key: 'list', className: 'dsh-side-list' },
        messages.length === 0
          ? React.createElement(
              'div',
              { className: 'dsh-git-empty' },
              sideId
                ? '（这个分支还没有自己的消息，继承的上下文在模型侧）'
                : '点右上「开始」：会从当前对话 fork 一个继承完整上下文的新会话，然后在下面提问。',
            )
          : messages.map((m) =>
              React.createElement(
                'div',
                { key: m.id, className: `dsh-side-msg is-${m.role}` },
                [
                  React.createElement('div', { key: 'r', className: 'dsh-side-role' }, m.role === 'user' ? '你' : '助理'),
                  React.createElement('div', { key: 'b', className: 'dsh-side-bubble' }, m.text),
                ],
              ),
            ),
      )

      const composer = React.createElement('div', { key: 'composer', className: 'dsh-side-composer' }, [
        React.createElement('textarea', {
          key: 'ta',
          className: 'dsh-side-input',
          value: input,
          rows: 2,
          placeholder: sideId ? '在分支会话里提问（Enter 发送，Shift+Enter 换行）' : '先点「开始」创建分支',
          disabled: !sideId || busy,
          onChange: (e) => setInput(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          },
        }),
        React.createElement(
          'button',
          {
            key: 's',
            type: 'button',
            className: 'dsh-git-btn',
            disabled: !sideId || busy || !input.trim(),
            onClick: send,
          },
          '发送',
        ),
      ])

      return React.createElement('div', { className: 'dsh-side' }, [
        head,
        error
          ? React.createElement('div', { key: 'e', className: 'dsh-nav-status', 'data-error': '1' }, error)
          : status
            ? React.createElement('div', { key: 's', className: 'dsh-nav-status' }, status)
            : null,
        list,
        composer,
      ])
    }

    function joinPath(dir, name) {
      return dir ? `${dir}/${name}` : name
    }

    /**
     * 「文件」页：懒加载目录树 + 新建文件/文件夹 + Git 状态着色。
     * 点文件 → 在「代码导航」页打开（同一栏内切页），点目录 → 展开/收起。
     */
    function FilesPanel(props) {
      const params = readParams(props, 'files')
      const sessionId = params.sessionId || (props && props.sessionId) || ''
      const reloadKey = (props && props.reloadKey) || 0
      const onSearch = (props && props.onSearch) || null
      const [entries, setEntries] = React.useState([])
      const [expanded, setExpanded] = React.useState({})
      const [root, setRoot] = React.useState('')
      const [error, setError] = React.useState('')
      const [want, setWant] = React.useState(null) // { dir, kind:'file'|'dir' }
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [selectedDir, setSelectedDir] = React.useState('')
      const [runOut, setRunOut] = React.useState(null)
      const [total, setTotal] = React.useState(0)
      const [truncated, setTruncated] = React.useState(false)
      const expandedRef = React.useRef(expanded)
      expandedRef.current = expanded
      const inputRef = React.useRef(null)

      const load = React.useCallback(
        async (dir) => {
          const data = await callApi('tree', { path: dir || '' }, sessionId)
          if (!data || !data.ok) {
            setError((data && data.error) || '读取目录失败')
            return { entries: [], total: 0, truncated: false }
          }
          if (data.root) setRoot(data.root)
          return { entries: data.entries || [], total: data.total || 0, truncated: Boolean(data.truncated) }
        },
        [sessionId],
      )

      const refresh = React.useCallback(async () => {
        if (!sessionId) {
          setError('没有会话上下文')
          return
        }
        // 目录一次性并行读，别一个个 await（每个 readdir 都是一次 IPC）
        const dirs = Object.keys(expandedRef.current)
        const [rootList, ...rest] = await Promise.all([load(''), ...dirs.map((dir) => load(dir))])
        setEntries(rootList.entries)
        setTotal(rootList.total)
        setTruncated(rootList.truncated)
        const next = {}
        dirs.forEach((dir, i) => {
          next[dir] = rest[i].entries
        })
        setExpanded(next)
        setError('')
      }, [sessionId, load])

      // Git 着色直接用 SourcePanel 已经轮询到的 status，这里不再单独跑 git
      const status = props && props.status
      const gitMap = React.useMemo(() => {
        const map = {}
        for (const f of (status && status.files) || []) {
          map[f.path] = f.x === '?' ? 'U' : f.y !== ' ' ? f.y : f.x
        }
        return map
      }, [status])

      React.useEffect(() => {
        refresh()
      }, [refresh, reloadKey])

      const openPath = (path) => openCodeTab(sessionId, path, 1)

      const toggle = async (entry) => {
        if (entry.type !== 'dir') {
          openPath(entry.path)
          return
        }
        setSelectedDir(entry.path)
        if (expanded[entry.path]) {
          const next = { ...expanded }
          delete next[entry.path]
          setExpanded(next)
          return
        }
        setBusy(true)
        const kids = await load(entry.path)
        setBusy(false)
        setExpanded({ ...expanded, [entry.path]: kids.entries })
      }

      const startCreate = async (dir, kind) => {
        const target = dir || ''
        if (target && !expanded[target]) {
          const kids = await load(target)
          setExpanded({ ...expanded, [target]: kids.entries })
        }
        setWant({ dir: target, kind })
        setDraft('')
        window.setTimeout(() => {
          if (inputRef.current) inputRef.current.focus()
        }, 30)
      }

      /** 双击语义：交给系统启动（GUI 自己开窗口，控制台自己弹控制台）。 */
      const launchEntry = async (entry) => {
        setRunOut({ path: entry.path, command: entry.path, running: true })
        const data = await callApi('launch', { path: entry.path }, sessionId)
        setRunOut({ ...(data || {}), path: entry.path, running: false, launched: Boolean(data && data.ok) })
      }

      /** 捕获语义：当控制台程序跑，把 stdout/stderr 收进浮层。 */
      const runEntry = async (entry) => {
        setRunOut({ path: entry.path, command: entry.path, running: true })
        const data = await callApi('run', { path: entry.path }, sessionId)
        setRunOut({ ...(data || {}), path: entry.path, running: false })
      }

      const revealEntry = async (entry) => {
        const data = await callApi('reveal', { path: entry.path }, sessionId)
        if (!data || !data.ok) setError((data && data.error) || '打开资源管理器失败')
      }

      const copyPath = (entry) => {
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(entry.path)
        } catch (_) {
          /* 忽略 */
        }
      }

      /** 行右键：文件 → 打开/运行/定位；目录 → 新建/定位。 */
      const openRowMenu = (e, entry) => {
        e.preventDefault()
        e.stopPropagation()
        const items = []
        if (entry.type === 'file') {
          items.push({ label: '打开', hint: '代码导航', onClick: () => openPath(entry.path) })
          const ext = (entry.name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
          if (!entry.runnable) {
            items.push({
              label: '运行',
              hint: ext ? `不支持 ${ext}` : '不支持该文件',
              disabled: true,
            })
          } else if (COMPILE_EXTS.includes(ext)) {
            items.push({ label: '编译并运行', hint: '显示编译与运行输出', onClick: () => runEntry(entry) })
          } else {
            items.push({ label: '运行', hint: '同双击', onClick: () => launchEntry(entry) })
            if (CAPTURE_EXTS.includes(ext)) {
              items.push({ label: '运行并查看输出', onClick: () => runEntry(entry) })
            }
          }
          items.push({ separator: true })
          items.push({ label: '在资源管理器中显示', onClick: () => revealEntry(entry) })
          items.push({ label: '复制相对路径', onClick: () => copyPath(entry) })
        } else {
          items.push({ label: '新建文件', onClick: () => startCreate(entry.path, 'file') })
          items.push({ label: '新建文件夹', onClick: () => startCreate(entry.path, 'dir') })
          items.push({ separator: true })
          items.push({ label: '在资源管理器中打开', onClick: () => revealEntry(entry) })
          items.push({ label: '刷新', onClick: () => refresh() })
        }
        showContextMenu({ x: e.clientX, y: e.clientY, title: { text: entry.name, title: entry.path }, items })
      }

      /** 空白处右键：在根目录新建。 */
      const openBlankMenu = (e) => {
        e.preventDefault()
        showContextMenu({
          x: e.clientX,
          y: e.clientY,
          title: { text: root || '工作区', title: root },
          items: [
            { label: '新建文件', onClick: () => startCreate('', 'file') },
            { label: '新建文件夹', onClick: () => startCreate('', 'dir') },
            { separator: true },
            { label: '刷新', onClick: () => refresh() },
          ],
        })
      }

      const commitCreate = async () => {
        if (!want) return
        const name = draft.trim().replace(/^[\\/]+|[\\/]+$/g, '')
        if (!name) {
          setWant(null)
          return
        }
        setBusy(true)
        const data = await callApi(want.kind === 'dir' ? 'mkdir' : 'newFile', { path: joinPath(want.dir, name) }, sessionId)
        setBusy(false)
        if (!data || !data.ok) {
          setError((data && data.error) || '创建失败')
          return
        }
        setError('')
        setWant(null)
        setDraft('')
        await refresh()
        if (want.kind === 'file') openPath(data.path)
      }

      const inputRow = (dir, depth) =>
        React.createElement('input', {
          key: `new:${dir}`,
          ref: inputRef,
          className: 'dsh-file-input',
          style: { marginLeft: `${10 + depth * 12}px` },
          value: draft,
          placeholder: want && want.kind === 'dir' ? '新文件夹名…' : '新文件名…',
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitCreate()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setWant(null)
              setDraft('')
            }
          },
        })

      // 列表 / 卡片 两种浏览方式（卡片视图只铺当前这一层）
      const [fileView, setFileView] = React.useState('list')

      const renderCards = (list) =>
        React.createElement(
          'div',
          { className: 'dsh-cards' },
          list.map((entry) => {
            const chip = fileChipMeta(entry)
            return React.createElement(
              'div',
              {
                key: entry.path,
                className: 'dsh-card',
                title: entry.path,
                onClick: () => toggle(entry),
                onContextMenu: (ev) => openRowMenu(ev, entry),
              },
              [
                React.createElement(
                  'span',
                  { key: 'c', className: 'dsh-card-chip', 'data-k': chip.kind },
                  chip.kind === 'dir' ? icon('folder', 15) : chip.label,
                ),
                React.createElement('span', { key: 't', className: 'dsh-card-text' }, [
                  React.createElement('span', { key: 'n', className: 'dsh-card-name' }, entry.name),
                  React.createElement(
                    'span',
                    { key: 'm', className: 'dsh-card-meta' },
                    entry.type === 'dir' ? '文件夹' : formatBytes(entry.size),
                  ),
                ]),
                React.createElement('span', { key: 'o', className: 'dsh-card-open' }, icon('external', 13)),
              ],
            )
          }),
        )

      const renderList = (list, depth, dirPath) => {
        const rows = []
        if (want && want.dir === dirPath) rows.push(inputRow(dirPath, depth))
        for (const entry of list) {
          const mark = gitMap[entry.path]
          rows.push(
            React.createElement(
              'div',
              {
                key: entry.path,
                className: 'dsh-file-row',
                style: { paddingLeft: `${6 + depth * 12}px` },
                title: entry.path,
                onClick: () => toggle(entry),
                onContextMenu: (ev) => openRowMenu(ev, entry),
              },
              [
                React.createElement(
                  'span',
                  { key: 'c', className: 'dsh-file-caret' },
                  entry.type === 'dir' ? (expanded[entry.path] ? '\u25BE' : '\u25B8') : '',
                ),
                React.createElement(
                  'span',
                  { key: 'g', className: 'dsh-file-icon' },
                  React.createElement(FileGlyph, { entry, expanded: Boolean(expanded[entry.path]) }),
                ),
                React.createElement('span', { key: 'n', className: 'dsh-file-name' }, entry.name),
                mark ? React.createElement('span', { key: 'm', className: 'dsh-file-mark', 'data-k': mark }, mark) : null,
              ],
            ),
          )
          if (entry.type === 'dir' && expanded[entry.path]) {
            rows.push(...renderList(expanded[entry.path] || [], depth + 1, entry.path))
          }
        }
        return rows
      }

      const rootDir = selectedDir || ''
      return React.createElement('div', { className: 'dsh-files' }, [
        React.createElement('div', { key: 'head', className: 'dsh-files-head' }, [
          React.createElement('span', { key: 'r', className: 'dsh-files-root', title: root }, root || '工作区'),
          onSearch
            ? React.createElement(
                'button',
                { key: 'se', type: 'button', className: 'dsh-nav-btn', title: '在工作区中搜索', onClick: onSearch },
                icon('search', 14),
              )
            : null,
          React.createElement(
            'button',
            { key: 'nf', type: 'button', className: 'dsh-nav-btn', title: '新建文件', onClick: () => startCreate(rootDir, 'file') },
            icon('filePlus', 14),
          ),
          React.createElement(
            'button',
            { key: 'nd', type: 'button', className: 'dsh-nav-btn', title: '新建文件夹', onClick: () => startCreate(rootDir, 'dir') },
            icon('folderPlus', 14),
          ),
          React.createElement(
            'button',
            {
              key: 'vl',
              type: 'button',
              className: 'dsh-nav-btn',
              title: '列表视图',
              'aria-pressed': fileView === 'list' || undefined,
              onClick: () => setFileView('list'),
            },
            icon('list', 14),
          ),
          React.createElement(
            'button',
            {
              key: 'vc',
              type: 'button',
              className: 'dsh-nav-btn',
              title: '卡片视图',
              'aria-pressed': fileView === 'cards' || undefined,
              onClick: () => setFileView('cards'),
            },
            icon('grid', 14),
          ),
          React.createElement(
            'button',
            { key: 'rf', type: 'button', className: 'dsh-nav-btn', title: '刷新', onClick: refresh },
            icon('refresh', 14),
          ),
        ]),
        error
          ? React.createElement('div', { key: 'e', className: 'dsh-nav-status', 'data-error': '1' }, error)
          : busy
            ? React.createElement('div', { key: 'b', className: 'dsh-nav-status' }, '处理中…')
            : null,
        React.createElement(
          'div',
          { key: 'body', className: 'dsh-files-body', onContextMenu: openBlankMenu },
          entries.length === 0
            ? React.createElement('div', { className: 'dsh-git-empty' }, '目录为空（或被全部跳过）')
            : fileView === 'cards'
              ? renderCards(entries)
              : renderList(entries, 0, ''),
          truncated
            ? React.createElement(
                'div',
                { key: 'trunc', className: 'dsh-git-more' },
                `本目录共 ${total} 项，仅显示前 ${entries.length} 项`,
              )
            : null,
        ),
        runOut
          ? React.createElement('div', { key: 'run', className: 'dsh-run' }, [
              React.createElement('div', { key: 'h', className: 'dsh-run-head' }, [
                React.createElement(
                  'span',
                  { key: 't', className: 'dsh-run-title' },
                  runOut.running
                    ? '运行中…'
                    : runOut.launched
                      ? '已启动（双击方式）'
                      : runOut.error
                        ? '运行失败'
                        : runOut.ok
                          ? '运行完成'
                          : `运行结束（退出码 ${runOut.code}）`,
                ),
                React.createElement(
                  'span',
                  { key: 'c', className: 'dsh-run-cmd', title: runOut.command || runOut.path || '' },
                  runOut.command || runOut.path || '',
                ),
                React.createElement(
                  'button',
                  { key: 'x', type: 'button', className: 'dsh-nav-btn', title: '关闭', onClick: () => setRunOut(null) },
                  '×',
                ),
              ]),
              React.createElement(
                'pre',
                { key: 'b', className: 'dsh-run-body' },
                runOut.running
                  ? '…'
                  : runOut.launched
                    ? '已交给系统启动（与双击一致）：GUI 程序会自己开窗口，控制台程序会自己弹控制台。\n输出不在这个浮层里 —— 想抓输出请用「运行并查看输出」。'
                    : [runOut.stdout, runOut.stderr, runOut.error].filter(Boolean).join('\n') || '（无输出）',
              ),
            ])
          : null,
      ])
    }

    /**
     * 「查找」页：跨文件文本搜索（普通串 / 正则、区分大小写），按文件分组。
     * 点命中 → 在「代码导航」页打开对应行。
     */
    function SearchPanel(props) {
      const params = readParams(props, 'search')
      const sessionId = params.sessionId || (props && props.sessionId) || ''
      const [query, setQuery] = React.useState('')
      const [regex, setRegex] = React.useState(false)
      const [caseSensitive, setCaseSensitive] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const timer = React.useRef(0)
      const [collapsed, setCollapsed] = React.useState({})

      React.useEffect(() => {
        window.clearTimeout(timer.current)
        const q = query.trim()
        if (!q) {
          setResult(null)
          setError('')
          return undefined
        }
        timer.current = window.setTimeout(async () => {
          setBusy(true)
          const data = await callApi('search', { query: q, regex, caseSensitive, maxResults: 300 }, sessionId)
          setBusy(false)
          if (!data || !data.ok) {
            setError((data && data.error) || '搜索失败')
            setResult(null)
            return
          }
          setError('')
          setResult(data)
          setCollapsed({})
        }, 320)
        return () => window.clearTimeout(timer.current)
      }, [query, regex, caseSensitive, sessionId])

      const groups = React.useMemo(() => {
        const map = new Map()
        for (const m of (result && result.matches) || []) {
          if (!map.has(m.path)) map.set(m.path, [])
          map.get(m.path).push(m)
        }
        return [...map.entries()]
      }, [result])

      const hitText = (m) => {
        const text = m.text || ''
        const col = Math.max(1, m.col || 1) - 1
        const len = Math.max(1, m.len || 1)
        const before = text.slice(0, col)
        const mid = text.slice(col, col + len)
        const after = text.slice(col + len)
        return [
          React.createElement('span', { key: 'b' }, before),
          React.createElement('mark', { key: 'm' }, mid),
          React.createElement('span', { key: 'a' }, after),
        ]
      }

      return React.createElement('div', { className: 'dsh-search' }, [
        React.createElement('div', { key: 'bar', className: 'dsh-search-bar' }, [
          React.createElement('input', {
            key: 'q',
            className: 'dsh-search-input',
            value: query,
            placeholder: '在工作区中查找…',
            onChange: (e) => setQuery(e.target.value),
          }),
          React.createElement(
            'button',
            {
              key: 'cs',
              type: 'button',
              className: 'dsh-search-opt',
              'aria-pressed': caseSensitive ? 'true' : 'false',
              title: '区分大小写',
              onClick: () => setCaseSensitive(!caseSensitive),
            },
            'Aa',
          ),
          React.createElement(
            'button',
            {
              key: 're',
              type: 'button',
              className: 'dsh-search-opt',
              'aria-pressed': regex ? 'true' : 'false',
              title: '正则表达式',
              onClick: () => setRegex(!regex),
            },
            '.*',
          ),
        ]),
        error
          ? React.createElement('div', { key: 'e', className: 'dsh-nav-status', 'data-error': '1' }, error)
          : busy
            ? React.createElement('div', { key: 'b', className: 'dsh-nav-status' }, '搜索中…')
            : result
              ? React.createElement(
                  'div',
                  { key: 's', className: 'dsh-nav-status' },
                  `${result.matches.length} 处命中 · 扫描 ${result.scanned} 个文件${result.truncated ? '（已截断）' : ''}`,
                )
              : null,
        React.createElement(
          'div',
          { key: 'body', className: 'dsh-search-body' },
          !result
            ? React.createElement('div', { className: 'dsh-git-empty' }, query.trim() ? '没有结果' : '输入关键字开始查找；支持 Aa 大小写与 .* 正则')
            : groups.length === 0
              ? React.createElement('div', { className: 'dsh-git-empty' }, '没有匹配')
              : groups.map(([path, hits]) =>
                  React.createElement('div', { key: path }, [
                    React.createElement(
                      'div',
                      {
                        key: 'h',
                        className: 'dsh-search-file',
                        title: path,
                        onClick: () => setCollapsed({ ...collapsed, [path]: !collapsed[path] }),
                      },
                      [
                        React.createElement('span', { key: 'c' }, collapsed[path] ? '\u25B8' : '\u25BE'),
                        React.createElement('span', { key: 'p' }, path),
                        React.createElement('span', { key: 'n', className: 'dsh-search-count' }, String(hits.length)),
                      ],
                    ),
                    ...(collapsed[path]
                      ? []
                      : hits.map((m, i) =>
                          React.createElement(
                            'div',
                            {
                              key: `${m.line}:${i}`,
                              className: 'dsh-search-hit',
                              title: `${m.path}:${m.line}`,
                              onClick: () => openCodeTab(sessionId, m.path, m.line),
                            },
                            [
                              React.createElement('span', { key: 'n', className: 'dsh-search-ln' }, m.line),
                              React.createElement('span', { key: 't', className: 'dsh-search-text' }, hitText(m)),
                            ],
                          ),
                        )),
                  ]),
                ),
        ),
      ])
    }

    // ------------------------------------------------------------------ 插件

    /**
     * 必须在这里声明要用的服务：Cordis 只给 inject 里列出的服务挂 ctx 属性，
     * 没声明时 `ctx.sidebarRight` 是 undefined（点按钮会静默什么都不做）。
     */
    const inject = ['slots']

    /**
     * @param {object} ctx - 客户端根上下文。
     */
    /**
     * 回合结尾的「本轮改动」卡片条。
     *
     * DSH 自带的产物卡片只登记"通过写文件工具产出"的东西；脚本/编译器产出的
     * （pyinstaller 打的 exe、构建产物）不会出现。这里用 git 状态补一刀，
     * 让"这一轮到底动了哪些文件"在对话结尾也看得见。
     */
    function TurnFilesTail(props) {
      const sessionId = (props && props.scope && props.scope.sessionId) || ''
      const seq = props && props.seq
      const [cards, setCards] = React.useState([])
      const [total, setTotal] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        if (!sessionId) return undefined
        callApi('gitStatus', {}, sessionId)
          .then((data) => {
            if (!alive) return
            if (!data || !data.ok || !Array.isArray(data.files)) return
            const files = data.files.filter((f) => f && f.path)
            setTotal(files.length)
            setCards(tailChangedFiles(files, 4))
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [sessionId, seq])

      if (!cards.length) return null

      const open = (path) => {
        try {
          if (props && typeof props.openFile === 'function') {
            props.openFile(path)
            return
          }
        } catch (_) {
          /* 落到自己的代码页 */
        }
        openCodeTab(sessionId, path, 1)
      }

      return React.createElement('div', { className: 'dsh-tail' }, [
        React.createElement('div', { key: 'h', className: 'dsh-tail-head' }, [
          React.createElement('span', { key: 't', className: 'dsh-tail-title' }, '本轮改动'),
          React.createElement('span', { key: 'c', className: 'dsh-tail-count' }, `${total} 个文件`),
        ]),
        React.createElement(
          'div',
          { key: 'g', className: 'dsh-cards' },
          cards.map((f) => {
            const chip = fileChipMeta({ type: 'file', name: f.name })
            return React.createElement(
              'div',
              {
                key: f.path,
                className: 'dsh-card dsh-card--sm',
                title: f.path,
                onClick: () => open(f.path),
              },
              [
                React.createElement(
                  'span',
                  { key: 'c', className: 'dsh-card-chip', 'data-k': chip.kind },
                  chip.label,
                ),
                React.createElement('span', { key: 't', className: 'dsh-card-text' }, [
                  React.createElement('span', { key: 'n', className: 'dsh-card-name' }, f.name),
                  React.createElement(
                    'span',
                    { key: 'm', className: 'dsh-card-meta', 'data-s': f.status },
                    TAIL_STATUS_LABEL[f.status] || f.status,
                  ),
                ]),
              ],
            )
          }),
        ),
      ])
    }

    function apply(ctx) {
      ensureStyle()
      restoreTheme()

      // 对话结尾的「本轮改动」卡片（conversation.chat.turnTail 槽位）
      try {
        ctx.inject(['slots'], (scope) => {
          if (!scope || !scope.slots || typeof scope.slots.inject !== 'function') return
          scope.slots.inject('conversation.chat.turnTail', () =>
            scope.slots.register(
              { name: 'conversation.chat.turnTail', key: 'dsh-deliverable-menu.turn-files' },
              TurnFilesTail,
            ),
          )
        })
      } catch (err) {
        console.warn('[dsh-deliverable-menu] 注册回合结尾卡片失败：', err)
      }

      // 侧栏开合后逼合成层重画（防止"白块"残留）
      try {
        watchLayoutForRepaint()
      } catch (_) {
        /* 忽略 */
      }

      // 紧急逃生口：皮肤/效果把界面弄坏时，Ctrl+Alt+Q 立刻还原（不改其它设置）
      try {
        if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener(
            'keydown',
            (e) => {
              if (!e.ctrlKey || !e.altKey || String(e.key).toLowerCase() !== 'q') return
              e.preventDefault()
              // 开关式：按一下关、再按一下开（不是"一按就永久关掉"）
              const next = !globalSkinOn
              setGlobalSkin(next, currentTheme, true)
              applyTheme(currentTheme, false)
              console.info(`[dsh-deliverable-menu] 全局 QQ 主题已${next ? '开启' : '关闭'}（Ctrl+Alt+Q 切换）`)
            },
            true,
          )

          // Ctrl+Alt+B：折叠/展开左侧边栏（DSH 自带"图标收纳" rail 模式，见 data-sidebar-collapsed）
          window.addEventListener(
            'keydown',
            (e) => {
              if (!e.ctrlKey || !e.altKey || String(e.key).toLowerCase() !== 'b') return
              e.preventDefault()
              if (typeof document === 'undefined' || !document.querySelectorAll) return
              const buttons = Array.from(document.querySelectorAll('button'))
              const target = buttons.find((b) =>
                /收起侧边栏|展开侧边栏|Collapse sidebar|Expand sidebar/i.test(
                  `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`,
                ),
              )
              if (target) {
                target.click()
                console.info('[dsh-deliverable-menu] 已切换左侧边栏（Ctrl+Alt+B）')
              } else {
                console.info(
                  '[dsh-deliverable-menu] 没找到侧边栏折叠按钮；也可以在界面里点「收起侧边栏」',
                )
              }
            },
            true,
          )
        }
      } catch (_) {
        /* 忽略 */
      }

      // 1) 交付卡片右键菜单（只依赖 slots，永远可用）
      ctx.slots.inject('deliverables.file.actions', () =>
        ctx.slots.register(
          {
            name: 'deliverables.file.actions',
            id: 'deliverable-menu',
          },
          ActionButton,
        ),
      )

      /**
       * 右侧栏相关的一切都放进这里：用**可选注入**拿 sidebarRight / sidebarRightTabs。
       * 这样即使某个服务缺失，卡片菜单仍然工作，并且会留下明确日志，
       * 而不是整个插件 apply 不执行（那样连按钮都不会出现，最难排查）。
       * @param {object} scope - 已具备侧栏服务的上下文
       */
      const wireSidebar = (scope) => {
        const tabsApi = scope.sidebarRightTabs
        const rightApi = scope.sidebarRight
        sidebarCtl = rightApi || null
        if (!tabsApi || !rightApi) {
          console.error(
            '[dsh-deliverable-menu] 右侧栏服务缺失（sidebarRight=%s, sidebarRightTabs=%s），Git 面板不可用',
            Boolean(rightApi),
            Boolean(tabsApi),
          )
          return
        }

        // 2) 会话窗口顶部（标题栏右侧）的 Git 入口 —— 只此一个按钮
        try {
          scope.slots.inject('conversation.session.header.utilities', () =>
            scope.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'dsh-git-button',
                inject: (sessionId) => ({ sessionId }),
              },
              GitButton,
            ),
          )
        } catch (err) {
          console.error('[dsh-deliverable-menu] 会话头部按钮注册失败：', err)
        }

        const registerType = (definition) =>
          scope.effect(() => {
            try {
              return tabsApi.register(definition)
            } catch (err) {
              console.error(`[dsh-deliverable-menu] 注册页类型 ${definition.id} 失败：`, err)
              return () => {}
            }
          }, `dsh-deliverable-menu: tab ${definition.id}`)

        const registerBody = (key, component) =>
          scope.effect(
            () =>
              scope.slots.inject('sidebar.right.pane.tab', () => {
                try {
                  return scope.slots.register({ name: 'sidebar.right.pane.tab', key }, component)
                } catch (err) {
                  console.error(`[dsh-deliverable-menu] 注册正文 ${key} 失败：`, err)
                  return () => {}
                }
              }),
            `dsh-deliverable-menu: body ${key}`,
          )

        try {
          registerType({ id: 'dsh-git', kind: 'dsh-git', title: () => '源代码管理' })
          registerBody('dsh-git', SourcePanel)

          registerType({
            id: 'dsh-git-diff',
            kind: 'dsh-git-diff',
            patterns: ['dsh-resource://dsh-git-diff/**'],
            title: () => '对比',
          })
          registerBody('dsh-git-diff', DiffView)

          // 单标签：右栏第二格固定放一个「代码」，换文件时内容切换（树留在第一格）。
          // 不用 multiple —— 多标签会把内容 ID 变成 uuid，preferNewPane 每次都分新栏。
          registerType({ id: 'dsh-code', kind: 'dsh-code', title: () => '代码' })
          registerBody('dsh-code', CodePanel)

          registerType({ id: 'dsh-side', kind: 'dsh-side', title: () => '侧边会话' })
          registerBody('dsh-side', SideChatPanel)
        } catch (err) {
          console.error('[dsh-deliverable-menu] 侧边栏标签页注册失败：', err)
        }
      }

      // 全局 QQ 皮肤：ctx.theme 可选注入（缺了只影响"应用到整个 DSH"）
      try {
        if (typeof ctx.inject === 'function') {
          ctx.inject(['theme'], (scope) => {
            globalThemeApi = scope.theme || null
            restoreGlobalSkin(currentTheme)
          })
        } else if (ctx.theme) {
          globalThemeApi = ctx.theme
          restoreGlobalSkin(currentTheme)
        }
      } catch (err) {
        console.error('[dsh-deliverable-menu] 主题服务不可用：', err)
      }

      try {
        if (typeof ctx.inject === 'function') {
          // 侧栏本体只要这两个服务；侧边会话的 remote/sessions 单独可选注入，
          // 免得它们缺失时连 Git 面板都一起没了
          ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
            wireSidebar(scope)
            try {
              ctx.inject(['remote', 'sessions'], (s2) => {
                sidebarDeps.remote = s2.remote || null
                sidebarDeps.sessions = s2.sessions || null
              })
            } catch (err) {
              console.error('[dsh-deliverable-menu] 侧边会话依赖缺失：', err)
            }
          })
        } else {
          sidebarDeps.remote = ctx.remote || null
          sidebarDeps.sessions = ctx.sessions || null
          wireSidebar(ctx)
        }
      } catch (err) {
        console.error('[dsh-deliverable-menu] 侧栏初始化失败：', err)
      }
    }

    exports.apply = apply
    exports.inject = inject

    // 调试钩子：便于用 DevTools/自动化脚本直接弹菜单验证渲染，
    // 不参与正常交互，也不暴露任何宿主能力。
    if (typeof window !== 'undefined') {
      window.__dshDeliverableMenu = {
        openMenu,
        closeMenu,
        parseUnified,
        includeAt,
        resolveInclude,
        FileGlyph,
        showContextMenu,
        tokensOf,
        extractText,
        messagesFromSource,
        SideChatPanel,
        THEME_PRESETS,
        themeVars,
        applyTheme,
        restoreTheme,
        ThemeButton,
        qqTokens,
        forceRepaint,
        skinPalette,
        skinCss,
        inspectChatDom,
        findWordOccurrences,
        renderMarkdown,
        renderInline,
        formatBytes,
        fileChipMeta,
        tailChangedFiles,
        openCodeTab,
        setGlobalSkin,
        isGlobalSkinOn: () => globalSkinOn,
        tokenizeLines,
        docAbove,
        fileHeaderComment,
        version: '1.6.0',
      }
    }

    return module.exports
  },
})
