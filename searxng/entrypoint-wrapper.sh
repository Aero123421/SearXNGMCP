#!/bin/sh
set -eu

# SearXNG 公式 entrypoint は、設定ファイルが既に存在する場合 secret_key を更新しない。
# 本プロジェクトは settings.yml を bind mount するため、起動前に env の値で上書きする。

ORIGINAL_ENTRYPOINT="/usr/local/searxng/entrypoint.sh"

TEMPLATE_PATH="/etc/searxng/settings.template.yml"
TARGET_PATH="${SEARXNG_SETTINGS_PATH:-/etc/searxng/settings.runtime.yml}"

if [ -f "${TEMPLATE_PATH}" ]; then
  if [ ! -f "${TARGET_PATH}" ] || [ "${TEMPLATE_PATH}" -nt "${TARGET_PATH}" ]; then
    cp -pf "${TEMPLATE_PATH}" "${TARGET_PATH}"
  fi
fi

export SEARXNG_SETTINGS_PATH="${TARGET_PATH}"

if [ -f "${SEARXNG_SETTINGS_PATH}" ]; then
  if [ -n "${SEARXNG_SECRET:-}" ]; then
    PYTHON="/usr/local/searxng/.venv/bin/python3"
    if [ -x "${PYTHON}" ]; then
      "${PYTHON}" - <<'PY' || true
import os
import pathlib
import re

path = os.environ.get("SEARXNG_SETTINGS_PATH")
secret = os.environ.get("SEARXNG_SECRET", "")
if not path or not secret:
    raise SystemExit(0)

p = pathlib.Path(path)
text = p.read_text(encoding="utf-8", errors="replace")

def yaml_dq(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'

repl = "  secret_key: " + yaml_dq(secret)
text2, n = re.subn(r"(?m)^\s*secret_key:\s*.*$", repl, text)
if n == 0:
    # best-effort: append into server: block if missing
    text2 = text + "\nserver:\n  secret_key: " + yaml_dq(secret) + "\n"

p.write_text(text2, encoding="utf-8")
PY
    else
      # フォールバック（secret に / や & を含めないこと）
      sed -i "s/^  secret_key: .*/  secret_key: \"${SEARXNG_SECRET}\"/" "${SEARXNG_SETTINGS_PATH}" || true
    fi
  fi
fi

exec "${ORIGINAL_ENTRYPOINT}"
