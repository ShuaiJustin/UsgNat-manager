#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

VERIFY_CMD="${CODEX_VERIFY_CMD:-}"

if [[ -z "$VERIFY_CMD" ]]; then
  exit 0
fi

case "${1:-}" in
  *commit*|commit|git-commit)
    echo "[codex 钩子] 提交前运行验证：$VERIFY_CMD"
    bash -lc "$VERIFY_CMD"
    ;;
  *)
    ;;
esac
