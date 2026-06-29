#!/usr/bin/env bash
set -euo pipefail

if [[ "${CODEX_AUTO_PUSH:-0}" != "1" ]]; then
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$ROOT" ]] || exit 0
cd "$ROOT"

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
case "$branch" in
  main|master|production|release)
    echo "[codex 钩子] 保护分支不自动推送：$branch"
    exit 0
    ;;
  ""|HEAD)
    exit 0
    ;;
esac

git push
