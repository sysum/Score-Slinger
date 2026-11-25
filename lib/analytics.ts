import Constants from "expo-constants";
import { Platform } from "react-native";
import PostHog from "posthog-react-native";

const key = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "";
const host =
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export const posthog = key
  ? new PostHog(key, {
      host,
      // Send immediately in dev so events show up in PostHog while testing;
      // small batches + a 5s timer in prod (SDK defaults: 20 events / 10s).
      flushAt: __DEV__ ? 1 : 5,
      flushInterval: 5000,
      // No feature flags or surveys in use — skip those network round-trips.
      preloadFeatureFlags: false,
      disableSurveys: true,
      captureAppLifecycleEvents: true,
      errorTracking: {
        autocapture: {
          uncaughtExceptions: true, // RN ErrorUtils — native only (absent on web)
          unhandledRejections: true,
          // Off: explicit *_failed events already cover the errors we care about.
          console: false,
        },
      },
    })
  : null;

if (posthog && process.env.EXPO_PUBLIC_POSTHOG_DEBUG === "true") {
  posthog.debug(true);
}

type EventProps = Parameters<NonNullable<typeof posthog>["capture"]>[1];

// Super properties — attached to every event. `reset()` wipes them, so
// `analytics.reset()` re-applies them.
const commitSha = process.env.EXPO_PUBLIC_COMMIT_SHA;
const superProps: Record<string, string> = {
  platform: Platform.OS,
  environment:
    process.env.EXPO_PUBLIC_VERCEL_ENV ||
    (__DEV__ ? "development" : "production"),
  ...(Constants.expoConfig?.version
    ? { app_version: Constants.expoConfig.version }
    : {}),
  ...(commitSha ? { commit: commitSha.slice(0, 7) } : {}),
};

function registerSuperProps() {
  posthog?.register(superProps);
}

registerSuperProps();

export const analytics = {
  /**
   * Identify the signed-in user and set person properties. Resolves `true`
   * when this is a new identity for this device (anonymous → user), i.e. a
   * real sign-in rather than a restored session — PostHog persists the
   * distinct ID, and `reset()` on sign-out clears it.
   */
  async identifyUser(user: {
    id: string;
    email?: string;
    displayName?: string;
  }): Promise<boolean> {
    if (!posthog) return false;
    // Wait for persisted storage so getDistinctId() reflects the stored ID.
    await posthog.ready();
    const isNewIdentity = posthog.getDistinctId() !== user.id;
    posthog.identify(user.id, {
      $set: {
        ...(user.email ? { email: user.email } : {}),
        ...(user.displayName ? { display_name: user.displayName } : {}),
      },
      $set_once: { first_seen_at: new Date().toISOString() },
    });
    return isNewIdentity;
  },
  setPersonProperties(
    set: Record<string, string>,
    setOnce?: Record<string, string>,
  ) {
    posthog?.setPersonProperties(set, setOnce);
  },
  track(event: string, props?: Record<string, unknown>) {
    // PostHog types properties as JsonType-valued; our callers pass plain
    // values. Cast to capture()'s own props type (derived, so it stays in sync).
    posthog?.capture(event, props as EventProps);
  },
  screen(name: string, props?: Record<string, unknown>) {
    posthog?.screen(name, props as EventProps);
  },
  captureException(error: unknown, props?: Record<string, unknown>) {
    posthog?.captureException(error, props as EventProps);
  },
  reset() {
    posthog?.reset();
    registerSuperProps();
  },
  /** Send queued events now (e.g. before a page reload), waiting at most `timeoutMs`. */
  async flush(timeoutMs = 500) {
    if (!posthog) return;
    await Promise.race([
      posthog.flush().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  },
};
