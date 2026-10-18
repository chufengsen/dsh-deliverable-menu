/**
 * 轻量符号索引（无 LSP）：按语言正则扫描定义，供「跳转定义」与「联想」使用。
 *
 * 设计取舍：DSH 里没有现成的语言服务，起 clangd/pyright 属于另一个量级的工程，
 * 所以这里用保守的逐行正则——只认"看起来确定是定义"的行（函数/类/宏/结构体/标题），
 * 宁可漏报，也不要把 if/for 这类调用点当成定义。
 */

/** 按扩展名判定语言。 */
const LANG_BY_EXT = {
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.ino': 'cpp',
  '.py': 'python', '.pyi': 'python',
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js',
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts',
  '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'java', '.kts': 'java', '.cs': 'csharp',
  '.lua': 'lua', '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.md': 'markdown', '.markdown': 'markdown',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.css': 'css', '.scss': 'css', '.html': 'html', '.htm': 'html', '.vue': 'html',
}

/** 语言 → 补全用的关键字。 */
export const KEYWORDS = {
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while NULL true false'.split(' '),
  cpp: 'auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend goto if inline int long namespace new nullptr operator private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'.split(' '),
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self'.split(' '),
  js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new return static super switch this throw try typeof var void while with yield true false null undefined'.split(' '),
  ts: 'abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let namespace new null number object private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield'.split(' '),
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'.split(' '),
  rust: 'as break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' '),
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' '),
  csharp: 'abstract as base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await'.split(' '),
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '),
  shell: 'case do done elif else esac fi for function if in local return select then until while echo export cd set unset'.split(' '),
  markdown: [],
  json: ['true', 'false', 'null'],
  yaml: ['true', 'false', 'null'],
  toml: ['true', 'false'],
  css: [],
  html: [],
}

/** 路径 → 语言键。 */
export function langOf(path) {
  const p = String(path || '').toLowerCase()
  const dot = p.lastIndexOf('.')
  if (dot < 0) {
    const base = p.slice(p.lastIndexOf('/') + 1)
    if (base === 'makefile' || base === 'makefile.am') return 'shell'
    return 'text'
  }
  return LANG_BY_EXT[p.slice(dot)] || 'text'
}

/** 语言 → 注释前缀（高亮/分词用）。 */
export function commentPrefix(lang) {
  if (lang === 'python' || lang === 'shell' || lang === 'yaml' || lang === 'toml') return '#'
  if (lang === 'lua') return '--'
  if (lang === 'html' || lang === 'markdown') return ''
  return '//'
}

/** C 家族里不能被当成函数名的关键字。 */
const C_NOT_NAMES = new Set(
  'if for while switch return sizeof catch do else case goto break continue typedef struct union enum static extern const volatile inline void char short int long float double signed unsigned sizeof'.split(' '),
)

