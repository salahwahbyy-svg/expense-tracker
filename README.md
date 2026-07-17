# Expense Tracker

A mobile-first expense tracker PWA with full financial statements — Balance
Sheet, P&L, Cash Flow, straight-line depreciation, accounts payable/
receivable, budgets, and PDF/Excel exports. Amounts are in Egyptian pounds
(E£).

## No accounts — sync codes instead

There are no user accounts or passwords. All data is scoped by a shared
7-character sync code (e.g. `A3K9XZP`). Enter the same code on every device
to see the same data there — a phone and a laptop just need the same code
typed in once. Treat the code like a password: anyone who has it can read
and edit that data.

There's no "forgot password" flow, so if you lose the code, the data is
gone. To protect against that, download a full JSON backup any time from the
sync sheet (tap the sync badge → "Download backup (JSON)").

## Stack

- **Frontend** — vanilla JS (single IIFE in `app.js`), no build step, no
  framework.
- **Backend** — Express (`server.js`).
- **Database** — Turso (hosted SQLite) via `@libsql/client`, falling back to
  a local `file:local.db` when no Turso credentials are set (local dev).

## File map

- `server.js` — Express app: routes, request validation, rate limiting.
- `db.js` — all database access (`@libsql/client`), schema creation/
  migration, per-table CRUD helpers.
- `export.js` — builds the PDF/Excel financial statement exports.
- `depreciation.js` — straight-line depreciation math.
- `index.html` — page markup and sheets/overlays.
- `app.js` — all client-side logic and rendering.
- `styles.css` — all styling.
- `sw.js` — service worker (offline shell caching).
- `manifest.json` — PWA manifest.
- `icon.png` — app icon.

## Local dev

```
npm install
node server.js
```

Then open http://localhost:3000. With no `TURSO_DATABASE_URL` set, the
server automatically uses a local `local.db` SQLite file in this directory
instead of a hosted database.

## Environment variables

- `TURSO_DATABASE_URL` — Turso database URL (omit for local file DB).
- `TURSO_AUTH_TOKEN` — Turso auth token (omit for local file DB).
- `PORT` — port to listen on (defaults to 3000).

## Deployment

Hosted on Render, auto-deploying from the `main` branch of
`github.com/salahwahbyy-svg/expense-tracker` on every push. Production URL:

https://expense-tracker-s9ht.onrender.com

## Service worker

The service worker (`sw.js`) caches the app shell cache-first with a
background refresh, so the app opens instantly even on a cold server —
updated files are fetched in the background and served on the next open.
When shipping any frontend change (`index.html`, `app.js`, `styles.css`,
`depreciation.js`, `manifest.json`, `icon.png`), bump the `CACHE` version
string at the top of `sw.js` so clients pick up the new files instead of
serving the stale cached ones indefinitely.
