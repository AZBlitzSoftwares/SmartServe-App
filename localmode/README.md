# Local Server - offline standby for Janu's Smart Serve

When the venue internet is slow or gone, **one laptop runs the whole event** over the event router:
captain tablets, guest tablets, waiter phones, the desk and the Print Hub all talk to the laptop instead
of the cloud. It is the same app with a copy of the event's data, so every event type works
(guest self-service, captain service, captain multi-kitchen, Smart Serve Maestro).

- **Plan A** (normal): everything runs on the cloud, as always.
- **Plan B** (bad internet): switch every device to the laptop. The laptop sends its orders to the
  cloud by itself whenever there is some internet, and once more after the event.

Use the launchers in this folder (double-click). Mac: the `.command` files. Windows: the `.bat` files.

| Launcher | When |
|---|---|
| **Prepare Event** | The day before, at the office, with internet |
| **Refresh Event Data** | At the venue, just before switching to Plan B (if there is any internet) |
| **Start Local Server** | Plan B: runs the event from the laptop. Keep the window open |
| **Start Print Hub (Local)** | Plan B: the Print Hub, printing from the laptop |
| **Upload to Cloud** | After the event, with internet |
| **Open Desk** | The Control Desk in its own Chrome window that prints KOTs without the print dialog (see "Printing from the desk") |

---

## The simple way: the Offline Kit (any laptop, no technical set-up)

Control Desk > **Control** tab > **Offline kit** > **Download for Windows** or **Download for Mac**.
The kit is made with every deploy, so it always matches the app. The laptop needs only **Node.js**
(nodejs.org, LTS): no Git, no code to build, no database password - the kit already carries the
cloud's address and its public key. Unzip it and follow `READ ME FIRST.txt`:

| Kit launcher | When |
|---|---|
| **1 Prepare Event** | The day before, with internet (first time: also downloads its parts, about 150 MB) |
| **2 Refresh Event Data** | At the venue, just before switching to Plan B (if there is any internet) |
| **3 Start Local Server** | Plan B: runs the event from the laptop. Keep the window open |
| **4 Start Print Hub** | Plan B: prints the KOTs from the laptop |
| **5 Upload to Cloud** | After the event, with internet |
| **6 Open Desk** | The Control Desk in its own Chrome window: KOTs print by themselves on the laptop's default printer, no print dialog. The laptop's desk while the Local Server runs (Start Local Server opens it by itself), otherwise the cloud desk |

- One laptop can carry several events of the same day (type `1,2` in Prepare Event). Events at
  different venues: one laptop per venue. Never two laptops for the same event.
- Devices move to the laptop with **Use laptop server**: tablets behind the Device button
  (supervisor PIN), kitchen screens in their menu, the desk on the Offline kit card.
- Everything below (Plan B, after the event, troubleshooting) applies to the kit as well; the
  kit's files are in its `files` folder (`files/localmode` = this folder).
- The sections "One-time setup" and "The day before" describe the technical route (Git and the
  database connection string), which also copies the cloud's exact structure.

---

## One-time setup (at the office)

You need a Mac (Apple Silicon or Intel) or a Windows 10/11 laptop, with its charger.

1. **Install Node.js**: go to **nodejs.org**, download the **LTS** version, install it (Next/Continue until Finish).
2. **Install Git**: Windows: **git-scm.com** -> Download -> install with the default answers.
   Mac: open **Terminal**, type `git --version`, press Enter, and accept the offer to install the developer tools.
3. **Get the Smart Serve code** (ask the technical team for the repository link and the branch to use).
   Open Terminal (Mac) or Command Prompt (Windows) and type, one line at a time:
   ```
   cd Documents
   git clone <repository link> smartserve
   cd smartserve
   git checkout <branch>
   npm install
   ```
   `npm install` takes a few minutes. It is needed once, so the laptop can build the app.
4. Open the folder `smartserve/localmode` and double-click **Prepare Event**.
   The first time it installs its own parts and then creates a file called `config.json` and stops.
   - Mac says *cannot be opened because it is from an unidentified developer*: right-click the file -> **Open** -> **Open**. Once per launcher.
   - Windows says *Windows protected your PC*: **More info** -> **Run anyway**.
