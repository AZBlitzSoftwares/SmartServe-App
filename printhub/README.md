# Print Hub - Janu's Smart Serve

## What it does

The Print Hub runs on the laptop at the monitoring desk during a multi-kitchen event.

- Captains place orders on their tablets. Each order is split into one **KOT** per kitchen (Italian, Arabic, Indian ...).
- The Print Hub picks up every new KOT within about 2 seconds and prints it on **that kitchen's printer**.
- Every 15 seconds it checks each printer: **ONLINE**, **OFFLINE**, **PAPER OUT** or **PAPER LOW**. The desk app sees this too.
- If a printer does not answer, it tries twice more. Then it prints on the kitchen's **backup printer** (the slip says *PRINTED ON BACKUP PRINTER*), or marks the KOT **FAILED** so the desk can see it.
- When a printer comes back (switched on, paper loaded), its failed KOTs **print again by themselves**.

Keep the Print Hub window open for the whole event. Closing it stops printing.

---

## How printing works at the event

1. **Each kitchen has its own printer** on the event router (cable or Wi-Fi), e.g. Italian `192.168.1.101`, Arabic `192.168.1.102`. **Find printers** at the desk lists them and assigns one to each kitchen (or type the IP in Control › Kitchens). A fixed IP or a DHCP reservation in the router is best; a printer that moves to a new address is followed by its MAC.
2. A captain sends an order from the tablet. Smart Serve splits it into **one KOT per kitchen**.
3. The **Print Hub** on the desk laptop picks up each new KOT **within about 2 seconds** and sends it to that kitchen's printer. Before printing it asks the printer whether it has paper.
4. The result comes back to everyone: the captain sees **Printing… → Printed ✓** (or **Failed — operator alerted**), and the desk sees each KOT's status and each printer's health (**Online / Paper low / Paper out / Offline**).
5. If a printer is off or out of paper, the KOT goes to the kitchen's **backup printer** if one is set, otherwise it is marked **Failed** and the desk is alerted. The desk can **Reprint** it or **Redirect** it to another kitchen's printer.
6. When the printer is back (switched on, new roll loaded), the Print Hub notices within about 15 seconds and **its failed KOTs print again by themselves**.

---

## The simple way: download it from the app

