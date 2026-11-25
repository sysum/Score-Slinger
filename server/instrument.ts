// Sentry initialisation for the API (Sentry project: score-slinger-api).
// MUST be the first import in every server entry point (api/index.ts,
// server/index.ts) so instrumentation is set up before hono/openai/supabase load.
//
// With no SENTRY_DSN (the local-dev default) the SDK still initialises, so the
// Hono middleware and logger calls work, but nothing is sent anywhere.
import * as Sentry from "@sentry/hono/node";
import { scrubDeep } from "./scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.VERCEL_ENV ?? "development",
  release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,

  // Low volume (a handful of users), so trace everything. See docs/SENTRY_PLAN.md
  // for the free-tier quota math.
  tracesSampleRate: 1.0,
  // CORS preflights are pure noise.
  ignoreSpans: [/^OPTIONS\b/, { attributes: { "http.request.method": "OPTIONS" } }],

  // Collect as little as possible by default. Explicit so an SDK default change
  // can't start shipping request data. Notably:
  //  - no bodies: /api/parse-score's outgoing OpenAI request body holds the
  //    base64 scoreboard image;
  //  - no headers/cookies: Authorization carries the Supabase JWT;
  //  - no IP / inferred user info: Sentry.setUser in requireAuth sets id +
  //    display name only, never email;
  //  - no GenAI inputs: the prompt includes the image. Outputs (the score JSON)
  //    are fine to keep on the span;
  //  - no stack-frame locals: frames hold the token, buffer and base64 string.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: true },
    databaseQueryData: false,
    stackFrameVariables: false,
  },

  integrations: [
    // Belt and braces with dataCollection.genAI above.
    Sentry.openAIIntegration({ recordInputs: false, recordOutputs: true }),
    // Safety net: anything that still calls console.warn/error (libraries,
    // stray code) becomes a Sentry log. server/log.ts mirrors to console.log,
    // which this deliberately doesn't capture, so there are no duplicates.
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  // Last line of defence: redact JWTs, API keys, signed-URL tokens and inline
  // images from every string before anything leaves the process.
  beforeSend: (event) => scrubDeep(event),
  beforeSendLog: (log) => scrubDeep(log),
  beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
  beforeSendSpan: (span) => scrubDeep(span),
});
