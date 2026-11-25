# Sentry plan

Status as of 2026-11-25: **Phase 0 and Phase 1 (server) done**: merged as PR #19 and verified in production (logs, traces and errors reach `score-slinger-api` in org `team-beam`). **Phase 2 (client) implemented** on `feat/sentry-client`, awaiting `EXPO_PUBLIC_SENTRY_DSN` in Vercel and a preview check. Phase 4 is not started.

## Why

- Vercel is on the Hobby plan, so runtime logs last **1 hour**. When a user reports a failure the next morning, the server side is gone. The 2026-11-25 "Failed to analyze image" incident had to be reconstructed from Supabase logs.
- PostHog covers product analytics (what users do) and some client error capture. It has no server visibility, traces, or structured logs.
- Sentry's free plan covers errors, traces (spans) and logs for this app's volume at $0.

## Decisions (user)

| Topic | Decision |
| :---- | :---- |
| Projects | Two Sentry projects: `score-slinger-web` (client, Phase 2) and `score-slinger-api` (server, Phase 1) |
| User identity | **No email in Sentry.** User id + display name (`username`) only |
| OpenAI output | Log the raw OpenAI response `content` (score JSON) at info level, truncated to 2 KB |
| PostHog | `*_failed` events stay (client-side). Error capture moves to Sentry in Phase 2 |
| Replay | No session replay (Phase 4 is optional, on-error only, and needs a separate decision) |
| Environments | Preview deploys report too. `environment` comes from `VERCEL_ENV` (`production` / `preview`; `development` locally) |
| Cost | $0 free plan. **With no `SENTRY_DSN` set, everything is a silent no-op.** Local dev stays no-op by default |

## Phases

### Phase 0: Sentry dashboard setup (user) — done

1. Create a Sentry account/org on the free (Developer) plan, US data region.
2. Create project **`score-slinger-api`** (platform: Node.js / Hono). Copy its DSN (Settings → Projects → score-slinger-api → Client Keys (DSN)).
3. Create project **`score-slinger-web`** (platform: React Native) now or in Phase 2.
4. In `score-slinger-api` → Settings → Security & Privacy: keep **Data Scrubber** and **Use Default Scrubbers** on. Turn **Prevent Storing of IP Addresses** on (belt and braces; the SDK already sends none).
5. Org Settings → Subscription / Spend: confirm the pay-as-you-go budget is **$0**, so overage drops data instead of billing.
6. Vercel → Project → Settings → Environment Variables: add `SENTRY_DSN` = the api DSN for **Production and Preview** (not Development). Plain variable is fine (a DSN can only send events), Sensitive is also fine.
7. Vercel → Project → Settings → General → Node.js Version: must be **22.x or 24.x** (the SDK needs ≥20.19 / ≥22.12).
8. Redeploy. Build cache doesn't matter here: `SENTRY_DSN` is read at runtime, not baked into the bundle.
9. Verify on a preview: hit the app, then check Sentry → Explore → Logs for `request.completed`, Traces for `GET /api/scores`, and filter by `environment:preview`.
10. Optional alerts: an issue alert for new issues in `production` (email), and one for `parse.no_json` / `*.failed` log volume if Sentry's log alerts are available on the plan.

### Phase 1: Server — done (PR #19, verified in production)

- `@sentry/hono` + `@sentry/node`, both pinned to exactly **11.12.0** (newest release ≥2 weeks old at install time). `honoIntegration` and `@hono/sentry` are deprecated/removed; not used.
- `server/instrument.ts` calls `Sentry.init` from `@sentry/hono/node`. It's imported as the **first line** of `api/index.ts` and `server/index.ts`.
  - `dsn: SENTRY_DSN`, `environment: VERCEL_ENV ?? "development"`, `release: SENTRY_RELEASE ?? VERCEL_GIT_COMMIT_SHA`
  - `tracesSampleRate: 1.0`, `ignoreSpans` for `OPTIONS`
  - explicit `dataCollection` (see PII below)
  - `openAIIntegration({ recordInputs: false })`, `consoleLoggingIntegration({ levels: ["warn", "error"] })`
  - `beforeSend` / `beforeSendLog` / `beforeBreadcrumb` / `beforeSendSpan` all run `scrubDeep`
  - Logs need no flag: SDK v11 has no `enableLogs` option; logs are on by default.
