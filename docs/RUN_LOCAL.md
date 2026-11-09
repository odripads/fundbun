# Run FundBun locally (no Vercel, no cloud)

This is the recommended way to run the app while in mainland China, where the
Vercel URL (`https://fundbun.vercel.app`) may be unreachable. Everything runs
on this laptop — the frontend, the `/api` backend, and the offline Bun Engine.
The core demo needs no network connection at all.

`npm start` runs the production server, which:

- binds **all interfaces** on port **8787**,
- serves the built frontend from `dist/`,
- serves the `/api` backend on the same port.

So **one URL serves everything** — no separate frontend/backend URLs.

## Prereq

- Node 20+ (verified with Node v22).
- Dependencies installed. **Use `npm install`, never `npm ci`**
  (`npm ci` deletes `node_modules` and its iCloud-ignore flag).

```bash
npm install
```

## Build (must do before `npm start`)

`npm start` serves the built `dist/` folder, so build it first:

```bash
npm run build
```

## Run

```bash
npm start
```

You should see a line like:

```
[gateway] listening on http://localhost:8787 · production (serving dist/) · provider=…
```

Stop it with `Ctrl+C`.

## Open it

| Device | URL |
|---|---|
| This laptop | `http://localhost:8787` |
| Phone on the **same Wi-Fi** | `http://192.168.100.121:8787` |

> The phone URL uses the laptop's LAN IP. `192.168.100.121` was measured on
> this Mac — your IP may differ. Find it with:

```bash
ipconfig getifaddr en0
```

If `en0` is empty, try `ipconfig getifaddr en1`.

## If the phone can't connect

1. Make sure the phone and the laptop are on the **same Wi-Fi network**
   (a phone on mobile data won't reach a `192.168.x.x` address).
2. Check the macOS Firewall isn't blocking incoming connections to node on
   port 8787: **System Settings → Network → Firewall**. Allow `node` (or
   `tsx`) to accept incoming connections, or turn the firewall off briefly to
   test.

## Optional deep links

Demo personas load via the `?demo=` query string (hash routing is used, so no
server-side route fallback is needed):

- `http://localhost:8787/?demo=jing`
- `http://localhost:8787/?demo=arif`

(For a phone, use `http://192.168.100.121:8787/?demo=jing`, etc.)
