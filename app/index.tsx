import React, { useState, useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";
import Colors from "@/constants/colors";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface PlayerScore {
  name: string;
  score: number;
  color: "red" | "blue" | "green" | "yellow";
}

interface ObjectiveScores {
  fightGiantBot: number;
  rescueSpiderMan: number;
  destroyGiantBot: number;
}

interface ParsedResult {
  teamScore: number;
  objectiveScores?: ObjectiveScores;
  gameName: string;
  players: PlayerScore[];
  error?: string;
}

interface HistoryItem {
  id: string;
  result: ParsedResult;
  timestamp: number;
  imageUri?: string;
}

const PLAYER_COLOR_MAP: Record<string, string> = {
  red: Colors.playerColors.red,
  blue: Colors.playerColors.blue,
  green: Colors.playerColors.green,
  yellow: Colors.playerColors.yellow,
};

const PLAYER_COLOR_LABELS: Record<string, string> = {
  red: "Red",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
};

function PlayerCard({ player, index }: { player: PlayerScore; index: number }) {
  const color = PLAYER_COLOR_MAP[player.color] || Colors.accent;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(1, { damping: 15, stiffness: 90 });
  }, []);

  const barStyle = useAnimatedStyle(() => ({
    width: `${interpolate(progress.value, [0, 1], [0, 100])}%`,
  }));

  return (
    <Animated.View
      entering={Platform.OS !== "web" ? FadeInDown.delay(200 + index * 100).springify() : undefined}
      style={[styles.playerCard, { borderLeftColor: color, borderLeftWidth: 3 }]}
    >
      <View style={styles.playerHeader}>
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <Text style={styles.playerName} numberOfLines={1}>
          {player.name}
        </Text>
        <Text style={[styles.playerScore, { color }]}>{player.score.toLocaleString()}</Text>
      </View>
      <View style={styles.playerBarBg}>
        <Animated.View style={[styles.playerBar, { backgroundColor: color }, barStyle]} />
      </View>
    </Animated.View>
  );
}

