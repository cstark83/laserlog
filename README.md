# LaserLog

Self-hosted laser cutter / engraver settings library. Runs as one Docker
container on Unraid, installs on Android and iPhone as a home-screen app,
works with the wifi off, and syncs back to your server when it reconnects.

No account, no ads, no cloud, no subscription. One SQLite file you own.

---

## What it tracks

| | |
|---|---|
| **Machines** | Type, optical watts, bed size, controller, default speed unit |
| **Materials** | Name, category, thickness, colour, brand, supplier, link, cost per sheet/sq ft |
| **Settings** | Speed, power max/min, passes, line interval, DPI, air assist, focus offset, Z step, pass depth, frequency + pulse width (fiber), kerf, rating out of 5, outcome, notes, tags, photos |
| **Test grids** | Speed × power (or any two axes) matrices — tap each square to rate it, promote the winner straight into your library |
| **Projects** | Client, design file, quantity, run time, material cost, sale price, profit and profit per machine hour |
| **Finishes** | Paint fill, stain, sealer and masking — brand, product, colour, coats, dry and cure times, how the excess comes off |
| **Maintenance** | What was done to which machine, when, at what machine hours, and when it comes round again |

Plus: full-text search, filter by machine / material / operation / favourites,
side-by-side compare of up to four settings, duplicate, copy a setting as
plain text to paste in a forum, CSV export **and import**, full JSON backup
and restore, and a job timer that follows you around the app.

---

## Running a MOPA and a diode side by side

The two machines share almost no parameters, so the app treats them differently.

### Speed units are normalised

Your diode works in **mm/min** (GRBL). The fiber works in **mm/s**. LightBurn
files store mm/s regardless of what its UI shows. That means a library built
from both machines has both units in it, and `420 mm/min` and `7 mm/s` are the
same speed.

Every entry stores what you typed *and* a normalised mm/min value. Comparison,
sorting and the LightBurn export all use the normalised number, so the two
machines' settings can sit in one library without lying to you.

### Laser eyewear is recorded per machine

Machines carry a wavelength and the eyewear rating that goes with it, shown on
the machine list:

- **AtomStack X40 Max** — 450nm, needs OD5+ @ 450nm
- **DeBin DBF-100 MOPA** — 1064nm, needs OD5+ @ 1064nm

These are **not interchangeable**. Blue-diode glasses do nothing against a
1064nm fiber beam, which is invisible — there's no blink reflex to save you.
Fiber glasses do nothing against the blue diode. If you run both machines in
one shop, this is the field worth filling in.

### Colour palette (MOPA)

On stainless, a MOPA makes colour by controlling oxide thickness through
frequency, pulse width, speed, power and hatch spacing. Miss any of them and
you get a different colour. **More → Colour palette** stores each colour you
land on as a swatch with the exact numbers that produced it.

The built-in hints are directions to explore, not recipes. Colour depends on
your source, lens, alloy and surface prep — run a grid on scrap and record
what you actually get.

### Materials that should never go in either machine

The starter library ships with hazard flags:

- **PVC / vinyl** — releases chlorine gas. Corrodes the machine, harmful to
  breathe. Includes most faux leather and "vinyl" sign stock.
- **Polycarbonate (Lexan)** — burns and yellows instead of cutting. Not acrylic.
- **ABS** — melts, gives off cyanide compounds.
- **Fiberglass / carbon fibre** — toxic binder fumes, glass dust.
- **Bare copper / brass** — flagged *caution*: highly reflective at 1064nm, and
  back-reflection can damage a fiber source.

These are not just a field in the database. A red banner lists the "never" ones
at the top of the Materials screen, every affected row carries a badge, the
material dropdown on a setting prefixes them with a warning mark, and picking
one drops a full warning into the form before you have typed a single number.
You can flag your own the same way — **Materials → any material → Safety**.

---

## Test grids that generate their own file

Define a grid (**Tests → +**), then **Get the file**.

