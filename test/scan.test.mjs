/**
 * 符号索引单元测试：验证各语言的正则只认定义、不把调用点当定义。
 *
 *   node test/scan.test.mjs
 */

import assert from 'node:assert/strict'

import { langOf, scanText } from '../lib/scan.js'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`  [ok] ${label}`)
}
const names = (list) => list.map((s) => s.name)

// ---------------------------------------------------------------- 语言判定
assert.equal(langOf('main.c'), 'c')
assert.equal(langOf('inc/board.h'), 'c')
assert.equal(langOf('src/app.cpp'), 'cpp')
assert.equal(langOf('tool.py'), 'python')
assert.equal(langOf('a/b.mjs'), 'js')
assert.equal(langOf('ui.tsx'), 'ts')
assert.equal(langOf('cmd/main.go'), 'go')
assert.equal(langOf('lib.rs'), 'rust')
assert.equal(langOf('Makefile'), 'shell')
assert.equal(langOf('README.md'), 'markdown')
assert.equal(langOf('data.bin'), 'text')
ok('langOf 覆盖 11 种扩展名')

// ---------------------------------------------------------------- C
const c = `
#include <stdio.h>
#define MAX_LEN 64
struct point { int x; int y; };
typedef struct { int a; } box_t;
static int helper(int a);
int main(void) {
    if (a) { return helper(1); }
    for (int i = 0; i < 3; i++) { }
    return 0;
}
void UART_Init(void)
{
}
`
const cSyms = scanText(c, 'c')
const cNames = names(cSyms)
assert.ok(cNames.includes('MAX_LEN'), 'C: 宏定义')
assert.ok(cNames.includes('point'), 'C: struct')
assert.ok(cNames.includes('box_t'), 'C: typedef 名字')
assert.ok(cNames.includes('main'), 'C: 函数定义')
assert.ok(cNames.includes('UART_Init'), 'C: Allman 风格函数')
assert.ok(!cNames.includes('if'), 'C: 不把 if 当定义')
assert.ok(!cNames.includes('for'), 'C: 不把 for 当定义')
assert.ok(!cNames.includes('stdio'), 'C: 不把 include 当定义')
ok('C：宏/结构体/typedef/函数，且排除 if/for')
assert.equal(cSyms.find((s) => s.name === 'UART_Init').line, 12, 'C: 行号正确')

// ---------------------------------------------------------------- Python
const py = `
import os

MAX = 10

class Node:
    def __init__(self):
        pass

    async def run(self, x):
        if x:
            return x
        return None
`
const pyNames = names(scanText(py, 'python'))
assert.ok(pyNames.includes('Node'), 'Python: class')
assert.ok(pyNames.includes('__init__'), 'Python: 方法')
assert.ok(pyNames.includes('run'), 'Python: async def')
assert.ok(!pyNames.includes('if'), 'Python: 不把 if 当定义')
ok('Python：class / 方法 / async def')

// ---------------------------------------------------------------- JS / TS
const js = `
import { x } from './x.js'
export function buildThing(a) { return a }
export async function loadAll() {}
const helper = (a, b) => a + b
let counter = 0
export class Widget {}
export interface Props { id: string }
export type Id = string
if (a) { helper(1, 2) }
`
const jsSyms = scanText(js, 'js')
const jsNames = names(jsSyms)
assert.ok(jsNames.includes('buildThing'), 'JS: export function')
assert.ok(jsNames.includes('loadAll'), 'JS: async function')
assert.ok(jsNames.includes('helper'), 'JS: 箭头函数常量')
assert.ok(jsNames.includes('counter'), 'JS: let')
assert.ok(jsNames.includes('Widget'), 'JS: class')
assert.ok(!jsNames.includes('if'), 'JS: 不把 if 当定义')
ok('JS：function/async/箭头/let/class')

const tsNames = names(scanText('export interface Props { id: string }', 'ts'))
assert.ok(tsNames.includes('Props'), 'TS: interface')
ok('TS：interface（js 规则复用）')

// ---------------------------------------------------------------- Go / Rust / shell / markdown
assert.deepEqual(names(scanText('func (s *Srv) Handle(w http.ResponseWriter) {\n}', 'go')).slice(0, 2), ['Handle'])
assert.deepEqual(names(scanText('type Config struct {\n}', 'go')).slice(0, 1), ['Config'])
ok('Go：方法 / 类型')

const rustNames = names(scanText('pub async fn run() {}\npub struct Ctx;\n', 'rust'))
assert.ok(rustNames.includes('run') && rustNames.includes('Ctx'), 'Rust: fn/struct')
ok('Rust：fn / struct')

const shNames = names(scanText('build_app() {\n  echo hi\n}\nVAR=1\n', 'shell'))
assert.ok(shNames.includes('build_app'), 'Shell: 函数')
ok('Shell：函数定义')

const md = scanText('# 标题一\n正文\n## 二级标题\n', 'markdown')
assert.equal(md[0].name, '标题一')
assert.equal(md[0].kind, 'h1')
assert.equal(md[1].kind, 'h2')
ok('Markdown：标题层级')

// ---------------------------------------------------------------- 边界
assert.deepEqual(scanText('', 'c'), [], '空文件')
assert.ok(scanText('x'.repeat(500) + '(a) {', 'c').length === 0, '超长行跳过')
assert.deepEqual(scanText('// int fake(void) {\n', 'c'), [], '注释行不产符号')
ok('边界：空文件 / 超长行 / 注释行')

console.log(`\n全部通过：${passed} 项`)
