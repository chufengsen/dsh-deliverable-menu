#!/usr/bin/env bash
# 一键发布：跑测试 → 打包 → 发 npm → 打 tag
#
#   只有 npm 需要登录（npm login），其余都在本机完成。
#   用法： bash release.sh            # 正常发布
#          bash release.sh --dry      # 只跑测试 + 打包，不真发
set -euo pipefail

cd "$(dirname "$0")"

DRY=0
[ "${1:-}" = "--dry" ] && DRY=1
# 账号开了两步验证时，用 OTP=<6位动态码> bash release.sh
OTP="${OTP:-}"

# ---------------------------------------------------------------- 找 node
# Git Bash 的 PATH 常常不含 Windows 的 node（PowerShell 里能跑、bash 里找不到）。
# 所以这里按 4 级回退找，并把找到的目录塞回 PATH（这样 npm 也能用）。
find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local candidates=(
    "/c/Program Files/nodejs/node.exe"
    "/c/Program Files (x86)/nodejs/node.exe"
    "${LOCALAPPDATA:-$HOME/AppData/Local}/Programs/nodejs/node.exe"
    "${PROGRAMFILES:-/c/Program Files}/nodejs/node.exe"
  )
  local c
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done

  # 用 PowerShell 问系统（node 可能是 PowerShell 里的别名/其他安装位置）
  if command -v powershell >/dev/null 2>&1; then
    local p
    p=$(powershell -NoProfile -Command "(Get-Command node -ErrorAction SilentlyContinue).Source" 2>/dev/null | tr -d '\r' || true)
    if [ -n "$p" ]; then
      if command -v cygpath >/dev/null 2>&1; then p=$(cygpath -u "$p"); fi
      [ -x "$p" ] && { printf '%s\n' "$p"; return 0; }
    fi
  fi

  # 最后试 npm 旁边（npm 通常和 node 同目录）
  if command -v npm >/dev/null 2>&1; then
    local d
    d=$(dirname "$(command -v npm)")
    [ -x "$d/node.exe" ] && { printf '%s\n' "$d/node.exe"; return 0; }
  fi
  return 1
}

NODE=$(find_node || true)
if [ -z "$NODE" ]; then
  echo "找不到 node。" >&2
  echo "  bash 的 PATH: $PATH" >&2
  echo "  如果你能在 PowerShell 里跑 node -v，请把它的路径加到 PATH，或直接：" >&2
  echo "    \"C:/Program Files/nodejs/node.exe\" --version" >&2
  exit 1
fi
# 让 npm / npx 也能被找到
NODE_DIR=$(dirname "$NODE")
case ":$PATH:" in
  *":$NODE_DIR:"*) ;;
  *) PATH="$NODE_DIR:$PATH" ;;
esac

VERSION=$("$NODE" -p "require('./package.json').version")
NAME=$("$NODE" -p "require('./package.json').name")
echo "== 包: $NAME@$VERSION =="
echo "   node: $NODE ($("$NODE" -v 2>/dev/null || echo '?'))"

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
set +e
if [ -n "$OTP" ]; then
  npm publish --access public --otp="$OTP"
else
  npm publish --access public
fi
PUBLISH_EXIT=$?
set -e
if [ "$PUBLISH_EXIT" -ne 0 ]; then
  echo
  echo "发布失败（exit=$PUBLISH_EXIT）。如果错误是 E403 且提到 2FA，二选一：" >&2
  echo "  · 用一次性动态码： OTP=123456 bash release.sh" >&2
  echo "  · 或去 npmjs.com → Access Tokens 生成带 Bypass 2FA 的 token，然后：" >&2
  echo "      npm publish --access public --//registry.npmjs.org/:_authToken=<TOKEN>" >&2
  exit "$PUBLISH_EXIT"
fi

echo
echo "== 完成 =="
echo "打 tag 并推送："
echo "  git tag v$VERSION && git push origin main --tags"