The `.lbrn` it produces has **one LightBurn layer per square, with that
square's settings already filled in** and the layer named with its values
(`F180 W45`). You open it, frame it, check the cut list and run it. There is no
transcribing a legend into thirty layers by hand, which is the step where
material tests usually go wrong.

- **Axes** include speed, power, passes, interval, focus, DPI and — for the
  MOPA — **frequency** and **pulse width**, which is the grid you actually want
  for colour work on stainless.
- **Held-constant values** you set on the grid are written into every layer.
- **Axis numbers are engraved** beside the rows and columns, so the burnt piece
  is readable on the bench without the app in your hand.
- **Cap is 30 squares** — LightBurn has 30 cut layers (C00–C29). 6×5 is the
  usual shape. Bigger grids are refused with a clear message rather than
  producing a file that silently drops layers.
- The `.svg` option is there for other software. It gives each square a
  distinct colour so LightBurn maps them to separate layers on import, but the
  **settings are not carried** — you'd fill them in yourself. Use the `.lbrn`.

**Confidence note:** the square geometry uses LightBurn's well-documented
`Rect` shape and round-trips correctly through this app's own LightBurn parser.
The engraved axis numbers are drawn as `Path` shapes, and the vertex format is
my best reading of the documented structure rather than something I could
verify against real LightBurn here. If the numbers come in wrong, switch
**Engrave the axis numbers** off — the squares and their settings are
unaffected.

---

## Lens and rotary

Two things make a fiber setting non-transferable, and both are recorded per
setting and per test grid:

- **Lens** (75 / 150 / 300mm). The same numbers through a different focal
  length give a different spot size and energy density. A colour recipe without
  its lens noted is not reproducible.
- **Rotary**, with the diameter. Curved-surface settings don't carry to flat
  work and vice versa.

---

## Sending settings back to LightBurn

`Settings → Export for LightBurn` produces a `.clb` material library.

- Grouped by material and thickness, the way LightBurn's library expects.
- Speeds converted to mm/s from the normalised value.
- Frequency written in Hz, pulse width as `QPulseWidth` in ns.
- By default it exports **proven** settings only — favourites and anything
  rated 4+. Add `?scope=all` for everything, `?machine_id=…` for one machine.

Export per machine. A library mixing 100W fiber marking settings with 40W diode
cutting settings is worse than no library.

**Confidence note:** this is built from LightBurn's documented library
structure, not from a file you gave me. Import one into a scratch LightBurn
profile before you rely on it, and if the shape is off, send me a real `.clb`
and I'll match it exactly.

---

## Backups

- A copy is taken at startup and nightly, using SQLite's online backup API, so
  a copy taken while the app is running is still consistent.
- A snapshot is taken **before any restore**, because restoring the wrong file
  should be recoverable rather than terminal.
- Kept in `/data/backups`, most recent 14 automatic ones (`BACKUP_KEEP` to
  change). Pre-restore snapshots are never pruned.
- **Every backup is opened and checked the moment it is written** — pages
  verified, schema version read, row counts taken. A backup nobody has ever
  opened is a guess, not a backup, so if one fails its check it says so in the
  container log instead of sitting there looking fine.

**Settings → Snapshots on the server** lists what is actually on disk, takes
one on demand, and has a **Check** button per file that opens it and tells you
what it would restore — "Restores fine — 412 entries · 38 materials · 2
machines". If a snapshot predates a table, it says which one, so you know what
restoring it would cost you.

Photos still live as files in `/data/uploads` — back up the whole `/data`
folder and you have everything.

### Getting data in

- **Restore from backup** takes a JSON export back in. It snapshots what is
  there first, then merges by id.
- **Import settings from a CSV** takes a spreadsheet — yours, or one somebody
  in a forum posted. It recognises the obvious column names (`machine`,
  `material`, `thickness`, `operation`, `speed`, `power`, `passes`, `notes`,
  and a few dozen aliases), creates any machine or material it names that you
  do not already have, and skips rows that duplicate something already in the
  library. It tells you exactly what it did.

---

## Finishes

