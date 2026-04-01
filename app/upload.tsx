import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  TextInput,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  FadeInUp,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
} from "react-native-reanimated";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useTheme } from "@/contexts/ThemeContext";
import { apiRequest } from "@/lib/query-client";
import { supabase } from "@/lib/supabase";
import { analytics } from "@/lib/analytics";
import { type ThemeColors } from "@/constants/colors";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerScore {
  name: string;
  score: number;
  color: "blue" | "red" | "yellow" | "purple";
}

interface ParsedResult {
  teamScore: number;
  achievement?: string | null;
  objectiveScores?: {
    fightGiantBot: number;
    rescueSpiderMan: number;
    destroyGiantBot: number;
  };
  gameName: string;
  players: PlayerScore[];
  error?: string;
  photoTakenDate?: string;
}

interface Score {
  id: string;
  uploaderName: string;
  teamScore: number;
  achievement: string | null;
  gameName: string;
  objectiveScores: { fightGiantBot: number; rescueSpiderMan: number; destroyGiantBot: number } | null;
  players: Array<{ name: string; score: number; color: string }>;
  playerNames: Record<string, string> | null;
  imagePath: string | null;
  playedDate: string | null;
  createdAt: string;
}

const PLAYER_COLOR_ORDER = ["blue", "red", "yellow", "purple"];

// ─── Player card ──────────────────────────────────────────────────────────────

function PlayerCard({
  player,
  index,
  customName,
  onNameChange,
  colors,
  allScores,
}: {
  player: PlayerScore;
  index: number;
  customName?: string;
  onNameChange?: (name: string) => void;
  colors: ThemeColors;
  allScores: number[];
}) {
  const colorMap: Record<string, string> = {
    blue: colors.playerColors.blue,
    red: colors.playerColors.red,
    yellow: colors.playerColors.yellow,
    purple: colors.playerColors.purple,
  };
  const color = colorMap[player.color] ?? colors.accent;
  const progress = useSharedValue(0);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(customName ?? "");

  useEffect(() => {
    progress.value = withSpring(1, { damping: 15, stiffness: 90 });
  }, []);

  const maxScore = Math.max(...allScores);
  const barStyle = useAnimatedStyle(() => ({
    width: `${interpolate(progress.value, [0, 1], [0, maxScore > 0 ? (player.score / maxScore) * 100 : 0])}%`,
  }));

  const displayName = customName || player.name;

  const handleSave = () => {
    setEditing(false);
    onNameChange?.(nameInput.trim());
  };

  return (
    <Animated.View
      entering={Platform.OS !== "web" ? FadeInDown.delay(200 + index * 80).springify() : undefined}
      style={[styles.playerCard, { borderLeftColor: color, backgroundColor: colors.surface }]}
    >
      <View style={styles.playerHeader}>
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        {editing ? (
          <TextInput
            style={[styles.playerNameInput, { color, borderBottomColor: colors.accent }]}
            value={nameInput}
            onChangeText={setNameInput}
            onBlur={handleSave}
            onSubmitEditing={handleSave}
            autoFocus
            placeholder={player.name}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />
        ) : (
          <Pressable onPress={() => { setNameInput(customName || ""); setEditing(true); }} style={styles.playerNameRow}>
            <Text style={[styles.playerName, { color }]}>{displayName}</Text>
            <Feather name="edit-2" size={12} color={colors.textMuted} />
          </Pressable>
        )}
        <Text style={[styles.playerScore, { color: colors.text }]}>{player.score.toLocaleString()}</Text>
      </View>
      <View style={[styles.playerBarBg, { backgroundColor: colors.surfaceLight }]}>
        <Animated.View style={[styles.playerBar, { backgroundColor: color }, barStyle]} />
      </View>
    </Animated.View>
  );
}

// ─── Upload screen ─────────────────────────────────────────────────────────────

