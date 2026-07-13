# Verify — ERS / IRAMS frontend

How to observe a change running in the real app.

## Launch

- Dev server: `npm run dev` in `src/frontend` → http://localhost:5173 (check first — it's usually already running). Port 4173 is `vite preview` serving a STALE build.
- Login page fills: placeholder `Enter your username or email` + `#login-password`, click "Sign In". Working dev creds: `admin001@cainergy.com` / `Password123!` (SUPER_ADMIN); also `k.syrus@cainergy.com`. Wait ~4s after sign-in.
- Playwright + Chromium live in `src/frontend/node_modules`; from a script elsewhere use `createRequire('<repo>/src/frontend/package.json')`.

## Drive recipes

- Work order detail: `/work-orders/:id`. Page tabs are buttons: Details / Tasks / Safety (JSA) / Resources / Cost / Files.
- Step popup (Tasks tab): rows are `div.cursor-pointer:has(input[placeholder="Enter task step name..."])` — click at `{ position: { x: 12, y: 20 } }` (the name input stopPropagations). Plan/Do work toggle is next to Steps; the Confirm-time bar only renders in Do work mode on a SAVED task (not `new-` ids).
- DB assertions: run REST queries inside `page.evaluate` using the app session — token from the localStorage key containing `auth-token`, headers `{ apikey: <VITE_SUPABASE_ANON_KEY from src/frontend/.env.local>, Authorization: Bearer <token> }` against `<VITE_SUPABASE_URL>/rest/v1/...`.

## Gotchas

- `work_order_labor.contact_id` FKs **users(id)** (0071), not contacts. Contacts crafts live in the `roles` column (UI `types`, defaultType = roles[0]).
- Every WO field edit auto-saves the WHOLE work order after a 1.5s debounce (delete-and-reinsert sync for labor/tasks) — a second stale session's save can rewrite child rows while you test. Posted confirmations (`confirmation_no` set) are protected from deletion, planner lines are not.
- `work_order_labor` holds BOTH planned craft lines (confirmation_no null) and posted time confirmations — don't read a row count as "number of confirmations".
- Login page fires pre-auth 401/permission-denied console errors — pre-existing noise, not a regression signal.
- Test WO with an operation on a work center (CIVL-01 @70) + planned R-ENG line: `/work-orders/0e6ebc00-750d-44f8-94bf-6e50a1cbe1f3`, op `1709093f-a625-4c42-9925-bb316e6d589a`.