Half the look of a finished product happens after the laser and none of it was
being written down. **More → Finishes** records what you actually used:

- What it is — paint fill into an engraving, paint over a surface, stain,
  sealer, masking, patina
- What it goes on, the brand and the actual can or pen, the colour with a
  swatch
- What you masked with, what you applied it with, and how many coats
- **Dry time between coats and cure time before handling** — the number that
  decides whether a batch can be boxed tonight or has to wait
- How the excess comes off, which is the part that goes wrong
- A rating and notes, and a link to the supply it comes out of so the cost
  lands in your product costing

The last two are the ones worth writing down honestly. "Bleeds under tape if
the engrave is deeper than 0.4mm" is worth more in six months than the brand
name.

---

## Maintenance

**More → Maintenance** logs what has been done to each machine — lens cleaned,
window replaced, belts checked — with the date, the machine hours at the time,
what it cost and the part number to reorder.

Give a job a repeat interval in **days**, in **machine hours**, or both, and
whichever comes round first is what it warns on. Anything overdue shows at the
top of the Maintenance screen and again as a red card on the **Bench**, so it
is in front of you rather than in a folder.

When you do a job again, open the old entry and hit **Did it again** — it logs
a fresh one for today and leaves the history intact, which is the whole point
of keeping it.

---

## The job timer

Run time is the number everyone guesses and nobody measures, and it is the one
that decides whether a price is right.

Open any setting and hit **Start timer**. A bar appears at the top of the app
and follows you from screen to screen — it survives navigating, locking the
phone, closing the tab and losing the wifi, because the start time is stored
locally rather than held in memory. Hit **Stop** and it opens a new project
with the run time already filled in. There is also a **Time this run** button
next to the run-time field on any project.

---

## Inventory, products and pricing

### Inventory is what you buy

Each supply records how you buy it — by the sheet, each, by the can, by the
millilitre. Every purchase is logged with the quantity and what you paid, and
the unit cost used in costing is the **weighted average across every purchase**.
Type it once and forget it and your costs go stale; record the buys and a price
rise shows up in your pricing on its own. The item view shows the current
average, the last price paid, and which way it moved.

Stock goes up when you record a buy and down when you build a product. Set a
reorder threshold and low items are flagged on the inventory screen.

### Products are recipes

A product lists the supplies it consumes, how much of each, and the time it
takes. Three separate times, because they behave differently:

| | |
|---|---|
| **Setup** | Charged once per batch. This is why 40 costs less each than 4. |
| **Machine** | Per run. Costed at your machine rate. |
| **Yours** | Per run. Costed at your hourly rate. |

Units convert. Buy basswood by the 300×600mm sheet, consume it as 72 square
inches, and the app works out that's 0.258 of a sheet and costs it accordingly.
Same for a roll consumed by the inch, or a bottle consumed by the millilitre.
If a conversion isn't meaningful it says so rather than silently costing zero.

Set `makes per run` to what one run produces — a coaster file that cuts four at
once makes 4.

### Three prices

Online, market/fairs, and friends & family, each with its own markup and fee
percentage, editable under **Products → Rates**.

**Fees are grossed up, not added on.** If a marketplace takes 9.5% and you want
to keep $33, the app lists at 33 ÷ 0.905 = $36.46, not $36.14. Adding the
percentage leaves you short on every sale and the gap widens as prices rise.
The price cards show what you list, what you keep after fees, and the profit.

**Profit here is after paying yourself.** Your labour is inside the cost at
your hourly rate, so a product showing $0 profit still paid you for your time —
it just didn't earn anything beyond that. That's the honest way round.

### Linking a product to how it is made

A product can point at the **setting** it runs at and the **design file** it
comes from. Both then appear as buttons on the pricing sheet, so a repeat
order is one tap to the numbers and one tap to download the file, instead of
hunting through two screens for something you set up months ago.

### Making a batch

Open a product, pick a batch size, and the prices recalculate with setup spread
across the batch. Hit **I made N** and the stock comes out of inventory, with a
project logged in your job history. If stock goes negative it tells you what
you were short of rather than refusing — you've already made the thing.