5. Open `config.json` (Mac: TextEdit, Windows: right-click -> Open with -> Notepad) and paste, inside the quote marks:
   - `anonKey`: Supabase -> Project Settings -> API -> **anon public** key.
   - `dbUrl`: Supabase -> **Connect** (top of the project page) or Project Settings -> Database ->
     **Connection string** -> **URI**, method **Session pooler**. It looks like
     `postgresql://postgres.kapmreqrhlifxuzjjejz:[YOUR-PASSWORD]@aws-0-....pooler.supabase.com:5432/postgres`.
     Replace `[YOUR-PASSWORD]` **including the brackets** with the database password
     (if nobody knows it: Project Settings -> Database -> Reset database password; use letters and numbers only).

   Save the file. Leave `port` at 8080 and `events` empty.
6. Windows only: if Prepare Event says the laptop needs **Visual C++ Redistributable**, its installer opens:
   click **Install**, then **Yes**. Then run Prepare Event again.
7. **Give the laptop a fixed address on the event router**, so the links never change.
   In the router's admin page (often `http://192.168.1.1`, password on the router label) find
   **DHCP reservation** / **Address reservation**, choose this laptop (connected by **cable**) and give it
   e.g. **192.168.1.10**. Write the links on a card for the team:
   - Captain and guest tablets: `http://192.168.1.10:8080/`
   - Waiter phones: `http://192.168.1.10:8080/waiter`
   - Desk: `http://192.168.1.10:8080/supervisor`
   - Smart Serve Maestro kitchen screens (barkers): `http://192.168.1.10:8080/kitchen`
8. **Power**: set the laptop never to sleep when plugged in, and keep the lid open during the event.
   (Mac: System Settings -> Battery/Energy. Windows: Settings -> System -> Power.)
9. Do one test run (next section), so the **firewall question** is answered at the office, not at the venue:
   - Windows: *Windows Defender Firewall has blocked some features* -> tick **Private networks** -> **Allow access**.
   - Mac: *Do you want the application "node" to accept incoming network connections?* -> **Allow**.

---

## The venue network (read before every event)

The laptop serves every device in the hall. What slows an event down is almost always the network,
not the laptop. Set it up like this:

1. **The laptop is on a cable** to the main router (LAN port), never on Wi-Fi. On Wi-Fi the laptop
   shares the air with every tablet and every answer goes through the air twice.
2. **A second router for a big hall = an Access Point**, joined to the main router by a LAN cable
   (up to about 100 m with Cat6). In the second router's settings choose **Access Point mode**
   (sometimes "AP mode" or "Bridge"), or switch its **DHCP off** and plug the cable into one of its
   **LAN** ports (not WAN). Then every device, on either router, is on the same network as the laptop.
   Two routers each in normal router mode do **not** work: tablets on the second one cannot reach the laptop.
3. **Same Wi-Fi name and password** on both routers is fine (devices join the nearest one).
   Put one router at each end of the hall. Plan for **about 25 devices per router**.
4. **5 GHz** for the tablets wherever the router offers it (a separate "-5G" name, or one name with
   band steering). Turn off any "guest network" / "client isolation" / "AP isolation" setting: it stops
   tablets reaching the laptop.
5. **No phone hotspot or laptop hotspot** as the event network (they allow only 5-10 devices).
6. **Windows laptop**: the network must be **Private** (Settings -> Network -> the connection ->
   Private), and the firewall question answered with **Allow** on Private networks. Set the laptop to
   never sleep, plugged in, lid open.
7. Keep the **welcome video short and small** (a 720p clip of 10-20 MB). Each tablet downloads it from
   the laptop **once** and keeps it; a 200 MB video is 200 MB per tablet at the start of the event.

---

## The day before (with internet)

1. Finish the event set-up on the cloud first (menu, kitchens and printers, captains, waiters, PINs).
   Changes made later reach the laptop only through **Refresh Event Data**.
2. Double-click **Prepare Event**. It lists the events of the coming days: type the event's number, press Enter.
   (Next time the event downloaded before is marked with `*`: just press Enter to keep it.)
   It takes about a minute. At the end it shows **DONE** and a short summary.
   The full report is in `localmode/data/prepare-report.txt`. Some lines under *NOT created on the laptop*
   are normal (parts of the cloud that only exist on Supabase, such as sign-in).
