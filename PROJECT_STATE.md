# Score Slinger — Project State

Last updated: 2026-11-24

---

## Current Goal

No major initiative in flight. The app is healthy and in production; the dependency refresh, analytics build-out, tsc/lint cleanup, new app logo, and local Supabase dev stack have all shipped to `main`. Remaining work is backlog/maintenance (see Next Steps).

---

## In Progress

### Parse prompt: colors by panel, not position (branch `fix/parse-colors-by-panel`, 2026-11-24)

**Bug:** the `/api/parse-score` prompt hard-coded player colors by panel position (blue top-left, yellow bottom-left, red top-right, purple bottom-right). The physical layout varies by ride vehicle — 3 of the 5 prod boards (Aug 25 2025, Sep 29 2025, Oct 27 2026) are yellow TL / blue BL / purple TR / red BR — so the model read the numbers right but swapped colors within a column. On those boards the top panel of each column has **white** digits, so color must come from the panel background/frame.

**Fix:** prompt moved to `server/parsePrompt.ts` (system prompt, user text, model, `buildParseRequest`, `extractParsedJson`, `checkParsedScore`) so offline validation can exercise the exact production request. Prompt now derives color only from each panel's background/digit color and says positions vary; each player gets a `position` field (traceability, stored in `players` JSONB; `Score.players[].position?` is optional). JSON mode (`response_format: json_object`) on, regex extraction kept as fallback. Post-parse sanity checks (4 players, colors exactly {blue,yellow,red,purple}; players + 3 objectives === teamScore) `console.warn` and add a `warning` string to the response — they never block the save. **Note:** a within-column color swap passes both sanity checks (same set of colors, same sum), so they can't catch this specific bug — only the prompt fix does.

**Validation (live OpenAI, 5 prod images, ground truth checked by eye + sum):** old prompt on Oct 27 → red/purple swapped in 3/3 runs (reproduces the bug). New prompt + `gpt-4o-mini` → colors 25/25 correct, but Aug 25's glare-washed "Rescue Spider-Man" 37,000 misread as 70,000/77,000/70,700 in 5/5 runs (the sum check flagged every one). New prompt + `gpt-4.1-mini` → 25/25 exact on every field; `gpt-4o` → 5/5 exact on Aug 25. **Switched production model to `gpt-4.1-mini`** — most accurate and cheapest per photo (~6k input tokens vs ~26k for 4o-mini, which bills images at a high token multiplier).

**Status:** code complete, validated, tsc/lint clean; in review as PR #10. Prod rows Aug 25, Sep 29 and Oct 27 have been corrected by hand.

### Post-deploy follow-ups (branch `fix/post-deploy-followups`, 2026-11-24)

- **Blank player names:** the prompt schema said `"name": "<player name or identifier>"`; the board shows no names, so `gpt-4.1-mini` could return `""` and the UI (which falls back to `player.name`) rendered blank labels. Prompt now asks for the capitalized color name, and `normalizePlayerNames()` (in `server/parsePrompt.ts`, called in `/api/parse-score` before the sanity checks) fills any missing/blank name with the capitalized color. Re-validated live (gpt-4.1-mini, 3 runs x 5 boards): all fields exact, names returned as color names every time.
- **DELETE race:** `DELETE /api/scores/:id` no longer uses `.single()` on the delete step; 0 rows deleted returns 404 `Score not found` (no error log) instead of a 500 from PGRST116. Client-side delete UX followed in `feat/delete-feedback` (see Recently Completed → Delete confirmation feedback).
- **Docs:** prod `SUPABASE_SERVICE_ROLE_KEY` is now a Supabase secret key (`sb_secret_…`) stored as a Vercel Secret; variable name kept for compatibility, code unchanged. Docs reworded accordingly. (The follow-on client-key swap and legacy-key disable are complete — see Recently Completed → Supabase API key migration.)

---

## Recently Completed (shipped to `main`)

### Delete confirmation feedback (PR #13, merged 2026-11-24)

**Problem:** confirming a delete gave no feedback, so users tapped Confirm again and sent duplicate DELETEs (seen in prod; the server already 404s the duplicate). Score Detail also closed the modal and navigated back regardless of outcome.

