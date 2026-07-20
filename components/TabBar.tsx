import React, { useState, type ComponentProps } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Tabs, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import { analytics } from "@/lib/analytics";

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const TAB_BAR_HEIGHT = 60;
const FAB_SIZE = 64;
const FAB_OVERLAP = 28;

export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [showActionSheet, setShowActionSheet] = useState(false);

  const totalHeight = TAB_BAR_HEIGHT + insets.bottom;

  const handleFABPress = async () => {
    if (Platform.OS !== "web") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setShowActionSheet(true);
  };

  const launchPicker = async (useCamera: boolean) => {
    setShowActionSheet(false);

    // Small delay to let action sheet close cleanly
    await new Promise((r) => setTimeout(r, 150));

    try {
      if (Platform.OS !== "web") {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      let pickerResult;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Camera access is required to take photos.");
          return;
        }
        pickerResult = await ImagePicker.launchCameraAsync({
          quality: 0.8,
          base64: false,
          exif: true,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Photo library access is required.");
          return;
        }
        pickerResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.8,
          base64: false,
          exif: true,
        });
      }

      if (pickerResult.canceled) return;

      analytics.track("image_selected", { source: useCamera ? "camera" : "library" });
      const asset = pickerResult.assets[0];

      // Extract EXIF date
      let photoDate: string = new Date().toISOString();
      if (asset.exif) {
        const exifData = asset.exif as Record<string, unknown>;
        const findExifDate = (obj: Record<string, unknown>): string | null => {
          if (!obj || typeof obj !== "object") return null;
          const dateKeys = ["DateTimeOriginal", "DateTime", "DateTimeDigitized", "CreateDate", "ModifyDate", "DateCreated"];
          for (const key of dateKeys) {
            if (obj[key] && typeof obj[key] === "string") return obj[key] as string;
          }
          for (const key of Object.keys(obj)) {
            if (typeof obj[key] === "object" && obj[key] !== null) {
              const found = findExifDate(obj[key] as Record<string, unknown>);
              if (found) return found;
            }
          }
          return null;
        };
        const exifDate = findExifDate(exifData);
        if (exifDate) {
          const parsed = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
          const d = new Date(parsed);
          if (!isNaN(d.getTime())) {
            photoDate = d.toISOString();
          }
        }
      }

      router.push({
        pathname: "/upload",
        params: {
          uri: asset.uri,
          photoDate,
          fileName: asset.fileName || asset.uri.split("/").pop() || "",
        },
      });
    } catch (err) {
      console.error("Image pick error:", err);
    }
  };

  const tabs = state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    return options.href !== null;
  });

  return (
    <>
      {/* Tab bar container */}
      <View style={[styles.container, { backgroundColor: colors.surface, borderTopColor: colors.cardBorder, height: totalHeight, paddingBottom: insets.bottom }]}>
        {/* Left tab */}
        <TabButton
          route={tabs[0]}
          state={state}
          descriptors={descriptors}
          navigation={navigation}
          colors={colors}
        />

        {/* FAB spacer */}
        <View style={{ width: FAB_SIZE + 32 }} />

        {/* Right tab */}
        <TabButton
          route={tabs[1]}
          state={state}
          descriptors={descriptors}
          navigation={navigation}
          colors={colors}
        />
      </View>

      {/* FAB — sits above the tab bar */}
      <Pressable
        onPress={handleFABPress}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: colors.accent,
            bottom: totalHeight - FAB_OVERLAP,
            opacity: pressed ? 0.88 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          },
        ]}
      >
        <Ionicons name="camera" size={28} color="#0f0f0f" />
      </Pressable>

      {/* Action sheet */}
      <Modal visible={showActionSheet} transparent animationType="fade" onRequestClose={() => setShowActionSheet(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowActionSheet(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.cardBorder }]} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Add Score</Text>

            <Pressable
              onPress={() => launchPicker(true)}
              style={({ pressed }) => [styles.sheetOption, { borderBottomColor: colors.cardBorder }, pressed && { backgroundColor: colors.surfaceLight }]}
            >
              <View style={[styles.sheetOptionIcon, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="camera-outline" size={22} color={colors.accent} />
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={[styles.sheetOptionLabel, { color: colors.text }]}>Take Photo</Text>
                <Text style={[styles.sheetOptionSub, { color: colors.textMuted }]}>Open camera to photograph the scoreboard</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            <Pressable
              onPress={() => launchPicker(false)}
              style={({ pressed }) => [styles.sheetOption, pressed && { backgroundColor: colors.surfaceLight }]}
            >
              <View style={[styles.sheetOptionIcon, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="images-outline" size={22} color={colors.accent} />
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={[styles.sheetOptionLabel, { color: colors.text }]}>Choose from Library</Text>
                <Text style={[styles.sheetOptionSub, { color: colors.textMuted }]}>Pick an existing photo</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            <Pressable
              onPress={() => setShowActionSheet(false)}
              style={({ pressed }) => [styles.cancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Individual tab button ─────────────────────────────────────────────────────

function TabButton({
  route,
  state,
  descriptors,
  navigation,
  colors,
}: {
  route: (typeof state.routes)[number];
  state: BottomTabBarProps["state"];
  descriptors: BottomTabBarProps["descriptors"];
  navigation: BottomTabBarProps["navigation"];
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const { options } = descriptors[route.key];
  const isFocused = state.index === state.routes.indexOf(route);

  const onPress = () => {
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  const icon = route.name === "index" ? "time" : "person";
  const label = route.name === "index" ? "History" : "Profile";
  const color = isFocused ? colors.accent : colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tabBtn, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={isFocused ? icon : `${icon}-outline` as any} size={22} color={color} />
      <Text style={[styles.tabLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingTop: 10,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: "DMSans_500Medium",
  },
  fab: {
    position: "absolute",
    alignSelf: "center",
    left: "50%",
    marginLeft: -(FAB_SIZE / 2),
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0px 4px 12px rgba(0, 229, 204, 0.4)",
    elevation: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 34,
    gap: 4,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: "SpaceGrotesk_700Bold",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
    borderRadius: 8,
  },
  sheetOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetOptionText: {
    flex: 1,
    gap: 2,
  },
  sheetOptionLabel: {
    fontSize: 15,
    fontFamily: "DMSans_600SemiBold",
  },
  sheetOptionSub: {
    fontSize: 12,
    fontFamily: "DMSans_400Regular",
  },
  cancelBtn: {
    marginTop: 8,
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 15,
    fontFamily: "DMSans_500Medium",
  },
});
