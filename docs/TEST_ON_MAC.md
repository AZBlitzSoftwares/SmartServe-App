# Test everything on the Mac (before anything goes to the cloud)

Everything below runs **on your MacBook only**. The cloud is never changed:

- `prepare --dev` only **reads** the cloud database (the connection is opened read-only), copies its
  structure to a database on the Mac, and applies the new `db/*.sql` updates **to the Mac's copy only**.
- In this test mode the local server **never uploads** anything, so test orders stay on the Mac.

You need: the repo at `~/SmartServe`, Node.js **20 or newer** (`node -v` shows `v20...` or higher), Terminal (zsh), and a phone or tablet on the **same Wi-Fi**
as the Mac. No printer needed (Virtual Printers). Allow about 30 minutes.

Open a new Terminal window with **Cmd+N**. Copy each grey block, paste it into Terminal, press Enter.

---

## 0. Get the branch (skip if done)

Put `maestro.bundle` in `~/SmartServe`, then:

```zsh
cd ~/SmartServe && git fetch ./maestro.bundle maestro && git checkout -B maestro-latest FETCH_HEAD
```

(Uncommitted changes in `~/SmartServe` stop the checkout: `git status` shows them.)

## 1. Install and build the app (Terminal window 1)

```zsh
cd ~/SmartServe && npm install && npm run build
```

## 2. Install the local server kit

```zsh
cd ~/SmartServe/localmode && npm install
```

## 3. Settings

Create the settings file and paste the cloud **anon key** from `../.env.local` into it:

```zsh
cp config.example.json config.json
K=$(grep '^VITE_SUPABASE_ANON_KEY=' ../.env.local | cut -d= -f2- | tr -d "\"' \r")
[ -n "$K" ] && sed -i '' "s|PASTE_ANON_KEY|$K|" config.json; grep anonKey config.json
```

The last line should show `"anonKey": "eyJ...`. (Test mode never uses it to send anything; the Print Hub's
settings get a copy.)

**Database connection string (if you have the database password).** It is only used to *read* the
cloud structure. In Supabase: open the project -> **Connect** (top bar) -> **Session pooler** -> copy the
**URI**. It looks like `postgresql://postgres.kapmreqrhlifxuzjjejz:[YOUR-PASSWORD]@aws-0-....pooler.supabase.com:5432/postgres`.

```zsh
open -e config.json
```

In TextEdit, replace `PASTE_DATABASE_CONNECTION_STRING` with the URI (keep the quote marks), and replace
`[YOUR-PASSWORD]` **including the brackets** with the password. Save (Cmd+S), close TextEdit.

No password yet? Skip it and use step 4b.

## 4. Build the test database on the Mac

**4a. With the connection string (preferred, real cloud structure):**

```zsh
node ss-local.mjs prepare --dev
```

It lists the real events of the coming days. Press **Enter** to copy none (the demo events in step 5
are enough), or type numbers like `1,2` to copy real events too (read only).

**4b. Without any cloud connection:**

```zsh
node ss-local.mjs prepare --dev --standin
```

This uses a bundled approximation of the tables. Fine for today, but **before the event run 4a once**.

Both take about a minute (the first time it also downloads PostgREST from GitHub). Look for:

```
  2026-10-07_multikitchen.sql: OK (63 statements)
DONE - TEST DATABASE ready on this laptop. Nothing was written to the cloud.
```

## 5. Create the demo events

```zsh
node ss-local.mjs demo
```

It creates four events dated **today** and prints every login. They are also saved here:
`cat ~/SmartServe/localmode/data/demo-logins.txt`

| Event | Who | Login |
|---|---|---|
| all | Desk (`/supervisor`) | `Demo Supervisor` / `9090` (then pick the event), or `admin` / `9999`* |
| Demo · Guest Self-Service (6 tables) | Guest tablet set-up PIN | `9090` |
| Demo · Captain Service (6 tables) | Captains | `Vikram` / `1212`, `Neha` / `3434` |
| | Waiters (assigned at the desk) | Ganesh (21), Harish (22), Javed (23) |
| Demo · Multi-Kitchen (10 tables x 10 chairs) | Captains | `Rahul` / `1111` (table 1), `Imran` / `2222` (table 1), `Sameer` / `3333` (table 2), `Ayesha` / `4444` (table 3) |
| | Waiter phones (`/waiter`) | `Arjun` 5101 Indian, `Salim` 5102 Arabic, `Kiran` 5103 Chinese, `Ravi` 5104 Italian, `Manoj` 5105 Mexican, `Tariq` 5106 Turkish |
| Demo · Smart Serve Maestro (15 tables x 10 covers) | Captains | `Neha` / `7071` (C1–C5) and `Arjun` / `7072` (C6–C10) at table 7, `Rahul` / `1111` (C1–C5), `Imran` / `2222` (C6–C10) at table 1, `Sameer` / `3333` (C1–C5), `Ayesha` / `4444` (C6–C10) at table 2, `Faiz` / `8081` (8), `Priya` / `3131` (3); one captain on every other table (all in `demo-logins.txt`) |
| | Kitchen Display (`/kitchen`) | Italian `Ajay` 6201 / `Vijay` 6202; Oriental `Rohit` 6301 / `Kunal` 6302; Indian `Farhan` 6401 / `Sunil` 6402; Desserts `Pooja` 6501 / `Meena` 6502 |