function HistoryCard({
  item,
  onPress,
}: {
  item: HistoryItem;
  onPress: () => void;
}) {
  const date = new Date(item.timestamp);
  const timeStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.historyCard, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.historyLeft}>
        <MaterialCommunityIcons name="gamepad-variant" size={20} color={Colors.accent} />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.historyGame} numberOfLines={1}>
            {item.result.gameName}
          </Text>
          <Text style={styles.historyTime}>{timeStr}</Text>
        </View>
      </View>
      <View style={styles.historyRight}>
        <Text style={styles.historyScore}>{item.result.teamScore.toLocaleString()}</Text>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const stored = await AsyncStorage.getItem("score_history");
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch {}
  };

  const saveToHistory = async (parsed: ParsedResult, uri?: string) => {
    try {
      const newItem: HistoryItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        result: parsed,
        timestamp: Date.now(),
        imageUri: uri,
      };
      const updated = [newItem, ...history].slice(0, 50);
      setHistory(updated);
      await AsyncStorage.setItem("score_history", JSON.stringify(updated));
    } catch {}
  };

  const deleteHistoryItem = async (id: string) => {
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    await AsyncStorage.setItem("score_history", JSON.stringify(updated));
  };

  const pickImage = useCallback(async (useCamera: boolean) => {
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
        });
      }

      if (pickerResult.canceled) return;

      const asset = pickerResult.assets[0];
      setImageUri(asset.uri);
      setResult(null);
      setShowHistory(false);
      await analyzeImage(asset.uri);
    } catch (err) {
      console.error("Image pick error:", err);
    }
  }, []);

  const analyzeImage = async (uri: string) => {
    setLoading(true);
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/parse-score", baseUrl);

      const formData = new FormData();

      if (Platform.OS === "web") {
        const response = await globalThis.fetch(uri);
        const blob = await response.blob();
        formData.append("image", blob, "screenshot.jpg");
      } else {
        const { File: ExpoFile } = require("expo-file-system");
        const file = new ExpoFile(uri);
        formData.append("image", file as any);
      }

      const res = await fetch(url.toString(), {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Server error");
      }

      const data = await res.json();

      if (data.error) {
        setResult({ teamScore: 0, gameName: "Unknown", players: [], error: data.error });
      } else {
        setResult(data);
        await saveToHistory(data, uri);
      }

      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error("Analysis error:", err);
      setResult({
        teamScore: 0,
        gameName: "Unknown",
        players: [],
        error: "Failed to analyze image. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setImageUri(null);
    setResult(null);
    setShowHistory(false);
  };

  const viewHistoryItem = (item: HistoryItem) => {
    setResult(item.result);
    setImageUri(item.imageUri || null);
    setShowHistory(false);
  };

  if (showHistory) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => setShowHistory(false)}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>History</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.historyList,
            { paddingBottom: insets.bottom + webBottomInset + 20 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {history.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="time-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No scans yet</Text>
              <Text style={styles.emptySubtext}>
                Your parsed game scores will appear here
              </Text>
            </View>
          ) : (
            history.map((item) => (
              <HistoryCard key={item.id} item={item} onPress={() => viewHistoryItem(item)} />
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  if (result && !loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.header}>
          <Pressable
            onPress={resetState}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Results</Text>
          <Pressable
            onPress={() => setShowHistory(true)}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="time-outline" size={22} color={Colors.text} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.resultsContent,
            { paddingBottom: insets.bottom + webBottomInset + 30 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {result.error ? (
            <Animated.View
              entering={Platform.OS !== "web" ? FadeIn : undefined}
              style={styles.errorCard}
            >
              <Ionicons name="alert-circle" size={40} color={Colors.danger} />
              <Text style={styles.errorText}>{result.error}</Text>
              <Pressable
                onPress={resetState}
                style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
              >
                <Feather name="refresh-cw" size={18} color={Colors.accent} />
                <Text style={styles.retryText}>Try Another Image</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <>
              {imageUri && (
                <Animated.View
                  entering={Platform.OS !== "web" ? FadeIn : undefined}
                  style={styles.previewContainer}
                >
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.previewImage}
                    contentFit="cover"
                  />
                  <LinearGradient
                    colors={["transparent", "rgba(10, 14, 26, 0.9)"]}
                    style={styles.previewGradient}
                  />
                  <View style={styles.previewOverlay}>
                    <Text style={styles.gameLabel}>{result.gameName}</Text>
                  </View>
                </Animated.View>
              )}

              <Animated.View
                entering={Platform.OS !== "web" ? FadeInUp.delay(100).springify() : undefined}
                style={styles.totalScoreCard}
              >
                <LinearGradient
                  colors={["rgba(0, 229, 204, 0.12)", "rgba(0, 229, 204, 0.03)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <Text style={styles.totalLabel}>TEAM SCORE</Text>
                <Text style={styles.totalScore}>{result.teamScore.toLocaleString()}</Text>
                <View style={styles.playerCount}>
                  <Ionicons name="people" size={14} color={Colors.textSecondary} />
                  <Text style={styles.playerCountText}>
                    {result.players.length} player{result.players.length !== 1 ? "s" : ""}
                  </Text>
                </View>
              </Animated.View>

              {result.objectiveScores && (
                <Animated.View
                  entering={Platform.OS !== "web" ? FadeInUp.delay(150).springify() : undefined}
                  style={styles.objectivesSection}
                >
                  <Text style={styles.sectionTitle}>Objective Scores</Text>
                  <View style={styles.objectivesRow}>
                    <View style={styles.objectiveCard}>
                      <MaterialCommunityIcons name="sword-cross" size={22} color="#FF6B6B" />
                      <Text style={styles.objectiveScore}>
                        {result.objectiveScores.fightGiantBot.toLocaleString()}
                      </Text>
                      <Text style={styles.objectiveLabel} numberOfLines={2}>
                        Fight Giant Bot
                      </Text>
                    </View>
                    <View style={styles.objectiveCard}>
                      <MaterialCommunityIcons name="shield-account" size={22} color="#4ECDC4" />
                      <Text style={styles.objectiveScore}>
                        {result.objectiveScores.rescueSpiderMan.toLocaleString()}
                      </Text>
                      <Text style={styles.objectiveLabel} numberOfLines={2}>
                        Rescue Spider-Man
                      </Text>
                    </View>
                    <View style={styles.objectiveCard}>
                      <MaterialCommunityIcons name="explosion" size={22} color="#FFB347" />
                      <Text style={styles.objectiveScore}>
                        {result.objectiveScores.destroyGiantBot.toLocaleString()}
                      </Text>
                      <Text style={styles.objectiveLabel} numberOfLines={2}>
                        Destroy Giant Bot
                      </Text>
                    </View>
                  </View>
                </Animated.View>
              )}

              <View style={styles.playersSection}>
                <Text style={styles.sectionTitle}>Individual Scores</Text>
                {result.players.map((player, i) => (
                  <PlayerCard key={`${player.name}-${i}`} player={player} index={i} />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <View style={{ width: 40 }} />
        <Text style={styles.headerTitle}>ScoreSnap</Text>
        <Pressable
          onPress={() => setShowHistory(true)}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="time-outline" size={22} color={Colors.text} />
        </Pressable>
      </View>

      <View style={styles.homeContent}>
        {loading ? (
          <Animated.View
            entering={Platform.OS !== "web" ? FadeIn : undefined}
            style={styles.loadingContainer}
          >
            {imageUri && (
              <View style={styles.loadingImageWrap}>
                <Image
                  source={{ uri: imageUri }}
                  style={styles.loadingImage}
                  contentFit="cover"
                />
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color={Colors.accent} />
                </View>
              </View>
            )}
            <Text style={styles.loadingText}>Analyzing scoreboard...</Text>
            <Text style={styles.loadingSubtext}>
              Extracting player scores and colors
            </Text>
          </Animated.View>
        ) : (
          <>
            <View style={styles.heroSection}>
              <View style={styles.iconCircle}>
                <MaterialCommunityIcons
                  name="image-search"
                  size={44}
                  color={Colors.accent}
                />
              </View>
              <Text style={styles.heroTitle}>Scan a Scoreboard</Text>
              <Text style={styles.heroSubtitle}>
                Take a photo or choose an image of your game's scoreboard to extract team and player scores
              </Text>
            </View>

            <View style={styles.actionButtons}>
              <Pressable
                onPress={() => pickImage(true)}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
                ]}
              >
                <LinearGradient
                  colors={[Colors.accent, "#00C4B0"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
                <Ionicons name="camera" size={22} color={Colors.background} />
                <Text style={styles.primaryBtnText}>Take Photo</Text>
              </Pressable>

              <Pressable
                onPress={() => pickImage(false)}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
                ]}
              >
                <Ionicons name="images" size={22} color={Colors.accent} />
                <Text style={styles.secondaryBtnText}>Choose from Gallery</Text>
              </Pressable>
            </View>

            {history.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.recentHeader}>
                  <Text style={styles.sectionTitle}>Recent Scans</Text>
                  <Pressable
                    onPress={() => setShowHistory(true)}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.seeAllText}>See All</Text>
                  </Pressable>
                </View>
                {history.slice(0, 3).map((item) => (
                  <HistoryCard
                    key={item.id}
                    item={item}
                    onPress={() => viewHistoryItem(item)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: "DMSans_700Bold",
    fontSize: 20,
    color: Colors.text,
  },
  homeContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  heroSection: {
    alignItems: "center",
    marginTop: 40,
    marginBottom: 40,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.accentDim,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
  },
  heroTitle: {
    fontFamily: "DMSans_700Bold",
    fontSize: 28,
    color: Colors.text,
    textAlign: "center",
    marginBottom: 12,
  },
  heroSubtitle: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  actionButtons: {
    gap: 14,
    marginBottom: 36,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 16,
    gap: 10,
    overflow: "hidden",
  },
  primaryBtnText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    color: Colors.background,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 16,
    gap: 10,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
  },
  secondaryBtnText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    color: Colors.accent,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingImageWrap: {
    width: SCREEN_WIDTH - 80,
    height: 200,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 28,
  },
  loadingImage: {
    width: "100%",
    height: "100%",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 14, 26, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 18,
    color: Colors.text,
    marginBottom: 8,
  },
  loadingSubtext: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  resultsContent: {
    paddingHorizontal: 20,
    gap: 20,
  },
  previewContainer: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  previewOverlay: {
    position: "absolute",
    bottom: 14,
    left: 16,
  },
  gameLabel: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    color: Colors.text,
  },
  totalScoreCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.accentBorder,
    overflow: "hidden",
  },
  totalLabel: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 12,
    color: Colors.textSecondary,
    letterSpacing: 2,
    marginBottom: 8,
  },
  totalScore: {
    fontFamily: "DMSans_700Bold",
    fontSize: 52,
    color: Colors.accent,
    marginBottom: 8,
  },
  playerCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  playerCountText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  objectivesSection: {
    gap: 12,
  },
  objectivesRow: {
    flexDirection: "row" as const,
    gap: 10,
  },
  objectiveCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: "center" as const,
    gap: 8,
  },
  objectiveScore: {
    fontFamily: "DMSans_700Bold",
    fontSize: 20,
    color: Colors.text,
  },
  objectiveLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: "center" as const,
    lineHeight: 15,
  },
  playersSection: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    color: Colors.text,
    marginBottom: 4,
  },
  playerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 12,
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
  playerName: {
    fontFamily: "DMSans_500Medium",
    fontSize: 15,
    color: Colors.text,
    flex: 1,
  },
  playerScore: {
    fontFamily: "DMSans_700Bold",
    fontSize: 20,
  },
  playerBarBg: {
    height: 4,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 2,
    overflow: "hidden",
  },
  playerBar: {
    height: "100%",
    borderRadius: 2,
  },
  errorCard: {
    alignItems: "center",
    padding: 40,
    gap: 16,
  },
  errorText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
    marginTop: 8,
  },
  retryText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
    color: Colors.accent,
  },
  recentSection: {
    gap: 12,
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  seeAllText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 14,
    color: Colors.accent,
  },
  historyList: {
    paddingHorizontal: 20,
    gap: 10,
  },
  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  historyLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  historyGame: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 15,
    color: Colors.text,
  },
  historyTime: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  historyRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  historyScore: {
    fontFamily: "DMSans_700Bold",
    fontSize: 18,
    color: Colors.accent,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 18,
    color: Colors.textSecondary,
  },
  emptySubtext: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
  },
});
