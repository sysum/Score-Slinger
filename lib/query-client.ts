import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { analytics } from "./analytics";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
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

/**
 * Thrown by apiRequest()/getQueryFn() for non-2xx responses. The message keeps
 * the original "<status>: <body>" format; `status` lets callers branch on it
 * (e.g. treat a 404 from DELETE as "already deleted").
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * True when throwIfResNotOk already sent this error as an `$exception` (5xx),
 * so catch sites that report swallowed errors don't capture it twice.
 */
export function isCapturedApiError(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 500;
}

/**
 * Analytics route label: drops the query string and replaces the score id so
 * every score maps to one route (e.g. /api/scores/:id/image-url).
 */
function normalizeRoute(route: string): string {
  return route.split("?")[0].replace(/^(\/api\/scores)\/[^/]+/, "$1/:id");
}

// Single choke point for non-2xx responses: fires `api_request_failed` once per
// failed request, plus an `$exception` for 5xx. Network errors (fetch threw)
// never reach here.
async function throwIfResNotOk(res: Response, method: string, route: string) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const error = new ApiError(res.status, `${res.status}: ${text}`);
    const props = { route: normalizeRoute(route), method, status: res.status };
    analytics.track("api_request_failed", props);
    if (res.status >= 500) analytics.captureException(error, props);
    throw error;
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(url.toString(), {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res, method, route);
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

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const res = await fetch(url.toString(), {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, "GET", route);
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