**Set your rates first.** The defaults ($25/hr labour, $8/hr machine) are
placeholders, not advice. The machine rate should cover power, consumables,
lens wear and eventual replacement; work out what yours actually is.

---

## Cataloguing files you already have (Nextcloud)

LaserLog can read a folder of files you already keep — a Nextcloud data
directory, a share, any folder — and build a catalogue of it.

**It never writes to that folder.** Mount it read-only and the guarantee is
enforced by Docker, not by trust in my code.

### Point it at Nextcloud

Nextcloud keeps each user's files in a plain directory tree, usually:

```
/mnt/user/appdata/nextcloud/data/<username>/files/...
```

Mount that into the container read-only — note the `:ro`:

```bash
-v /mnt/user/appdata/nextcloud/data/chris/files:/nextcloud:ro
```

Then in the app: **Files → Sources → Connect a folder**, set the folder to
`/nextcloud`, optionally set a subfolder (`Laser`, say) to limit the scan, hit
**Test**, then **Save & scan**.

If Nextcloud is on a different machine, pick **Over the network (WebDAV)**
instead and give it the address, your username and a Nextcloud app password
(Nextcloud → Settings → Security → Create new app password). Don't use your
real account password.

### What a scan does

- Walks the folder and records every laser-ish file it finds: `.lbrn`,
  `.lbrn2`, `.svg`, `.dxf`, `.ai`, `.pdf`, images, `.gcode`/`.nc`, `.stl`, and
  common documents. Everything else is ignored.
- Skips Nextcloud's own plumbing — `files_trashbin`, `files_versions`, hidden
  folders, `Thumbs.db`.
- **Skips whatever else you tell it to.** A Nextcloud data folder holds a lot
  that is not laser work. **Files → Sources → your source → Skip these folders**
  takes one per line: a plain name (`Downloads`) skips that folder wherever it
  turns up, a name with a slash (`Admin/Backups`) skips exactly that path.
  Anything already catalogued from a folder you add there is dropped on the
  next scan rather than left sitting in the list.
- Suggests a category from the folder each file sits in, so a tree you've
  already organised arrives mostly sorted.
- **Opens your LightBurn files and reads their cut settings.** `.lbrn` and
  `.lbrn2` are plain XML that carry their own speed, power, passes, interval,
  DPI, air assist, frequency and pulse width. One tap turns those into real
  entries in your settings library — no retyping. Layers with output switched
  off are skipped, since they weren't part of the real job.
- Pulls out the thumbnail LightBurn embeds in the file, so the grid shows you
  the actual design.

**Note on speed units:** LightBurn stores speed in **mm/sec** inside the file
regardless of what the UI shows you. Imported entries are labelled mm/s
accordingly — if your machine profile works in mm/min, the number will look
small until you convert it.

Rescanning is safe and cheap. Files you've already categorised keep their
category, tags, notes and links; a rescan only refreshes size and timestamps
and picks up what's new. A file that's disappeared is flagged **missing**
rather than deleted, so your notes survive an unmounted share.

**If the share is not mounted**, an Unassigned Device looks like an empty
folder rather than an error — so a scan that finds nothing at all, while the
catalogue has rows in it, is refused outright and changes nothing. If more
than half the catalogue goes missing in one scan, the result says so, because
that is almost always the mount and not the files.

### Sorting a big pile

After the first scan you may have tens of thousands of files. The grid loads
200 at a time with a **Load more** button, so the screen opens fast whatever
the catalogue size; search and the filter chips always work across the whole
lot, not just what is on screen.

**Select** → tap the ones that belong together → **Categorise** sets a
category, adds tags and assigns a material or machine to all of them at once.

### Caveats, honestly

- WebDAV app passwords are stored in the database in plain text. `/data` is
  yours alone, but if that bothers you, use the read-only mount instead — it
  needs no credentials at all.
- Removing a file from the catalogue only forgets it in LaserLog. Nothing is
  ever deleted from your server.
