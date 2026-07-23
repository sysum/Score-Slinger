# Score Slinger — Project State

Last updated: 2026-07-23

---

## Current Goal

No major initiative in flight. The app is healthy and in production; the dependency refresh, analytics build-out, tsc/lint cleanup, and new app logo have all shipped to `main`. Remaining work is backlog/maintenance (see Next Steps).

---

## In Progress

Nothing actively in progress. `main` is clean and deployed.

---

## Recently Completed (shipped to `main`)

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
2. **Separate Non-Prod Supabase project** — local dev currently writes to the **prod database** (mirrors the PostHog Non-Prod split). Highest-value item — removes real risk of dev polluting prod data.  
3. **Observability / error tracking** — no APM or error monitoring today (e.g. Sentry — first-class Expo + Vercel SDKs).  
4. **Deferred dep majors** — ESLint 9 → 10, TypeScript 5 → 6 (revisit once `eslint-config-expo` / Metro typings support them).  
5. Future: profile photo support (avatar circle already in place — swap initials for `<Image>`)  
6. Future: email/password auth as second method in `components/AuthScreen.tsx`  
7. Future: per-user score filtering via RLS on `scores` table

