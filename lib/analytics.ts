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
    posthog?.capture(event, props);
  },
  screen(name: string) {
    posthog?.screen(name);
  },
  reset() {
    posthog?.reset();
  },
};
