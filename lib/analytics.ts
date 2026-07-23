import PostHog from "posthog-react-native";

const key = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "";
const host =
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export const posthog = key ? new PostHog(key, { host }) : null;

export const analytics = {
  identify(userId: string, props?: { email?: string; name?: string }) {
    posthog?.identify(userId, props);
  },
  track(event: string, props?: Record<string, unknown>) {
    // PostHog types properties as JsonType-valued; our callers pass plain
    // values. Cast to capture()'s own props type (derived, so it stays in sync).
    posthog?.capture(event, props as Parameters<NonNullable<typeof posthog>["capture"]>[1]);
  },
  screen(name: string) {
    posthog?.screen(name);
  },
  reset() {
    posthog?.reset();
  },
};