- Middleware order in `server/app.ts`: `sentry(app)` → request-id → `cors` → `requireAuth`.
  - Request-id: accept `X-Request-Id` (≤64 chars, `[\w-]`) or mint `crypto.randomUUID()`. Set as tags and scope attributes with `route` and `method`. Echo it in the response, which CORS exposes. Log `request.completed { method, route, status, duration_ms, request_id }`.
  - CORS `allowHeaders` adds `sentry-trace`, `baggage`, `X-Request-Id` (ready for Phase 2 distributed tracing).
  - `requireAuth`: `Sentry.setUser({ id, username: user_metadata.display_name })` + `user_id` attribute.
- `server/log.ts`: `log.{debug,info,warn,error}(event, attrs)` over `Sentry.logger`, mirrored (scrubbed) to `console.log`. Every server `console.*` was replaced; see CONTEXT.md → Observability → Server log events. The `server/index.ts` startup line stays `console.log`.
- `fail(c, event, err, message)`: `captureException` + `<event>.failed` log + `{ error: message, requestId }` with 500. Error strings and status codes are unchanged.
- **Serverless flush:** `@sentry/node` 11.12.0 calls `setupVercelKeepAlive(client)` in `init` when `process.env.VERCEL` is set. It subscribes to the `http.server.response.finish` diagnostics channel and calls the Vercel request context's `waitUntil(...)`, which waits up to 2 s for the root span and then runs `client.flush(2000)`. No `@vercel/functions` needed. If Phase 0 step 9 shows missing logs or spans in Vercel, add `waitUntil(Sentry.flush(2000))` from `@vercel/functions` in the request-id middleware.

### Phase 2: Client SDK + PostHog error-capture split (implemented on `feat/sentry-client`)

Plan as approved:

- Add the Sentry React Native / Expo SDK in the client with `EXPO_PUBLIC_SENTRY_DSN` (project `score-slinger-web`). No-op when unset, same rule as the server.
- New `lib/monitoring.ts` wrapper (null-safe, like `lib/analytics.ts`). Move every `analytics.captureException` call site there: the `ErrorBoundary` `onError`, 5xx in `throwIfResNotOk`, the catch blocks (`post_save`, `upload_cancel_cleanup`, player names, analyze image).
- **PostHog exception autocapture off** (`uncaughtExceptions`, `unhandledRejections`), so errors go to Sentry only. PostHog `*_failed` events stay for funnels.
- Send `X-Request-Id` from `lib/query-client.ts` (or read the echoed one) and attach it to client errors. Enable `tracePropagationTargets` for the API origin so `sentry-trace` / `baggage` connect client and server traces (CORS already allows them).
- `Sentry.setUser({ id, username: display_name })`, no email.

As implemented (details in CONTEXT.md → Observability):

- `@sentry/react-native` pinned to **8.35.0** (2026-11-12). `npx expo install` chose ~7.11.0 from Expo's stale `bundledNativeModules.json`; 7.11.0 lacks `expoRouterIntegration` and SDK 56 `expo/fetch` support (8.14.0). 8.36.0 was <14 days old. `expo.install.exclude` in `package.json` keeps expo-doctor quiet about it.
- `lib/monitoring.ts`, first import of `app/_layout.tsx`. `Sentry.init` runs **only with `EXPO_PUBLIC_SENTRY_DSN`**. `environment` = `APP_ENVIRONMENT` (also PostHog's), `release` = `EXPO_PUBLIC_COMMIT_SHA`, `tracesSampleRate` 1.0, `tracePropagationTargets` = `^${getApiUrl()}/api/` only, `expoRouterIntegration()`, `enableLogs` with `beforeSendLog` dropping debug/trace in production, `sendDefaultPii: false`, `maxBreadcrumbs` 50, `ignoreErrors` / `denyUrls`, scrubbing in `beforeSend` / `beforeSendTransaction` / `beforeBreadcrumb` / `beforeSendLog`.
- `metro.config.js`: `getSentryExpoConfig(__dirname, { includeWebReplay: false, includeWebFeedback: false })`, no `annotateReactComponents` (React Compiler). Plus a resolver that makes every bare `@sentry/core` import use `@sentry/react-native`'s copy (the server's hoisted 11.x forces npm to nest a 10.x copy per client package): minified bundle 8.17 MB → 6.73 MB.
- `app.json`: `["@sentry/react-native/expo", { organization: "team-beam", project: "score-slinger-web" }]`. Native-only mods; `expo export` reads the config with `skipPlugins: true`, and no token is needed.
- `expo/fetch` on web is `globalThis.fetch` captured at module load, which can predate Sentry's patch of `globalThis.fetch`, so `lib/query-client.ts` calls `globalThis.fetch` per request.
- Request ids: `X-Request-Id` on every API request, `ApiError.requestId`, `request_id` on `api_request_failed` / the other `*_failed` events / 5xx Sentry tags.
- Dashboard (user): in `score-slinger-web` → Settings → Security & Privacy, keep the data scrubbers on and turn on **Prevent Storing of IP Addresses**, as for the api project.

