# Auto-deploy

Drop a LaserLog tarball into `/mnt/user/appdata/` and the container updates
itself within a few minutes. If anything goes wrong it puts the old one back.

## Install

1. Unraid → **Apps** → install **User Scripts** if you don't have it
2. **Settings → User Scripts → Add New Script**, name it `laserlog-autodeploy`
3. Click the gear → **Edit Script**, paste in `laserlog-autodeploy.sh`, save
4. Set the schedule to **Custom** and enter `*/5 * * * *`

That's every five minutes. It exits immediately when there's nothing to do, so
it costs nothing to run.

## Using it

Upload the tarball to `/mnt/user/appdata/`. Any name starting with `laserlog`
and ending `.tar.gz` is picked up — including `laserlog (1).tar.gz`, which is
what a phone saves when you download the same filename twice.

Within five minutes you get an Unraid notification saying what happened.

## What it checks, in order

| Check | If it fails |
|---|---|
| File still uploading | Left alone, retried next run |
| Readable `.tar.gz` | Renamed `.corrupt`, notified |
| Actually a LaserLog build | Renamed `.notlaserlog`, notified |
| Version differs from what's installed | Archived without rebuilding |
| Docker build succeeds | Source rolled back, container **never touched**, renamed `.buildfailed` |
| `/healthz` answers within 90s | Container and source both rolled back to the previous image |

The old image is kept as `laserlog:previous` for exactly that last case. Only
once the new container answers its health check does the tarball get archived
and the scratch image cleaned up.

## Where things go

```
/mnt/user/appdata/laserlog-src/
├── deploy.log              # everything it did, newest at the bottom
└── .deployed/
    ├── laserlog.tar.gz.1.1.2        # tarballs it has processed
    └── src-before-1.1.2-*.tar.gz    # source backups, last 10 kept
```

The log is trimmed to 1MB once it passes 5MB.

## If you change ports or paths

Everything configurable is at the top of the script, and the `docker run`
command is in one function called `run_container`. Nothing is hardcoded twice.

## Running it by hand

```
bash /boot/config/plugins/user.scripts/scripts/laserlog-autodeploy/script
```

Or hit **Run Script** in the User Scripts page. A `flock` stops two copies
overlapping, so a manual run during a scheduled one is safe.

## Turning it off

Set the schedule to **Disabled** in User Scripts. Nothing else to undo.
