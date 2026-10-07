# Tablets at the event: staff guide

For supervisors. You never need to clear app data. If a tablet looks wrong, use **⚙ Device → Reset this tablet** (section 5).

## 1. How a tablet decides what it is

When you open the app, it looks at **today's events**:

| Today there is… | The tablet opens on |
|---|---|
| only a Captain Service event | **Captain Sign In** |
| only a self-service event | **Supervisor Setup** (guest tablet) |
| both kinds | **"How is this tablet being used?"**: tap **📱 Guest tablet** or **🧑‍💼 Captain** |
| no event | **No event today**, with today's date. Tap **Retry** (it also checks again by itself every 30 seconds) |

A tablet that is already set up for **today** opens straight back where it was: a guest tablet on its table, a captain on their tables. Anything saved from an earlier day is cleared automatically.

If you see **Can't reach the server**, check the Wi-Fi or internet and tap **Retry**.

## 2. Set up a guest tablet

1. Open the app. If you see the question, tap **📱 Guest tablet**.
2. **Supervisor Setup**: enter your supervisor PIN (or the admin PIN), then tap **Verify PIN →**.
3. If more than one event is listed, tap yours.
4. Tap a **green** table number, then **✓ Confirm Table N**. The Welcome screen appears.

A red **IN USE** number belongs to another tablet. Ask the admin to release it, or pick another number.

## 3. Captain sign-in

1. Open the app. If you see the question, tap **🧑‍💼 Captain**.
2. **Captain Sign In**: type the captain name and PIN, then tap **Sign In →**. The event is found automatically.
3. At a multi-kitchen event, a captain linked to a table goes straight to that table's menu.

To hand the tablet to another captain, tap **Switch** under the captain's name.

## 4. Switch a tablet between guest and captain

- **Guest → captain**: on the Welcome screen, hold the **TABLE N** label for 3 seconds. On **Supervisor Setup**, tap **Captain? Sign in here →**.
- **Captain → guest**: tap **Switch** under the captain's name. On **Captain Sign In**, tap **Guest tablet? Set up a table →**.

These links only appear when that kind of event is running today. Switching clears only the old mode, so nothing else is lost.

## 5. Reset a tablet (the "start again" button)

1. Get to Supervisor Setup, Captain Sign In, the question screen or No event today. For example, a captain taps **Switch**, or on a guest tablet you hold the **TABLE N** label on the Welcome screen for 3 seconds.
2. Tap **⚙ Device** in the **bottom-right corner**, or hold the **logo** for 2 seconds.
3. Enter the **admin PIN**, or the **supervisor PIN for today's event**, and tap **Open**.
4. Check the panel: Mode, Event, Table / captain, Server, App build.
5. Tap **Reset this tablet**, then **Yes, reset this tablet**.

The tablet restarts like a new one, following section 1. Its table is released so that number can be picked again straight away. Orders already sent are not affected.

## 6. Move tablets to the laptop server, and back

Use this when the venue internet fails and the laptop's **Local Server** window is running (see the Local Server guide).

**To the laptop.** On each tablet:
1. Open **⚙ Device** and enter your PIN.
2. Tap **Use laptop server…**.
3. Type the address shown in the Local Server window, for example `192.168.1.10:8080`. Tap **Connect →**.

A green **LAPTOP SERVER** label now shows at the top of the sign-in screens. On the laptop, **guest tablets choose their table again and captains sign in again** (same PINs). From now on the tablet goes to the laptop every time the app opens.

**Back to the cloud.** On each tablet, open **⚙ Device** and tap **Use cloud server**. Each tablet then carries on as it was on the cloud before the move.

**No internet and the PIN won't check?** The panel says *Can't check the PIN*. It still offers **Use laptop server…** so you can move the tablet anyway.

**Tablet shows an error page after moving?** The laptop did not answer. Close the app and open it again. You will see **This tablet is set to use the laptop**:
- tap **Open laptop server →** to try again, or
- tap **Use cloud server instead**.

Check that the laptop is awake, its Local Server window is open, and the tablet is on the **same Wi-Fi as the laptop**.

## 7. Do NOT

- **Don't clear Chrome or app data**, and **don't uninstall the app**. Use **Reset this tablet** instead. Clearing data also deletes orders waiting to be sent while the tablet was offline.
- Don't reset a tablet that is working fine during service.
- Don't tap **Go anyway** for a laptop address unless the laptop is definitely running. It skips the connection check.
- Don't share the admin PIN with captains or guests.