- The LightBurn parser reads tags it recognises and keeps anything it doesn't
  under `extra`. LightBurn changes its format between versions; if a field
  comes through blank, that's why, and the rest of the import still works.
- Filenames with characters outside Latin-1 — em-dashes, curly apostrophes,
  emoji, CJK — are served with an RFC 5987 `filename*` header and an ASCII
  fallback. Your browser gets the real name; the underscored fallback is only
  what very old clients would see.

---

## Install on Unraid

### The short version

```bash
# on the Unraid box, in a folder you keep source in
mkdir -p /mnt/user/appdata/laserlog
cd /boot/config/plugins/dockerMan   # or wherever you keep build folders
# copy the laserlog folder here, then:
cd laserlog
docker build -t laserlog:latest .
docker run -d \
  --name laserlog \
  --restart unless-stopped \
  -p 8420:8080 \
  -v /mnt/user/appdata/laserlog:/data \
  -e PUID=99 -e PGID=100 \
  -e TZ=America/Indianapolis \
  -e AUTH=on \
  laserlog:latest
```

Then open `http://<your-unraid-ip>:8420` and create your account.

### With the Unraid template

1. Copy `laserlog.xml` to `/boot/config/plugins/dockerMan/templates-user/`
   on the flash drive.
2. Build the image once: `docker build -t laserlog:latest .`
3. Unraid → **Docker** → **Add Container** → pick **LaserLog** from the
   template dropdown at the top.
4. Check the port and the appdata path, hit Apply.

### With docker compose

```bash
docker compose up -d --build
```

Edit the port and `TZ` in `docker-compose.yml` first if you want something
other than 8420.

---

## Settings

| Variable | Default | What it does |
|---|---|---|
| `AUTH` | `on` | `on` = username + password, created on first visit. `off` = no login at all — only sensible if it's LAN-only behind something else. |
| `PUID` / `PGID` | `99` / `100` | Owner of the data folder. Unraid's `nobody:users`. |
| `PORT` | `8080` | Port inside the container. Map it with `-p`, don't change this. |
| `DATA_DIR` | `/data` | Where the database and photos live. |
| `MAX_UPLOAD_MB` | `15` | Largest photo accepted. Photos are shrunk to 1600px on the phone before upload, so this is generous. |
| `AUTO_BACKUP` | `on` | `off` disables the startup and nightly snapshots. |
| `BACKUP_KEEP` | `14` | How many automatic snapshots to keep. |
| `TZ` | unset | Container timezone. |

Login is rate-limited to 10 failed attempts per IP per 15 minutes. It is a box
on your own LAN, but if it ever ends up behind a port forward, an unlimited
login endpoint is the first thing that gets found.

Everything lives in `/data`:

```
/data
├── laserlog.db        # SQLite — this is your whole library
├── laserlog.db-wal    # write-ahead log
├── backups/           # verified snapshots, startup + nightly
└── uploads/           # photos, as uploaded
```

Back up that folder and you've backed up everything. The in-app JSON export
covers the database but **not** the photo files — for a complete backup, copy
the folder.

---

## Putting it on your phone

It's a progressive web app. Both phones install it from the browser and both
talk to the same database on your server.

**Android (Chrome)**
1. Open `http://<unraid-ip>:8420`
2. ⋮ menu → **Install app** (or **Add to Home screen**)

**iPhone (Safari — it has to be Safari, not Chrome)**
1. Open `http://<unraid-ip>:8420`
2. Share button → scroll down → **Add to Home Screen**

It gets its own icon, opens full-screen with no browser chrome, and the whole
library is readable with no signal. Anything you log while disconnected is
queued and pushed the moment you're back on the network — the banner at the
top tells you when something's waiting.

### Reaching it away from home

Your server isn't on the public internet, and it shouldn't be. Options, best
first:

1. **Tailscale** — install it on the Unraid box and both phones. The app then
   works anywhere with no ports open. This is what I'd do.