**Fix (both the History swipe-delete modal and the Score Detail modal):** shared hook `lib/use-delete-score.ts` (`useDeleteScore(source)`) holds the flow. A `useRef` re-entry guard stops double-taps; the Delete button shows a spinner + "Deleting…" and Cancel / overlay tap / Android back are disabled while the request runs; the modal stays open until it finishes. On success the modal closes and an app-level **"Score deleted" toast** shows. History removes the row from the `["/api/scores"]` cache right away (optimistic), then invalidates. Detail calls `router.back()`, and the toast is still visible on History. On failure the modal stays open with an inline error ("Couldn't delete — check your connection and try again."), the buttons re-enable, and History rolls back the optimistic removal. **A 404 counts as success** (already deleted). `apiRequest` now throws an `ApiError` with a `status` field; the message format (`"<status>: <body>"`) is unchanged. Analytics: `score_deleted` fires once per success (`already_deleted: true` on the 404 path); new `score_delete_failed` event `{ source, scoreId, error }`.

**Toast:** `contexts/ToastContext.tsx` (`ToastProvider` + `useToast().showToast(message, { type?: "success" | "error" })`) + `components/Toast.tsx`, mounted in `app/_layout.tsx` above the Stack so it survives navigation. Reanimated fade/slide, auto-dismiss after 2.5s, one at a time, bottom-anchored above the TabBar (60px + safe-area inset), theme colors, `pointerEvents: "none"`, `accessibilityRole="alert"` + live region (plus `announceForAccessibility` on iOS). On iOS it renders inside `react-native-screens`' `FullWindowOverlay` so it shows above native modals. No new dependency.

**Verified:** tsc 0 errors, lint 0 problems; web dev bundle compiles; local API DELETE on the same score returned 200 then 404. Not yet clicked through by hand — see the manual checklist in the PR/hand-off.

### Persist edited played date (branch `fix/persist-played-date`, 2026-11-24 — in review)

**Bug (data loss):** `app/upload.tsx` auto-saves the score (`POST /api/scores`) right after a successful parse, then the result screen lets the user edit the played date. `saveDateEdit` only updated local state and fired `played_date_changed` — nothing reached the server and there was no route to update `played_date`, so **every edited played date was silently lost**.

**Fix:** new `PATCH /api/scores/:id/played-date` (`{ playedDate }`): 400 `Invalid playedDate` if missing/unparseable; stored normalized via `toISOString()` (column is TEXT holding ISO strings); ownership mirrors DELETE (fetch `user_id` → 404 missing, 403 not the uploader); update uses `.select()` without `.single()` and treats 0 rows as 404 (same race-safe pattern as the DELETE fix). Client: when `savedId` exists, `saveDateEdit` PATCHes the date — Save shows a spinner + "Saving…", both buttons and the overlay are disabled, and a `useRef` guard blocks re-entry (pattern mirrors the `feat/delete-feedback` delete hook). Success → update local state, close modal, invalidate `["/api/scores"]`. Failure → modal stays open with inline error "Couldn't save the date — check your connection and try again.", previous date kept, buttons re-enabled. If `savedId` is null (auto-save failed) the edit stays local-only as before. Analytics: `played_date_changed` now carries `{ location: "upload", score_id }`; new `played_date_change_failed { location, score_id, error }`. `score_id` (snake_case) is the agreed prop convention going forward.

**Verified (local Supabase):** PATCH → 200 and `GET /api/scores` shows the normalized ISO value; invalid/missing/non-string date → 400; unknown id (UUID and non-UUID) → 404; no token → 401; second local user PATCHing dev's score → 403 and the value is unchanged. tsc 0 errors, `expo lint` clean, web bundle compiles.

### Supabase API key migration (2026-11-24)

