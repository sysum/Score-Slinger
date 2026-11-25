import * as Crypto from "expo-crypto";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { analytics } from "./analytics";
import { getApiUrl } from "./api-url";
import { captureException } from "./monitoring";

export { getApiUrl };

/**
 * Thrown by apiRequest()/getQueryFn() for non-2xx responses. The message keeps
 * the original "<status>: <body>" format; `status` lets callers branch on it
 * (e.g. treat a 404 from DELETE as "already deleted"). `requestId` is the
 * server's X-Request-Id for the request (search Sentry for request_id:<id>).
 */
export class ApiError extends Error {
  status: number;
  requestId: string | null;

  constructor(status: number, message: string, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * True when throwIfResNotOk already sent this error to Sentry (5xx), so catch
 * sites that report swallowed errors don't capture it twice.
 */
export function isCapturedApiError(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 500;
}

/** The server request id of an ApiError, or null (network or other errors). */
export function requestIdOf(err: unknown): string | null {
  return err instanceof ApiError ? err.requestId : null;
}

/**
 * Analytics route label: drops the query string and replaces the score id so
 * every score maps to one route (e.g. /api/scores/:id/image-url).
 */
function normalizeRoute(route: string): string {
  return route.split("?")[0].replace(/^(\/api\/scores)\/[^/]+/, "$1/:id");
}

/**
 * Sent as X-Request-Id; the server tags its logs, spans and errors with it and
 * echoes it back. Null if UUIDs aren't available (web crypto.randomUUID needs a
 * secure context, so not a LAN http:// URL): the server then mints its own.
 */
function newRequestId(): string | null {
  try {
    return Crypto.randomUUID();
  } catch {
    return null;
  }
}

/**
 * Looked up on every call (not imported from expo/fetch) so requests go through
 * Sentry's fetch instrumentation, which replaces globalThis.fetch in
 * Sentry.init: breadcrumbs, http.client spans and the sentry-trace / baggage
 * headers that link client and server traces. On web, expo/fetch is only
 * `globalThis.fetch` captured when that module first loads, which can be before
 * Sentry.init. On native (Expo SDK 56) globalThis.fetch is expo/fetch anyway.
 */
function apiFetch(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init);
}

// Single choke point for non-2xx responses: fires `api_request_failed` once per
// failed request, plus a Sentry error for 5xx. Network errors (fetch threw)
// never reach here.
async function throwIfResNotOk(
  res: Response,
  method: string,
  route: string,
  sentRequestId: string | null,
) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // The server echoes the id it used (ours, unless it rejected it).
    const requestId = res.headers.get("X-Request-Id") ?? sentRequestId;
    const error = new ApiError(res.status, `${res.status}: ${text}`, requestId);
    const props = { route: normalizeRoute(route), method, status: res.status };
    analytics.track("api_request_failed", { ...props, request_id: requestId });
    if (res.status >= 500) {
      captureException(error, { tags: { ...props, request_id: requestId } });
    }
    throw error;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);
  const requestId = newRequestId();

  const res = await apiFetch(url.toString(), {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(await authHeader()),
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res, method, route, requestId);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const route = queryKey.join("/") as string;
    const url = new URL(route, baseUrl);
    const requestId = newRequestId();

    const res = await apiFetch(url.toString(), {
      credentials: "include",
      headers: {
        ...(await authHeader()),
        ...(requestId ? { "X-Request-Id": requestId } : {}),
      },
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, "GET", route, requestId);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
