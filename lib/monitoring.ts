// Sentry for the client (Sentry project: score-slinger-web). Errors, traces and
// logs; PostHog (lib/analytics.ts) stays the product-analytics tool, including
// the *_failed events. See docs/SENTRY_PLAN.md and CONTEXT.md → Observability.
//
// MUST be the first import of app/_layout.tsx, so Sentry instruments fetch and
// installs its error handlers before the rest of the app loads.
//
// With no EXPO_PUBLIC_SENTRY_DSN (the local-dev default) Sentry.init is never
// called: no instrumentation, no trace headers, nothing sent. Every export
// below is then a no-op.
import * as Sentry from "@sentry/react-native";
import { getApiUrl } from "@/lib/api-url";
import { scrubDeep } from "@/shared/scrub";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || undefined;

/**
 * `production` / `preview` on Vercel builds (EXPO_PUBLIC_VERCEL_ENV, baked in
 * by the build command), else `development` in dev and `production` otherwise.
 * Also PostHog's `environment` super property (lib/analytics.ts).
 */
export const APP_ENVIRONMENT =
  process.env.EXPO_PUBLIC_VERCEL_ENV ||
  (__DEV__ ? "development" : "production");

/** Escapes a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Trace headers (`sentry-trace`, `baggage`) go to our own API only. Never to
 * Supabase: the client uploads straight to Supabase Storage, and extra
 * headers there would trigger CORS preflight failures.
 */
function apiTracePropagationTargets(): RegExp[] {
  try {
    return [new RegExp(`^${escapeRegExp(getApiUrl())}/api/`)];
  } catch {
    // EXPO_PUBLIC_DOMAIN unset: propagate nowhere.
    return [];
  }
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: APP_ENVIRONMENT,
    // Full commit SHA, the same value the server reports (VERCEL_GIT_COMMIT_SHA).
    release: process.env.EXPO_PUBLIC_COMMIT_SHA || undefined,

    // Low volume, so trace everything (quota math in docs/SENTRY_PLAN.md).
    tracesSampleRate: 1.0,
    tracePropagationTargets: apiTracePropagationTargets(),

    // Also auto-registered when tracing is on; listed so it's explicit.
    integrations: [Sentry.expoRouterIntegration()],

    // Only explicit Sentry.logger.* calls: on web the SDK doesn't auto-capture
    // console.* as logs.
    enableLogs: true,

    // No IP address or other inferred user data. Sentry.setUser (below) sends
    // the user id + display name only, never email.
    sendDefaultPii: false,
    maxBreadcrumbs: 50,

    ignoreErrors: [
      // Benign browser layout notices.
      /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
      // Browser extensions and injected scripts.
      "top.GLOBALS",
      "originalCreateNotification",
      "canvas.contentDocument",
      "MyApp_RemoveAllHighlights",
      "atomicFindClose",
      "conduitPage",
      /^Can't find variable: (ZiteReader|__gCrWeb)/,
      // Outlook Safe Links / mail scanners poking at the page.
      /Non-Error promise rejection captured with value: Object Not Found Matching Id/,
    ],
    denyUrls: [
      /^(chrome|moz|safari(-web)?)-extension:\/\//i,
      /^webkit-masked-url:\/\//i,
    ],

    // Last line of defence: redact JWTs, API keys, signed-URL tokens, magic-link
    // / PKCE codes and inline images from every string (including breadcrumb
    // and navigation URLs) before anything leaves the device.
    beforeSend: (event) => scrubDeep(event),
    beforeSendTransaction: (event) => scrubDeep(event),
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
    beforeSendLog: (log) => {
      if (
        APP_ENVIRONMENT === "production" &&
        (log.level === "debug" || log.level === "trace")
      ) {
        return null;
      }
      return scrubDeep(log);
    },
  });
}

type TagValue = string | number | boolean | null | undefined;

export type CaptureContext = {
  /** Indexed and searchable in Sentry (e.g. context, route, status, request_id). */
  tags?: Record<string, TagValue>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
};

/** Sends an error to Sentry. No-op without a DSN. */
export function captureException(error: unknown, context: CaptureContext = {}) {
  if (!dsn) return;
  const tags: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context.tags ?? {})) {
    if (value !== null && value !== undefined) tags[key] = value;
  }
  Sentry.captureException(error, {
    tags,
    extra: context.extra,
    contexts: context.contexts,
  });
}

/** Attaches the signed-in user to future events. Never pass an email. */
export function setMonitoringUser(user: { id: string; username?: string }) {
  if (!dsn) return;
  Sentry.setUser({
    id: user.id,
    ...(user.username ? { username: user.username } : {}),
  });
}

export function clearMonitoringUser() {
  if (!dsn) return;
  Sentry.setUser(null);
}
