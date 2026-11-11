#!/usr/bin/env bash
# 从 For_Jasmine 模板创建一个新的产品工位。
#
#   bash install.sh install ../宝宝喂养 --name "宝宝喂养"
#   bash <(curl -fsSL https://raw.githubusercontent.com/Chee-0806/For_Jasmine/main/install.sh) install ../宝宝喂养 --name "宝宝喂养"
#
# 选项：
#   --name "产品名"   显示在产品 PRD / 工作台里的名字
#   --git             新目录初始化 git（不自动提交）
#   --with-pack <包>  同时安装可选内容包，例如 pm-methods
#   --ref <ref>       使用指定分支/标签/commit（默认 main）
set -euo pipefail

REPO="${FOR_JASMINE_REPO:-Chee-0806/For_Jasmine}"
REF="${FOR_JASMINE_REF:-main}"

usage() {
  cat <<'EOF'
用法：
  bash install.sh install <目录> [--name "产品名"] [--git] [--with-pack pm-methods] [--ref <分支/标签>]

示例：
  bash install.sh install ../宝宝喂养 --name "宝宝喂养"
  bash install.sh install ../宝宝喂养 --name "宝宝喂养" --git

远程一行：
  bash <(curl -fsSL https://raw.githubusercontent.com/Chee-0806/For_Jasmine/main/install.sh) install ../宝宝喂养 --name "宝宝喂养"
  curl -fsSL https://raw.githubusercontent.com/Chee-0806/For_Jasmine/main/install.sh | bash -s -- install ../宝宝喂养 --name "宝宝喂养"

要求：Node.js >= 18。
EOF
}

if [ "$#" -eq 0 ]; then
  usage
  exit 1
fi

if [ "$1" = "install" ]; then
  shift
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  usage
  exit 1
fi
shift

ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ref)
      REF="${2:-}"
      if [ -z "$REF" ]; then
        echo "✖ --ref 缺少值" >&2
        exit 1
      fi
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "✖ 没有找到 Node.js。请先安装 Node.js >= 18：https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✖ Node.js 版本过低（当前 $(node -v)），需要 >= 18。" >&2
  exit 1
fi

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
TEMPLATE=""

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/scripts/new.mjs" ] && [ -d "$SCRIPT_DIR/skills" ]; then
  TEMPLATE="$SCRIPT_DIR"
else
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/for-jasmine.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  URL="https://codeload.github.com/$REPO/tar.gz/$REF"

  if command -v curl >/dev/null 2>&1; then
    if ! curl -fsSL "$URL" | tar -xz -C "$TMP" --strip-components=1; then
      echo "✖ 下载模板失败：$URL" >&2
      exit 1
    fi
  elif command -v git >/dev/null 2>&1; then
    if ! git clone --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$TMP" >/dev/null 2>&1; then
      echo "✖ 克隆模板失败：https://github.com/$REPO" >&2
      exit 1
    fi
  else
    echo "✖ 需要 curl 或 git 来下载模板。" >&2
    exit 1
  fi

  TEMPLATE="$TMP"
fi

if [ "${#ARGS[@]}" -gt 0 ]; then
  node "$TEMPLATE/scripts/new.mjs" "$TARGET" "${ARGS[@]}"
else
  node "$TEMPLATE/scripts/new.mjs" "$TARGET"
fi
