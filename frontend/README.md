# Gurukrupa Eye Hospital — frontend (React + Vite PWA)

Shared shell for the clinic app. Design source of truth is `../docs/mockup-reference.html`;
class names in `src/styles/global.css` are identical to the mockup so markup can be lifted across.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173  (/api is proxied to http://localhost:8000)
npm test           # vitest in watch mode
npm run test:run   # vitest --run (CI)
npm run build      # production build → dist/ (includes sw.js + manifest.webmanifest)
npm run preview    # serve dist/ locally
npm run lint       # eslint
npm run format     # prettier
```

Node 20+ (24 works). On first install npm may ask you to approve esbuild's postinstall
(`npm approve-scripts --allow-scripts-pending`).

## Mock mode vs real backend

`VITE_USE_MOCKS=1` makes every API module return in-memory data seeded from the mockup's arrays
(`src/mocks/data.js`) with live mutation (`src/mocks/store.js`, `src/mocks/adapters.js`).

| File | Value | Effect |
|---|---|---|
| `.env.development` | `VITE_USE_MOCKS=1` | `npm run dev` uses mocks (default so screens can be built before the backend lands) |
| `.env.test` | `VITE_USE_MOCKS=1` | tests use mocks unless they `vi.mock` the API |
| production build | unset | real API |

To hit the real backend in dev, set `VITE_USE_MOCKS=0` in `.env.development.local` (git-ignored)
or run `VITE_USE_MOCKS=0 npm run dev`. Restart the dev server after changing env files.

Mock logins: `admin/admin`, `doctor/doctor`, `optom/optom`, `reception/reception`, `ot/ot`.
In mock mode with no stored session the app auto-signs-in as admin.

**What is real today:** `auth.login`, `auth.me`, `auth.health` (backend B1). Every other adapter in
`src/api/real.js` follows the paths in `docs/task-list-backend-frontend.md` (B3–B10) and will 404 until
the backend agent ships them — fix the path in `real.js` when it lands, never in a screen.

## Folder conventions

```
src/
  api/          client.js (axios, Bearer token, 401 → /login), real.js (axios adapters), index.js (mock/real switch)
  mocks/        data.js (mockup arrays, verbatim), store.js (mutable state), adapters.js (mock API)
  auth/         AuthContext.jsx — useAuth(), <RequireAuth>, <RequireRole roles={[...]}>
  offline/      OfflineContext.jsx — useOffline(): isOffline, simulateOffline, onReconnect(fn), pendingCount
  hooks/        useDeviceMode (mobile < 768px, or ?device=mobile|desktop|auto override)
  components/   AppShell (rail / topbar / mobile nav / bottom nav / search), Modal, Drawer, Toast,
                DateStrip, PatientCard (+QueueRow), SearchModal, ConnectivityBanner, Placeholder, Icons
  lib/          format.js — fmtElapsed, fmtTime, fmtLastVisit, computeRowStatus (wait thresholds 20/45 min)
  screens/      one folder per screen: Login, Queue, Appointments, Machines, OT, Inventory, Admin, MRs
  styles/       tokens.css (CSS variables), global.css (ported mockup styles)
  nav.js        NAV_ITEMS (rail/menu model, per-role visibility), hospital constants
  App.jsx       routes; AppShell is the layout route
```

Routes: `/login`, `/queue`, `/queue/:stage`, `/appointments`, `/machines`, `/ot`, `/inventory`,
`/mrs`, `/admin` (admin only).

## How to add / replace a screen (Agents 2–4)

1. Put your screen in `src/screens/<Name>/<Name>.jsx` (replace the placeholder; keep `index.js`).
2. Set the topbar from inside the screen:
   ```jsx
   import { useTopbar, useShell } from '../../components/AppShell';
   useTopbar({ sub: 'Stock levels · updates automatically', actions: <button className="btn-primary">+ Add</button> });
   const { isMobile, stages, stageCounts, refreshCounts, openSearch } = useShell();
   ```
   `title` defaults to the hospital name (short on mobile) exactly like the mockup's `setTopTitle`.
3. Data: `import { inventory, onDataChange } from '../../api'` — never import `mocks/` or `real.js`
   directly. In mock mode `onDataChange(fn)` fires after every mutation; in real mode it is a no-op, so
   also refetch after your own writes (and poll if the screen is shared, like the queue).
4. UI pieces: `<Modal open title sub onClose actions>`, `<Drawer open name meta onClose foot>`,
   `useToast()` → `toast.lowStock(item)`, `toast.dilationDue(p, line)`, `toast.info/success/error`.
   `<DateStrip value onChange counts />` for Appointments/OT. `<PatientCard>` / `<QueueRow>` for the board.
5. Mobile: styles key off `body.mobile-mode` (set by `useDeviceMode`). Test with `?device=mobile`.
   Tables get the mockup's card transform automatically — add `data-label` to `<td>`s.
6. Offline (Machines): `useOffline()` gives `isOffline`, `toggleSimulateOffline`, `onReconnect(fn)` and
   `setPendingCount(n)` (shown in the ConnectivityBanner). Put the IndexedDB queue in `src/offline/`.
7. Search → patient: `SearchModal` navigates to `/queue/:stage?patient=<id>`; the Queue screen reads
   `?patient=` and opens the drawer. Keep that contract.
8. Route/nav: routes live in `src/App.jsx`; rail/menu entries and role visibility in `src/nav.js`.
9. Tests: colocate `*.test.jsx`; use `renderWithProviders` / `renderShell` from `src/test/utils.jsx`.

## Auth & roles

Roles: `admin | doctor | optometrist | reception | ot_staff`. Token + user cached in localStorage
(`gk_token`, `gk_user`), validated with `GET /auth/me` on load; a 401 anywhere clears the session and
redirects to `/login?next=…`. Rail items are filtered by `NAV_ITEMS[].roles` (Admin is admin-only;
MRs hidden from optometrist/OT staff; OT hidden from optometrist — adjust in `nav.js` once Dr Anu confirms).

## PWA

`vite-plugin-pwa` (autoUpdate). Manifest: "Gurukrupa Eye Hospital" / "Gurukrupa", theme `#1E3A8A`,
standalone. Icons in `public/icons/` were generated from `../../logo.jpg` (192/512 + maskable variants).
Runtime caching: `/api/*` NetworkFirst (8s timeout, 24h), Google Fonts StaleWhileRevalidate.
The service worker is disabled in `npm run dev`; test it with `npm run build && npm run preview`.
