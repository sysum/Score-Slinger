import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  TextInput,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  FadeIn,
  FadeInUp,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
} from "react-native-reanimated";
import { useTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/contexts/ToastContext";
import { apiRequest, ApiError, requestIdOf } from "@/lib/query-client";
import { analytics } from "@/lib/analytics";
import { captureException } from "@/lib/monitoring";
import { useDeleteScore } from "@/lib/use-delete-score";
import { type ThemeColors } from "@/constants/colors";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Score {
  id: string;
  uploaderName: string;
  teamScore: number;
  achievement: string | null;
  gameName: string;
  objectiveScores: {
    fightGiantBot: number;
    rescueSpiderMan: number;
    destroyGiantBot: number;
  } | null;
  players: { name: string; score: number; color: string }[];
  playerNames: Record<string, string> | null;
  imagePath: string | null;
  playedDate: string | null;
  createdAt: string;
}

const PLAYER_COLOR_ORDER = ["blue", "red", "yellow", "purple"];

const NAME_SAVE_ERROR_MESSAGE = "Couldn't save the name — check your connection and try again.";

// ─── Player card ──────────────────────────────────────────────────────────────

function PlayerCard({
  player,
  index,
  customName,
  onNameChange,
  colors,
  allScores,
  canEdit,
}: {
  player: Score["players"][number];
  index: number;
  customName?: string;
  onNameChange?: (name: string) => void;
  colors: ThemeColors;
  allScores: number[];
  canEdit: boolean;
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
  }, [progress]);

  const maxScore = Math.max(...allScores, 1);
  const barStyle = useAnimatedStyle(() => ({
    width: `${interpolate(progress.value, [0, 1], [0, (player.score / maxScore) * 100])}%`,
  }));

  const displayName = customName || player.name;

  const handleSave = () => {
    setEditing(false);
    onNameChange?.(nameInput.trim());
  };

  return (
    <Animated.View
      entering={Platform.OS !== "web" ? FadeInDown.delay(150 + index * 70).springify() : undefined}
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
          <Pressable
            onPress={() => { if (canEdit) { analytics.track("player_name_edit_started", { location: "detail" }); setNameInput(customName || ""); setEditing(true); } }}
            style={styles.playerNameRow}
            disabled={!canEdit}
          >
            <Text style={[styles.playerName, { color }]}>{displayName}</Text>
            {canEdit && <Feather name="edit-2" size={12} color={colors.textMuted} />}
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

// ─── Score detail screen ───────────────────────────────────────────────────────

export default function ScoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [localPlayerNames, setLocalPlayerNames] = useState<Record<string, string> | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // Snapshot of the score taken when Delete is confirmed. A successful delete
  // removes it from the ["/api/scores"] cache; the snapshot keeps this screen
  // rendering the score (not the loading fallback) while the modal slides away.
  const [deletingScore, setDeletingScore] = useState<Score | null>(null);
  const {
    deleteScore,
    isDeleting,
    error: deleteError,
    clearError: clearDeleteError,
  } = useDeleteScore("detail");

  const { data: scores = [] } = useQuery<Score[]>({ queryKey: ["/api/scores"] });
  const score = scores.find((s) => s.id === id) ?? deletingScore ?? undefined;

  const playerNames = localPlayerNames ?? score?.playerNames ?? {};

  const { data: imageUrlData, isLoading: imageLoading } = useQuery<{ url: string }>({
    queryKey: ["/api/scores", id, "image-url"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scores/${id}/image-url`);
      return res.json();
    },
    enabled: !!score?.imagePath,
  });
  const imageUrl = imageUrlData?.url ?? null;

  useEffect(() => {
    AsyncStorage.getItem("display_name").then((n) => { if (n) setDisplayName(n); });
  }, []);

  const updatePlayerName = async (color: string, name: string) => {
    const previous = playerNames[color];
    const updated = { ...playerNames, [color]: name || undefined } as Record<string, string>;
    if (!name) delete updated[color];
    setLocalPlayerNames(updated);
    try {
      await apiRequest("PATCH", `/api/scores/${id}/player-names`, {
        playerNames: Object.keys(updated).length > 0 ? updated : null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
      analytics.track("player_names_updated", { location: "detail", score_id: id, color });
    } catch (err) {
      // Revert this color's label (unless it was edited again meanwhile).
      setLocalPlayerNames((current) => {
        if (!current || current[color] !== updated[color]) return current;
        const reverted = { ...current };
        if (previous) reverted[color] = previous;
        else delete reverted[color];
        return reverted;
      });
      showToast(NAME_SAVE_ERROR_MESSAGE, { type: "error" });
      const status = err instanceof ApiError ? err.status : null;
      analytics.track("player_names_update_failed", {
        location: "detail",
        score_id: id,
        status,
        request_id: requestIdOf(err),
      });
      // HTTP errors are covered by api_request_failed; send the stack trace
      // only for non-HTTP ones (network or unexpected).
      if (status === null) {
        captureException(err, { tags: { context: "player_names_update", location: "detail", score_id: id } });
      }
    }
  };

  const handleDelete = async () => {
    if (!id || !score) return;
    setDeletingScore(score);
    // Modal stays open (spinner) until the request settles. On success the hook
    // shows the "Score deleted" toast (mounted at the root, so it stays visible
    // on History after navigating back). On failure the modal stays open with an
    // inline error so the user can retry or cancel.
    const deleted = await deleteScore(id);
    if (deleted) {
      setShowDeleteModal(false);
      router.back();
    } else {
      setDeletingScore(null);
    }
  };

  const closeDetail = () => {
    analytics.track("score_detail_closed", { score_id: id });
    router.back();
  };

  const cancelDeleteModal = () => {
    if (isDeleting) return;
    analytics.track("score_delete_canceled", { source: "detail", score_id: id });
    clearDeleteError();
    setShowDeleteModal(false);
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
  const canDelete = score?.uploaderName === displayName;

  if (!score) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + webTop, borderBottomColor: colors.cardBorder }]}>
          <Pressable onPress={closeDetail} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </View>
    );
  }

  const sortedPlayers = [...score.players].sort(
    (a, b) => PLAYER_COLOR_ORDER.indexOf(a.color) - PLAYER_COLOR_ORDER.indexOf(b.color)
  );
  const allScores = score.players.map((p) => p.score);
  const dateSource = score.playedDate || score.createdAt;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop, borderBottomColor: colors.cardBorder }]}>
        <Pressable onPress={closeDetail} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Score Detail</Text>
        {canDelete ? (
          <Pressable
            onPress={() => { analytics.track("score_delete_requested", { via: "detail_button", score_id: id }); setShowDeleteModal(true); }}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Image */}
        {score.imagePath && (
          <Animated.View entering={Platform.OS !== "web" ? FadeIn : undefined} style={styles.previewContainer}>
            {imageLoading ? (
              <View style={[styles.imagePlaceholder, { backgroundColor: colors.surface }]}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : imageUrl ? (
              <>
                <Image source={{ uri: imageUrl }} style={styles.previewImage} contentFit="cover" />
                <LinearGradient
                  colors={["transparent", isDark ? "rgba(15,15,15,0.92)" : "rgba(245,245,245,0.92)"]}
                  style={StyleSheet.absoluteFill}
                />
              </>
            ) : (
              <View style={[styles.imagePlaceholder, { backgroundColor: colors.surface }]}>
                <Ionicons name="image-outline" size={32} color={colors.textMuted} />
              </View>
            )}
          </Animated.View>
        )}

        {/* Meta row */}
        <Animated.View
          entering={Platform.OS !== "web" ? FadeInUp.delay(40).springify() : undefined}
          style={[styles.metaRow, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
        >
          <Ionicons name="calendar-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>{formatDate(dateSource)}</Text>
          <Ionicons name="person-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.metaUploaderText, { color: colors.textMuted }]}>by {score.uploaderName}</Text>
        </Animated.View>

        {/* Team score */}
        <Animated.View
          entering={Platform.OS !== "web" ? FadeInUp.delay(80).springify() : undefined}
          style={[styles.scoreCard, { borderColor: colors.accentBorder }]}
        >
          <LinearGradient
            colors={[`${colors.accent}18`, `${colors.accent}06`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {score.achievement ? (
            <View style={styles.achievementRow}>
              <Ionicons name="trophy" size={14} color="#FFD700" />
              <Text style={styles.achievementText}>{score.achievement}</Text>
            </View>
          ) : null}
          <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>TEAM SCORE</Text>
          <Text style={[styles.scoreValue, { color: colors.accent }]}>{score.teamScore.toLocaleString()}</Text>
          <Text style={[styles.gameLabel, { color: colors.textMuted }]}>{score.gameName}</Text>
        </Animated.View>

        {/* Objectives */}
        {score.objectiveScores && (
          <Animated.View
            entering={Platform.OS !== "web" ? FadeInUp.delay(120).springify() : undefined}
            style={styles.objectivesSection}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Objectives</Text>
            <View style={styles.objectivesRow}>
              {[
                { icon: "sword-cross", color: "#ef4444", value: score.objectiveScores.fightGiantBot, label: "Fight Giant Bot" },
                { icon: "shield-account", color: "#00E5CC", value: score.objectiveScores.rescueSpiderMan, label: "Rescue Spider-Man" },
                { icon: "robot", color: "#eab308", value: score.objectiveScores.destroyGiantBot, label: "Destroy Giant Bot" },
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
          {sortedPlayers.map((player, i) => (
            <PlayerCard
              key={`${player.color}-${i}`}
              player={player}
              index={i}
              customName={playerNames[player.color]}
              onNameChange={(name) => updatePlayerName(player.color, name)}
              colors={colors}
              allScores={allScores}
              canEdit={true}
            />
          ))}
        </View>
      </ScrollView>

      {/* Delete confirm modal */}
      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={cancelDeleteModal}>
        <Pressable style={styles.modalOverlay} onPress={cancelDeleteModal} disabled={isDeleting}>
          <Pressable
            style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Score</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              Are you sure you want to delete this entry? This cannot be undone.
            </Text>
            {deleteError ? (
              <View style={styles.modalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={[styles.modalErrorText, { color: colors.danger }]}>{deleteError}</Text>
              </View>
            ) : null}
            <View style={styles.modalBtns}>
              <Pressable
                onPress={cancelDeleteModal}
                disabled={isDeleting}
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  { backgroundColor: colors.surfaceLight },
                  pressed && { opacity: 0.7 },
                  isDeleting && { opacity: 0.5 },
                ]}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                disabled={isDeleting}
                accessibilityState={{ busy: isDeleting, disabled: isDeleting }}
                style={({ pressed }) => [
                  styles.modalDeleteBtn,
                  { backgroundColor: colors.danger },
                  pressed && { opacity: 0.7 },
                  isDeleting && { opacity: 0.8 },
                ]}
              >
                {isDeleting ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text style={styles.modalDeleteText}>{isDeleting ? "Deleting…" : "Delete"}</Text>
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 12,
  },

  // Image
  previewContainer: {
    height: 220,
    borderRadius: 14,
    overflow: "hidden",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },

  // Meta
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexWrap: "wrap",
  },
  metaText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "DMSans_400Regular",
  },
  metaUploaderText: {
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
  },
  modalBody: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    lineHeight: 20,
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
  modalDeleteBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  modalError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  modalErrorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "DMSans_500Medium",
    lineHeight: 18,
  },
  modalDeleteText: {
    fontSize: 15,
    fontFamily: "DMSans_600SemiBold",
    color: "#fff",
  },
});
