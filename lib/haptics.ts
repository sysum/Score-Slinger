import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Haptics are cosmetic: a failure (e.g. an unsupported device) must never block
// or fail the flow, so these are fire-and-forget (never await them) with both
// sync and async errors swallowed. No-op on web.
export function impactHaptic(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
) {
  if (Platform.OS === "web") return;
  try {
    Haptics.impactAsync(style).catch(() => {});
  } catch {
    // ignore
  }
}
