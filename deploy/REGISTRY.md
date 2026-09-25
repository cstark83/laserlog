# Proper deploys: GitHub Actions → ghcr.io → Unraid

Push code, GitHub builds the image, Unraid offers it as an update like any
other container. Your array never builds anything.

Everything below is one-time except **Updating**, which is three commands.

---

## 1. Make the repo

On github.com → **New repository** → name it `laserlog`, set it **Private**,
don't add a README. Then on the server:

```
cd /mnt/user/appdata/laserlog-src
git init -b main
git remote add origin git@github.com:YOUR_USERNAME/laserlog.git
git add -A
git commit -m "LaserLog"
git push -u origin main
```

If it asks for a password, use a personal access token rather than your
GitHub password — GitHub stopped accepting passwords over HTTPS.

The push starts the build. **Actions** tab on GitHub shows it running; it
takes two or three minutes the first time and under a minute after that,
because the workflow caches its layers.

## 2. Make the package pullable

Your package is private, so Unraid needs to sign in once.

Create the token: GitHub → your avatar → **Settings** → **Developer settings**
→ **Personal access tokens** → **Tokens (classic)** → **Generate new token
(classic)**. Tick only **read:packages**. Set it to never expire, or you'll be
doing this again in a year. Copy it.

Use the classic kind, not fine-grained — fine-grained tokens are unreliable
against ghcr.io.

Then on the server:

```
docker login ghcr.io -u YOUR_USERNAME
```

Paste the token as the password. It's stored in `/root/.docker/config.json`
and survives reboots.

## 3. Switch the container over to a template

This is what gets you the **Edit** button back and makes Unraid's update check
work. Your data is in a volume, so nothing is lost.

Edit `laserlog.xml` and replace every `YOUR_GITHUB_USERNAME` with your GitHub
username in **lowercase** — ghcr.io rejects capitals. Then:

```
cp laserlog.xml /boot/config/plugins/dockerMan/templates-user/
docker stop laserlog && docker rm laserlog
```

Unraid → **Docker** → **Add Container** → pick **LaserLog** from the template
dropdown at the top. Check the port is 8420 and the paths match, then Apply.

It pulls from ghcr.io instead of using your locally built image, and from here
it behaves like every other container you run.

## 4. Turn on automatic updates

Unraid checks for new images hourly and shows **update ready** on the Docker
tab. To have it install them by itself: **Apps** → install **CA Auto Update
Applications** → Settings → enable it for LaserLog on whatever schedule suits.

---

## Updating, from then on

```
cd /mnt/user/appdata/laserlog-src
tar -xzf /mnt/user/appdata/laserlog.tar.gz -C . --strip-components=1
git add -A && git commit -m "v$(node -p "require('./package.json').version")" && git push
```

That's it. GitHub builds it, and Unraid picks it up within the hour — or hit
**Check for Updates** on the Docker tab if you want it now.

Nothing to build locally, nothing to stop and recreate, and the Edit button
works if you need to change a path.

## Rolling back

Every build is tagged with its version, so a bad release is a one-line fix:
edit the container in Unraid and change the Repository tag from `:latest` to
the version you want.

```
ghcr.io/YOUR_USERNAME/laserlog:1.1.2
```

Apply, and you're back. Switch it to `:latest` again once the next build is out.

## Checking what's published

```
docker run --rm ghcr.io/YOUR_USERNAME/laserlog:latest node -p "require('/app/package.json').version"
```

Or the **Packages** tab on your GitHub profile lists every tag.
