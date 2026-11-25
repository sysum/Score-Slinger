import React, { useEffect } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { useTheme } from "@/contexts/ThemeContext";

export type ToastType = "success" | "error";

export interface ToastData {
  id: number;
  message: string;
  type: ToastType;
}

const VISIBLE_MS = 2500;
const ANIM_MS = 200;
// Matches TAB_BAR_HEIGHT in components/TabBar.tsx, so the toast sits just above it.
const TAB_BAR_HEIGHT = 60;
const GAP_ABOVE_TAB_BAR = 16;

// On iOS, native modals (expo-router `presentation: "modal"`, RN <Modal>) are
// presented above the root view, so render the toast in a full-window overlay
// to keep it on top. Android/web render it in place at the end of the root tree.
function Overlay({ children }: { children: React.ReactNode }) {
  if (Platform.OS === "ios") {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
        {children}
      </FullWindowOverlay>
    );
  }
  return <>{children}</>;
}

export default function Toast({
  toast,
  onHide,
}: {
  toast: ToastData | null;
  onHide: (id: number) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  const toastId = toast?.id;

  useEffect(() => {
    if (toastId === undefined) return;
    progress.value = withTiming(1, { duration: ANIM_MS });
    const timer = setTimeout(() => {
      progress.value = withTiming(0, { duration: ANIM_MS }, (finished) => {
        "worklet";
        // `finished` is false if a newer toast interrupted the fade-out.
        if (finished) runOnJS(onHide)(toastId);
      });
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toastId, progress, onHide]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [16, 0]) }],
  }));

  if (!toast) return null;

  const isError = toast.type === "error";
  const iconColor = isError ? colors.danger : colors.success;

  return (
    <Overlay>
      <View
        style={[styles.host, { bottom: insets.bottom + TAB_BAR_HEIGHT + GAP_ABOVE_TAB_BAR }]}
      >
        <Animated.View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            {
              backgroundColor: colors.surface,
              borderColor: isError ? colors.danger : colors.accentBorder,
            },
            animatedStyle,
          ]}
        >
          <Ionicons name={isError ? "alert-circle" : "checkmark-circle"} size={18} color={iconColor} />
          <Text style={[styles.message, { color: colors.text }]} numberOfLines={2}>
            {toast.message}
          </Text>
        </Animated.View>
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
    // Never block touches on the UI underneath.
    pointerEvents: "none",
    zIndex: 1000,
    elevation: 1000,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: 420,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  message: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: "DMSans_500Medium",
  },
});