### Phase 3: Source maps

- Build: `npx expo export --platform web --source-maps`, then `npx @sentry/expo-upload-sourcemaps dist` with `SENTRY_AUTH_TOKEN` (Vercel secret, build-time only), `SENTRY_ORG`, `SENTRY_PROJECT`.
- Then **delete the `.map` files from `dist/`** in the same Vercel build command so they're never served publicly.
- Server stack traces are already readable (`api/index.ts` isn't minified), so this is mostly for the web client.

### Phase 4 (optional): On-error replay

- Only if errors prove hard to reproduce. `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0`, all text and inputs masked. Needs an explicit user decision, since the current decision is no replay.

## Free-tier quota math

Free plan, monthly: **5M spans, 5 GB logs, 5k errors** (plus 50 replays, unused).

| Data | Estimate per month | Limit | Headroom |
| :---- | :---- | :---- | :---- |
| Spans | ≈25k (a few thousand API requests × ~5 spans each: server span, Supabase fetches, OpenAI call) | 5M | ~200× |
| Logs | ≈12 MB (one ~0.5 KB `request.completed` per request, plus ~2–3 KB `parse.completed` per upload) | 5 GB | ~400× |
| Errors | a handful | 5k | ample |

`tracesSampleRate: 1.0` is safe at this volume. Revisit if traffic grows ~50× or more. The $0 spend cap means overage drops data rather than billing.

## PII and scrubbing rules

**Never sent:** email, image bytes, base64, data URLs, Supabase JWTs, API keys, signed-URL tokens, magic-link / PKCE codes, IP addresses.

SDK `dataCollection` (explicit, so an SDK default change can't widen it):

| Option | Value | Why |
| :---- | :---- | :---- |
| `httpBodies` | `[]` | The outgoing OpenAI request body holds the base64 image; incoming bodies hold score data |
| `httpHeaders` | `false` | `Authorization: Bearer <JWT>` |
| `cookies` | `false` | |
| `urlQueryParams` | `false` | Signed URLs carry `token=` |
| `userInfo` | `false` | No IP / inferred user. `setUser` (id + display name) still works |
| `genAI` | `{ inputs: false, outputs: true }` | The prompt contains the image. Output is score JSON |
| `databaseQueryData` | `false` | |
| `stackFrameVariables` | `false` | Locals include the token, image buffer and base64 string |

`shared/scrub.ts` regexes (moved from `server/scrub.ts` in Phase 2; used by server and client) run on every string in events, logs, breadcrumbs and spans (and the server's console mirror):

| Pattern | Replacement |
| :---- | :---- |
| `data:image/[^"'\s]{64,}` | `[image]` |
| `eyJ[\w-]+\.[\w-]+\.[\w-]+` (JWT) | `[jwt]` |
| `sb_secret_\w+` | `[sb_secret]` |
| `sb_publishable_\w+` | `[sb_publishable]` |
| `sk-[\w-]{20,}` | `[openai_key]` |
| `(token\|code)=[^&\s"']+` (case-insensitive) | `$1=[redacted]` |

The `token=` / `code=` rule also redacts things like `status_code=`. That's deliberate: over-redacting is the safe failure.
