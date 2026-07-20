import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme, AppearanceMode } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { analytics } from "@/lib/analytics";
import Constants from "expo-constants";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortOption =
  | "upload_recent"
  | "upload_oldest"
  | "played_recent"
  | "played_oldest"
  | "score_highest"
  | "score_lowest";

const SORT_LABELS: Record<SortOption, string> = {
  upload_recent: "Upload Date (Recent First)",
  upload_oldest: "Upload Date (Oldest First)",
  played_recent: "Played Date (Recent First)",
  played_oldest: "Played Date (Oldest First)",
  score_highest: "Team Score (Highest First)",
  score_lowest: "Team Score (Lowest First)",
};

type DateFormatKey =
  | "us_full"
  | "eu_full"
  | "iso_full"
  | "mmm_full"
  | "dd_mmm_full"
  | "us_date"
  | "eu_date"
  | "iso_date"
  | "mmm_date"
  | "long_date";

const DATE_FORMAT_LABELS: Record<DateFormatKey, string> = {
  us_full: "MM/DD/YYYY h:mm A",
  eu_full: "DD/MM/YYYY h:mm A",
  iso_full: "YYYY-MM-DD HH:mm",
  mmm_full: "Jan 15, 2025 3:30 PM",
  dd_mmm_full: "15 Jan 2025 3:30 PM",
  us_date: "MM/DD/YYYY",
  eu_date: "DD/MM/YYYY",
  iso_date: "YYYY-MM-DD",
  mmm_date: "Jan 15, 2025",
  long_date: "January 15, 2025",
};

