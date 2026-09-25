#!/bin/sh
# Unraid hands containers a PUID/PGID (99:100 by default) so files on the
# array end up owned by nobody:users instead of root. Honour that, then drop
# privileges before starting node.
set -e

PUID=${PUID:-99}
PGID=${PGID:-100}
DATA_DIR=${DATA_DIR:-/data}

if [ "$(id -u)" = "0" ]; then
  # Reuse the group if that GID already exists, otherwise make one.
  if ! getent group "$PGID" >/dev/null 2>&1; then
    groupadd -g "$PGID" laserlog 2>/dev/null || true
  fi
  GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)

  if ! getent passwd "$PUID" >/dev/null 2>&1; then
    useradd -u "$PUID" -g "$PGID" -M -s /usr/sbin/nologin laserlog 2>/dev/null || true
  fi
  USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)

  mkdir -p "$DATA_DIR/uploads"

  # Only chown when it's actually wrong — a big uploads folder on a spun-down
  # array shouldn't be walked on every restart.
  if [ "$(stat -c '%u' "$DATA_DIR")" != "$PUID" ] || \
     [ "$(stat -c '%g' "$DATA_DIR")" != "$PGID" ]; then
    echo "[laserlog] setting ownership of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR"
  fi

  echo "[laserlog] starting as ${USER_NAME:-$PUID}:${GROUP_NAME:-$PGID}"
  exec gosu "$PUID:$PGID" "$@"
fi

# Already running unprivileged (docker run --user ...).
mkdir -p "$DATA_DIR/uploads" 2>/dev/null || true
exec "$@"