\* With 4a your real admin is copied from the cloud, so use your usual admin PIN (the demo prints which).

Multi-kitchen kitchens: Indian IN (default), Arabic AR, Chinese CH, Italian IT, Mexican MX, Turkish TR,
printers `127.0.0.1` ports 9101-9106 (in that order). **Desserts** and **Beverages** have no kitchen on
purpose: they print in the default kitchen (Indian).

Maestro kitchens: Italian IT 9101, Oriental OR 9102 (default), Indian IN 9103, Desserts DS 9104, with the
demo menu: Soup, Appetizer, Entrée, Palate Cleanser, Main Course 1, Main Course 2 from each cuisine, and Dessert.

## 6. Start the Virtual Printers (Terminal window 2: Cmd+N)

```zsh
cd ~/SmartServe/printhub && node fake-printer.mjs --kitchens 6 --open
```

The page **http://localhost:9180** opens: six printers, each with Paper OK / Paper low / Paper out and
Switch off / Switch on. Leave the window open. (If the Maestro Test launcher's Virtual Printers are
already running, that page is already open: skip this step.)

## 7. Start the local server (Terminal window 3: Cmd+N)

```zsh
cd ~/SmartServe/localmode && node ss-local.mjs start
```

- macOS asks *Do you want the application "node" to accept incoming network connections?* -> **Allow**.
  (Missed it? System Settings -> Network -> Firewall -> Options -> node -> Allow incoming connections.)
- The panel says **TEST MODE** and shows the Mac's address, e.g. `http://192.168.1.23:8080/`.
  Write it down: below it is called `<mac-ip>`. (Also: `ipconfig getifaddr en0`.)
- QR codes for the phone: make the window taller, or open **http://localhost:8080/qr** on the Mac
  and scan it with the phone camera.

## 8. Start the Print Hub against the local server (Terminal window 4: Cmd+N)

```zsh
cd ~/SmartServe/localmode && node ss-local.mjs printhub
```

Check: `Printing KOTs for event: Demo · Multi-Kitchen` and `Demo · Smart Serve Maestro`, printers **ONLINE**.

## 9. Test checklist

Phone/tablet on the **same Wi-Fi** as the Mac, browser to `http://<mac-ip>:8080`. The first screen asks
**How is this tablet being used?** (guest and captain events both run today). Desk = on the Mac,
**http://localhost:8080/supervisor**.

**A. Guest self-service**
- [ ] Tablet: **Guest tablet** -> PIN `9090` -> tap table **2** -> **Confirm Table 2** -> menu of Demo · Guest Self-Service.
- [ ] **ADD +** two dishes -> open the cart -> **Place Order** -> "Your order will be served in few minutes".
- [ ] Desk: `Demo Supervisor` / `9090` -> **Demo · Guest Self-Service** -> **Orders** tab -> Live Orders shows **T2**.
- [ ] Tap the waiter chip **11** on that order (Anil) -> then **Deliver**.

**B. Captain service**
- [ ] Device: **Captain** -> `Vikram` / `1212` -> **Which table?** -> **3** -> ADD a dish -> **Place Order**.
- [ ] Desk: **Logout** -> sign in again -> **Demo · Captain Service** -> Orders -> **T3** -> tap chip **21** -> "Ganesh (21) -> T3" -> **Deliver**.

