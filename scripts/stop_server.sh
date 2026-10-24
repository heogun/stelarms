#!/usr/bin/env bash
# STELARMS 서버 중지 스크립트
#
# 사용법:
#   ./scripts/stop_server.sh              # 기본 포트(3001)의 서버 중지
#   ./scripts/stop_server.sh 3002         # 포트 지정
#   ./scripts/stop_server.sh --port=3002  # 포트 지정
#   ./scripts/stop_server.sh --quiet      # 조용히 실행
#
# logs/server.pid 와 해당 포트의 LISTEN 프로세스를 함께 확인해서
# STELARMS 서버(server/index.ts)로 확인된 프로세스만 종료한다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

PORT="${PORT:-3001}"
QUIET=false

while [ $# -gt 0 ]; do
  case "$1" in
    -q | --quiet)
      QUIET=true
      ;;
    --port)
      shift
      [ $# -gt 0 ] || { echo "[오류] --port 뒤에 포트 번호가 필요합니다." >&2; exit 2; }
      PORT="$1"
      ;;
    --port=*)
      PORT="${1#*=}"
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        PORT="$1"
      else
        echo "사용법: $0 [--quiet] [--port=PORT] [PORT]" >&2
        exit 2
      fi
      ;;
  esac
  shift
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "[오류] 잘못된 포트: $PORT" >&2
  exit 2
fi

log() {
  if [ "$QUIET" = false ]; then
    echo "$@"
  fi
}

PID_FILE="$ROOT_DIR/logs/server.pid"
PIDS=""

add_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  case " $PIDS " in
    *" $pid "*) ;;
    *) PIDS="${PIDS} ${pid}" ;;
  esac
}

is_stelarms() {
  local pid="$1"
  local cmd
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$cmd" in
    *server/index.ts* | *run-server.sh* | *"bun run serve"*) return 0 ;;
    *) return 1 ;;
  esac
}

# 1) pid 파일
if [ -f "$PID_FILE" ]; then
  pid="$(tr -dc '0-9' <"$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    add_pid "$pid"
  fi
fi

# 2) 해당 포트를 LISTEN 중인 프로세스
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    add_pid "$pid"
  done
fi

TARGETS=""
for pid in $PIDS; do
  if is_stelarms "$pid"; then
    TARGETS="${TARGETS} ${pid}"
  else
    log "[건너뜀] PID $pid 는 STELARMS 서버가 아닙니다. (${PORT} 포트)"
  fi
done

if [ -z "${TARGETS// /}" ]; then
  rm -f "$PID_FILE"
  log "실행 중인 STELARMS 서버가 없습니다. (포트 ${PORT})"
  exit 0
fi

log "서버 중지 중... (포트 ${PORT}, PID:${TARGETS})"
for pid in $TARGETS; do
  kill -TERM "$pid" 2>/dev/null || true
done

# 최대 15초 대기
for _ in $(seq 1 75); do
  alive=0
  for pid in $TARGETS; do
    if kill -0 "$pid" 2>/dev/null; then
      alive=1
    fi
  done
  [ "$alive" -eq 0 ] && break
  sleep 0.2
done

for pid in $TARGETS; do
  if kill -0 "$pid" 2>/dev/null; then
    log "[강제 종료] PID $pid"
    kill -KILL "$pid" 2>/dev/null || true
  fi
done

rm -f "$PID_FILE"

if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  log "[경고] ${PORT} 포트가 아직 사용 중입니다."
  exit 1
fi

log "서버가 중지되었습니다."
