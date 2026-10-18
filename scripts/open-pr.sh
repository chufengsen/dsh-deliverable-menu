#!/usr/bin/env bash
# 用 GitHub API 开 PR（不需要 git，只需要一个 PAT）
#
#   GITHUB_TOKEN=ghp_xxx bash scripts/open-pr.sh
#
# token 权限（二选一）：
#   · classic:  勾 public_repo
#   · fine-grained: 对 chufengsen/dsh-deliverable-menu 与 fork 出来的
#                   awesome-dsh-plugin 给 "Contents: Read and write" + "Pull requests: Read and write"
#
# 做的事：fork → 在 fork 的 main 上加一个 data/plugins/xxx.yml → 向上游开 PR。
set -euo pipefail

UPSTREAM_OWNER="awesome-dsh-plugin"
UPSTREAM_REPO="awesome-dsh-plugin"
ENTRY_PATH="data/plugins/chufengsen__dsh-deliverable-menu.yml"
ENTRY_FILE="$(cd "$(dirname "$0")/.." && pwd)/PUBLISH-ENTRY.yml"
API="https://api.github.com"

: "${GITHUB_TOKEN:?请先设置 GITHUB_TOKEN}"
[ -f "$ENTRY_FILE" ] || { echo "找不到 $ENTRY_FILE" >&2; exit 1; }

auth=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "== 1) 我是谁 =="
ME=$(curl -sf "${auth[@]}" "$API/user" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).login))")
echo "   $ME"

echo "== 2) fork 上游仓库（已存在会返回 422，忽略）=="
curl -s -o /dev/null -w "   fork: %{http_code}\n" -X POST "${auth[@]}" \
  "$API/repos/$UPSTREAM_OWNER/$UPSTREAM_REPO/forks"

echo "== 3) 等 fork 就绪 =="
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" "$API/repos/$ME/$UPSTREAM_REPO")
  [ "$code" = "200" ] && { echo "   就绪"; break; }
  sleep 2
done

echo "== 4) 提交条目文件 =="
CONTENT_B64=$(node -e "process.stdout.write(Buffer.from(require('fs').readFileSync(process.argv[1],'utf8')).toString('base64'))" "$ENTRY_FILE")
BODY=$(node -e '
const [path, content] = process.argv.slice(1)
process.stdout.write(JSON.stringify({
  message: "add dsh-deliverable-menu entry",
  content,
  branch: "main",
}))' "$ENTRY_PATH" "$CONTENT_B64")

resp=$(curl -s -w '\n%{http_code}' -X PUT "${auth[@]}" \
  -d "$BODY" "$API/repos/$ME/$UPSTREAM_REPO/contents/$ENTRY_PATH")
code=$(printf '%s' "$resp" | tail -1)
echo "   PUT: $code"
if [ "$code" != "201" ] && [ "$code" != "200" ]; then
  printf '%s\n' "$resp" | head -20 >&2
  echo "（422 通常是文件已存在；409 是 fork 还没同步好，等 10 秒重跑）" >&2
  exit 1
fi

echo "== 5) 开 PR =="
PR_BODY=$(node -e '
process.stdout.write(JSON.stringify({
  title: "add dsh-deliverable-menu",
  head: process.argv[1] + ":main",
  base: "main",
  body: "Adds **dsh-deliverable-menu** — VS Code-style Git panel for DSH (side-by-side diff, file tree, cross-file search, code navigation, Markdown preview, side chat, deliverable card menus).\n\n- npm: `dsh-deliverable-menu@1.31.1`\n- repo: https://github.com/chufengsen/dsh-deliverable-menu\n- capabilities: fs-read, fs-write (workspace-scoped); no network / llm / env",
}))' "$ME")

pr=$(curl -s -w '\n%{http_code}' -X POST "${auth[@]}" -d "$PR_BODY" \
  "$API/repos/$UPSTREAM_OWNER/$UPSTREAM_REPO/pulls")
code=$(printf '%s' "$pr" | tail -1)
echo "   POST pulls: $code"
if [ "$code" = "201" ]; then
  printf '%s' "$pr" | head -n -1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('   PR:', JSON.parse(s).html_url))"
else
  printf '%s\n' "$pr" | head -20 >&2
  exit 1
fi
