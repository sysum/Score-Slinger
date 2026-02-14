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
import { type ThemeColors } from "@/constants/colors";
import { useTheme, AppearanceMode } from "@/contexts/ThemeContext";

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
  fileName?: string;
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

const pad2 = (n: number) => n.toString().padStart(2, "0");

const formatWithKey = (iso: string, key: DateFormatKey): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const Y = d.getFullYear();
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  const min = pad2(d.getMinutes());
  const ampm = h24 >= 12 ? "PM" : "AM";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthsFull = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  switch (key) {
    case "us_full": return `${pad2(M)}/${pad2(D)}/${Y} ${h12}:${min} ${ampm}`;
    case "eu_full": return `${pad2(D)}/${pad2(M)}/${Y} ${h12}:${min} ${ampm}`;
    case "iso_full": return `${Y}-${pad2(M)}-${pad2(D)} ${pad2(h24)}:${min}`;
    case "mmm_full": return `${months[d.getMonth()]} ${D}, ${Y} ${h12}:${min} ${ampm}`;
    case "dd_mmm_full": return `${D} ${months[d.getMonth()]} ${Y} ${h12}:${min} ${ampm}`;
    case "us_date": return `${pad2(M)}/${pad2(D)}/${Y}`;
    case "eu_date": return `${pad2(D)}/${pad2(M)}/${Y}`;
    case "iso_date": return `${Y}-${pad2(M)}-${pad2(D)}`;
    case "mmm_date": return `${months[d.getMonth()]} ${D}, ${Y}`;
    case "long_date": return `${monthsFull[d.getMonth()]} ${D}, ${Y}`;
    default: return d.toLocaleDateString();
  }
};