3. Test: double-click **Start Local Server**, open the captain link on one tablet that is on the same
   Wi-Fi, check the menu and pictures, then press **Ctrl+C** in the server window.
   **Do not place test orders** - the laptop would later send them to the cloud as real orders.
   (To practise with orders, use test mode instead: `docs/TEST_ON_MAC.md`.)

---

## At the venue

Connect the laptop to the **event router** and plug it in, even on Plan A.

### Plan A - the cloud (normal)

Everything as usual: devices on the normal link, Print Hub with **Start Print Hub** (in the `printhub` folder).

### Plan B - switch to the laptop

Decide once, then switch **all** devices. Stay on Plan B until the event ends.

1. **If there is any internet**: double-click **Refresh Event Data** (about a minute). It brings the
   orders taken so far and any last changes to the laptop. No internet at all? Skip this step - the
   laptop still has everything from Prepare Event (just not the orders taken on the cloud since).
2. Double-click **Start Local Server**. Wait for the panel with the links and *Database OK API OK*.
   For staff to scan the links: open `http://localhost:8080/qr` on the laptop screen.
3. On **every** tablet and phone, open the browser and type the link from the panel (or your card):
   captains and guest tablets `http://192.168.1.10:8080/`, waiters `.../waiter`, Maestro kitchen
   screens `.../kitchen`.
   Faster: a tablet that still has some internet shows **Laptop server is on** on its sign-in or set-up
   screen and on the captain's table screen (the laptop tells the cloud its address every minute): tap
   **Use laptop server** and enter the supervisor PIN, nothing to type. Tablets switched with
   **Use laptop server** keep their captain sign-in or guest table. A device that types the address
   **signs in again** (same names and PINs) and a guest tablet chooses its table again.
   Smart Serve Maestro: dishes a captain had held but not fired on the cloud are on the laptop only if
   **Refresh Event Data** ran; otherwise the captain takes them again (the course board shows what is there).
4. **Print Hub**: close the normal Print Hub window (Ctrl+C), then double-click
   **Start Print Hub (Local)** in this folder. Check every printer shows ONLINE.
5. **Desk**: open `http://192.168.1.10:8080/supervisor` and log in.

On the server window, *Tablets/phones seen in the last 2 minutes* should go up as devices switch over.

**KOT numbers**: the first time the server starts with newly downloaded data, every kitchen's
numbering jumps by 100 (IT-021 -> IT-121; on Maestro events both barker series, AS-A 014 -> AS-A 114
and AS-B 009 -> AS-B 109), so no slip repeats a number the cloud already used.
Tell the kitchens; it is expected.

**Keep the server window open.** If it is closed by mistake or the laptop restarts, double-click
Start Local Server again: nothing is lost, and the devices reconnect by themselves within seconds.

While Plan B runs, the window shows *CLOUD ...*: the laptop tries to send its orders to the cloud
every minute. "cloud not reachable" is normal without internet - it keeps trying.

---

## After the event

1. Wait until the Print Hub has nothing left to print.
2. Press **Ctrl+C** in the Local Server window (and in the Print Hub window).
3. With internet, double-click **Upload to Cloud**. Wait for
   **"Everything on this laptop is now in the cloud."** Running it again is harmless.

---

## What is NOT synced (good to know)

Sync is **one way**: laptop -> cloud. Two-way sync is a later phase.

- Anything changed **on the cloud** after Prepare Event / Refresh Event Data does not reach the laptop.
  That is why all devices switch together and stay on Plan B.
- Uploaded: tables, orders, dishes ordered, KOTs, help/SOS requests, chat messages, feedback and carts
  (a cart cleared on the laptop is removed from the cloud too); on Smart Serve Maestro events also the
  held and fired dishes, firings and seated covers, and both barkers' KOT numbers. Deleting anything else on the laptop is
  not copied.
- **Not uploaded**: changes to the event, menu, kitchens, captains or waiters made on the laptop
  (Event Manager / Control). Make set-up changes on the cloud, then Refresh. Uploading pictures or
  videos does not work on the laptop.
- A KOT still waiting for its printer is uploaded once printed. A KOT that failed to print is uploaded
  as "skipped", so a Print Hub on the cloud never prints it again.
