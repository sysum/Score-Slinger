import React, { useState, useCallback, useEffect, useRef } from "react";
import * as FileSystem from "expo-file-system";
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
  TextInput,
  Modal,
  PanResponder,
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
import DateTimePicker from "@react-native-community/datetimepicker";
import Colors from "@/constants/colors";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface PlayerScore {
  name: string;
  score: number;
  color: "blue" | "red" | "yellow" | "purple";
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
  playedDate?: string;
  playerNames?: Record<string, string>;
}

const PLAYER_COLOR_MAP: Record<string, string> = {
  blue: Colors.playerColors.blue,
  red: Colors.playerColors.red,
  yellow: Colors.playerColors.yellow,
  purple: Colors.playerColors.purple,
};

const PLAYER_COLOR_LABELS: Record<string, string> = {
  blue: "Blue",
  red: "Red",
  yellow: "Yellow",
  purple: "Purple",
};

const PLAYER_COLOR_ORDER = ["blue", "red", "yellow", "purple"];

function PlayerCard({
  player,
  index,
  customName,
  onNameChange,
}: {
  player: PlayerScore;
  index: number;
  customName?: string;
  onNameChange?: (name: string) => void;
}) {
  const color = PLAYER_COLOR_MAP[player.color] || Colors.accent;
  const progress = useSharedValue(0);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(customName || "");

  useEffect(() => {
    progress.value = withSpring(1, { damping: 15, stiffness: 90 });
  }, []);

  const barStyle = useAnimatedStyle(() => ({
    width: `${interpolate(progress.value, [0, 1], [0, 100])}%`,
  }));

  const displayName = customName || player.name;

  const handleSaveName = () => {
    setEditing(false);
    if (onNameChange) onNameChange(nameInput.trim());
  };

  return (
    <Animated.View
      entering={Platform.OS !== "web" ? FadeInDown.delay(200 + index * 100).springify() : undefined}
      style={[styles.playerCard, { borderLeftColor: color, borderLeftWidth: 3 }]}
    >
      <View style={styles.playerHeader}>
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        {editing ? (
          <TextInput
            style={[styles.playerNameInput, { color }]}
            value={nameInput}
            onChangeText={setNameInput}
            onBlur={handleSaveName}
            onSubmitEditing={handleSaveName}
            autoFocus
            placeholder={player.name}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="done"
            autoCapitalize="words"
          />
        ) : (
          <Pressable
            onPress={() => {
              setNameInput(customName || "");
              setEditing(true);
            }}
            style={styles.playerNameBtn}
          >
            <Text style={[styles.playerName, customName ? {} : { color: Colors.textSecondary }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Feather name="edit-2" size={11} color={Colors.textMuted} style={{ marginLeft: 4 }} />
          </Pressable>
        )}
        <Text style={[styles.playerScore, { color }]}>{player.score.toLocaleString()}</Text>
      </View>
      <View style={styles.playerBarBg}>
        <Animated.View style={[styles.playerBar, { backgroundColor: color }, barStyle]} />
      </View>
    </Animated.View>
  );
}

const DELETE_THRESHOLD = -80;

function HistoryCard({
  item,
  onPress,
  onDelete,
}: {
  item: HistoryItem;
  onPress: () => void;
  onDelete: () => void;
}) {
  const dateSource = item.playedDate || item.timestamp;
  const date = new Date(dateSource);
  const timeStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const translateX = useSharedValue(0);
  const isSwiped = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.value = Math.max(gestureState.dx, DELETE_THRESHOLD - 10);
        } else if (isSwiped.current) {
          translateX.value = Math.min(DELETE_THRESHOLD + gestureState.dx, 0);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < DELETE_THRESHOLD / 2) {
          translateX.value = withSpring(DELETE_THRESHOLD, { damping: 20, stiffness: 200 });
          isSwiped.current = true;
        } else {
          translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
          isSwiped.current = false;
        }
      },
    })
  ).current;

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const deleteOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, DELETE_THRESHOLD], [0, 1]),
  }));

  const handlePress = () => {
    if (isSwiped.current) {
      translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      isSwiped.current = false;
      return;
    }
    onPress();
  };

  return (
    <View style={styles.historyCardWrapper}>
      <Animated.View style={[styles.historyDeleteArea, deleteOpacity]}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDelete();
          }}
          style={({ pressed }) => [styles.historyDeleteBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={styles.historyDeleteText}>Delete</Text>
        </Pressable>
      </Animated.View>
      <Animated.View style={[styles.historyCard, cardAnimStyle]} {...panResponder.panHandlers}>
        <Pressable
          onPress={handlePress}
          style={({ pressed }) => [styles.historyCardContent, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.historyLeft}>
            <MaterialCommunityIcons name="gamepad-variant" size={20} color={Colors.accent} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.historyTime}>{timeStr}</Text>
            </View>
          </View>
          <View style={styles.historyRight}>
            <Text style={styles.historyScore}>{item.result.teamScore.toLocaleString()}</Text>
            <Feather name="chevron-right" size={16} color={Colors.textMuted} />
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const historyRef = useRef<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [playedDate, setPlayedDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);
  const [editDate, setEditDate] = useState(new Date());
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const stored = await AsyncStorage.getItem("score_history");
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(parsed);
        historyRef.current = parsed;
      }
    } catch {}
  };

  const persistHistory = async (updated: HistoryItem[]) => {
    setHistory(updated);
    historyRef.current = updated;
    await AsyncStorage.setItem("score_history", JSON.stringify(updated));
  };

  const persistImage = async (uri: string, itemId: string): Promise<string> => {
    if (Platform.OS === "web") {
      try {
        const response = await globalThis.fetch(uri);
        const blob = await response.blob();
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        return uri;
      }
    }
    try {
      const imagesDir = new FileSystem.Directory(FileSystem.Paths.document, "scoresnap_images");
      if (!imagesDir.exists) {
        imagesDir.create({ intermediates: true });
      }
      const ext = uri.split(".").pop()?.split("?")[0] || "jpg";
      const sourceFile = new FileSystem.File(uri);
      const destFile = new FileSystem.File(imagesDir, `${itemId}.${ext}`);
      sourceFile.copy(destFile);
      return destFile.uri;
    } catch {
      return uri;
    }
  };

  const saveToHistory = async (parsed: ParsedResult, uri?: string, dateStr?: string) => {
    try {
      const itemId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      let savedUri = uri;
      if (uri) {
        savedUri = await persistImage(uri, itemId);
      }
      const newItem: HistoryItem = {
        id: itemId,
        result: parsed,
        timestamp: Date.now(),
        imageUri: savedUri,
        playedDate: dateStr || new Date().toISOString(),
      };
      const updated = [newItem, ...historyRef.current].slice(0, 50);
      setCurrentHistoryId(itemId);
      setPlayerNames({});
      setImageUri(savedUri || null);
      await persistHistory(updated);
    } catch {}
  };

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const confirmDeleteItem = async () => {
    if (!pendingDeleteId) return;
    const deletedItem = historyRef.current.find((h) => h.id === pendingDeleteId);
    if (deletedItem?.imageUri && Platform.OS !== "web" && deletedItem.imageUri.includes("scoresnap_images")) {
      try { const f = new FileSystem.File(deletedItem.imageUri); if (f.exists) f.delete(); } catch {}
    }
    const updated = historyRef.current.filter((h) => h.id !== pendingDeleteId);
    await persistHistory(updated);
    if (currentHistoryId === pendingDeleteId) {
      resetState();
    }
    setPendingDeleteId(null);
  };

  const updatePlayedDate = async (newDate: string) => {
    setPlayedDate(newDate);
    if (currentHistoryId) {
      const updated = historyRef.current.map((h) =>
        h.id === currentHistoryId ? { ...h, playedDate: newDate } : h
      );
      await persistHistory(updated);
    }
  };

  const updatePlayerName = async (color: string, name: string) => {
    const updated = { ...playerNames, [color]: name || undefined } as Record<string, string>;
    if (!name) delete updated[color];
    setPlayerNames(updated);
    if (currentHistoryId) {
      const updatedHistory = historyRef.current.map((h) =>
        h.id === currentHistoryId ? { ...h, playerNames: Object.keys(updated).length > 0 ? updated : undefined } : h
      );
      await persistHistory(updatedHistory);
    }
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

      const asset = pickerResult.assets[0];
      let photoDate: string = new Date().toISOString();
      if (asset.exif) {
        const exifData = asset.exif as any;
        const findExifDate = (obj: any): string | null => {
          if (!obj || typeof obj !== "object") return null;
          const dateKeys = [
            "DateTimeOriginal", "DateTime", "DateTimeDigitized",
            "CreateDate", "ModifyDate", "DateCreated",
          ];
          for (const key of dateKeys) {
            if (obj[key] && typeof obj[key] === "string") return obj[key];
          }
          for (const key of Object.keys(obj)) {
            if (typeof obj[key] === "object" && obj[key] !== null) {
              const found = findExifDate(obj[key]);
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
      setPlayedDate(photoDate);
      setImageUri(asset.uri);
      setResult(null);
      setShowHistory(false);
      setCurrentHistoryId(null);
      await analyzeImage(asset.uri, photoDate ?? undefined);
    } catch (err) {
      console.error("Image pick error:", err);
    }
  }, []);

  const analyzeImage = async (uri: string, dateStr?: string) => {
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
        const effectiveDate = data.photoTakenDate || dateStr;
        if (effectiveDate) {
          setPlayedDate(effectiveDate);
        }
        setResult(data);
        await saveToHistory(data, uri, effectiveDate);
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
    setPlayedDate(null);
    setCurrentHistoryId(null);
    setPlayerNames({});
  };

  const viewHistoryItem = (item: HistoryItem) => {
    setResult(item.result);
    setImageUri(item.imageUri || null);
    setPlayedDate(item.playedDate || new Date(item.timestamp).toISOString());
    setCurrentHistoryId(item.id);
    setPlayerNames(item.playerNames || {});
    setShowHistory(false);
  };

  const formatPlayedDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const [webDateStr, setWebDateStr] = useState("");
  const [webTimeStr, setWebTimeStr] = useState("");

  const formatDateInput = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let formatted = "";
    for (let i = 0; i < digits.length; i++) {
      if (i === 4 || i === 6) formatted += "-";
      formatted += digits[i];
    }
    return formatted;
  };

  const formatTimeInput = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    let formatted = "";
    for (let i = 0; i < digits.length; i++) {
      if (i === 2) formatted += ":";
      formatted += digits[i];
    }
    return formatted;
  };

  const handleWebDateChange = (val: string) => {
    setWebDateStr(formatDateInput(val));
  };

  const handleWebTimeChange = (val: string) => {
    setWebTimeStr(formatTimeInput(val));
  };

  const openDateEditor = () => {
    const d = playedDate ? new Date(playedDate) : new Date();
    setEditDate(d);
    setWebDateStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setWebTimeStr(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setEditingDate(true);
  };

  const onDateChange = (_event: any, selectedDate?: Date) => {
    if (selectedDate) {
      const updated = new Date(editDate);
      updated.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      setEditDate(updated);
    }
  };

  const onTimeChange = (_event: any, selectedTime?: Date) => {
    if (selectedTime) {
      const updated = new Date(editDate);
      updated.setHours(selectedTime.getHours(), selectedTime.getMinutes());
      setEditDate(updated);
    }
  };

  const parseDateStr = (str: string) => {
    const digits = str.replace(/\D/g, "");
    if (digits.length >= 8) {
      return {
        y: parseInt(digits.slice(0, 4)),
        m: parseInt(digits.slice(4, 6)) - 1,
        d: parseInt(digits.slice(6, 8)),
      };
    }
    return null;
  };

  const parseTimeStr = (str: string) => {
    const digits = str.replace(/\D/g, "");
    if (digits.length >= 4) {
      return { h: parseInt(digits.slice(0, 2)), min: parseInt(digits.slice(2, 4)) };
    }
    return null;
  };

  const saveDateEdit = () => {
    let finalDate = new Date(editDate);
    if (Platform.OS === "web") {
      const dp = parseDateStr(webDateStr);
      if (dp && !isNaN(dp.y) && !isNaN(dp.m) && !isNaN(dp.d)) {
        finalDate.setFullYear(dp.y, dp.m, dp.d);
      }
      const tp = parseTimeStr(webTimeStr);
      if (tp && !isNaN(tp.h) && !isNaN(tp.min)) {
        finalDate.setHours(tp.h, tp.min);
      }
    }
    updatePlayedDate(finalDate.toISOString());
    setEditingDate(false);
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
              <HistoryCard
                key={item.id}
                item={item}
                onPress={() => viewHistoryItem(item)}
                onDelete={() => setPendingDeleteId(item.id)}
              />
            ))
          )}
        </ScrollView>

        <Modal visible={!!pendingDeleteId} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setPendingDeleteId(null)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Delete Entry</Text>
              <Text style={styles.deleteModalMessage}>Are you sure you want to delete this score entry?</Text>
              <View style={styles.modalButtons}>
                <Pressable
                  onPress={() => setPendingDeleteId(null)}
                  style={({ pressed }) => [styles.modalCancelBtn, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirmDeleteItem}
                  style={({ pressed }) => [styles.deleteConfirmBtn, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.deleteConfirmText}>Delete</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
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
                  <View style={styles.previewOverlay} />
                </Animated.View>
              )}

              {playedDate && (
                <Animated.View
                  entering={Platform.OS !== "web" ? FadeInUp.delay(50).springify() : undefined}
                  style={styles.playedDateCard}
                >
                  <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
                  <Text style={styles.playedDateLabel}>Played:</Text>
                  <Text style={styles.playedDateValue}>{formatPlayedDate(playedDate)}</Text>
                  <Pressable
                    onPress={openDateEditor}
                    style={({ pressed }) => [styles.editDateBtn, pressed && { opacity: 0.5 }]}
                  >
                    <Feather name="edit-2" size={14} color={Colors.accent} />
                  </Pressable>
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
                      <MaterialCommunityIcons name="robot" size={22} color="#FFB347" />
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
                {[...result.players]
                  .sort((a, b) => PLAYER_COLOR_ORDER.indexOf(a.color) - PLAYER_COLOR_ORDER.indexOf(b.color))
                  .map((player, i) => (
                    <PlayerCard
                      key={`${player.name}-${i}`}
                      player={player}
                      index={i}
                      customName={playerNames[player.color]}
                      onNameChange={(name) => updatePlayerName(player.color, name)}
                    />
                  ))}
              </View>
            </>
          )}
        </ScrollView>

        <Modal visible={editingDate} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setEditingDate(false)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Edit Played Date</Text>

              {Platform.OS === "web" ? (
                <View style={styles.datePickerRow}>
                  <View style={styles.datePickerField}>
                    <Text style={styles.datePickerLabel}>Date</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={webDateStr}
                      onChangeText={handleWebDateChange}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={10}
                    />
                  </View>
                  <View style={styles.datePickerField}>
                    <Text style={styles.datePickerLabel}>Time</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={webTimeStr}
                      onChangeText={handleWebTimeChange}
                      placeholder="HH:MM"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.nativePickerContainer}>
                  <View style={styles.pickerLabelRow}>
                    <Ionicons name="calendar-outline" size={18} color={Colors.accent} />
                    <Text style={styles.pickerTriggerText}>Date</Text>
                  </View>
                  <DateTimePicker
                    value={editDate}
                    mode="date"
                    display="spinner"
                    onChange={onDateChange}
                    themeVariant="dark"
                    style={{ height: 150 }}
                  />
                  <View style={[styles.pickerLabelRow, { marginTop: 12 }]}>
                    <Ionicons name="time-outline" size={18} color={Colors.accent} />
                    <Text style={styles.pickerTriggerText}>Time</Text>
                  </View>
                  <DateTimePicker
                    value={editDate}
                    mode="time"
                    display="spinner"
                    onChange={onTimeChange}
                    themeVariant="dark"
                    style={{ height: 150 }}
                  />
                </View>
              )}

              <View style={styles.modalButtons}>
                <Pressable
                  onPress={() => setEditingDate(false)}
                  style={({ pressed }) => [styles.modalCancelBtn, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveDateEdit}
                  style={({ pressed }) => [styles.modalSaveBtn, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.modalSaveText}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <View style={{ width: 40 }} />
        <Text style={styles.headerTitle}>Score Slinger</Text>
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
                    onDelete={() => setPendingDeleteId(item.id)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </View>

      <Modal visible={!!pendingDeleteId} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setPendingDeleteId(null)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Delete Entry</Text>
            <Text style={styles.deleteModalMessage}>Are you sure you want to delete this score entry?</Text>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setPendingDeleteId(null)}
                style={({ pressed }) => [styles.modalCancelBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmDeleteItem}
                style={({ pressed }) => [styles.deleteConfirmBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.deleteConfirmText}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  playerNameBtn: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  playerNameInput: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  playerColorLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    marginLeft: 20,
    marginTop: -4,
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
  historyCardWrapper: {
    borderRadius: 14,
    overflow: "hidden" as const,
    position: "relative" as const,
  },
  historyDeleteArea: {
    position: "absolute" as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: Colors.danger,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
  },
  historyDeleteBtn: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  historyDeleteText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 11,
    color: "#fff",
  },
  historyCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: Colors.surface,
    borderRadius: 14,
  },
  historyCardContent: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
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
  playedDateCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  playedDateLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  playedDateValue: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  editDateBtn: {
    padding: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    padding: 30,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: "100%" as const,
    maxWidth: 340,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  modalTitle: {
    fontFamily: "DMSans_700Bold",
    fontSize: 18,
    color: Colors.text,
    marginBottom: 4,
  },
  modalHint: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 16,
  },
  modalInput: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: "row" as const,
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    alignItems: "center" as const,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surfaceLight,
  },
  modalCancelText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 1,
    alignItems: "center" as const,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.accent,
  },
  modalSaveText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
    color: Colors.background,
  },
  deleteModalMessage: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  deleteConfirmBtn: {
    flex: 1,
    alignItems: "center" as const,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.danger,
  },
  deleteConfirmText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
    color: "#fff",
  },
  datePickerRow: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 20,
    marginTop: 12,
  },
  datePickerField: {
    flex: 1,
  },
  datePickerLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  nativePickerContainer: {
    gap: 8,
    marginTop: 12,
    marginBottom: 20,
  },
  pickerLabelRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 4,
  },
  pickerTrigger: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  pickerTriggerText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    color: Colors.text,
  },
});
