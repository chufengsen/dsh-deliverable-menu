#!/usr/bin/env bash
# 一键发布：跑测试 → 打包 → 发 npm → 打 tag
#
#   只有 npm 需要登录（npm login），其余都在本机完成。
#   用法： bash release.sh            # 正常发布
#          bash release.sh --dry     # 只跑测试 + 打包，不真发
set -euo pipefail

cd "$(dirname "$0")"

DRY=0
[ "${1:-}" = "--dry" ] && DRY=1

NODE=$(command -v node || true)
if [ -z "$NODE" ]; then
  echo "找不到 node，请先安装 Node 18+" >&2
  exit 1
fi

VERSION=$("$NODE" -p "require('./package.json').version")
NAME=$("$NODE" -p "require('./package.json').name")
echo "== 包: $NAME@$VERSION =="

echo
echo "== 1/4 语法检查 =="
"$NODE" --check lib/client.js
"$NODE" --check lib/index.js
"$NODE" --check lib/git.js
"$NODE" --check lib/scan.js
"$NODE" --check lib/run.js

echo
echo "== 2/4 测试 =="
for t in contract scan api git; do
  printf '  %-9s ' "$t"
  "$NODE" "test/$t.test.mjs" | tail -1
done

echo
echo "== 3/4 打包清单 =="
npm pack --dry-run 2>&1 | grep -E "npm notice (total files|package size)|README|PUBLISH|lib/" || true

if [ "$DRY" = "1" ]; then
  echo
  echo "（--dry：到此为止，没有发布）"
  exit 0
fi

echo
echo "== 4/4 发布到 npm =="
if ! npm whoami >/dev/null 2>&1; then
  echo "还没登录 npm。先执行： npm login" >&2
  exit 1
fi
echo "登录身份: $(npm whoami)"
npm publish --access public

echo
echo "== 完成 =="
echo "打 tag 并推送："
echo "  git tag v$VERSION && git push origin main --tags"
