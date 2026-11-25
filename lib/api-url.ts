// Kept dependency-free so lib/monitoring.ts can read the API origin without
// pulling in query-client (and with it Supabase and PostHog) before Sentry.init.

/**
 * Gets the base URL for the API server (e.g. "http://localhost:5055" or
 * "https://www.slingers.app"), built from the bare EXPO_PUBLIC_DOMAIN host.
 */
export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }

  const isLocal =
    host.startsWith("localhost") || host.startsWith("127.0.0.1");
  return `${isLocal ? "http" : "https"}://${host}`;
}
