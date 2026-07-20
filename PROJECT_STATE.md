# Score Slinger — Project State

Last updated: 2026-06-17

---

## Current Goal

Dependency modernization. The app is healthy and in production; the active work is a staged dependency refresh on branch `chore/deps-2026-05` (not yet merged). The UI redesign that this doc previously tracked has long since shipped to `main` (PR #2).

---

## In Progress

### Dependency refresh — branch `chore/deps-2026-05` (unpushed)

Ten commits, one logical unit per commit so any can be reverted independently:

- **Phase 0** — removed unused deps (`http-proxy-middleware`, `p-retry`, `p-limit`, `zod-validation-error`)  
- **Phase 1** — `npm audit fix` (cleared all 4 high-severity findings)  
- **Phase 2** — non-Expo patch/minor sweep (`@supabase/supabase-js`, `@tanstack/react-query`, `hono`, `openai`, `posthog-react-native`, react-compiler GA)  
- **Phase 3** — Expo SDK 54 → 55; removed the obsolete `expo-asset` patch  
- **Phase 4** — Expo SDK 55 → 56 (React 19.2, RN 0.85); React Compiler lint fixes (PanResponder → gesture-handler, useQuery for image URL, `@types/node` for the server build, TabBar type import)  
- **Phase 5** — `@hono/node-server` 1 → 2, `zod` 3 → 4  
- Plus: dead-file cleanup, `npm run dev` + port 5055, `.gitignore` tightening, doc refresh

**Deferred (intentionally):** ESLint 9 → 10 and TypeScript 5 → 6 wait on `eslint-config-expo` / Metro typings catching up.

**Remaining audit:** ~13 moderate findings, all the upstream `xcode → uuid` dev-tooling chain (no published fix; `npm audit fix --force` would downgrade Expo — rejected). Dev/build-time only; nothing ships to users.

**Next on this branch:** runtime smoke test, then push + PR to `main`.

---

## Recently Completed (shipped to `main`)

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

1. **Smoke-test `chore/deps-2026-05`** — `npm run dev`, verify auth → upload → score view → magic-link deep link work end-to-end  
2. **Fix any issues** found during testing  
3. **Push + open PR** to `main` for the dependency refresh  
4. Future: profile photo support (avatar circle already in place — swap initials for `<Image>`)  
5. Future: email/password auth as second method in `components/AuthScreen.tsx`  
6. Future: per-user score filtering via RLS on `scores` table

