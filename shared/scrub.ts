// Redacts secrets and image data from anything sent to Sentry (events, logs,
// breadcrumbs, spans) and from the console mirror in server/log.ts.
// Applied to every string value, at any depth.
//
// Shared by the server (server/instrument.ts, server/log.ts) and the client
// (lib/monitoring.ts), so both Sentry projects redact the same patterns.
// Keep it dependency-free: it's bundled into the web app and the API function.

const PATTERNS: [RegExp, string][] = [
  // Inline base64 images (the OpenAI request carries one). Checked first so the
  // other patterns don't partially match inside the base64 payload.
  [/data:image\/[^"'\s]{64,}/g, "[image]"],
  // JWTs (Supabase access tokens, legacy anon/service-role keys).
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
  // Supabase API keys.
  [/sb_secret_\w+/g, "[sb_secret]"],
  [/sb_publishable_\w+/g, "[sb_publishable]"],
  // OpenAI API keys.
  [/sk-[\w-]{20,}/g, "[openai_key]"],
  // Signed-URL tokens, magic-link / PKCE codes, access_token=, refresh_token=.
  [/(token|code)=[^&\s"']+/gi, "$1=[redacted]"],
];

export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const MAX_DEPTH = 20;

// Returns a scrubbed copy of `value`. Only strings, arrays and plain objects are
// walked; anything else (numbers, Dates, String objects, class instances) is
// returned as-is. Cycles and very deep trees are cut off, not followed.
export function scrubDeep<T>(value: T): T {
  return walk(value, 0, new WeakSet()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((item) => walk(item, depth + 1, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = walk(item, depth + 1, seen);
    }
    return out;
  }
  return value;
}