**C. Captain multi-kitchen**
- [ ] Device: **Captain** -> `Rahul` / `1111` -> lands straight on **Table 1**.
- [ ] ADD **Penne Arrabbiata**, **Hummus with Pita**, **Tiramisu** -> **Place Order** -> **Which chairs?** tap **2** and **3** -> **Send to Kitchens**.
- [ ] "Order placed" with three KOTs **IT-001, AR-001, IN-001**, each turning **Printed**.
- [ ] Virtual Printers page: slips on Italian (9104), Arabic (9102) and Indian (9101 - Tiramisu, dessert -> default kitchen).
- [ ] Phone: `http://<mac-ip>:8080/waiter` -> `Ravi` / `5104` -> sees only the Italian KOT -> **Delivered** (Undo shows for a moment).
- [ ] Desk: **Demo · Multi-Kitchen** -> **Orders** tab = **Kitchen Board**: six kitchen cards, Online, 127.0.0.1:9101...9106.
- [ ] Virtual Printers: Arabic (9102) -> **Paper out**. Within about 20 s the Kitchen Board shows Arabic **Paper out** (the others stay Online).
- [ ] Captain: **Place Another Order** -> Hummus -> chair 5 -> Send. Captain sees **AR-002 Failed - operator alerted**; the desk shows the failed print.
- [ ] Virtual Printers: Arabic -> **Paper OK**. AR-002 prints **by itself** within about 20 s.
- [ ] Same with **Switch off** -> new Arabic order fails -> **Switch on** -> it prints by itself.
- [ ] Captain: **Track** -> latest order -> **Cancel** (within 2 minutes) -> a **CANCEL** slip prints in that kitchen.
- [ ] Desk: Control -> **Kitchens** lists the six kitchens with their printers.

**D. Smart Serve Maestro**
- [ ] Device: **Captain** -> `Neha` / `7071` -> table 7 -> **Mark C1 seated** (nothing prints yet: the guest chooses every course).
- [ ] **By course**: Soup from Oriental, Appetizer from Indian, Entrée from Italian, and so on to Dessert -> **Save & fire Soup**.
- [ ] One KOT prints: the soup on Oriental (9102); every later course waits (held) until it is fired.
- [ ] Kitchen PC: `http://<mac-ip>:8080/kitchen` -> `Rohit` / `6301` -> the Oriental KOT arrives already Received -> Start preparing -> Ready -> Handed over (that completes it; it moves to Done). Reprint prints it again; Entire kitchen shows (and can move) Barker B's KOTs too.
- [ ] Captain: **Course board** -> tap the **Appetizer** heading -> **Fire** -> the Indian KOT prints on 9103.
- [ ] Desk: **Demo · Smart Serve Maestro** -> **Control Desk**: kitchens, table 7, nothing late.

## 10. Offline test (the important one)

Keep everything running. Cut the **internet** but keep the **Wi-Fi** between the Mac and the phone:
unplug the internet (WAN) cable from the router, or switch off the router's internet / SIM.

- [ ] On the Mac: `curl -sI https://www.google.com` fails (no internet), the phone still opens `http://<mac-ip>:8080`.
- [ ] Phone: switch **mobile data off**. If it says *Wi-Fi has no internet*, choose **Stay connected / Keep**.
- [ ] Repeat one order of **C**, one of **D** (and one of **A**): order, slips, waiter Delivered / kitchen display, Kitchen Board - all must work.

Plug the internet back in when done.

## 11. If something fails, stopping, resetting

| Where to look | What it shows |
|---|---|
| Window 3 (server) | `STATUS Database OK API OK`, orders, KOTs, *print failed* |
| Window 4 (Print Hub) | one line per KOT: PRINTED / FAILED and why |
| Window 2 / http://localhost:9180 | what each virtual printer received |
| `localmode/data/prepare-report.txt` | what step 4 created; any `FAILED` line from `db/*.sql` |
| `localmode/data/logs/` | `server-<date>.log`, `postgrest.log`, `postgres.log`, `build.log` |
| `node ss-local.mjs status` | test mode, events, server running or not |

- **Stop:** **Ctrl+C** in each window (Print Hub: press it twice if it waits for a printer).
- **Reset the test data** (deletes all test orders, recreates the four demo events and logins):
  ```zsh
  cd ~/SmartServe/localmode && node ss-local.mjs demo --remove && node ss-local.mjs demo
  ```
- **Changed the app code?** Ctrl+C the server and run `node ss-local.mjs start` again: in test mode it rebuilds the app first.
- **Changed a `db/*.sql` file?** Stop the server, run step 4 again, then step 5.
- *Port 8080 is already used*: put `"port": 8081` in `config.json` (links become `:8081`).
- A phone cannot open the link: same Wi-Fi as the Mac? Firewall answered **Allow**? Some guest/office Wi-Fi blocks
  devices from seeing each other: use a home router or the event router.

When every box above is ticked, the next step is applying `db/*.sql` to the cloud (separate step).