The prod Supabase project is fully off the legacy JWT API keys. **Why:** Vercel flagged the service-role key as a readable secret, and the legacy keys were also retiring at the end of 2026. **Approach (zero downtime):** (1) created a new **secret key** (`sb_secret_…`) and stored it as a Vercel **Secret** in `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview), then deployed (PR #11 docs); (2) created a dedicated **publishable key** (`sb_publishable_…`, named `vercel_publishable_key`) and set it in `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Production + Preview) as a normal, non-secret var — it is public by design and ships in the web bundle — then redeployed **without build cache** because `EXPO_PUBLIC_*` is baked in at build time; (3) only then **disabled the legacy `anon` + `service_role` JWT keys**. Variable names are kept for compatibility, so `lib/supabase.ts` and `server/supabase.ts` are unchanged.

**Verification:** the live bundle ships only the publishable key; the legacy anon key now returns 401 "Legacy API keys are disabled"; a real prod upload works end to end (client storage upload via the publishable key + user session, server via the secret key). Existing user sessions were unaffected. The legacy toggle is reversible in the Supabase dashboard (Settings → API Keys) if ever needed. The readable Development-only Vercel vars (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`) were deleted; local dev reads `.env`, which points at the local Supabase stack (demo keys from `supabase status -o env`, still legacy-style JWTs locally, which is fine). `.env.prod-reference` (gitignored) now holds the prod secret + publishable keys.

### Local Supabase dev workflow (PR #9, merged 2026-11-24)

Local dev now runs against a local Supabase stack (Supabase CLI 2.117.0 + Docker) instead of the prod project. Before, the local `.env` pointed at prod, so local testing wrote real prod data. New scripts: `npm run db:start` / `db:stop` / `db:reset` / `db:status` (`db:start` is not chained into `npm run dev` — cold start ~30s). Local endpoints: API `127.0.0.1:54321`, Postgres `54322`, Studio `54323`, Mailpit `54324` (magic-link inbox). `supabase/config.toml` sets invite-only auth (`enable_signup = false`, site_url `http://localhost:8081`, redirects `http://localhost:8081/**` + `scoreslinger://**`); `supabase/seed.sql` creates confirmed test user `dev@local.test` plus 2 fake scores. Prod env values moved to gitignored `.env.prod-reference` (deliberately not an Expo-recognised name, so `expo export` can't bake prod into a local build); `.env` holds local values.

**Schema drift fixed:** the schema now lives in `supabase/migrations/` (`20260101000000_scores_table.sql`, `20260101000001_storage_bucket_and_policies.sql`), mirroring live prod exactly. The old `01_scores_table.sql` / `02_storage_policies.sql` were removed — they would not have built a correct schema: `user_id text references auth.users(id)` (text→uuid FK fails; prod has no FK), `played_date timestamptz` (prod is `text`), missing `game_name default 'Unknown'`, and differing storage policy names. The bucket is now created in SQL. Prod baseline at the time: `public.scores` 5 rows, 33 storage objects in `scores` (more objects than rows → orphaned images from discarded uploads).

### App logo (PR #7, merged 2026-07-23)

New Score Slinger logo (teal "S"/arrow with hanging spider + red trajectory burst on dark navy) wired into every icon slot: app icon, browser favicon, splash, and Android adaptive icon. The source had a light artboard background around a rounded-dark-square; regenerated **full-bleed** with the light bg replaced by the logo's own navy (`#01051D`) so the OS rounded-mask renders cleanly. Master source kept at `assets/images/score-slinger.png`. **Note:** icons are baked at build time — verify on a native/EAS build, not the dev server.

### tsc + lint cleanup (PR #6, merged 2026-07-23)

Project now type-checks and lints spotless (0 tsc errors, 0 lint warnings — a first). Cleared the 3 tsc baseline errors (`TabBar` `href` cast, `analytics.ts` prop-type cast, new `types/exif-parser.d.ts` shim) and all lint warnings. **Also fixed a real native bug surfaced by the cleanup:** the native image-upload path used `expo-file-system`'s `readAsStringAsync`/`EncodingType`, which SDK 56 moved to the `/legacy` subpath — switched to `await import("expo-file-system/legacy")`. Web was never affected (it uses a separate `fetch`/`blob` path), so this only manifests on native — **verify on a device build.**

### Analytics event coverage (PR #4, merged 2026-07-20)

Expanded PostHog from a handful of events to comprehensive coverage of every user action (~40 events, `snake_case noun_verb`, consistent props). Mobile gestures (swipe-to-delete `card_swiped_open`, pull-to-refresh `history_pull_refreshed`) are tagged with `platform`. All flows through the null-safe `lib/analytics.ts`. Full catalog documented in **CONTEXT.md → External Integrations → PostHog**. Also set up a separate **Non-Prod PostHog project** for local/preview so dev events don't pollute production.

### Dependency refresh (PR #3, merged 2026-07-20)

Ten commits, one revertable unit each: Expo SDK 54 → 56 (React 19.2, RN 0.85), `@hono/node-server` 1 → 2, `zod` 3 → 4, patch/minor sweep, and react-compiler GA. All `npm audit` high-severity findings cleared (25 → 13, remaining are the upstream `xcode → uuid` dev-tooling chain — dev/build-time only). Migrated swipe-to-delete off `PanResponder` onto `react-native-gesture-handler` for React Compiler compatibility. Deleted dead files (`scripts/build.js`, `server/templates/landing-page.html`, orphaned `shared/models/chat.ts`). Added `npm run dev` (concurrently); moved local server port to **5055** (AirPlay binds 5000). Un-ignored + refreshed the project docs.

**Deferred (intentionally):** ESLint 9 → 10 and TypeScript 5 → 6 wait on `eslint-config-expo` / Metro typings catching up.

### UI redesign (PR #2, merged)

Replaced the monolithic `app/index.tsx` (~1800 lines, conditional renders) with expo-router tab + modal architecture: `app/_layout.tsx` (AuthGate + DisplayNameSetup + Stack), `(tabs)/index.tsx` (History), `(tabs)/profile.tsx` (Profile), `upload.tsx` and `score/[id].tsx` (modals), and a custom `components/TabBar.tsx` with centered FAB. New design tokens in `constants/colors.ts`.

### PostHog analytics

- `posthog-react-native` + `lib/analytics.ts` wrapper (no-op if key not set); integrated across app and AuthScreen. Local/preview should use the **Non-Prod** PostHog project.

### Score detail deep-link URLs

- Shareable/linkable URLs for individual score detail views.

### Documentation & SQL setup files

- `supabase/` folder with SQL setup scripts and README

---

## Decisions Made

### Local Supabase over a cloud non-prod project; migrations as schema source of truth (2026-11-24)

The Supabase org ("Sam's Org") is on the Pro plan, where every project bills compute (~$10/mo); a paid non-prod project was declined. A local stack is $0 and fully isolated, and mirrors the PostHog Non-Prod split in spirit. `supabase/migrations/` is now the schema source of truth. New migrations: `supabase migration new <name>`, test with `npm run db:reset`, then apply to prod via the dashboard SQL Editor (or Supabase MCP `apply_migration`) — prod's existing schema predates the migrations folder. Optional drift check later: `supabase link --project-ref <ref> && supabase db diff --linked`. Tradeoff: Vercel previews still hit the prod Supabase project.

### Navigation: tab bar \+ modals (2026-03-31)

Replaced conditional-render screen pattern with expo-router tabs \+ Stack modals.

- History is the default/home tab  
- Profile is the second tab  
- Camera FAB (centered in tab bar, overlapping 28px) opens action sheet → navigates to `/upload` with image URI params  
- Score detail navigates to `/score/[id]` as a modal  
- Both modals use `presentation: "modal"` in the Stack

### Upload flow: auto-save on parse success (2026-03-31)

On the upload modal, the score is saved to the DB immediately after successful AI parsing (no explicit "Save" button). The user can discard (which deletes the saved record) or tap "Done" to keep it. This simplifies the flow — no unsaved state hanging around.

### Auth gate in `_layout.tsx` (2026-03-31)

Auth session management (`AuthGate` component), magic link deep link handling, and display name setup all live in `app/_layout.tsx`. The tab routes are always rendered authenticated — the gate is above the Stack navigator. This is cleaner than gating inside each screen.

### Color tokens updated (2026-03-31)

- Background: `#0f0f0f` (was `#0A0E1A`)  
- Surface: `#1a1a1a` (was `#131829`)  
- Player colors updated to v0 spec: Blue `#3b82f6`, Yellow `#eab308`, Red `#ef4444`, Purple `#a855f7`  
- Teal accent (`#00E5CC`) kept — user preferred it over indigo

### Hono over Express

Switched backend from Express to Hono. Hono runs natively on Vercel serverless, first-class TypeScript, significantly lighter.

### Supabase JS client over Drizzle ORM

Dropped Drizzle after WSL/Windows toolchain conflicts. Supabase JS client handles all DB queries directly.

### Private Storage bucket \+ signed URLs

Images stored as paths, displayed via 60s signed URLs from `GET /api/scores/:id/image-url`.

### Invite-only auth via `shouldCreateUser: false`

Unknown emails silently rejected — no rate limit abuse, no email leak.

### PKCE flow for magic link

Magic link redirects with `code=` param; SDK exchanges for session automatically (web) or manually (native).

### Display name in Supabase user metadata

Saved to AsyncStorage (fast) \+ `supabase.auth.updateUser` (cross-device sync).

### EXPO\_PUBLIC\_DOMAIN must match browsing domain (no protocol)

`getApiUrl()` prepends `https://`; the value must be bare domain.

---

## Known Gotchas

### EXPO\_PUBLIC\_\* vars require a full rebuild (no cache)

Baked into the static Expo web export at build time.

### Double-protocol bug (`https://https/...`)

If `EXPO_PUBLIC_DOMAIN` is set with `https://` prefix, `getApiUrl()` produces a broken URL.

### www vs non-www CORS

Both must be in `ALLOWED_ORIGINS`, or `EXPO_PUBLIC_DOMAIN` must match exactly.

### Metro bundler first-run is slow on WSL

3–5 minutes on first `npm run expo:dev`. Normal; subsequent runs use cache.

### `localhost:5055` returns 404 at root

Expected — server only handles `/api/*`. (Port is 5055, not 5000 — macOS AirPlay Receiver binds 5000.)

### FAB position on web

The `position: "absolute"` FAB with `left: "50%"` \+ `marginLeft` centering works on native but may need adjustment on web depending on layout.

---

## Blocked / Open Questions

- Should `slingers.app` redirect to `www.slingers.app` in Vercel Domains? Currently both work but API calls only go to `www.slingers.app`.  
- Future: per-user score filtering via RLS on `scores` table?

---

## Next Steps

Backlog, no active work:

1. **Native build verification** — the app icons/splash (PR #7) and the `expo-file-system/legacy` native-upload fix (PR #6) are both baked at build time and unverified on device. Confirm on a native/EAS build (or `expo run:ios`/`run:android`): home-screen icon, splash, and a native image upload.  
2. **Vercel previews still point at the prod Supabase project** — local can't serve them, so preview testing can still write prod data. Options later: a cloud non-prod project, or Supabase Branching.  
3. **Device testing against local Supabase** — iOS Simulator reaches `127.0.0.1`; Android emulator needs `10.0.2.2:54321`; a physical phone needs the Mac's LAN IP in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_DOMAIN`.  
4. **Orphaned storage objects in prod** — 33 objects in bucket `scores` vs 5 rows; discarded uploads leave images behind. Clean up, and consider fixing the discard path.  
5. **Supabase CLI v3 upgrade** (currently 2.117.0).  
6. **Observability / error tracking** — no APM or error monitoring today (e.g. Sentry — first-class Expo + Vercel SDKs).  
7. **Deferred dep majors** — ESLint 9 → 10, TypeScript 5 → 6 (revisit once `eslint-config-expo` / Metro typings support them).  
8. Future: profile photo support (avatar circle already in place — swap initials for `<Image>`)  
9. Future: email/password auth as second method in `components/AuthScreen.tsx`  
10. Future: per-user score filtering via RLS on `scores` table
11. ~~**Delete UX feedback**~~ — **done** (branch `feat/delete-feedback`, 2026-11-24; see Recently Completed → Delete confirmation feedback). Still needs a manual click-through on web + a native device (toast above iOS modals uses `FullWindowOverlay`).  

