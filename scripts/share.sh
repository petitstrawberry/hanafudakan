#!/usr/bin/env bash
# Temporary public HTTPS entry point. Only the compiled flower-card service is exposed.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/artifacts/share"
NIX_BIN="${HANAFUDA_NIX_BIN:-nix}"
if ! command -v "$NIX_BIN" >/dev/null 2>&1 && [[ -x /nix/var/nix/profiles/default/bin/nix ]]; then
  NIX_BIN=/nix/var/nix/profiles/default/bin/nix
fi
mkdir -p "$STATE_DIR"
cd "$ROOT_DIR"
run_nix() { "$NIX_BIN" --extra-experimental-features 'nix-command flakes' "$@"; }
live_process() {
  local name="$1" pid actual
  [[ -f "$STATE_DIR/$name.pid" && -f "$STATE_DIR/$name.started" ]] || return 1
  pid="$(cat "$STATE_DIR/$name.pid")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  actual="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"
  [[ "$actual" == "$(cat "$STATE_DIR/$name.started")" ]]
}
stop_process() {
  local name="$1"
  if live_process "$name"; then kill -TERM "$(cat "$STATE_DIR/$name.pid")"; fi
  rm -f "$STATE_DIR/$name.pid" "$STATE_DIR/$name.started"
}
case "${1:-status}" in
  stop)
    stop_process tunnel
    stop_process server
    rm -f "$STATE_DIR/url"
    echo '一時公開を停止しました。開発サーバーには影響しません。'
    exit 0
    ;;
  status)
    if live_process tunnel && live_process server && [[ -s "$STATE_DIR/url" ]]; then
      printf '公開中: '; cat "$STATE_DIR/url"
    else
      echo '一時公開は停止中です。'
    fi
    exit 0
    ;;
  start) ;;
  *) echo 'Usage: ./scripts/share.sh start|status|stop' >&2; exit 2 ;;
esac
if live_process tunnel && live_process server && [[ -s "$STATE_DIR/url" ]]; then
  printf '公開中: '; cat "$STATE_DIR/url"; exit 0
fi
stop_process tunnel
stop_process server
PORT="${HANAFUDA_SHARE_PORT:-3100}"
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1024 && PORT <= 65535)) || { echo 'Invalid HANAFUDA_SHARE_PORT' >&2; exit 1; }
if command -v lsof >/dev/null && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already used. Choose HANAFUDA_SHARE_PORT." >&2; exit 1
fi
printf 'Nixで公開用パッケージをビルドしています…\n'
run_nix build --no-update-lock-file . --out-link "$STATE_DIR/package"
TUNNEL_PACKAGE="$(run_nix build --no-update-lock-file --inputs-from . nixpkgs#cloudflared --no-link --print-out-paths)"
cleanup_failure() { stop_process tunnel; stop_process server; rm -f "$STATE_DIR/url"; }
trap cleanup_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Quick tunnels do not modify DNS, routers, login items, or firewall rules.
nohup "$TUNNEL_PACKAGE/bin/cloudflared" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" \
  >"$STATE_DIR/tunnel.log" 2>&1 < /dev/null &
printf '%s\n' "$!" > "$STATE_DIR/tunnel.pid"
ps -p "$(cat "$STATE_DIR/tunnel.pid")" -o lstart= > "$STATE_DIR/tunnel.started"
SHARE_URL=''
for ((attempt=0; attempt<90; attempt++)); do
  SHARE_URL="$(sed -n 's/.*\(https:\/\/[a-z0-9-]*\.trycloudflare\.com\).*/\1/p' "$STATE_DIR/tunnel.log" | head -n 1)"
  [[ -n "$SHARE_URL" ]] && break
  live_process tunnel || { tail -n 15 "$STATE_DIR/tunnel.log" >&2; exit 1; }
  sleep 1
done
[[ -n "$SHARE_URL" ]] || { echo '公開URLの作成がタイムアウトしました。' >&2; cleanup_failure; exit 1; }
nohup env BIND_ADDR="127.0.0.1:$PORT" ALLOWED_ORIGIN="$SHARE_URL" RUST_LOG=info \
  "$STATE_DIR/package/bin/hanafudakan-server" >"$STATE_DIR/server.log" 2>&1 < /dev/null &
printf '%s\n' "$!" > "$STATE_DIR/server.pid"
ps -p "$(cat "$STATE_DIR/server.pid")" -o lstart= > "$STATE_DIR/server.started"
for ((attempt=0; attempt<30; attempt++)); do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    printf '%s\n' "$SHARE_URL" > "$STATE_DIR/url"
    printf '\n公開URL: %s\n停止: ./scripts/share.sh stop\n' "$SHARE_URL"
    echo 'このプロセスを動かしている間だけ公開します。Ctrl+Cでも閉じられます。'
    while live_process tunnel && live_process server; do sleep 2; done
    exit 0
  fi
  live_process server || { tail -n 15 "$STATE_DIR/server.log" >&2; cleanup_failure; exit 1; }
  sleep 1
done
cleanup_failure
echo 'サーバーの起動に失敗しました。' >&2
exit 1