// ─── Section components ────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle, colors }: { title: string; subtitle?: string; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <View style={sectionStyles.header}>
      <Text style={[sectionStyles.title, { color: colors.text }]}>{title}</Text>
      {subtitle && <Text style={[sectionStyles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: { marginBottom: 8, gap: 2 },
  title: { fontSize: 13, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase" },
  subtitle: { fontSize: 12, fontFamily: "DMSans_400Regular" },
});

// ─── Profile screen ────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("upload_recent");
  const [dateFormat, setDateFormat] = useState<DateFormatKey>("mmm_full");

  useEffect(() => {
    AsyncStorage.getItem("display_name").then((n) => { if (n) setDisplayName(n); });
    AsyncStorage.getItem("sort_option").then((s) => { if (s && s in SORT_LABELS) setSortOption(s as SortOption); });
    AsyncStorage.getItem("date_format").then((f) => { if (f && f in DATE_FORMAT_LABELS) setDateFormat(f as DateFormatKey); });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user.email) setEmail(session.user.email);
    });
  }, []);

  const saveName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    setEditingName(false);
    await AsyncStorage.setItem("display_name", trimmed);
    supabase.auth.updateUser({ data: { display_name: trimmed } });
    analytics.track("display_name_changed");
  };

  const handleSortChange = async (option: SortOption) => {
    analytics.track("default_sort_changed", { sort: option });
    setSortOption(option);
    await AsyncStorage.setItem("sort_option", option).catch(() => {});
  };

  const handleDateFormatChange = async (key: DateFormatKey) => {
    analytics.track("date_format_changed", { format: key });
    setDateFormat(key);
    await AsyncStorage.setItem("date_format", key).catch(() => {});
  };

  const handleAppearanceChange = (m: AppearanceMode) => {
    analytics.track("appearance_changed", { mode: m });
    setMode(m);
  };

  const handleSignOut = () => {
    analytics.track("signed_out");
    analytics.reset();
    supabase.auth.signOut();
  };

  const webTop = Platform.OS === "web" ? 67 : 0;
  const appVersion = Constants.expoConfig?.version ?? "—";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop, borderBottomColor: colors.cardBorder }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Profile</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + identity */}
        <View style={[styles.avatarSection, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <View style={[styles.avatar, { backgroundColor: colors.accentDim, borderColor: colors.accentBorder }]}>
            <Text style={[styles.avatarText, { color: colors.accent }]}>
              {displayName?.[0]?.toUpperCase() ?? "?"}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.displayName, { color: colors.text }]}>{displayName}</Text>
            <Text style={[styles.emailText, { color: colors.textMuted }]}>{email}</Text>
          </View>
          <Pressable
            onPress={() => { analytics.track("display_name_edit_started"); setNameInput(displayName); setEditingName(true); }}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Feather name="edit-2" size={18} color={colors.accent} />
          </Pressable>
        </View>

        {/* Edit name inline */}
        {editingName && (
          <View style={[styles.editNameRow, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <TextInput
              style={[styles.nameInput, { color: colors.text, borderBottomColor: colors.accent }]}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={() => saveName(nameInput)}
              onBlur={() => saveName(nameInput)}
            />
            <Pressable
              onPress={() => saveName(nameInput)}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.8 }]}
            >
              <Text style={[styles.saveBtnText, { color: colors.background }]}>Save</Text>
            </Pressable>
          </View>
        )}

        {/* Appearance */}
        <View style={styles.section}>
          <SectionHeader title="Appearance" subtitle="Choose your preferred theme" colors={colors} />
          <View style={[styles.optionGroup, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            {(["dark", "light", "system"] as AppearanceMode[]).map((m, i) => (
              <Pressable
                key={m}
                onPress={() => handleAppearanceChange(m)}
                style={({ pressed }) => [
                  styles.optionRow,
                  { borderBottomColor: colors.cardBorder },
                  i === 2 && styles.optionRowLast,
                  mode === m && { backgroundColor: colors.accentDim },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={styles.optionLeft}>
                  <Ionicons
                    name={m === "dark" ? "moon-outline" : m === "light" ? "sunny-outline" : "phone-portrait-outline"}
                    size={18}
                    color={mode === m ? colors.accent : colors.textSecondary}
                  />
                  <Text style={[styles.optionText, { color: mode === m ? colors.accent : colors.textSecondary }, mode === m && { fontFamily: "DMSans_600SemiBold" }]}>
                    {m === "dark" ? "Dark Mode" : m === "light" ? "Light Mode" : "System"}
                  </Text>
                </View>
                {mode === m && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Date format */}
        <View style={styles.section}>
          <SectionHeader title="Date Format" subtitle="Applied everywhere dates are shown" colors={colors} />
          <View style={[styles.optionGroup, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            {(Object.keys(DATE_FORMAT_LABELS) as DateFormatKey[]).map((key, i, arr) => (
              <Pressable
                key={key}
                onPress={() => handleDateFormatChange(key)}
                style={({ pressed }) => [
                  styles.optionRow,
                  { borderBottomColor: colors.cardBorder },
                  i === arr.length - 1 && styles.optionRowLast,
                  dateFormat === key && { backgroundColor: colors.accentDim },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.optionText, { color: dateFormat === key ? colors.accent : colors.textSecondary }, dateFormat === key && { fontFamily: "DMSans_600SemiBold" }]}>
                  {DATE_FORMAT_LABELS[key]}
                </Text>
                {dateFormat === key && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Default sort */}
        <View style={styles.section}>
          <SectionHeader title="Default Sort" subtitle="Applied to the results list" colors={colors} />
          <View style={[styles.optionGroup, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            {(Object.keys(SORT_LABELS) as SortOption[]).map((option, i, arr) => (
              <Pressable
                key={option}
                onPress={() => handleSortChange(option)}
                style={({ pressed }) => [
                  styles.optionRow,
                  { borderBottomColor: colors.cardBorder },
                  i === arr.length - 1 && styles.optionRowLast,
                  sortOption === option && { backgroundColor: colors.accentDim },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.optionText, { color: sortOption === option ? colors.accent : colors.textSecondary }, sortOption === option && { fontFamily: "DMSans_600SemiBold" }]}>
                  {SORT_LABELS[option]}
                </Text>
                {sortOption === option && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Export (coming soon) */}
        <View style={styles.section}>
          <SectionHeader title="Export Scores" subtitle="Download your scan data" colors={colors} />
          <View style={[styles.optionGroup, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            {[
              { icon: "document-text-outline", label: "Export as CSV" },
              { icon: "code-slash-outline", label: "Export as JSON" },
            ].map(({ icon, label }, i, arr) => (
              <View
                key={label}
                style={[
                  styles.optionRow,
                  { borderBottomColor: colors.cardBorder },
                  i === arr.length - 1 && styles.optionRowLast,
                  { opacity: 0.5 },
                ]}
              >
                <View style={styles.optionLeft}>
                  <Ionicons name={icon as any} size={18} color={colors.textSecondary} />
                  <Text style={[styles.optionText, { color: colors.textSecondary }]}>{label}</Text>
                </View>
                <View style={[styles.comingSoonBadge, { backgroundColor: colors.surfaceLight }]}>
                  <Text style={[styles.comingSoonText, { color: colors.textMuted }]}>Soon</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Sign out */}
        <View style={styles.section}>
          <View style={[styles.optionGroup, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Pressable
              onPress={handleSignOut}
              style={({ pressed }) => [styles.optionRow, styles.optionRowLast, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.optionLeft}>
                <Ionicons name="log-out-outline" size={18} color={colors.danger} />
                <Text style={[styles.optionText, { color: colors.danger }]}>Sign Out</Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* Version */}
        <Text style={[styles.versionText, { color: colors.textMuted }]}>
          Score Slinger v{appVersion}
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: -0.5,
  },
  content: {
    paddingTop: 20,
    paddingHorizontal: 16,
    gap: 24,
  },

  // Avatar
  avatarSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 22,
    fontFamily: "SpaceGrotesk_700Bold",
  },
  displayName: {
    fontSize: 16,
    fontFamily: "DMSans_600SemiBold",
  },
  emailText: {
    fontSize: 12,
    fontFamily: "DMSans_400Regular",
    marginTop: 1,
  },

  // Edit name
  editNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nameInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
    borderBottomWidth: 1.5,
    paddingBottom: 4,
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: {
    fontSize: 14,
    fontFamily: "DMSans_600SemiBold",
  },

  // Sections
  section: { gap: 8 },
  optionGroup: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionRowLast: {
    borderBottomWidth: 0,
  },
  optionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionText: {
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
  },
  comingSoonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  comingSoonText: {
    fontSize: 11,
    fontFamily: "DMSans_500Medium",
  },

  versionText: {
    fontSize: 12,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
    paddingBottom: 8,
  },
});
