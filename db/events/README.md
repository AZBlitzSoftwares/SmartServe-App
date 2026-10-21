# Event-day scripts (one-off)

SQL written for one event (the Jamnagar Maestro event, 15-17 Oct 2026): set-up copies,
switch-overs, names, PINs, printers, clean-ups, and their undo files. Each one was run
once, by hand, in the Supabase SQL Editor, and is kept here only as a record.

They are NOT part of the database structure:
- the Offline Kit does not carry them (it carries only the dated files directly in `db/`);
- "Prepare Event" and test mode (`prepare --dev`) do not run them on a laptop.
Most of them stop on purpose when their event is not found, which used to stop
"Prepare Event" on every laptop.

The one structural part, the VIP seating function `ms_vip_apply` from
`2026-10-16_maestro_v9_vip_menus.sql`, is in `../2026-10-16_maestro_v9_vip_apply.sql`.

Do not run these again on the cloud: they target that event by name and date.