const sortHistory = (items: HistoryItem[], sort: SortOption): HistoryItem[] => {
  const sorted = [...items];
  switch (sort) {
    case "upload_recent":
      return sorted.sort((a, b) => b.timestamp - a.timestamp);
    case "upload_oldest":
      return sorted.sort((a, b) => a.timestamp - b.timestamp);
    case "played_recent":
      return sorted.sort((a, b) => {
        const da = a.playedDate ? new Date(a.playedDate).getTime() : a.timestamp;
        const db = b.playedDate ? new Date(b.playedDate).getTime() : b.timestamp;
        return db - da;
      });
    case "played_oldest":
      return sorted.sort((a, b) => {
        const da = a.playedDate ? new Date(a.playedDate).getTime() : a.timestamp;
        const db = b.playedDate ? new Date(b.playedDate).getTime() : b.timestamp;
        return da - db;
      });
    case "score_highest":
      return sorted.sort((a, b) => b.result.teamScore - a.result.teamScore);
    case "score_lowest":
      return sorted.sort((a, b) => a.result.teamScore - b.result.teamScore);
    default:
      return sorted;
  }
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
  themeColors,
}: {
  player: PlayerScore;
  index: number;
  customName?: string;
  onNameChange?: (name: string) => void;
  themeColors: ThemeColors;
}) {
  const playerColorMap: Record<string, string> = {
    blue: themeColors.playerColors.blue,
    red: themeColors.playerColors.red,
    yellow: themeColors.playerColors.yellow,
    purple: themeColors.playerColors.purple,
  };
  const color = playerColorMap[player.color] || themeColors.accent;
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
      style={[styles.playerCard, { borderLeftColor: color, borderLeftWidth: 3, backgroundColor: themeColors.surface }]}
    >
      <View style={styles.playerHeader}>
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        {editing ? (
          <TextInput
            style={[styles.playerNameInput, { color, borderBottomColor: themeColors.accent }]}
            value={nameInput}
            onChangeText={setNameInput}
            onBlur={handleSaveName}
            onSubmitEditing={handleSaveName}
            autoFocus
            placeholder={player.name}
            placeholderTextColor={themeColors.textMuted}
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
            <Text style={[styles.playerName, { color: customName ? themeColors.text : themeColors.textSecondary }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Feather name="edit-2" size={11} color={themeColors.textMuted} style={{ marginLeft: 4 }} />
          </Pressable>
        )}
        <Text style={[styles.playerScore, { color }]}>{player.score.toLocaleString()}</Text>
      </View>
      <View style={[styles.playerBarBg, { backgroundColor: themeColors.surfaceLight }]}>
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
  dateFormat,
  themeColors,
}: {
  item: HistoryItem;
  onPress: () => void;
  onDelete: () => void;
  dateFormat: DateFormatKey;
  themeColors: ThemeColors;
}) {
  const dateSource = item.playedDate || new Date(item.timestamp).toISOString();
  const timeStr = formatWithKey(typeof dateSource === "string" ? dateSource : new Date(dateSource).toISOString(), dateFormat);

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
      <Animated.View style={[styles.historyDeleteArea, { backgroundColor: themeColors.danger }, deleteOpacity]}>
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
      <Animated.View style={[styles.historyCard, { backgroundColor: themeColors.surface }, cardAnimStyle]} {...panResponder.panHandlers}>
        <Pressable
          onPress={handlePress}
          style={({ pressed }) => [styles.historyCardContent, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.historyLeft}>
            <MaterialCommunityIcons name="gamepad-variant" size={20} color={themeColors.accent} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={[styles.historyTime, { color: themeColors.textSecondary }]}>{timeStr}</Text>
            </View>
          </View>
          <View style={styles.historyRight}>
            <Text style={[styles.historyScore, { color: themeColors.accent }]}>{item.result.teamScore.toLocaleString()}</Text>
            <Feather name="chevron-right" size={16} color={themeColors.textMuted} />
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode, isDark } = useTheme();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const historyRef = useRef<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("upload_recent");
  const [dateFormat, setDateFormat] = useState<DateFormatKey>("mmm_full");
  const [showSortPicker, setShowSortPicker] = useState(false);
  const [playedDate, setPlayedDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);
  const [editDate, setEditDate] = useState(new Date());
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const pendingUpload = useRef<{ uri: string; photoDate: string; fileName?: string } | null>(null);

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
      const savedSort = await AsyncStorage.getItem("sort_option");
      if (savedSort && savedSort in SORT_LABELS) {
        setSortOption(savedSort as SortOption);
      }
      const savedDateFormat = await AsyncStorage.getItem("date_format");
      if (savedDateFormat && savedDateFormat in DATE_FORMAT_LABELS) {
        setDateFormat(savedDateFormat as DateFormatKey);
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

  const saveToHistory = async (parsed: ParsedResult, uri?: string, dateStr?: string, fileName?: string) => {
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
        ...(fileName ? { fileName } : {}),
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
      const pickedFileName = asset.fileName || asset.uri.split("/").pop() || undefined;

      const isDuplicate = historyRef.current.some((item) => {
        if (pickedFileName && item.fileName && pickedFileName === item.fileName) return true;
        if (!item.playedDate) return false;
        const existingTime = new Date(item.playedDate).getTime();
        const newTime = new Date(photoDate).getTime();
        return Math.abs(existingTime - newTime) < 60000;
      });

      if (isDuplicate) {
        pendingUpload.current = { uri: asset.uri, photoDate, fileName: pickedFileName };
        setImageUri(asset.uri);
        setResult(null);
        setShowHistory(false);
        setCurrentHistoryId(null);
        setDuplicateWarning(true);
        return;
      }

      setPlayedDate(photoDate);
      setImageUri(asset.uri);
      setResult(null);
      setShowHistory(false);
      setCurrentHistoryId(null);
      await analyzeImage(asset.uri, photoDate ?? undefined, pickedFileName);
    } catch (err) {
      console.error("Image pick error:", err);
    }
  }, []);

  const confirmDuplicateUpload = async () => {
    setDuplicateWarning(false);
    if (pendingUpload.current) {
      const { uri, photoDate, fileName } = pendingUpload.current;
      pendingUpload.current = null;
      setPlayedDate(photoDate);
      await analyzeImage(uri, photoDate, fileName);
    }
  };

  const cancelDuplicateUpload = () => {
    setDuplicateWarning(false);
    pendingUpload.current = null;
    resetState();
  };

  const analyzeImage = async (uri: string, dateStr?: string, fileName?: string) => {
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
        await saveToHistory(data, uri, effectiveDate, fileName);
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
    return formatWithKey(iso, dateFormat);
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

  const handleSortChange = async (option: SortOption) => {
    setSortOption(option);
    setShowSortPicker(false);
    try {
      await AsyncStorage.setItem("sort_option", option);
    } catch {}
  };

  const handleDateFormatChange = async (key: DateFormatKey) => {
    setDateFormat(key);
    try {
      await AsyncStorage.setItem("date_format", key);
    } catch {}
  };

  const handleDefaultSortFromSettings = async (option: SortOption) => {
    setSortOption(option);
    try {
      await AsyncStorage.setItem("sort_option", option);
    } catch {}
  };

  if (showSettings) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset, backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => setShowSettings(false)}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.settingsContent,
            { paddingBottom: insets.bottom + webBottomInset + 20 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.settingsSection}>
            <Text style={[styles.settingsSectionTitle, { color: colors.text }]}>Appearance</Text>
            <Text style={[styles.settingsSectionSubtitle, { color: colors.textMuted }]}>Choose your preferred theme</Text>
            <View style={[styles.settingsOptionsList, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              {(["dark", "light", "system"] as AppearanceMode[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={({ pressed }) => [
                    styles.settingsOptionRow,
                    { borderBottomColor: colors.cardBorder },
                    mode === m && { backgroundColor: colors.accentDim },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Ionicons
                      name={m === "dark" ? "moon-outline" : m === "light" ? "sunny-outline" : "phone-portrait-outline"}
                      size={18}
                      color={mode === m ? colors.accent : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.settingsOptionText,
                        { color: mode === m ? colors.accent : colors.textSecondary },
                        mode === m && { fontFamily: "DMSans_600SemiBold" },
                      ]}
                    >
                      {m === "dark" ? "Dark Mode" : m === "light" ? "Light Mode" : "System"}
                    </Text>
                  </View>
                  {mode === m && (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.settingsSection}>
            <Text style={[styles.settingsSectionTitle, { color: colors.text }]}>Date Format</Text>
            <Text style={[styles.settingsSectionSubtitle, { color: colors.textMuted }]}>Applied everywhere dates are shown</Text>
            <View style={[styles.settingsOptionsList, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              {(Object.keys(DATE_FORMAT_LABELS) as DateFormatKey[]).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => handleDateFormatChange(key)}
                  style={({ pressed }) => [
                    styles.settingsOptionRow,
                    { borderBottomColor: colors.cardBorder },
                    dateFormat === key && { backgroundColor: colors.accentDim },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsOptionText,
                      { color: dateFormat === key ? colors.accent : colors.textSecondary },
                      dateFormat === key && { fontFamily: "DMSans_600SemiBold" },
                    ]}
                  >
                    {DATE_FORMAT_LABELS[key]}
                  </Text>
                  {dateFormat === key && (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.settingsSection}>
            <Text style={[styles.settingsSectionTitle, { color: colors.text }]}>Default Sort</Text>
            <Text style={[styles.settingsSectionSubtitle, { color: colors.textMuted }]}>Applied to the results list</Text>
            <View style={[styles.settingsOptionsList, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => handleDefaultSortFromSettings(option)}
                  style={({ pressed }) => [
                    styles.settingsOptionRow,
                    { borderBottomColor: colors.cardBorder },
                    sortOption === option && { backgroundColor: colors.accentDim },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsOptionText,
                      { color: sortOption === option ? colors.accent : colors.textSecondary },
                      sortOption === option && { fontFamily: "DMSans_600SemiBold" },
                    ]}
                  >
                    {SORT_LABELS[option]}
                  </Text>
                  {sortOption === option && (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.settingsSection}>
            <Text style={[styles.settingsSectionTitle, { color: colors.text }]}>Export Scores</Text>
            <Text style={[styles.settingsSectionSubtitle, { color: colors.textMuted }]}>Download your scan data</Text>
            <View style={[styles.settingsOptionsList, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={[styles.settingsExportRow, { borderBottomColor: colors.cardBorder }]}>
                <View style={styles.settingsExportLeft}>
                  <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.settingsOptionText, { color: colors.textSecondary }]}>Export as CSV</Text>
                </View>
                <View style={[styles.comingSoonBadge, { backgroundColor: colors.surfaceLight }]}>
                  <Text style={[styles.comingSoonText, { color: colors.textMuted }]}>Coming Soon</Text>
                </View>
              </View>
              <View style={[styles.settingsExportRow, { borderBottomColor: colors.cardBorder }]}>
                <View style={styles.settingsExportLeft}>
                  <Ionicons name="code-slash-outline" size={20} color={colors.textSecondary} />
                  <Text style={[styles.settingsOptionText, { color: colors.textSecondary }]}>Export as JSON</Text>
                </View>
                <View style={[styles.comingSoonBadge, { backgroundColor: colors.surfaceLight }]}>
                  <Text style={[styles.comingSoonText, { color: colors.textMuted }]}>Coming Soon</Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (showHistory) {
    const sortedHistory = sortHistory(history, sortOption);
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset, backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => setShowHistory(false)}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Results</Text>
          <Pressable
            onPress={() => setShowSortPicker(true)}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="swap-vertical" size={22} color={colors.text} />
          </Pressable>
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
              <Ionicons name="time-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No scans yet</Text>
              <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                Your parsed game scores will appear here
              </Text>
            </View>
          ) : (
            sortedHistory.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                onPress={() => viewHistoryItem(item)}
                onDelete={() => setPendingDeleteId(item.id)}
                dateFormat={dateFormat}
                themeColors={colors}
              />
            ))
          )}
        </ScrollView>

        <Modal visible={!!pendingDeleteId} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setPendingDeleteId(null)}>
            <Pressable style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Entry</Text>
              <Text style={[styles.deleteModalMessage, { color: colors.textSecondary }]}>Are you sure you want to delete this score entry?</Text>
              <View style={styles.modalButtons}>
                <Pressable
                  onPress={() => setPendingDeleteId(null)}
                  style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirmDeleteItem}
                  style={({ pressed }) => [styles.deleteConfirmBtn, { backgroundColor: colors.danger }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.deleteConfirmText}>Delete</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal visible={showSortPicker} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setShowSortPicker(false)}>
            <Pressable style={[styles.sortModalContent, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Sort By</Text>
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => handleSortChange(option)}
                  style={({ pressed }) => [
                    styles.sortOptionRow,
                    { borderBottomColor: colors.cardBorder },
                    sortOption === option && { backgroundColor: colors.accentDim },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text
                    style={[
                      styles.sortOptionText,
                      { color: sortOption === option ? colors.accent : colors.textSecondary },
                      sortOption === option && { fontFamily: "DMSans_700Bold" },
                    ]}
                  >
                    {SORT_LABELS[option]}
                  </Text>
                  {sortOption === option && (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  )}
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  if (result && !loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset, backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              resetState();
              setShowHistory(true);
            }}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Results</Text>
          <Pressable
            onPress={() => setShowHistory(true)}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="time-outline" size={22} color={colors.text} />
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
              <Ionicons name="alert-circle" size={40} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>{result.error}</Text>
              <Pressable
                onPress={resetState}
                style={({ pressed }) => [styles.retryBtn, { backgroundColor: colors.accentDim, borderColor: colors.accentBorder }, pressed && { opacity: 0.7 }]}
              >
                <Feather name="refresh-cw" size={18} color={colors.accent} />
                <Text style={[styles.retryText, { color: colors.accent }]}>Try Another Image</Text>
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
                    colors={["transparent", isDark ? "rgba(10, 14, 26, 0.9)" : "rgba(242, 244, 248, 0.9)"]}
                    style={styles.previewGradient}
                  />
                  <View style={styles.previewOverlay} />
                </Animated.View>
              )}

              {playedDate && (
                <Animated.View
                  entering={Platform.OS !== "web" ? FadeInUp.delay(50).springify() : undefined}
                  style={[styles.playedDateCard, { backgroundColor: colors.surface }]}
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.playedDateLabel, { color: colors.textSecondary }]}>Played:</Text>
                  <Text style={[styles.playedDateValue, { color: colors.text }]}>{formatPlayedDate(playedDate)}</Text>
                  <Pressable
                    onPress={openDateEditor}
                    style={({ pressed }) => [styles.editDateBtn, pressed && { opacity: 0.5 }]}
                  >
                    <Feather name="edit-2" size={14} color={colors.accent} />
                  </Pressable>
                </Animated.View>
              )}

              <Animated.View
                entering={Platform.OS !== "web" ? FadeInUp.delay(100).springify() : undefined}
                style={[styles.totalScoreCard, { borderColor: colors.accentBorder }]}
              >
                <LinearGradient
                  colors={[`${colors.accent}1F`, `${colors.accent}08`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>TEAM SCORE</Text>
                <Text style={[styles.totalScore, { color: colors.accent }]}>{result.teamScore.toLocaleString()}</Text>
                <View style={styles.playerCount}>
                  <Ionicons name="people" size={14} color={colors.textSecondary} />
                  <Text style={[styles.playerCountText, { color: colors.textSecondary }]}>
                    {result.players.length} player{result.players.length !== 1 ? "s" : ""}
                  </Text>
                </View>
              </Animated.View>

              {result.objectiveScores && (
                <Animated.View
                  entering={Platform.OS !== "web" ? FadeInUp.delay(150).springify() : undefined}
                  style={styles.objectivesSection}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Objective Scores</Text>
                  <View style={styles.objectivesRow}>
                    <View style={[styles.objectiveCard, { backgroundColor: colors.surface }]}>
                      <MaterialCommunityIcons name="sword-cross" size={22} color="#FF6B6B" />
                      <Text style={[styles.objectiveScore, { color: colors.text }]}>
                        {result.objectiveScores.fightGiantBot.toLocaleString()}
                      </Text>
                      <Text style={[styles.objectiveLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                        Fight Giant Bot
                      </Text>
                    </View>
                    <View style={[styles.objectiveCard, { backgroundColor: colors.surface }]}>
                      <MaterialCommunityIcons name="shield-account" size={22} color="#4ECDC4" />
                      <Text style={[styles.objectiveScore, { color: colors.text }]}>
                        {result.objectiveScores.rescueSpiderMan.toLocaleString()}
                      </Text>
                      <Text style={[styles.objectiveLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                        Rescue Spider-Man
                      </Text>
                    </View>
                    <View style={[styles.objectiveCard, { backgroundColor: colors.surface }]}>
                      <MaterialCommunityIcons name="robot" size={22} color="#FFB347" />
                      <Text style={[styles.objectiveScore, { color: colors.text }]}>
                        {result.objectiveScores.destroyGiantBot.toLocaleString()}
                      </Text>
                      <Text style={[styles.objectiveLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                        Destroy Giant Bot
                      </Text>
                    </View>
                  </View>
                </Animated.View>
              )}

              <View style={styles.playersSection}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Individual Scores</Text>
                {[...result.players]
                  .sort((a, b) => PLAYER_COLOR_ORDER.indexOf(a.color) - PLAYER_COLOR_ORDER.indexOf(b.color))
                  .map((player, i) => (
                    <PlayerCard
                      key={`${player.name}-${i}`}
                      player={player}
                      index={i}
                      customName={playerNames[player.color]}
                      onNameChange={(name) => updatePlayerName(player.color, name)}
                      themeColors={colors}
                    />
                  ))}
              </View>
            </>
          )}
        </ScrollView>

        <Modal visible={editingDate} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setEditingDate(false)}>
            <Pressable style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Played Date</Text>

              {Platform.OS === "web" ? (
                <View style={styles.datePickerRow}>
                  <View style={styles.datePickerField}>
                    <Text style={[styles.datePickerLabel, { color: colors.textSecondary }]}>Date</Text>
                    <TextInput
                      style={[styles.modalInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.cardBorder }]}
                      value={webDateStr}
                      onChangeText={handleWebDateChange}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={10}
                    />
                  </View>
                  <View style={styles.datePickerField}>
                    <Text style={[styles.datePickerLabel, { color: colors.textSecondary }]}>Time</Text>
                    <TextInput
                      style={[styles.modalInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.cardBorder }]}
                      value={webTimeStr}
                      onChangeText={handleWebTimeChange}
                      placeholder="HH:MM"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.nativePickerContainer}>
                  <View style={styles.pickerLabelRow}>
                    <Ionicons name="calendar-outline" size={18} color={colors.accent} />
                    <Text style={[styles.pickerTriggerText, { color: colors.text }]}>Date</Text>
                  </View>
                  <DateTimePicker
                    value={editDate}
                    mode="date"
                    display="spinner"
                    onChange={onDateChange}
                    themeVariant={isDark ? "dark" : "light"}
                    style={{ height: 150 }}
                  />
                  <View style={[styles.pickerLabelRow, { marginTop: 12 }]}>
                    <Ionicons name="time-outline" size={18} color={colors.accent} />
                    <Text style={[styles.pickerTriggerText, { color: colors.text }]}>Time</Text>
                  </View>
                  <DateTimePicker
                    value={editDate}
                    mode="time"
                    display="spinner"
                    onChange={onTimeChange}
                    themeVariant={isDark ? "dark" : "light"}
                    style={{ height: 150 }}
                  />
                </View>
              )}

              <View style={styles.modalButtons}>
                <Pressable
                  onPress={() => setEditingDate(false)}
                  style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveDateEdit}
                  style={({ pressed }) => [styles.modalSaveBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.modalSaveText, { color: colors.background }]}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset, backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setShowSettings(true)}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="settings-outline" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Score Slinger</Text>
        <Pressable
          onPress={() => setShowHistory(true)}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="time-outline" size={22} color={colors.text} />
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
                  <ActivityIndicator size="large" color={colors.accent} />
                </View>
              </View>
            )}
            <Text style={[styles.loadingText, { color: colors.text }]}>Analyzing scoreboard...</Text>
            <Text style={[styles.loadingSubtext, { color: colors.textSecondary }]}>
              Extracting player scores and colors
            </Text>
          </Animated.View>
        ) : (
          <>
            <View style={styles.heroSection}>
              <View style={[styles.iconCircle, { backgroundColor: colors.accentDim, borderColor: colors.accentBorder }]}>
                <Ionicons
                  name="images-outline"
                  size={44}
                  color={colors.accent}
                />
              </View>
              <Text style={[styles.heroTitle, { color: colors.text }]}>Scan a Scoreboard</Text>
              <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
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
                  colors={[colors.accent, isDark ? "#00C4B0" : "#009E8E"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
                <Ionicons name="camera" size={22} color={colors.background} />
                <Text style={[styles.primaryBtnText, { color: colors.background }]}>Take Photo</Text>
              </Pressable>

              <Pressable
                onPress={() => pickImage(false)}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  { backgroundColor: colors.accentDim, borderColor: colors.accentBorder },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
                ]}
              >
                <Ionicons name="images" size={22} color={colors.accent} />
                <Text style={[styles.secondaryBtnText, { color: colors.accent }]}>Choose from Gallery</Text>
              </Pressable>
            </View>

            {history.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.recentHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Scans</Text>
                  <Pressable
                    onPress={() => setShowHistory(true)}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.seeAllText, { color: colors.accent }]}>See All</Text>
                  </Pressable>
                </View>
                {history.slice(0, 3).map((item) => (
                  <HistoryCard
                    key={item.id}
                    item={item}
                    onPress={() => viewHistoryItem(item)}
                    onDelete={() => setPendingDeleteId(item.id)}
                    dateFormat={dateFormat}
                    themeColors={colors}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </View>

      <Modal visible={!!pendingDeleteId} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setPendingDeleteId(null)}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Entry</Text>
            <Text style={[styles.deleteModalMessage, { color: colors.textSecondary }]}>Are you sure you want to delete this score entry?</Text>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setPendingDeleteId(null)}
                style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmDeleteItem}
                style={({ pressed }) => [styles.deleteConfirmBtn, { backgroundColor: colors.danger }, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.deleteConfirmText}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={duplicateWarning} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={cancelDuplicateUpload}>
          <Pressable style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Ionicons name="warning-outline" size={22} color={colors.accent} />
              <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 0 }]}>Duplicate Score</Text>
            </View>
            <Text style={[styles.deleteModalMessage, { color: colors.textSecondary }]}>
              Looks like you already uploaded this score. Do you want to upload it again?
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={cancelDuplicateUpload}
                style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Nevermind</Text>
              </Pressable>
              <Pressable
                onPress={confirmDuplicateUpload}
                style={({ pressed }) => [styles.modalSaveBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.modalSaveText, { color: isDark ? colors.background : "#fff" }]}>Yes, upload this score</Text>
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
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    borderWidth: 1,
  },
  heroTitle: {
    fontFamily: "DMSans_700Bold",
    fontSize: 28,
    textAlign: "center",
    marginBottom: 12,
  },
  heroSubtitle: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
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
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 16,
    gap: 10,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
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
    marginBottom: 8,
  },
  loadingSubtext: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
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
  },
  totalScoreCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    overflow: "hidden",
  },
  totalLabel: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 8,
  },
  totalScore: {
    fontFamily: "DMSans_700Bold",
    fontSize: 52,
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
    borderRadius: 14,
    padding: 14,
    alignItems: "center" as const,
    gap: 8,
  },
  objectiveScore: {
    fontFamily: "DMSans_700Bold",
    fontSize: 20,
  },
  objectiveLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    textAlign: "center" as const,
    lineHeight: 15,
  },
  playersSection: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    marginBottom: 4,
  },
  playerCard: {
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
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  playerColorLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    marginLeft: 20,
    marginTop: -4,
  },
  playerScore: {
    fontFamily: "DMSans_700Bold",
    fontSize: 20,
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
  errorCard: {
    alignItems: "center",
    padding: 40,
    gap: 16,
  },
  errorText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
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
    borderWidth: 1,
    marginTop: 8,
  },
  retryText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
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
  },
  historyTime: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
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
  },
  emptySubtext: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  playedDateCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  playedDateLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
  },
  playedDateValue: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
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
    borderRadius: 20,
    padding: 24,
    width: "100%" as const,
    maxWidth: 340,
    borderWidth: 1,
  },
  modalTitle: {
    fontFamily: "DMSans_700Bold",
    fontSize: 18,
    marginBottom: 4,
  },
  modalHint: {
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    marginBottom: 16,
  },
  modalInput: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
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
  },
  modalCancelText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
  },
  modalSaveBtn: {
    flex: 1,
    alignItems: "center" as const,
    paddingVertical: 12,
    borderRadius: 12,
  },
  modalSaveText: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
  },
  deleteModalMessage: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  deleteConfirmBtn: {
    flex: 1,
    alignItems: "center" as const,
    paddingVertical: 12,
    borderRadius: 12,
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
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  pickerTriggerText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 16,
  },
  sortModalContent: {
    borderRadius: 20,
    padding: 24,
    width: "100%" as const,
    maxWidth: 340,
    borderWidth: 1,
  },
  sortOptionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  sortOptionText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
  },
  settingsContent: {
    paddingHorizontal: 20,
    gap: 28,
    paddingTop: 8,
  },
  settingsSection: {
    gap: 8,
  },
  settingsSectionTitle: {
    fontFamily: "DMSans_700Bold",
    fontSize: 17,
  },
  settingsSectionSubtitle: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    marginBottom: 4,
  },
  settingsOptionsList: {
    borderRadius: 14,
    overflow: "hidden" as const,
    borderWidth: 1,
  },
  settingsOptionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  settingsOptionText: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
  },
  settingsExportRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  settingsExportLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  comingSoonBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  comingSoonText: {
    fontFamily: "DMSans_500Medium",
    fontSize: 11,
  },
});
