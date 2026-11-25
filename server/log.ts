// Structured server logging: thin wrapper over Sentry.logger.
//
// Each call is one named event (e.g. "parse.completed") plus flat attributes.
// Sentry adds request_id / route / method / user_id from the request scope (see
// server/app.ts), plus the trace id, so logs, errors and spans correlate.
//
// Every line is also mirrored to console.log (scrubbed) so local dev, where
// Sentry is a no-op by default, and Vercel's 1-hour runtime logs still show it.
// console.log rather than console.warn/error: the consoleLoggingIntegration in
// server/instrument.ts captures warn/error, and mirroring there would duplicate
// every warn/error log in Sentry.
//
// NEVER pass image bytes, base64, data URLs, tokens or keys as attributes.
// scrub.ts is a safety net, not a licence.
import * as Sentry from "@sentry/hono/node";
import { scrubDeep, scrubString } from "../shared/scrub";

export type LogAttributes = Record<string, string | number | boolean | null | undefined>;
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, event: string, attributes: LogAttributes = {}): void {
  // Drop undefined so Sentry and the console line only show real values.
  const attrs: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) attrs[key] = value;
  }

  if (Sentry.isEnabled()) {
    Sentry.logger[level](event, attrs);
  }

  const suffix = Object.keys(attrs).length > 0 ? ` ${JSON.stringify(scrubDeep(attrs))}` : "";
  console.log(`[${level}] ${scrubString(event)}${suffix}`);
}

export const log = {
  debug: (event: string, attributes?: LogAttributes) => emit("debug", event, attributes),
  info: (event: string, attributes?: LogAttributes) => emit("info", event, attributes),
  warn: (event: string, attributes?: LogAttributes) => emit("warn", event, attributes),
  error: (event: string, attributes?: LogAttributes) => emit("error", event, attributes),
};

// Best-effort message from anything thrown or returned as an error: Error
// instances, Supabase's PostgrestError / StorageError shapes, strings.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

export const MAX_LOGGED_CONTENT = 2048;

// Truncates long free text (e.g. the raw OpenAI reply) before logging it.
export function truncate(value: string, max: number = MAX_LOGGED_CONTENT): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated ${value.length - max} chars]` : value;
}