Control Desk › Control tab › Event set-up › **Kitchens & printers** › **Print Hub: Download for Windows / Mac
(Apple chip)**. The download is ONE program, built with every deploy (`tools/offline-kit.mjs`, Bun
`--compile`), with the server address and key built in: nothing to install, double-click it and keep its window
open (first start only: Windows "More info › Run anyway", Mac "Privacy & Security › Open Anyway" - the program is
not code-signed). Logs go to `SmartServe Print Hub/logs` in the user's home folder. The same Print Hub for a
laptop with Node.js (Intel Macs, or when the program is blocked) is offered next to it: unzip, double-click
**Start Print Hub** (READ ME FIRST inside). Then **Find printers** lists every printer on
that laptop's router; **Print a slip** shows which is which and **Use for a kitchen** assigns it, so no IP
has to be typed. A printer on automatic addresses (DHCP) that comes back on a new address is followed by its
MAC. Only one Print Hub may run per event (any running hub takes the event's KOTs); the desk warns when two
hubs took KOTs in the last 10 minutes.

The manual set-up below is for running it from the code folder.

## One-time setup

You need the **anon key** of the Smart Serve server (Supabase dashboard -> Project Settings -> API -> *anon public*). Ask the technical team if you do not have it.

### Mac

1. Go to **nodejs.org**, download the **LTS** version and install it (Continue, Continue, Install).
2. Copy the whole `printhub` folder to the laptop, for example to Documents.
3. Double-click **Start Print Hub.command**. The first time, it creates a file called `config.json` and stops.
   - If the Mac says it *cannot be opened because it is from an unidentified developer*: right-click the file -> **Open** -> **Open**. You only need to do this once.
4. Open `config.json` with **TextEdit**. Replace `PASTE_ANON_KEY` with the key (keep the quote marks around it). Save.
5. Optional: change `"hubName"` to a name for this laptop, e.g. `"desk-laptop"`.
6. System Settings -> Battery (or Energy Saver): stop the Mac from sleeping when plugged in. The Print Hub keeps the Mac awake while it runs, but **closing the lid still puts it to sleep** - keep the lid open.

### Windows

1. Go to **nodejs.org**, download the **LTS** version (.msi) and install it (Next, Next, Finish).
2. Copy the whole `printhub` folder to the laptop, for example to Documents.
3. Double-click **Start Print Hub.bat**. The first time, it creates a file called `config.json` and stops.
   - If Windows says *Windows protected your PC*: click **More info** -> **Run anyway**.
4. Right-click `config.json` -> **Open with** -> **Notepad**. Replace `PASTE_ANON_KEY` with the key (keep the quote marks). Save.
5. Optional: change `"hubName"` to a name for this laptop.
6. Settings -> System -> Power: *When plugged in, put my device to sleep after*: **Never**. Also set *closing the lid* to **Do nothing**, or keep the lid open.
7. Start the Print Hub once, right-click the window's **title bar** -> **Defaults** -> untick **QuickEdit Mode** -> OK. (Otherwise a mouse click inside the window pauses the Print Hub until Esc is pressed.)

Also check the laptop's **clock and time zone** are right: KOT times and "today's event" come from it.

---

## Every event day

1. Switch on the event router and all kitchen printers.
2. Connect the laptop to the **event router** (Wi-Fi or cable). For the cloud server it also needs internet.
3. Double-click **Start Print Hub** (`.command` on Mac, `.bat` on Windows).
4. Check the screen:
   - `Server: CLOUD ... CONNECTED`
   - your event's name
   - every kitchen's printer shows **ONLINE**
5. Send a test print to each kitchen from the app: Control › Kitchens › Test print (or place a small test order).
6. Leave the window open. To stop at the end: press **Ctrl+C** (or close the window).

If the window ever says *Print Hub stopped unexpectedly ... Restarting*, it restarts by itself. Nothing to do.

### Reading the screen

```
JANU'S SMART SERVE - PRINT HUB                   Hub: desk-laptop   07:42:10 PM
Server: CLOUD (kapmreqrhlifxuzjjejz.supabase.co)  CONNECTED

Event: Sharma Wedding  (2026-10-13)
  KITCHEN            PRINTER                STATUS      PRINTED  FAILED
  Italian            192.168.1.101          ONLINE           42       0
  Arabic             192.168.1.102          PAPER LOW        37       0
    backup           192.168.1.101          ONLINE
  Indian             192.168.1.103          OFFLINE          18       2

LAST ACTIVITY
  07:42 PM  PRINTED IT-043 Italian T8 on 192.168.1.101
  07:41 PM  FAILED  IN-019 Indian T5 - Printer 192.168.1.103 not reachable
```

- **PRINTED / FAILED** count since the Print Hub was started.
- A big **red box** at the top means the server cannot be reached. It keeps retrying by itself.
- Everything is also written to `logs/printhub-<date>.log` in this folder.

---

## Setting up an Epson TM-m30III with a fixed IP

Each printer needs an IP address that **never changes**, and the same address must be entered for its kitchen in Smart Serve.

1. **Connect** the printer to the event router with a LAN cable (easiest), or join it to the router's Wi-Fi.
2. **Print the status sheet**: switch the printer off, hold the **Feed** button, switch it on, let go when it starts printing. (Some units have a small *status sheet* button on the back, next to the LAN port - press it instead.) Find **IP Address** on the sheet.
   - If it shows `192.168.192.168`, the printer did not get an address from the router: check the cable and router.
3. On the laptop (connected to the same router), open a web browser and type that IP, e.g. `http://192.168.1.57`. **Epson Web Config** opens. If the browser warns about security, choose *Advanced* -> *Proceed*. If it asks for a password, try the printer's **serial number** (label underneath) or `epson`.
4. Go to the network / TCP-IP settings and set:
   - IP address: **Manual**
   - IP address: a free number from **192.168.1.101 to 192.168.1.150** (the first three parts must match the router and the laptop, e.g. `192.168.1.x`)
   - Subnet mask: `255.255.255.0`
   - Default gateway: the router's address (often `192.168.1.1`)
   - Save. The printer restarts.

   *Other way:* in the router's admin page, use **DHCP / address reservation** to always give the printer's MAC address (on the status sheet) the same IP.
5. Print the status sheet again to confirm the new IP.
6. **Label the printer** with a sticker: kitchen name and IP, e.g. `ITALIAN - 192.168.1.101`.
7. In Smart Serve, enter that IP for the kitchen (port **9100**). Optionally enter a backup printer IP (usually a nearby kitchen's printer).

Use the event's own router. Hotel or "guest" Wi-Fi often blocks devices from seeing each other, so the laptop cannot reach the printers.

### Why our own router, and what happens if a printer's address changes

A printer with a fixed IP only works on a network with the same first three numbers. At a venue whose network is `192.168.0.x` or `10.0.5.x`, printers set to `192.168.1.10x` cannot be reached at all. So the kit travels with **its own router**: printers, desk laptop and tablets all join it, and the router's internet port is plugged into the venue's internet (or a 4G dongle). The printer addresses then never depend on the venue.

The Print Hub also protects against an address changing anyway (a printer left on automatic addressing, a router reset):

- It **finds printers** on its network by itself: at start, whenever the desk presses **Find printers** (Control > Kitchens & printers), and every minute while a printer is not answering.
- It reads each printer's **hardware (MAC) address**, which never changes, and remembers it for the kitchen.
- If a kitchen's printer turns up at a new address, the kitchen is **moved to the new address automatically** and printing carries on; the desk sees a green note saying so, and the move is in the log.
- At the desk, **Find printers** lists every printer the hub can see. **Print a slip** prints "THIS PRINTER 192.168.1.104" on it, so you can tell which box is which; **Use for a kitchen** sets it as a kitchen's main or backup printer without typing.

- It is careful on a shared network: only the kitchen printers already set up are asked for their paper status. Any other device that answers on port 9100 (an office printer, say) is only connected to and let go, with nothing sent, so it never prints a stray page. A printer follows a new address only when its hardware address is seen at exactly one address and no other kitchen prints there.

This needs the database update `db/2026-10-09_printer_discovery.sql`. Without it the Print Hub prints exactly as before and says the search is off. To switch the search off on a laptop, add `"findPrinters": false` to `config.json`. To keep the search to the kitchen printers already set up (no look around the rest of the network), add `"scanSubnets": false`.

---

## Testing without a printer (Virtual Printers)

**Virtual Printers** are pretend kitchen printers that run on a laptop. They accept KOTs exactly like the real Epson printers do, and show every slip on a web page as a paper receipt. Use them to test, and to demo to a client, when no printer is at hand.

1. **Start them.** Double-click **Start Virtual Printers** (`.command` on Mac, `.bat` on Windows). This starts **6 printers on ports 9101 to 9106** and opens the **Virtual Printers** page in the browser (`http://localhost:9180`).
   - If the computer asks whether Node.js may accept connections, click **Allow**.
   - The window also shows a second address, e.g. `http://192.168.1.20:9180`: open it on a phone or tablet on the same Wi-Fi to watch the slips there too.
   - From a command window you can choose: `node fake-printer.mjs --kitchens 3` (ports 9101-9103) or `--ports 9101,9102`.
2. **Point the kitchens at them.** In Smart Serve, Control › Kitchens, for each kitchen:
   - Printer IP: **127.0.0.1** when the Print Hub runs on this same laptop (otherwise this laptop's IP, shown in the Virtual Printers window).
   - Port: **9101** for the first kitchen, **9102** for the second, and so on - each kitchen its own port.
3. **Start the Print Hub** as usual (its own window). On the Print Hub screen every kitchen's printer shows **ONLINE**, and on the Virtual Printers page each printer says *Print Hub checked ... s ago*.
4. **Place orders** on a captain tablet (or press **Test print** in Control › Kitchens). Within about 2 seconds a slip appears under the right printer, newest on top, with the time it arrived. The printer takes the kitchen's name from its first slip.
5. **Try the problems** with the buttons on each printer:
   - **Paper: Out** - the printer prints nothing. The desk shows **PAPER OUT** for that kitchen and new KOTs for it are marked **Failed** (or go to its backup printer).
   - **Turn off** - the printer is unreachable, like a printer with no power. The desk shows **OFFLINE**.
   - **Paper: OK** / **Turn on** - within about 15 seconds the failed KOTs **print again by themselves** and the desk alert clears.
   - **Paper: Low** - still prints; the desk is warned to change the roll.
6. **Clear** (top right, click twice) removes all slips and resets the counters.

Each virtual printer has its own status, even though they all share one IP: the Print Hub checks and reports every printer by **IP and port**.

Good to know:
- Leave the Virtual Printers window open; closing it switches all six printers off.
- *Print Hub not seen* on a printer means nothing has contacted it: is the Print Hub running, and does a kitchen use that port?
- The **backup printer** and the desk's **Redirect** button choose a printer by IP only, so with Virtual Printers (one IP for all) they cannot pick a particular one. Test those two with real printers.
- Without the web page (`--no-web`) every slip is drawn as text in the window instead. You can also type `o` (paper out), `l` (paper low) or `n` (paper OK) + Enter there to change all printers at once.

---

## Using the local server

When the event runs on the local server instead of the cloud:

- open `config.json`, set `"use": "local"` and paste the local anon key in place of `PASTE_LOCAL_ANON_KEY`, then start as usual; **or**
- from a command window: `node printhub.mjs --server local`

Other options: `--event <event id>` prints only for that event (instead of every multi-kitchen event dated today), `--hub <name>` sets this laptop's name.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| A printer shows **OFFLINE** | Check power, cable and router. Print its status sheet: is the IP the same as in Smart Serve? Is the laptop on the same router? Failed KOTs print by themselves within about 15 s once the printer is back. |
| **PAPER OUT** | Load a new roll and close the cover firmly. KOTs that failed meanwhile print by themselves. |
| **PAPER LOW** | Change the roll at the next quiet moment. |
| Red **CANNOT REACH SERVER** box | Check Wi-Fi / internet. The Print Hub keeps retrying; nothing is lost - new KOTs arrive as soon as the connection is back. |
| *No multi-kitchen event is dated today* | In Event Manager the event must have today's date and Multi-kitchen switched on. The Print Hub checks again every minute. |
| Nothing prints, but printers are ONLINE and server CONNECTED | Are captains on the right event? Does the desk show the KOT? Look at the log file. |
| KOT failed: *No printer IP set for ...* | Enter the printer IP for that kitchen in Smart Serve, then re-send the KOT from the desk (this one is not re-sent automatically). |
| A slip says *PRINTED ON BACKUP PRINTER* | The kitchen's own printer is down. Take the slip to the right kitchen and fix the printer. |
| **Two laptops** both run the Print Hub | Safe - every KOT is printed only once; the server gives each KOT to one laptop only. Give each laptop its own `hubName`. A second laptop is a good standby. |
| Window closed by mistake, or laptop restarted | Double-click Start Print Hub again. Waiting KOTs print; a KOT that was half-way may print again after about 45 s. |
| *Laptop was asleep* in the activity list | Fix the sleep settings (see setup). Nothing printed while it slept. |
| *The server refused the anon key* | The key in `config.json` is wrong - copy it again. |
| *Print Hub functions are missing on the server* | The multi-kitchen database update has not been run yet - call the technical team. |
| Windows: the window title starts with **Select** | Someone clicked inside the window and printing is paused. Press **Esc**. (See setup step 7 to stop this happening.) |
| *Node.js is not installed* right after installing it | Restart the laptop once, then try again. |
| Mac: double-click does nothing / *permission denied* | In Terminal type `chmod +x ` (with a space), drag **Start Print Hub.command** in, press Enter. |

---

## For the technical team

- Node 18+ only, no npm packages. Files: `printhub.mjs` (main loop, printer I/O, status board), `escpos.mjs` (KOT layout + decoder), `fake-printer.mjs` (Virtual Printers: fake printers + web server) with `virtual-printers.html` (the page, plain HTML/CSS/JS, no build, no internet), `config.example.json`, the four launchers, `test/`.
- Tests: `node --test printhub/test` from the repo root.
- Server calls (PostgREST, anon key): `rpc/hub_claim_kots`, `rpc/hub_report`, `rpc/hub_printer_status`, `GET kitchens`, `GET events` - see `db/2026-10-07_multikitchen.sql`.
- Printer status is per printer = **IP + port**: `hub_printer_status(p_event_id, p_printer_ip, p_status, p_printer_port)`. The hub sends the host and the port it actually uses (an IP field written `ip:port` counts as that port); the server updates only the kitchens on that printer and re-queues only the failed KOTs aimed at it (a redirect in `kots.printer_ip` may be `ip:port`). Without `p_printer_port` the old match on the IP text is used. If the server still has the old 3-argument function, the hub notices (PGRST202), says so once and reports per IP instead.
- Virtual Printers API (same port as the page): `GET /api/state`, `GET /api/events` (Server-Sent Events: `snapshot`, `slip`, `printer`), `POST /api/printers/<port>` with `{"paper":"online|paper_low|paper_out"}` or `{"power":"on|off"}`, `POST /api/clear`. Paper out: answers DLE EOT 4 with paper-end and prints nothing it receives. Off: the port is closed (connection refused).
- Timings: poll 1.5 s; printer check 15 s; status re-sent on change or every 60 s; connect timeout 4 s; one attempt max 10 s; retries after 1 s and 2 s; a KOT is given up after 40 s (the server re-issues a stuck KOT after 45 s, so two laptops never both print it).
- Before each KOT the hub asks the printer for its paper status (DLE EOT 4) and does not send the KOT if the paper is out.
- Exit codes: `0` stopped, `2` settings problem (launchers do not restart), anything else: launchers restart after 5 s.
