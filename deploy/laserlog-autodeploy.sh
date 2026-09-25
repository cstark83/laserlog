#!/bin/bash
#
# LaserLog auto-deploy.
#
# Drop a laserlog tarball anywhere in $DROP_DIR and this picks it up, builds it
# and swaps the container over. If the build fails or the new container doesn't
# come up healthy, it puts the old one back and tells you.
#
# Install: Unraid → Plugins → User Scripts → Add New Script → paste this →
#          set the schedule to Custom, */5 * * * *
#
# Everything it does is appended to $LOG.

set -uo pipefail

# ----------------------------------------------------------------- config
NAME="laserlog"                       # container name
IMAGE="laserlog"                      # image name
HOST_PORT=8420
DROP_DIR="/mnt/user/appdata"          # where you upload the tarball
SRC_DIR="/mnt/user/appdata/laserlog-src"
DATA_DIR="/mnt/user/appdata/laserlog"
NEXTCLOUD_DIR="/mnt/disks/Plex_Data/nextcloud_data/Laser/files"
ARCHIVE_DIR="$SRC_DIR/.deployed"      # processed tarballs land here
LOG="$SRC_DIR/deploy.log"
HEALTH_TIMEOUT=90                     # seconds to wait for the new container

# The run command, kept in one place. Edit here if you ever change ports.
run_container() {
  docker run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -p ${HOST_PORT}:8080 \
    -v "${DATA_DIR}":/data \
    -v "${NEXTCLOUD_DIR}":/nextcloud:ro \
    -e PUID=99 -e PGID=100 -e AUTH=on \
    -e TZ=America/Indiana/Indianapolis \
    "$1" >/dev/null
}

# ------------------------------------------------------------------ setup
mkdir -p "$ARCHIVE_DIR"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG"; }

# Docker build output goes in here on every deploy, so cap it rather than
# letting it quietly eat the array over a couple of years.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5000000 ]; then
  tail -c 1000000 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
  log "(log trimmed to the last 1MB)"
fi

# Same for old source backups — keep the last ten, they are only a rollback net.
ls -1t "$ARCHIVE_DIR"/src-before-*.tar.gz 2>/dev/null | tail -n +11 | while read -r f; do
  rm -f "$f"
done

# Unraid's notification system, so a failure reaches you rather than the log.
notify() {
  local sev="$1" subj="$2" body="$3"
  local n="/usr/local/emhttp/webGui/scripts/notify"
  [ -x "$n" ] && "$n" -e "LaserLog" -s "$subj" -d "$body" -i "$sev" >/dev/null 2>&1
}

# Only one deploy at a time. A slow build must not overlap the next cron tick.
exec 9>"${SRC_DIR}/.deploy.lock"
flock -n 9 || exit 0

# -------------------------------------------------- find a tarball to deploy
# laserlog*.tar.gz catches "laserlog (1).tar.gz", which is what a phone saves
# when you download the same name twice.
TARBALL="$(find "$DROP_DIR" -maxdepth 1 -name 'laserlog*.tar.gz' -printf '%T@ %p\n' 2>/dev/null \
           | sort -rn | head -1 | cut -d' ' -f2-)"
[ -z "${TARBALL:-}" ] && exit 0

# An upload still in flight looks like a complete file. Wait for it to settle.
size1=$(stat -c %s "$TARBALL" 2>/dev/null || echo 0)
sleep 5
size2=$(stat -c %s "$TARBALL" 2>/dev/null || echo 0)
if [ "$size1" != "$size2" ] || [ "$size2" -eq 0 ]; then
  log "still uploading ($size1 -> $size2 bytes), leaving it for next run"
  exit 0
fi
# Past this point the size is stable, so the file is whatever it is going to be.
# Whether it is any good is the tar check's job, not a size guess — otherwise a
# small corrupt file sits in the drop folder being retried forever.

# A truncated or corrupt archive must never reach the build.
if ! tar -tzf "$TARBALL" >/dev/null 2>&1; then
  log "REJECTED $TARBALL — not a readable tar.gz"
  mv "$TARBALL" "${TARBALL}.corrupt"
  notify "warning" "LaserLog update rejected" "The uploaded file is not a readable archive."
  exit 1
fi
if ! tar -tzf "$TARBALL" | grep -q '^laserlog/package.json$'; then
  log "REJECTED $TARBALL — does not look like a LaserLog build"
  mv "$TARBALL" "${TARBALL}.notlaserlog"
  notify "warning" "LaserLog update rejected" "That archive isn't a LaserLog build."
  exit 1
fi