export default function UploadScreen() {
  const { uri, photoDate, fileName } = useLocalSearchParams<{
    uri: string;
    photoDate: string;
    fileName: string;
  }>();

  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [playedDate, setPlayedDate] = useState<string>(photoDate ?? new Date().toISOString());
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [editingDate, setEditingDate] = useState(false);
  const [editDate, setEditDate] = useState(new Date(photoDate ?? Date.now()));
  const [webDateStr, setWebDateStr] = useState("");
  const [webTimeStr, setWebTimeStr] = useState("");
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const displayNameRef = useRef<string>("");

  const { data: scores = [] } = useQuery<Score[]>({ queryKey: ["/api/scores"] });

  useEffect(() => {
    AsyncStorage.getItem("display_name").then((n) => {
      displayNameRef.current = n ?? "Anonymous";
    });
  }, []);

  // Check duplicate, then start analysis on mount
  useEffect(() => {
    if (!uri) return;
    const isDuplicate = scores.some((item) => {
      if (!item.playedDate) return false;
      return Math.abs(new Date(item.playedDate).getTime() - new Date(photoDate ?? 0).getTime()) < 60000;
    });
    if (isDuplicate) {
      setLoading(false);
      setShowDuplicateWarning(true);
    } else {
      analyzeImage(uri, photoDate, fileName);
    }
  }, []);

  const analyzeImage = async (imageUri: string, dateStr?: string, file?: string) => {
    setLoading(true);
    setShowDuplicateWarning(false);
    analytics.track("score_parse_started");

    try {
      const ext = imageUri.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";

      if (Platform.OS === "web" && (ext === "heic" || ext === "heif")) {
        Alert.alert("Unsupported format", "HEIC files aren't supported on web. Please convert to JPEG or PNG first.");
        router.back();
        return;
      }

      const contentType = ext === "png" ? "image/png" : "image/jpeg";
      const storagePath = `scores/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      // Upload to Supabase Storage
      let uploadError: Error | null = null;
      if (Platform.OS === "web") {
        const response = await globalThis.fetch(imageUri);
        const blob = await response.blob();
        const { error } = await supabase.storage.from("scores").upload(storagePath, blob, { contentType });
        if (error) uploadError = error;
      } else {
        const ExpoFS = require("expo-file-system");
        const base64 = await ExpoFS.readAsStringAsync(imageUri, { encoding: ExpoFS.EncodingType.Base64 });
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const { error } = await supabase.storage.from("scores").upload(storagePath, bytes, { contentType });
        if (error) uploadError = error;
      }

      if (uploadError) throw uploadError;

      // Parse via AI
      const res = await apiRequest("POST", "/api/parse-score", { imagePath: storagePath });
      const data = await res.json();

      if (data.error) {
        analytics.track("score_parse_failed", { error: data.error });
        setResult({ teamScore: 0, gameName: "Unknown", players: [], error: data.error });
      } else {
        analytics.track("score_parse_succeeded");
        const effectiveDate = data.photoTakenDate || dateStr || new Date().toISOString();
        setPlayedDate(effectiveDate);
        setEditDate(new Date(effectiveDate));

        // Auto-save to DB
        const saveRes = await apiRequest("POST", "/api/scores", {
          uploaderName: displayNameRef.current,
          teamScore: data.teamScore,
          achievement: data.achievement || null,
          gameName: data.gameName,
          objectiveScores: data.objectiveScores || null,
          players: data.players,
          playerNames: null,
          imagePath: storagePath,
          playedDate: effectiveDate,
        });
        const newScore = await saveRes.json();
        setSavedId(newScore.id);
        queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
        analytics.track("score_saved");
        setResult(data);
      }

      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error("Analysis error:", err);
      analytics.track("score_parse_failed", { error: String(err) });
      setResult({ teamScore: 0, gameName: "Unknown", players: [], error: "Failed to analyze image. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const updatePlayerName = async (color: string, name: string) => {
    const updated = { ...playerNames, [color]: name || undefined } as Record<string, string>;
    if (!name) delete updated[color];
    setPlayerNames(updated);
    if (savedId) {
      try {
        await apiRequest("PATCH", `/api/scores/${savedId}/player-names`, {
          playerNames: Object.keys(updated).length > 0 ? updated : null,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
        analytics.track("player_names_updated");
      } catch {}
    }
  };

  const handleDiscard = async () => {
    if (savedId) {
      try {
        await apiRequest("DELETE", `/api/scores/${savedId}`);
        queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
        analytics.track("score_discarded");
      } catch {}
    }
    router.back();
  };

  const handleDone = () => {
    router.back();
  };

  // Date editing helpers
  const openDateEditor = () => {
    const d = new Date(playedDate);
    setEditDate(d);
    setWebDateStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setWebTimeStr(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setEditingDate(true);
  };

  const saveDateEdit = () => {
    let finalDate = new Date(editDate);
    if (Platform.OS === "web") {
      const digits = webDateStr.replace(/\D/g, "");
      if (digits.length >= 8) {
        finalDate.setFullYear(parseInt(digits.slice(0, 4)), parseInt(digits.slice(4, 6)) - 1, parseInt(digits.slice(6, 8)));
      }
      const tDigits = webTimeStr.replace(/\D/g, "");
      if (tDigits.length >= 4) {
        finalDate.setHours(parseInt(tDigits.slice(0, 2)), parseInt(tDigits.slice(2, 4)));
      }
    }
    setPlayedDate(finalDate.toISOString());
    setEditingDate(false);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const h = d.getHours() % 12 || 12;
    const ampm = d.getHours() >= 12 ? "PM" : "AM";
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${String(d.getMinutes()).padStart(2,"0")} ${ampm}`;
  };

  const webTop = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop, borderBottomColor: colors.cardBorder }]}>
        <Pressable
          onPress={handleDiscard}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {loading ? "Analyzing…" : result?.error ? "Parse Error" : "Score Result"}
        </Text>
        {!loading && result && !result.error ? (
          <Pressable
            onPress={handleDone}
            style={({ pressed }) => [styles.doneBtn, { backgroundColor: colors.accentDim }, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.doneBtnText, { color: colors.accent }]}>Done</Text>
          </Pressable>
        ) : (
          <View style={{ width: 64 }} />
        )}
      </View>

      {/* Duplicate warning */}
      <Modal visible={showDuplicateWarning} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => { setShowDuplicateWarning(false); router.back(); }}>
          <Pressable style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="warning-outline" size={32} color="#FFD700" style={{ alignSelf: "center" }} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Possible Duplicate</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              A score from around the same time already exists. Upload anyway?
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                onPress={() => { setShowDuplicateWarning(false); router.back(); }}
                style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => analyzeImage(uri!, photoDate, fileName)}
                style={({ pressed }) => [styles.modalConfirmBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.modalConfirmText, { color: colors.background }]}>Upload Anyway</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Loading state */}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Analyzing scoreboard…</Text>
          <Text style={[styles.loadingSubtext, { color: colors.textMuted }]}>This usually takes a few seconds</Text>
        </View>
      )}

      {/* Result */}
      {!loading && result && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.resultContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {result.error ? (
            <Animated.View entering={Platform.OS !== "web" ? FadeIn : undefined} style={[styles.errorCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>{result.error}</Text>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.retryBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.retryText, { color: colors.textSecondary }]}>Go Back</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <>
              {/* Image preview */}
              {uri && (
                <Animated.View entering={Platform.OS !== "web" ? FadeIn : undefined} style={styles.previewContainer}>
                  <Image source={{ uri }} style={styles.previewImage} contentFit="cover" />
                  <LinearGradient
                    colors={["transparent", isDark ? "rgba(15,15,15,0.92)" : "rgba(245,245,245,0.92)"]}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              )}

              {/* Date row */}
              <Animated.View
                entering={Platform.OS !== "web" ? FadeInUp.delay(50).springify() : undefined}
                style={[styles.metaRow, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
              >
                <Ionicons name="calendar-outline" size={15} color={colors.textSecondary} />
                <Text style={[styles.metaText, { color: colors.textSecondary }]}>{formatDate(playedDate)}</Text>
                <Pressable onPress={openDateEditor} style={({ pressed }) => [pressed && { opacity: 0.5 }]}>
                  <Feather name="edit-2" size={13} color={colors.accent} />
                </Pressable>
              </Animated.View>

              {/* Team score card */}
              <Animated.View
                entering={Platform.OS !== "web" ? FadeInUp.delay(100).springify() : undefined}
                style={[styles.scoreCard, { borderColor: colors.accentBorder }]}
              >
                <LinearGradient
                  colors={[`${colors.accent}18`, `${colors.accent}06`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                {result.achievement ? (
                  <View style={styles.achievementRow}>
                    <Ionicons name="trophy" size={14} color="#FFD700" />
                    <Text style={styles.achievementText}>{result.achievement}</Text>
                  </View>
                ) : null}
                <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>TEAM SCORE</Text>
                <Text style={[styles.scoreValue, { color: colors.accent }]}>{result.teamScore.toLocaleString()}</Text>
                <Text style={[styles.gameLabel, { color: colors.textMuted }]}>{result.gameName}</Text>
              </Animated.View>

              {/* Objectives */}
              {result.objectiveScores && (
                <Animated.View
                  entering={Platform.OS !== "web" ? FadeInUp.delay(150).springify() : undefined}
                  style={styles.objectivesSection}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Objectives</Text>
                  <View style={styles.objectivesRow}>
                    {[
                      { icon: "sword-cross", color: "#ef4444", value: result.objectiveScores.fightGiantBot, label: "Fight Giant Bot" },
                      { icon: "shield-account", color: "#00E5CC", value: result.objectiveScores.rescueSpiderMan, label: "Rescue Spider-Man" },
                      { icon: "robot", color: "#eab308", value: result.objectiveScores.destroyGiantBot, label: "Destroy Giant Bot" },
                    ].map(({ icon, color, value, label }) => (
                      <View key={label} style={[styles.objectiveCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                        <MaterialCommunityIcons name={icon as any} size={20} color={color} />
                        <Text style={[styles.objectiveScore, { color: colors.text }]}>{value.toLocaleString()}</Text>
                        <Text style={[styles.objectiveLabel, { color: colors.textMuted }]} numberOfLines={2}>{label}</Text>
                      </View>
                    ))}
                  </View>
                </Animated.View>
              )}

              {/* Players */}
              <View style={styles.playersSection}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Players</Text>
                {[...result.players]
                  .sort((a, b) => PLAYER_COLOR_ORDER.indexOf(a.color) - PLAYER_COLOR_ORDER.indexOf(b.color))
                  .map((player, i) => (
                    <PlayerCard
                      key={`${player.color}-${i}`}
                      player={player}
                      index={i}
                      customName={playerNames[player.color]}
                      onNameChange={(name) => updatePlayerName(player.color, name)}
                      colors={colors}
                      allScores={result.players.map((p) => p.score)}
                    />
                  ))}
              </View>

              {/* Discard button */}
              <Pressable
                onPress={handleDiscard}
                style={({ pressed }) => [styles.discardBtn, { borderColor: colors.danger }, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={[styles.discardText, { color: colors.danger }]}>Discard This Score</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}

      {/* Date editor modal */}
      <Modal visible={editingDate} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setEditingDate(false)}>
          <Pressable style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Played Date</Text>

            {Platform.OS === "web" ? (
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Date</Text>
                  <TextInput
                    style={[styles.dateInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.cardBorder }]}
                    value={webDateStr}
                    onChangeText={(v) => {
                      const d = v.replace(/\D/g, "").slice(0, 8);
                      let f = "";
                      for (let i = 0; i < d.length; i++) { if (i === 4 || i === 6) f += "-"; f += d[i]; }
                      setWebDateStr(f);
                    }}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={10}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>Time</Text>
                  <TextInput
                    style={[styles.dateInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.cardBorder }]}
                    value={webTimeStr}
                    onChangeText={(v) => {
                      const d = v.replace(/\D/g, "").slice(0, 4);
                      let f = "";
                      for (let i = 0; i < d.length; i++) { if (i === 2) f += ":"; f += d[i]; }
                      setWebTimeStr(f);
                    }}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                </View>
              </View>
            ) : (
              <View>
                <DateTimePicker value={editDate} mode="date" display="spinner" onChange={(_, d) => { if (d) { const u = new Date(editDate); u.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); setEditDate(u); } }} themeVariant={isDark ? "dark" : "light"} style={{ height: 150 }} />
                <DateTimePicker value={editDate} mode="time" display="spinner" onChange={(_, d) => { if (d) { const u = new Date(editDate); u.setHours(d.getHours(), d.getMinutes()); setEditDate(u); } }} themeVariant={isDark ? "dark" : "light"} style={{ height: 150 }} />
              </View>
            )}

            <View style={styles.modalBtns}>
              <Pressable onPress={() => setEditingDate(false)} style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveDateEdit} style={({ pressed }) => [styles.modalConfirmBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.modalConfirmText, { color: colors.background }]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "DMSans_600SemiBold",
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  doneBtnText: {
    fontSize: 14,
    fontFamily: "DMSans_600SemiBold",
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  loadingText: {
    fontSize: 17,
    fontFamily: "DMSans_500Medium",
  },
  loadingSubtext: {
    fontSize: 13,
    fontFamily: "DMSans_400Regular",
  },

  // Result
  resultContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  previewContainer: {
    height: 200,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 4,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metaText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "DMSans_400Regular",
  },

  // Score card
  scoreCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    overflow: "hidden",
    gap: 6,
  },
  achievementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  achievementText: {
    fontSize: 12,
    fontFamily: "DMSans_700Bold",
    color: "#FFD700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  scoreLabel: {
    fontSize: 11,
    fontFamily: "DMSans_600SemiBold",
    letterSpacing: 1.5,
  },
  scoreValue: {
    fontSize: 48,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: -2,
    lineHeight: 56,
  },
  gameLabel: {
    fontSize: 12,
    fontFamily: "DMSans_400Regular",
    marginTop: 2,
  },

  // Objectives
  objectivesSection: { gap: 10 },
  objectivesRow: { flexDirection: "row", gap: 8 },
  objectiveCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    alignItems: "center",
    gap: 6,
  },
  objectiveScore: {
    fontSize: 15,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: -0.5,
  },
  objectiveLabel: {
    fontSize: 10,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
    lineHeight: 14,
  },

  // Players
  playersSection: { gap: 10 },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "DMSans_600SemiBold",
  },
  playerCard: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  playerNameRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  playerName: {
    fontSize: 14,
    fontFamily: "DMSans_600SemiBold",
  },
  playerNameInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "DMSans_600SemiBold",
    borderBottomWidth: 1,
    paddingBottom: 2,
  },
  playerScore: {
    fontSize: 15,
    fontFamily: "SpaceGrotesk_700Bold",
    marginLeft: "auto",
  },
  playerBarBg: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  playerBar: {
    height: "100%",
    borderRadius: 2,
  },

  // Error
  errorCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: "center",
    gap: 12,
    marginTop: 20,
  },
  errorText: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "DMSans_500Medium",
  },

  // Discard
  discardBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  discardText: {
    fontSize: 14,
    fontFamily: "DMSans_500Medium",
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalBox: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "SpaceGrotesk_700Bold",
    textAlign: "center",
  },
  modalBody: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    lineHeight: 20,
    textAlign: "center",
  },
  modalBtns: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  modalCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    fontSize: 15,
    fontFamily: "DMSans_500Medium",
  },
  modalConfirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmText: {
    fontSize: 15,
    fontFamily: "DMSans_600SemiBold",
  },
  dateRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateLabel: {
    fontSize: 12,
    fontFamily: "DMSans_400Regular",
    marginBottom: 4,
  },
  dateInput: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
  },
});