- Live updates (realtime) are off on the laptop; every screen refreshes itself every few seconds instead.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| *Node.js is not installed* (just after installing it) | Restart the laptop once, then try again. |
| Mac: *unidentified developer* | Right-click the launcher -> **Open** -> **Open** (once per launcher). |
| Mac: double-click does nothing / *permission denied* | Terminal: type `chmod +x ` (with a space), drag the launcher in, press Enter. |
| Windows: *Windows protected your PC* | **More info** -> **Run anyway**. |
| *Could not reach the cloud database* | No internet, or the network blocks it: try a phone hotspot. |
| *refused the password* / *[YOUR-PASSWORD]* | Fix `dbUrl` in `config.json` (step 5 of the setup). |
| *No events are dated between ...* | Check the event date in Event Manager. |
| A tablet cannot open the link | Is it on the **event router's** Wi-Fi (not hotel Wi-Fi)? Is the address the one on the server window? Was the firewall question answered with Allow? Is the laptop awake? |
| Server window: *not connected to any network* | Connect the laptop to the event router (Wi-Fi or cable). |
| *Port 8080 is already used* | Close the other program, or set `"port": 8081` in `config.json` (the links change to :8081). |
| *already running in another window* | Use that window (look in the task bar / Dock). |
| Print Hub: *CANNOT REACH SERVER* | Is the Local Server window open? Was the Print Hub started with **Start Print Hub (Local)**? |
| Refresh: *Stopped, so that nothing is lost* | The laptop has orders the cloud does not have yet and the cloud cannot be reached. Just **Start Local Server** - its data is complete. Upload later. |
| Upload: *row(s) could not be uploaded* | Send the files in `localmode/data/logs` to the technical team. Everything is still on the laptop. |
| Pictures missing on the tablets | Listed in `data/prepare-report.txt` (they could not be downloaded; they show when there is internet). |
| Windows: window title starts with **Select** | Someone clicked inside the window, which pauses it. Press **Esc**. |

---

## For the technical team

**Offline Kit** (`../tools/offline-kit.mjs`, run by `npm run build` after `vite build`): two zips
in `dist/downloads/` (Windows / Mac) + `offline-kit.json` for the Control tab card. Kit layout:
numbered launchers at the top (the ones in this folder, changed to `cd files/localmode`),
`files/dist` (the built app, no sources: `prepareApp` just copies it), `files/db` (dated updates
only), `files/localmode` (no node_modules/data/bin; `config.json` with url + anon key, no
`dbUrl`), `files/printhub`. No VITE_SUPABASE_URL / _ANON_KEY at build time = no kit.