2. **Your existing VPN** back to the house.
3. **Reverse proxy** (SWAG, NPM, Traefik) with a real certificate and
   `AUTH=on`.

Don't port-forward 8420 to the internet with `AUTH=off`. That's your whole
library, world-writable.

Note that iOS is stricter about evicting storage for sites added over plain
`http://`. If you rely on offline access away from the house, put it behind
HTTPS via one of the options above.

---

## How syncing works

Every device keeps a local mirror in IndexedDB.

- **Reading offline** comes from that mirror. The header says "Offline" so you
  know the numbers might be stale.
- **Writing offline** goes into a queue. When the network returns the queue is
  replayed against `POST /api/sync`.
- **Conflicts** are last-write-wins, compared on `updated_at`. If your queued
  change is older than what the server already has, the server keeps its
  version and the app tells you it was overwritten rather than silently
  dropping one.

That's honest about what it is: it's good enough for one person with a phone
and a laptop, and it is not a CRDT. If you edit the same setting on two
devices while both are offline, the one that syncs last wins.

---

## API

Everything the UI does is available over HTTP. With `AUTH=on`, grab a bearer
token from **Settings → Copy API token**.

```bash
curl -H "Authorization: Bearer $TOKEN" http://unraid:8420/api/entries
curl -H "Authorization: Bearer $TOKEN" http://unraid:8420/api/entries?q=plywood
curl -H "Authorization: Bearer $TOKEN" http://unraid:8420/api/export/csv
```

| Method | Path | |
|---|---|---|
| GET/POST | `/api/entries` | Settings. Filters: `q`, `machine_id`, `material_id`, `operation`, `favorite`, `min_rating`, `tag` |
| GET/PUT/DELETE | `/api/entries/:id` | |
| POST | `/api/entries/:id/duplicate` | |
| GET/POST/PUT/DELETE | `/api/machines`, `/api/materials`, `/api/projects`, `/api/tests`, `/api/finishes`, `/api/maintenance` | Add `?archived=1` to include archived rows |
| GET/POST/PUT/DELETE | `/api/supplies`, `/api/products` | |
| GET | `/api/products/:id/costing?qty=` | Three prices for a batch of `qty` |
| POST | `/api/products/:id/build` | Take the materials out of stock |
| GET | `/api/files?limit=&offset=` | Paged. Returns `{ total, limit, offset, files }` |
| POST | `/api/sources/:id/scan` | 400 with a plain message if the root is empty |
| PUT | `/api/tests/:id/cells/:col/:row` | Rate one square of a grid |
| POST | `/api/tests/:id/promote` | Turn the winning square into a saved setting |
| POST | `/api/photos` | multipart: `photo`, `entity_type`, `entity_id` |
| GET/POST | `/api/sync` | Delta pull with `?since=`, batch push |
| GET | `/api/export/json`, `/api/export/csv`, `/api/export/lightburn` | |
| POST | `/api/import/json` | Body `{ tables, mode }`, mode `merge` (default) or `replace` |
| POST | `/api/import/csv` | Body `{ csv }` — see Getting data in |
| GET/POST | `/api/backups` | List, or take one now |
| POST | `/api/backups/:name/verify` | Open it and prove it would restore |
| GET | `/healthz`, `/api/health` | No auth. Returns app and schema version |

Deletes are soft — rows keep a `deleted_at` so other devices learn about the
removal on their next sync.

---

## Updating

```bash
cd /path/to/laserlog
docker build -t laserlog:latest .
docker stop laserlog && docker rm laserlog
# re-run the same docker run command, or hit Apply in the Unraid template
```

Your data is in `/mnt/user/appdata/laserlog` and isn't touched. The schema
migrates itself forward on boot — the container logs the version it moved to.

After updating, the phone may hold the old app shell in its cache. Pull down
to refresh once, or close the app and reopen it, and the new service worker
takes over. Your data is on the server either way.

---

## Built with

Node 22, Express, better-sqlite3, and a vanilla-JS front end with no build
step and no CDN — every asset is served from the container, so it keeps
working whether or not the machine has internet.
