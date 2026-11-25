import { Platform } from "react-native";
import { analytics } from "@/lib/analytics";

// Stale-bundle guard (web prod only). The SPA never reloads on its own, so a
// tab left open keeps running an old bundle — with old EXPO_PUBLIC_* values
// baked in (e.g. a disabled Supabase key). Detect a newer deploy by comparing
// the entry script in a fresh copy of index.html with the one this page loaded,
// and reload at a safe moment. No-op on native and in dev.

const ENTRY_RE = /\/_expo\/static\/js\/web\/entry-[\w.-]+\.js/;
const LEGACY_KEY_RE = /legacy api keys are disabled/i;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
// At most one reload per reason per 5 minutes, so a deploy that keeps serving
// mismatched HTML (or a key error that a reload doesn't fix) can't loop.
const RELOAD_GUARD_MS = 5 * 60 * 1000;

type ReloadReason = "new_bundle" | "legacy_key_error";

/** The `/_expo/static/js/web/entry-<hash>.js` path in an HTML string or script src, or null. */
export function extractEntrySrc(text: string | null | undefined): string | null {
  return text?.match(ENTRY_RE)?.[0] ?? null;
}

/** True only when both entries are known and differ — unknown means "don't reload". */
export function isNewBundle(current: string | null, latest: string | null): boolean {
  return !!current && !!latest && current !== latest;
}

const currentEntry =
  Platform.OS === "web" && !__DEV__ && typeof document !== "undefined"
    ? extractEntrySrc(
        document
          .querySelector('script[src*="/_expo/static/js/web/entry-"]')
          ?.getAttribute("src"),
      )
    : null;
// No entry script found (dev server, unexpected HTML) → the guard stays off.
const enabled = currentEntry !== null;

let pathname: string | null = null;
let signedIn = false;
let pendingEntry: string | null = null;
let lastCheckAt = 0;
let inFlight: Promise<string | null> | null = null;
let reloading = false;

async function fetchLatestEntry(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/", { cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;
    return extractEntrySrc(await res.text());
  } catch {
    return null; // offline, timeout, etc. — try again next time
  } finally {
    clearTimeout(timer);
  }
}

function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

// The auth screen is always safe; otherwise not on the upload modal (it may be
// analysing/saving) and not typing.
function isSafeToReload(): boolean {
  if (!signedIn) return true;
  return pathname !== "/upload" && !isTextInputFocused();
}

function claimReloadGuard(reason: ReloadReason): boolean {
  const key = `reload_guard_${reason}`;
  try {
    const last = Number(sessionStorage.getItem(key));
    if (last && Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return false; // can't guard against loops → don't reload
  }
}

async function reload(reason: ReloadReason, toEntry: string | null): Promise<boolean> {
  if (reloading) return true;
  if (!claimReloadGuard(reason)) return false;
  reloading = true;
  analytics.track("app_reloaded_for_update", {
    reason,
    from_entry: currentEntry,
    to_entry: toEntry,
  });
  await analytics.flush(500);
  window.location.reload();
  return true;
}

function reloadIfPending(): void {
  if (pendingEntry && isSafeToReload()) void reload("new_bundle", pendingEntry);
}

/**
 * Check for a newer deploy (throttled unless `force`). Reloads now if safe,
 * otherwise remembers it for the next safe moment. Resolves true if a reload
 * was started.
 */
export async function checkForUpdate({ force = false } = {}): Promise<boolean> {
  if (!enabled || reloading) return reloading;
  if (!inFlight) {
    if (!force && Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) {
      reloadIfPending();
      return reloading;
    }
    lastCheckAt = Date.now();
    inFlight = fetchLatestEntry().finally(() => {
      inFlight = null;
    });
  }
  const latest = await inFlight;
  // A failed fetch (null) keeps any pending reload; a reply naming the current
  // entry (e.g. a rollback) clears it.
  if (latest) pendingEntry = isNewBundle(currentEntry, latest) ? latest : null;
  if (pendingEntry && isSafeToReload()) return reload("new_bundle", pendingEntry);
  return false;
}

/**
 * If a Supabase auth error is the "legacy API keys are disabled" 401, this
 * bundle has a retired key baked in — reload (at most once per 5 minutes).
 * Resolves true if a reload was started.
 */
export async function reloadOnLegacyKeyError(message: string | undefined): Promise<boolean> {
  if (Platform.OS !== "web" || __DEV__ || !message || !LEGACY_KEY_RE.test(message)) return false;
  return reload("legacy_key_error", null);
}

export function setVersionCheckPathname(next: string): void {
  pathname = next;
  reloadIfPending();
}

export function setVersionCheckSignedIn(next: boolean): void {
  signedIn = next;
  reloadIfPending();
}

/** Start the visibility + interval checks. Returns a cleanup function. */
export function startVersionCheck(): () => void {
  if (!enabled) return () => {};
  const onVisibilityChange = () => {
    // A hidden tab is a fine moment for a pending reload; on show, re-check.
    reloadIfPending();
    if (document.visibilityState === "visible") void checkForUpdate();
  };
  const interval = setInterval(() => {
    if (document.visibilityState === "visible") void checkForUpdate();
  }, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