# ------------------------------------------------------- version comparison
ver_of() { grep -m1 '"version"' | sed 's/.*"version": *"\([^"]*\)".*/\1/'; }
NEW_VER="$(tar -xzOf "$TARBALL" laserlog/package.json | ver_of)"
OLD_VER="$(ver_of < "$SRC_DIR/package.json" 2>/dev/null || echo "none")"

if [ "$NEW_VER" = "$OLD_VER" ]; then
  log "already on $NEW_VER — archiving $(basename "$TARBALL") without rebuilding"
  mv -f "$TARBALL" "$ARCHIVE_DIR/$(basename "$TARBALL").$NEW_VER"
  exit 0
fi

log "=== deploying $OLD_VER -> $NEW_VER from $(basename "$TARBALL") ==="

# ------------------------------------------------------------------ backup
BACKUP="$ARCHIVE_DIR/src-before-$NEW_VER-$(date +%Y%m%d_%H%M%S).tar.gz"
tar -czf "$BACKUP" -C "$(dirname "$SRC_DIR")" "$(basename "$SRC_DIR")" 2>/dev/null \
  && log "source backed up to $(basename "$BACKUP")"

# ----------------------------------------------------------------- extract
if ! tar -xzf "$TARBALL" -C "$SRC_DIR" --strip-components=1; then
  log "FAILED to extract — rolling source back"
  tar -xzf "$BACKUP" -C "$(dirname "$SRC_DIR")"
  notify "alert" "LaserLog update failed" "Could not extract the archive. Nothing changed."
  exit 1
fi

# ------------------------------------------------------------------- build
# Build to a scratch tag first, so a failed build cannot replace a working image.
if ! docker build -t "${IMAGE}:incoming" "$SRC_DIR" >> "$LOG" 2>&1; then
  log "BUILD FAILED — rolling source back, container untouched"
  rm -rf "${SRC_DIR:?}/"* 2>/dev/null
  tar -xzf "$BACKUP" -C "$(dirname "$SRC_DIR")"
  mv -f "$TARBALL" "$ARCHIVE_DIR/$(basename "$TARBALL").buildfailed"
  notify "alert" "LaserLog update failed" "Build error on $NEW_VER. Still running $OLD_VER. See deploy.log."
  exit 1
fi
log "build ok"

# ------------------------------------------------------------------- swap
# Keep the working image so there is something to go back to.
docker tag "${IMAGE}:latest" "${IMAGE}:previous" 2>/dev/null \
  && log "previous image kept as ${IMAGE}:previous"
docker tag "${IMAGE}:incoming" "${IMAGE}:latest"

docker stop "$NAME" >/dev/null 2>&1
docker rm "$NAME" >/dev/null 2>&1
run_container "${IMAGE}:latest"

# ----------------------------------------------------------- health check
healthy=0
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -sf --max-time 2 "http://localhost:${HOST_PORT}/healthz" >/dev/null 2>&1; then
    healthy=1; break
  fi
  sleep 1
done

if [ "$healthy" = 1 ]; then
  RUNNING="$(curl -s --max-time 3 "http://localhost:${HOST_PORT}/healthz")"
  log "HEALTHY — $RUNNING"
  log "$(docker logs --tail 5 "$NAME" 2>&1)"
  mv -f "$TARBALL" "$ARCHIVE_DIR/$(basename "$TARBALL").$NEW_VER"
  docker image rm "${IMAGE}:incoming" >/dev/null 2>&1
  notify "normal" "LaserLog updated to $NEW_VER" "Was $OLD_VER. Container healthy on port ${HOST_PORT}."
  log "=== done ==="
  exit 0
fi

# ---------------------------------------------------------------- rollback
log "NOT HEALTHY after ${HEALTH_TIMEOUT}s — rolling back to $OLD_VER"
log "$(docker logs --tail 30 "$NAME" 2>&1)"
docker stop "$NAME" >/dev/null 2>&1
docker rm "$NAME" >/dev/null 2>&1

if docker image inspect "${IMAGE}:previous" >/dev/null 2>&1; then
  docker tag "${IMAGE}:previous" "${IMAGE}:latest"
  run_container "${IMAGE}:latest"
  rm -rf "${SRC_DIR:?}/"* 2>/dev/null
  tar -xzf "$BACKUP" -C "$(dirname "$SRC_DIR")"
  log "rolled back to $OLD_VER"
  notify "alert" "LaserLog update rolled back" "$NEW_VER would not start. Back on $OLD_VER. See deploy.log."
else
  log "NO PREVIOUS IMAGE — cannot roll back automatically"
  notify "alert" "LaserLog is down" "$NEW_VER would not start and there is no previous image. Needs you."
fi

mv -f "$TARBALL" "$ARCHIVE_DIR/$(basename "$TARBALL").unhealthy"
exit 1