**Prepare without `dbUrl`** (the kit; `lib/cloudrest.mjs`): events listed and rows read through
the REST API with the anon key (pages of 1000, `in.()` filters in chunks). The structure is
`dev/standin-schema.sql` (kept in step with the cloud's columns) + the dated `../db/*.sql`; any
column the cloud has and the laptop lacks is added from the rows (and one sample row per table),
typed from the values. Not one snapshot like the SQL route; no sequences (all ids are uuids).

**Upload** drops columns the cloud does not have (asked with `select=...&limit=0`, the cloud names
the unknown one), so a column made only on the laptop never blocks a row. `ms_covers` and
`table_carts` rows that clash on their natural key (seated in the cloud after the last refresh)
are merged on that key.


`ss-local.mjs` (Node 20+) with three npm packages: `embedded-postgres` (real Postgres 17 binaries:
initdb, pg_ctl, postgres), `pg` and `qrcode`. PostgREST 13.0.5 is downloaded from GitHub into `bin/` by prepare.
No Docker, no Supabase CLI.

```
node ss-local.mjs prepare [--force]              full download (schema rebuilt, data, media, app)
node ss-local.mjs prepare --refresh              data only, schema kept (guards unsent local changes)
node ss-local.mjs start [--kot-jump N]           N defaults to 100 (0 in test mode), 0 = off
node ss-local.mjs upload [--all]                 --all re-sends every row (idempotent)
node ss-local.mjs status
node ss-local.mjs printhub [Print Hub options]   ../printhub/printhub.mjs --server local

Test mode (try changes before they reach the cloud - step by step: ../docs/TEST_ON_MAC.md):
node ss-local.mjs prepare --dev [--force]        cloud structure (read only) + ../db/*.sql on the laptop
node ss-local.mjs prepare --dev --standin        no cloud at all: dev/standin-schema.sql + ../db/*.sql
node ss-local.mjs demo [--remove]                four demo events dated today (logins: data/demo-logins.txt)
```

- **Test mode** (`prepare --dev`): the cloud database connection is opened read-only
  (`default_transaction_read_only`), only the anon key is optional, and you may copy real events or
  none. After the cloud structure is built, every `../db/*.sql` file runs in name order on the
  **laptop's** database: first as written (one transaction), and if that fails, statement by
  statement with `begin`/`commit` left out, so Supabase-only lines (realtime publication, `notify
  pgrst`, `auth.*`) are reported as skipped and the rest still applies. Results are in
  `data/prepare-report.txt`. `snapshot.json` gets `"mode": "dev"`: `upload` and `prepare --refresh`
  refuse, the server never uploads and shows TEST MODE, `start` re-copies the newest `../dist`
  (rebuilding if the code changed) and does no KOT jump. A normal `prepare` replaces a test database
  without uploading anything from it; `prepare --dev` stops if the laptop holds real orders not yet
  in the cloud (unless `--force`).
- `--standin` builds the database from `dev/standin-schema.sql` (an approximation of the live tables
  before the multi-kitchen update) + `../db/*.sql`, with no cloud connection and no `config.json`
  needed. It warns that the real structure must be tested with `prepare --dev` before an event.
- `demo` (test mode only) deletes and recreates, in one transaction, four events dated today with
  fixed ids (`...de301` guest self-service, `...de302` captain service, `...de303` captain
  multi-kitchen with six kitchens on the Virtual Printers `127.0.0.1:9101-9106`, `...de304` Smart
  Serve Maestro with four kitchens on `9101-9104` and the demo menu from
  `../db/demo_maestro_menu.sql`), their menus,
  tables, captains, waiters, supervisor `Demo Supervisor`/9090 and help items; child rows get ids
  derived from the event, so cached sessions on tablets stay valid. Only columns that exist are
  written. It adds `admin`/9999 if there is no `admin` login. `demo --remove` deletes them, children
  first.
- The server also answers `GET /ss-local.json` (`{ local: true, mode, startedAt, port, events }`,
  CORS open: the app's "use the laptop server" check) and `GET /qr` (big QR codes of the tablet,
  waiter and desk links, for the desk screen). The panel shows the two main links as terminal QR
  codes when the window is tall enough (npm package `qrcode`; without it everything still works).

- **Schema** without pg_dump: catalog introspection of `public` (enums, domains, composite types,
  sequences, tables with defaults/identity/generated columns, constraints, indexes, views, functions,
  triggers). Statements run one by one and failures are retried until nothing more succeeds, so
  dependencies settle by themselves; failures land in `data/prepare-report.txt`, a failed **table**
  stops the prepare. RLS policies are not copied; `anon`/`authenticated` get all rights on `public`.
  Generated SQL: `data/schema.sql`.
- **Data**: chosen events only, read in one repeatable-read snapshot as `json_agg`, written in one local
  transaction (`json_populate_recordset`, `session_replication_role = replica`), so a failed refresh
  leaves the previous data intact. Media URLs are rewritten to `/media/<sha1>.<ext>`.
- **Server** (`0.0.0.0:port`): `/rest/v1/*` -> PostgREST on 127.0.0.1 (random port), `/media/*`, the app
  (`app/`, SPA fallback) with `window.__SS_LOCAL__ = {url, key}` injected into index.html;
  `/realtime`, `/auth`, `/storage`, `/functions` answer 404. `/__ss/health` returns JSON status.
  Postgres listens on 127.0.0.1 only (`data/local.json` has the port and passwords).
- **Finding the laptop** (its address comes from whichever router it joins): `start` calls the cloud's
  `ls_announce` (db/2026-10-21_local_server_address.sql) at start, every minute and when its address
  changes, with every LAN address (169.254.x.x left out) and the events it carries; on Ctrl+C it sends
  `p_stopped`. Only private addresses (10/8, 172.16/12, 192.168/16, 100.64/10) are published; one
  live laptop per event (another laptop's fresh entry is kept); a stopped server stays stopped. Off
  in test mode unless `SS_LOCAL_ANNOUNCE=1` (`SS_LOCAL_ANNOUNCE_BASE` sets the address, for tests).
  The app reads `ls_find` (today's events, told the cloud in the last 3 minutes): the "Laptop server
  is on" offer (entry screens and captain table screen, the device's own event only, supervisor PIN)
  and the address box. On laptop pages `src/lib/laptopWatch.js` asks `/ss-local.json` every 5 s;
  after 20 s without an answer it asks the cloud directly, then searches this page's own /24 (12 at a
  time) for a server carrying the same events and moves there, keeping the device's ss_*/ms_* keys
  (`#ss_carry=`; never the outbox, clock skew, print station or menu cache). Not found: retries after
  30 s, 1, 2, 5 min, with "Use cloud server". A device that came from the cloud app moves by way of
  `?ss_server=laptop:<address>` (honoured only for a device already set to a laptop, private
  addresses only) so the cloud origin saves the new address too. The cloud copy is carried to a
  laptop only while it is the newest (`ss_server_fresh`). Laptops prepared before this update serve
  the old app: run Prepare Event again after deploying. The panel shows a FINDING line.
- **Upload**: REST upsert (`on_conflict=id`) with the cloud anon key, batches of 500, bad rows isolated
  row by row. Order: tables, new orders (ignore-duplicates), order_items, final KOTs, orders
  (merge: status changes after the KOTs, so the cloud's cancel trigger finds no open KOT and prints no
  second CANCEL slip), sos, chat, feedback, carts; then each kitchen's `kot_seq` is raised to the local
  value. `ss_local.uploaded` keeps a fingerprint (md5 of the row) of what the cloud has, so only
  changed rows are sent. The running server does this every 60 s in a child process.
- **PostgREST and libpq**: the macOS release binaries link Homebrew's `libpq.5.dylib` and the Windows
  one `LIBPQ.dll`; neither ships with them. The libpq that comes with embedded-postgres is used instead
  (`DYLD_FALLBACK_LIBRARY_PATH` on macOS, DLLs copied next to `postgrest.exe` on Windows). Windows also
  needs the Visual C++ runtime for Postgres itself (prepare checks and opens Microsoft's installer).
- **Files**: `data/` (database `data/pg`, media, logs, snapshot.json, local.json, last-upload.json,
  prepare-report.txt, schema.sql, demo-logins.txt), `bin/` (PostgREST), `app/` (copy of `dist/`). All git-ignored.
  To start from scratch: stop the server, delete `data/`, run Prepare Event.
- `--force` on prepare discards local changes that could not be uploaded. Use only when sure.
- Crash recovery: on start, a leftover Postgres from an earlier run is stopped cleanly, a stale lock
  file is removed, a leftover PostgREST is killed.

---

## Printing from the desk (USB printer on the laptop)

Guest and captain events print the KOT from the Control Desk as soon as a waiter is assigned
(Auto-print ON). A normal browser asks with its print dialog every time. **Open Desk** (kit: **6 Open
Desk**) starts Chrome - or Edge if there is no Chrome - with its own profile and `--kiosk-printing`,
so every slip goes straight to the laptop's **default printer**:

- Make the KOT printer the default printer (Mac: System Settings > Printers & Scanners > Default
  printer, not "Last Printer Used"; Windows: untick "Let Windows manage my default printer", then
  the printer > Set as default).
- **Start Local Server** opens it by itself once (`http://localhost:8080/supervisor`, so it never
  depends on the laptop's network address). `"openDesk": false` in config.json switches that off.
- Without the Local Server, Open Desk opens the cloud desk (`appUrl` in config.json) the same way.
- The profile lives outside the kit (Mac: ~/Library/Application Support/SmartServe/Desk Browser,
  Windows: %LOCALAPPDATA%\SmartServe\Desk Browser): the desk sign-in survives a new kit, and the
  normal Chrome is never touched. Sign in once in that window.
- One window prints to one printer. A second printer needs a second laptop and desk, or network
  printers with the Print Hub.
- Another browser: `SS_DESK_BROWSER=/path/to/browser` or `"deskBrowser"` in config.json.