/** 依次尝试的行级规则：[正则, 名字组下标, 类型]。 */
const RULES = {
  c: [
    [/^\s*#\s*define\s+([A-Za-z_]\w*)/, 1, 'macro'],
    [/^\s*(?:typedef\s+)?(?:struct|union|enum)\s+([A-Za-z_]\w*)\s*(?:\{|$)/, 1, 'type'],
    // 匿名结构体 typedef：typedef struct { ... } name;
    [/^\s*typedef\s+(?:struct|union|enum)\s*\{[^}]*\}\s*([A-Za-z_]\w*)\s*;/, 1, 'type'],
    [/^\s*typedef\s+[^;{}]*?\b([A-Za-z_]\w*)\s*;/, 1, 'type'],
    [/^\s*(?:static\s+|inline\s+|extern\s+|const\s+|unsigned\s+|signed\s+)*[A-Za-z_][\w \t\*&]*?[\s\*&]([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{?\s*$/, 1, 'func'],
    [/^\s*([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{?\s*$/, 1, 'func'],
  ],
  python: [
    [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, 1, 'func'],
    [/^\s*class\s+([A-Za-z_]\w*)/, 1, 'class'],
    [/^([A-Za-z_]\w*)\s*[:=]\s*(?:[A-Za-z_]|$)/, 1, 'var'],
  ],
  js: [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 1, 'func'],
    [/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, 1, 'class'],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 1, 'func'],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 1, 'var'],
  ],
  go: [
    [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, 1, 'func'],
    [/^type\s+([A-Za-z_]\w*)\s+/, 1, 'type'],
    [/^(?:var|const)\s+([A-Za-z_]\w*)\s+/, 1, 'var'],
  ],
  rust: [
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, 1, 'func'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union|type)\s+([A-Za-z_]\w*)/, 1, 'type'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_]\w*)/, 1, 'var'],
  ],
  java: [
    [/^\s*(?:@\w+\s+)*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|override|virtual|async|sealed|partial)\s+)+[\w<>\[\],.?\s]*\s([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:throws [\w,\s.]+)?\{/, 1, 'func'],
    [/^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*(?:class|interface|enum|record|struct)\s+([A-Za-z_]\w*)/, 1, 'class'],
  ],
  lua: [
    [/^\s*(?:local\s+)?function\s+([\w.:]+)\s*\(/, 1, 'func'],
    [/^\s*local\s+([A-Za-z_]\w*)\s*=/, 1, 'var'],
  ],
  shell: [
    [/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{/, 1, 'func'],
    [/^\s*([A-Za-z_]\w*)=/, 1, 'var'],
  ],
  markdown: [],
}

RULES.cpp = RULES.c
RULES.csharp = RULES.java

/** TS 先匹配自己独有的声明，再落回 JS 规则。 */
RULES.ts = [
  [/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, 1, 'type'],
  [/^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, 1, 'type'],
  [/^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 1, 'type'],
  [/^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/, 1, 'type'],
  ...RULES.js,
]

/**
 * 扫描一段文本里的定义。
 * @param {string} text - 文件内容
 * @param {string} lang - langOf() 的结果
 * @returns {{name:string,kind:string,line:number}[]} line 从 1 开始
 */
export function scanText(text, lang) {
  const out = []
  const rules = RULES[lang] || []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (lang === 'markdown') {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
      if (m) out.push({ name: m[2], kind: `h${m[1].length}`, line: i + 1 })
      continue
    }
    if (!raw || raw.length > 400) continue
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    if ((lang === 'python' || lang === 'shell' || lang === 'yaml') && trimmed.startsWith('#')) continue
    for (const [re, group, kind] of rules) {
      const m = re.exec(raw)
      if (!m) continue
      const name = m[group]
      if (!name || name.length > 80) continue
      if ((lang === 'c' || lang === 'cpp') && (C_NOT_NAMES.has(name) || /^(?:if|for|while|switch)$/.test(name))) continue
      if (kind === 'var' && name === '_') continue
      out.push({ name, kind, line: i + 1 })
      break
    }
  }
  return out
}

/**
 * 索引/全局搜索跳过的目录（这些目录里的源码没有检索价值，跳过能省大量 IO）。
 * 注意：**文件树不能用这个表**，否则 build/dist 这类目录会在界面上消失。
 */
export const SKIP_DIRS = new Set(
  'node_modules .git .hg .svn dist build out bin obj target .venv venv env __pycache__ .mypy_cache .pytest_cache .idea .vscode .next .nuxt .cache coverage .workbuddy .dsh debug release .gradle .tox bower_components'.split(' '),
)

/**
 * 文件树只隐藏版本库元数据目录（VS Code 的资源管理器同样只排除 .git 这类），
 * build / dist / node_modules / __pycache__ 一律照常显示。
 */
export const TREE_SKIP_DIRS = new Set(['.git', '.hg', '.svn'])

/** 小于这个体积、且扩展名在表里的文件才参与索引。 */
export const MAX_FILE_BYTES = 256 * 1024
export const MAX_FILES = 1500
export const MAX_SYMBOLS = 30000
export const MAX_DEPTH = 12
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

/** 全局搜索时跳过的二进制扩展名（其余按文本读，含 .txt/.log/.csv）。 */
export const BINARY_EXT = new Set(
  (
    '.png .jpg .jpeg .gif .webp .bmp .ico .icns .tif .tiff .psd ' +
    '.zip .gz .tgz .bz2 .xz .7z .rar .tar .jar .war ' +
    '.exe .dll .so .dylib .a .lib .o .obj .class .pdb .ilk ' +
    '.pdf .doc .docx .xls .xlsx .ppt .pptx .odt ' +
    '.mp3 .mp4 .avi .mkv .mov .wav .flac .ogg ' +
    '.woff .woff2 .ttf .otf .eot ' +
    '.bin .hex .elf .map .wasm .db .sqlite .pyc .pyo'
  ).split(' '),
)
