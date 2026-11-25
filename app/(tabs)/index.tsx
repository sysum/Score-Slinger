import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/contexts/ThemeContext";
import { apiRequest } from "@/lib/query-client";
import { analytics } from "@/lib/analytics";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad2 = (n: number) => n.toString().padStart(2, "0");

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours() % 12 || 12;
  const ampm = d.getHours() >= 12 ? "PM" : "AM";
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${pad2(d.getMinutes())} ${ampm}`;
};

const sortScores = (items: Score[], sort: SortOption): Score[] => {
  const sorted = [...items];
  switch (sort) {
    case "upload_recent":
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case "upload_oldest":
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case "played_recent":
      return sorted.sort((a, b) => {
        const da = a.playedDate ? new Date(a.playedDate).getTime() : new Date(a.createdAt).getTime();
        const db = b.playedDate ? new Date(b.playedDate).getTime() : new Date(b.createdAt).getTime();
        return db - da;
      });
    case "played_oldest":
      return sorted.sort((a, b) => {
        const da = a.playedDate ? new Date(a.playedDate).getTime() : new Date(a.createdAt).getTime();
        const db = b.playedDate ? new Date(b.playedDate).getTime() : new Date(b.createdAt).getTime();
        return da - db;
      });
    case "score_highest":
      return sorted.sort((a, b) => b.teamScore - a.teamScore);
    case "score_lowest":
      return sorted.sort((a, b) => a.teamScore - b.teamScore);
    default:
      return sorted;
  }
};

// ─── History card ─────────────────────────────────────────────────────────────

const DELETE_THRESHOLD = -80;
const PLAYER_COLOR_ORDER = ["blue", "red", "yellow", "purple"];

function HistoryCard({
  item,
  onPress,
  onDelete,
  canDelete,
  colors,
  displayName,
}: {
  item: Score;
  onPress: () => void;
  onDelete: () => void;
  canDelete: boolean;
  colors: ThemeColors;
  displayName: string;
}) {
  const dateSource = item.playedDate || item.createdAt;
  const dateStr = formatDate(typeof dateSource === "string" ? dateSource : new Date(dateSource).toISOString());

  const translateX = useSharedValue(0);
  const isSwiped = useSharedValue(false);

  const trackSwipeOpen = () => analytics.track("card_swiped_open", { platform: Platform.OS });

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .onUpdate((g) => {
          "worklet";
          if (g.translationX < 0) {
            translateX.value = Math.max(g.translationX, DELETE_THRESHOLD - 10);
          } else if (isSwiped.value) {
            translateX.value = Math.min(DELETE_THRESHOLD + g.translationX, 0);
          }
        })
        .onEnd((g) => {
          "worklet";
          if (g.translationX < DELETE_THRESHOLD / 2) {
            const wasOpen = isSwiped.value;
            translateX.value = withSpring(DELETE_THRESHOLD, { damping: 20, stiffness: 200 });
            isSwiped.value = true;
            if (!wasOpen) runOnJS(trackSwipeOpen)();
          } else {
            translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
            isSwiped.value = false;
          }
        }),
    [translateX, isSwiped],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        "worklet";
        if (isSwiped.value) {
          translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
          isSwiped.value = false;
        } else {
          runOnJS(onPress)();
        }
      }),
    [translateX, isSwiped, onPress],
  );

  const cardGesture = useMemo(
    () => (canDelete ? Gesture.Exclusive(panGesture, tapGesture) : tapGesture),
    [canDelete, panGesture, tapGesture],
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const deleteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, DELETE_THRESHOLD], [0, 1]),
  }));

  const sortedPlayers = [...item.players].sort(
    (a, b) => PLAYER_COLOR_ORDER.indexOf(a.color) - PLAYER_COLOR_ORDER.indexOf(b.color),
  );

  const playerColorMap: Record<string, string> = {
    blue: colors.playerColors.blue,
    red: colors.playerColors.red,
    yellow: colors.playerColors.yellow,
    purple: colors.playerColors.purple,
  };

  const topScore = Math.max(...item.players.map((p) => p.score));

  return (
    <View style={styles.cardWrapper}>
      {canDelete && (
        <Animated.View style={[styles.deleteArea, { backgroundColor: colors.danger }, deleteStyle]}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              analytics.track("score_delete_requested", { via: "swipe" });
              onDelete();
            }}
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="trash-outline" size={20} color="#fff" />
            <Text style={styles.deleteBtnText}>Delete</Text>
          </Pressable>
        </Animated.View>
      )}

      <GestureDetector gesture={cardGesture}>
        <Animated.View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }, cardStyle]}
        >
          <View style={styles.cardContent}>
            {/* Top row: date + achievement + score */}
          <View style={styles.cardTop}>
            <View style={styles.cardTopLeft}>
              {item.achievement ? (
                <View style={[styles.achievementBadge, { backgroundColor: "rgba(255,215,0,0.12)" }]}>
                  <Ionicons name="trophy" size={11} color="#FFD700" />
                  <Text style={styles.achievementText}>{item.achievement}</Text>
                </View>
              ) : null}
              <Text style={[styles.cardDate, { color: colors.textMuted }]}>{dateStr}</Text>
            </View>
            <View style={styles.cardTopRight}>
              <Text style={[styles.cardScore, { color: colors.accent }]}>{item.teamScore.toLocaleString()}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginTop: 2 }} />
            </View>
          </View>

          {/* Player dots row */}
          <View style={styles.playersRow}>
            {sortedPlayers.map((player) => {
              const resolvedName = item.playerNames?.[player.color] || player.name;
              const isTop = player.score === topScore;
              const color = playerColorMap[player.color] ?? colors.accent;
              return (
                <View key={player.color} style={styles.playerDot}>
                  <View style={[styles.dot, { backgroundColor: color }, isTop && styles.dotTop]} />
                  <Text style={[styles.playerScore, { color: colors.textSecondary }]} numberOfLines={1}>
                    {(player.score / 1000).toFixed(0)}k
                  </Text>
                  <Text style={[styles.playerName, { color: colors.textMuted }]} numberOfLines={1}>
                    {resolvedName}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Footer: uploader */}
          <Text style={[styles.uploaderText, { color: colors.textMuted }]}>
            by {item.uploaderName}{item.uploaderName === displayName ? " (you)" : ""}
          </Text>
        </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ─── History screen ────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [sortOption, setSortOption] = useState<SortOption>("upload_recent");
  const [showSortPicker, setShowSortPicker] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    AsyncStorage.getItem("display_name").then((name) => {
      if (name) setDisplayName(name);
    });
    AsyncStorage.getItem("sort_option").then((saved) => {
      if (saved && saved in SORT_LABELS) setSortOption(saved as SortOption);
    });
  }, []);

  const { data: scores = [], isLoading } = useQuery<Score[]>({
    queryKey: ["/api/scores"],
  });

  const onRefresh = async () => {
    setRefreshing(true);
    analytics.track("history_pull_refreshed", { platform: Platform.OS });
    await queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
    setRefreshing(false);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await apiRequest("DELETE", `/api/scores/${pendingDeleteId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
      analytics.track("score_deleted", { source: "history", scoreId: pendingDeleteId });
    } catch {}
    setPendingDeleteId(null);
  };

  const cancelDelete = () => {
    analytics.track("score_delete_canceled", { source: "history" });
    setPendingDeleteId(null);
  };

  const handleSortChange = async (option: SortOption) => {
    analytics.track("history_sort_changed", { sort: option });
    setSortOption(option);
    setShowSortPicker(false);
    await AsyncStorage.setItem("sort_option", option).catch(() => {});
  };

  const sortedScores = sortScores(scores, sortOption);

  const webTop = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTop, borderBottomColor: colors.cardBorder }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>History</Text>
        <Pressable
          onPress={() => { analytics.track("history_sort_opened"); setShowSortPicker(true); }}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="swap-vertical" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Score list */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
        >
          {sortedScores.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="game-controller-outline" size={52} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No scores yet</Text>
              <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                Tap the camera button to photograph a scoreboard
              </Text>
            </View>
          ) : (
            sortedScores.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                colors={colors}
                displayName={displayName}
                canDelete={item.uploaderName === displayName}
                onPress={() => {
                  analytics.track("score_detail_viewed", { source: "history", scoreId: item.id });
                  router.push(`/score/${item.id}`);
                }}
                onDelete={() => setPendingDeleteId(item.id)}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* Delete confirm modal */}
      <Modal visible={!!pendingDeleteId} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={cancelDelete}>
          <Pressable
            style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Score</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              Are you sure you want to delete this entry? This cannot be undone.
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                onPress={cancelDelete}
                style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                style={({ pressed }) => [styles.modalDeleteBtn, { backgroundColor: colors.danger }, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.modalDeleteText}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sort picker modal */}
      <Modal visible={showSortPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowSortPicker(false)}>
          <Pressable
            style={[styles.sortModal, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>Sort By</Text>
            {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
              <Pressable
                key={option}
                onPress={() => handleSortChange(option)}
                style={({ pressed }) => [
                  styles.sortRow,
                  { borderBottomColor: colors.cardBorder },
                  sortOption === option && { backgroundColor: colors.accentDim },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text
                  style={[
                    styles.sortLabel,
                    { color: sortOption === option ? colors.accent : colors.textSecondary },
                    sortOption === option && { fontFamily: "DMSans_700Bold" },
                  ]}
                >
                  {SORT_LABELS[option]}
                </Text>
                {sortOption === option && (
                  <Ionicons name="checkmark" size={18} color={colors.accent} />
                )}
              </Pressable>
            ))}
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
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: -0.5,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingTop: 12, paddingHorizontal: 16 },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "SpaceGrotesk_700Bold",
    marginTop: 8,
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },

  // Card
  cardWrapper: {
    marginBottom: 10,
    borderRadius: 14,
    overflow: "hidden",
  },
  deleteArea: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 90,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  deleteBtn: {
    alignItems: "center",
    gap: 4,
    padding: 8,
  },
  deleteBtnText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "DMSans_500Medium",
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardContent: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cardTopLeft: { flex: 1, gap: 4 },
  cardTopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 12,
  },
  achievementBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  achievementText: {
    fontSize: 10,
    fontFamily: "DMSans_700Bold",
    color: "#FFD700",
    letterSpacing: 0.5,
  },
  cardDate: {
    fontSize: 12,
    fontFamily: "DMSans_400Regular",
  },
  cardScore: {
    fontSize: 22,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: -0.5,
  },
  playersRow: {
    flexDirection: "row",
    gap: 12,
  },
  playerDot: {
    alignItems: "center",
    gap: 3,
    flex: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotTop: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  playerScore: {
    fontSize: 11,
    fontFamily: "DMSans_600SemiBold",
  },
  playerName: {
    fontSize: 10,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
  },
  uploaderText: {
    fontSize: 11,
    fontFamily: "DMSans_400Regular",
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
    alignItems: "center",
    justifyContent: "center",
  },
  modalDeleteText: {
    fontSize: 15,
    fontFamily: "DMSans_600SemiBold",
    color: "#fff",
  },
  sortModal: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 2,
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  sortLabel: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
  },
});
