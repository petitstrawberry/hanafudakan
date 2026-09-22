#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for command_name in cargo node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '必要なコマンドが見つかりません: %s\n先に nix develop で開発シェルに入ってください。\n' "$command_name" >&2
    exit 1
  fi
done

if [[ ! -d "$ROOT/client/node_modules" ]]; then
  printf '先に依存関係を準備してください: cd client && npm ci\n' >&2
  exit 1
fi

export BIND_ADDR="${BIND_ADDR:-127.0.0.1:3000}"
export STATIC_DIR="${STATIC_DIR:-$ROOT/client/dist}"
export RUST_LOG="${RUST_LOG:-info}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

# 先にビルドし、サーバーを直接起動することで終了時に子プロセスを残さない。
cargo build --locked -p hanafudakan-server
server_pid=""
client_pid=""
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$client_pid" ]] || kill "$client_pid" 2>/dev/null || true
  [[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true
  [[ -z "$client_pid" ]] || wait "$client_pid" 2>/dev/null || true
  [[ -z "$server_pid" ]] || wait "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"$CARGO_TARGET_DIR/debug/hanafudakan-server" &
server_pid=$!
(
  cd "$ROOT/client"
  exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
) &
client_pid=$!

printf '\n花札館: http://localhost:5173\n終了: Ctrl+C\n\n'
# macOS 標準の Bash 3.2 でも動作するよう wait -n は使用しない。
while kill -0 "$server_pid" 2>/dev/null && kill -0 "$client_pid" 2>/dev/null; do
  sleep 1
done
printf 'サーバーまたはクライアントが終了したため、開発環境を停止します。\n' >&2
exit 1
