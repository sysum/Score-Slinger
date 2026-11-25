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
import { useToast } from "@/contexts/ToastContext";
import { apiRequest, ApiError, isCapturedApiError } from "@/lib/query-client";
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
  /** Server sanity-check problems (never blocks the save). */
  warning?: string;
  /** OpenAI model that parsed the image. */
  model?: string;
}

interface Score {
  id: string;
  uploaderName: string;
  teamScore: number;
  achievement: string | null;
  gameName: string;
  objectiveScores: { fightGiantBot: number; rescueSpiderMan: number; destroyGiantBot: number } | null;
  players: { name: string; score: number; color: string }[];
  playerNames: Record<string, string> | null;
  imagePath: string | null;
  playedDate: string | null;
  createdAt: string;
}

const PLAYER_COLOR_ORDER = ["blue", "red", "yellow", "purple"];

const DATE_SAVE_ERROR_MESSAGE = "Couldn't save the date — check your connection and try again.";
const NAME_SAVE_ERROR_MESSAGE = "Couldn't save the name — check your connection and try again.";
const DISCARD_ERROR_MESSAGE = "Couldn't discard — check your connection and try again.";

// Web image URIs are `blob:` URLs with no extension (splitting on "." used to
// yield e.g. "app/<uuid>"), so on web the extension comes from the blob's MIME
// type, then the picker's file name, then "jpg".
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
};

function extFromName(name?: string | null): string | null {
  const match = name?.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

// Haptics are cosmetic: a failure (e.g. an unsupported device) must never fail
// the flow, so it's fire-and-forget with both sync and async errors swallowed.
function successHaptic() {
  if (Platform.OS === "web") return;
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } catch {
    // ignore
  }
}

// Flat, breakdown-friendly gameplay props for score_saved (no nested arrays).
function gameplayProps(data: ParsedResult) {
  const players = data.players ?? [];
  const scoreFor = (color: PlayerScore["color"]) =>
    players.find((p) => p.color === color)?.score ?? null;
  const top = players.reduce<PlayerScore | null>(
    (best, p) => (best === null || p.score > best.score ? p : best),
    null,
  );
  return {
    team_score: data.teamScore,
    achievement: data.achievement || null,
    objective_fight_giant_bot: data.objectiveScores?.fightGiantBot ?? null,
    objective_rescue_spider_man: data.objectiveScores?.rescueSpiderMan ?? null,
    objective_destroy_giant_bot: data.objectiveScores?.destroyGiantBot ?? null,
    score_blue: scoreFor("blue"),
    score_yellow: scoreFor("yellow"),
    score_red: scoreFor("red"),
    score_purple: scoreFor("purple"),
    top_color: top?.color ?? null,
  };
}

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
  }, [progress]);

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
          <Pressable onPress={() => { analytics.track("player_name_edit_started", { location: "upload" }); setNameInput(customName || ""); setEditing(true); }} style={styles.playerNameRow}>
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
  const { uri, photoDate, fileName, source: uploadSource, photoDateSource } = useLocalSearchParams<{
    uri: string;
    photoDate: string;
    fileName: string;
    // Analytics only, set by TabBar: "camera" | "library", and "exif" | "now".
    source?: string;
    photoDateSource?: string;
  }>();

  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [playedDate, setPlayedDate] = useState<string>(photoDate ?? new Date().toISOString());
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [editingDate, setEditingDate] = useState(false);
  const [editDate, setEditDate] = useState(() => new Date(photoDate ?? Date.now()));
  const [webDateStr, setWebDateStr] = useState("");
  const [webTimeStr, setWebTimeStr] = useState("");
  const [savingDate, setSavingDate] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  // Ref guard: state updates are async, so a double-tap could otherwise send two PATCHes.
  const savingDateRef = useRef(false);
  // Analytics: set once a played-date edit is saved (score_kept / score_discarded).
  const dateEditedRef = useRef(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  // Ref guard: a double-tap (or X + Discard) could otherwise send two DELETEs.
  const discardingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  // Set while analyzeImage runs; calling it abandons the analysis (X tapped or
  // the screen unmounted mid-analysis). Cleared once the analysis settles.
  const cancelAnalysisRef = useRef<(() => void) | null>(null);
  const displayNameRef = useRef<string>("");

  const { data: scores = [] } = useQuery<Score[]>({ queryKey: ["/api/scores"] });

  useEffect(() => {
    AsyncStorage.getItem("display_name").then((n) => {
      displayNameRef.current = n ?? "Anonymous";
    });
  }, []);

  // Leaving mid-analysis (e.g. iOS swipe-down, Android back) also cancels it.
  useEffect(() => () => cancelAnalysisRef.current?.(), []);

  // Intentional on-mount kickoff: check for duplicates, otherwise begin analysis.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!uri) return;
    const isDuplicate = scores.some((item) => {
      if (!item.playedDate) return false;
      return Math.abs(new Date(item.playedDate).getTime() - new Date(photoDate ?? 0).getTime()) < 60000;
    });
    if (isDuplicate) {
      setLoading(false);
      setShowDuplicateWarning(true);
      analytics.track("duplicate_warning_shown");
    } else {
      analyzeImage(uri, photoDate, fileName);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const analyzeImage = async (
    imageUri: string,
    dateStr?: string,
    file?: string,
    { duplicateOverridden = false }: { duplicateOverridden?: boolean } = {},
  ) => {
    setLoading(true);
    setShowDuplicateWarning(false);

    // Analytics state. `stage` tells an upload failure (image_upload_failed)
    // from a parse/save one (score_parse_failed.stage). `networkFailed` is set
    // when a request threw without an HTTP response (stage "network").
    const source = uploadSource ?? null;
    let stage: "upload" | "parse" | "save" = "upload";
    let networkFailed = false;
    let ext = "jpg";
    let byteCount: number | null = null;
    const request = (method: string, route: string, body?: unknown) =>
      apiRequest(method, route, body).catch((err: unknown) => {
        if (!(err instanceof ApiError)) networkFailed = true;
        throw err;
      });

    // Cancellation (X / unmount mid-analysis). Checked after every await: once
    // set, no further request is started, no flow event fires and no state is
    // set (the screen may be gone). `upload_canceled` is the only event.
    let canceled = false;
    const cancel = () => {
      canceled = true;
      cancelAnalysisRef.current = null;
      analytics.track("upload_canceled", { stage });
    };
    // Set once the auto-save request succeeds: from then on the score exists,
    // so no later error may show the failure screen.
    let savedResult: ParsedResult | null = null;
    cancelAnalysisRef.current = cancel;

    try {
      // Web: read the blob first, since its MIME type gives the extension and
      // HEIC must be rejected before the upload.
      let blob: Blob | null = null;
      if (Platform.OS === "web") {
        const response = await globalThis.fetch(imageUri);
        blob = await response.blob();
        byteCount = blob.size;
        ext = MIME_EXT[blob.type.toLowerCase()] ?? extFromName(file) ?? "jpg";
      } else {
        ext = imageUri.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
      }
      if (canceled) return;

      if (Platform.OS === "web" && (ext === "heic" || ext === "heif")) {
        // Not a user cancel: unregister so the unmount doesn't report one.
        cancelAnalysisRef.current = null;
        Alert.alert("Unsupported format", "HEIC files aren't supported on web. Please convert to JPEG or PNG first.");
        router.back();
        return;
      }

      const contentType = ext === "png" ? "image/png" : "image/jpeg";
      const storagePath = `scores/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      // Upload to Supabase Storage
      analytics.track("image_upload_started", { ext, source });
      let uploadError: Error | null = null;
      if (blob) {
        const { error } = await supabase.storage.from("scores").upload(storagePath, blob, { contentType });
        if (error) uploadError = error;
      } else {
        // Native only: lazy-load the legacy FS API. In Expo SDK 56 the main
        // expo-file-system entry dropped readAsStringAsync/EncodingType — they
        // now live under the /legacy subpath. Dynamic import keeps it off web.
        const ExpoFS = await import("expo-file-system/legacy");
        const base64 = await ExpoFS.readAsStringAsync(imageUri, { encoding: ExpoFS.EncodingType.Base64 });
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        byteCount = bytes.length;
        const { error } = await supabase.storage.from("scores").upload(storagePath, bytes, { contentType });
        if (error) uploadError = error;
      }

      // Canceled before the save: no record to delete. The uploaded image is
      // left behind; the client has no Storage delete policy, so it can't
      // remove the object itself (only DELETE /api/scores/:id cleans images).
      if (canceled) return;
      if (uploadError) throw uploadError;
      analytics.track("image_upload_succeeded", { ext, bytes: byteCount, source });

      // Parse via AI
      stage = "parse";
      analytics.track("score_parse_started");
      const parseStartedAt = Date.now();
      const res = await request("POST", "/api/parse-score", { imagePath: storagePath });
      const data: ParsedResult = await res.json();
      if (canceled) return;

      if (data.error) {
        analytics.track("score_parse_failed", { stage, status: null, error: data.error });
        setResult({ teamScore: 0, gameName: "Unknown", players: [], error: data.error });
      } else {
        analytics.track("score_parse_succeeded", {
          duration_ms: Date.now() - parseStartedAt,
          warning: data.warning ?? null,
          has_exif_date: !!data.photoTakenDate || photoDateSource === "exif",
          has_achievement: !!data.achievement,
          team_score: data.teamScore,
          model: data.model ?? null,
        });
        const effectiveDate = data.photoTakenDate || dateStr || new Date().toISOString();
        // Mirrors effectiveDate's fallback chain. A dateStr without client EXIF is
        // TabBar's pick-time default, so it counts as "now".
        const playedDateSource = data.photoTakenDate
          ? "exif_server"
          : dateStr && photoDateSource === "exif"
            ? "exif_client"
            : "now";
        setPlayedDate(effectiveDate);
        setEditDate(new Date(effectiveDate));

        // Auto-save to DB
        stage = "save";
        // Shared history size before this save (all users); undefined if not cached.
        const cachedCount = queryClient.getQueryData<Score[]>(["/api/scores"])?.length;
        const saveRes = await request("POST", "/api/scores", {
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
        // 2xx: the score is saved. Everything below is post-save work whose
        // errors are captured, never shown as an analysis failure.
        savedResult = data;
        let newScoreId: string | null = null;
        try {
          const newScore = await saveRes.json();
          if (typeof newScore?.id === "string") newScoreId = newScore.id;
        } catch (err) {
          analytics.captureException(err, { context: "post_save", step: "read_response" });
        }
        if (!newScoreId) {
          // Unreadable save response: recover the id from a fresh history fetch
          // (storage paths are unique), so Discard and edits still work.
          try {
            await queryClient.refetchQueries({ queryKey: ["/api/scores"] });
            newScoreId =
              queryClient.getQueryData<Score[]>(["/api/scores"])?.find((s) => s.imagePath === storagePath)?.id ?? null;
          } catch (err) {
            analytics.captureException(err, { context: "post_save", step: "recover_id" });
          }
        }

        if (canceled) {
          // Canceled while the save was in flight: delete the new record (the
          // server also removes its image). Best-effort; a 404 means it's gone.
          if (newScoreId) {
            try {
              await apiRequest("DELETE", `/api/scores/${newScoreId}`);
            } catch (err) {
              if (!(err instanceof ApiError && err.status === 404) && !isCapturedApiError(err)) {
                analytics.captureException(err, { context: "upload_cancel_cleanup", score_id: newScoreId });
              }
            }
          }
          queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
          return;
        }

        try {
          if (newScoreId) setSavedId(newScoreId);
          queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
          const ageDays = (Date.now() - new Date(effectiveDate).getTime()) / 86_400_000;
          // Saved before the user keeps or discards it: see score_discarded.
          analytics.track("score_saved", {
            score_id: newScoreId,
            source,
            played_date_source: playedDateSource,
            played_date_age_days: Number.isFinite(ageDays) ? Math.floor(ageDays) : null,
            duplicate_overridden: duplicateOverridden,
            history_size: cachedCount !== undefined ? cachedCount + 1 : null,
            ...gameplayProps(data),
          });
        } catch (err) {
          analytics.captureException(err, { context: "post_save" });
        }
        setResult(data);
      }

      successHaptic();
    } catch (err) {
      // Abandoned by the user: nothing to show or report.
      if (canceled) return;
      console.error("Analysis error:", err);
      if (savedResult) {
        // Backstop: post-save work is wrapped above, but a score that exists
        // must never be reported as "Failed to analyze image".
        analytics.captureException(err, { context: "post_save" });
        setResult(savedResult);
        return;
      }
      if (stage === "upload") {
        analytics.track("image_upload_failed", { ext, bytes: byteCount, source, error: String(err) });
      } else {
        const status = err instanceof ApiError ? err.status : null;
        analytics.track("score_parse_failed", {
          stage: networkFailed ? "network" : stage,
          status,
          error: String(err),
        });
        // Neither an HTTP nor a network failure (e.g. a bad JSON body or a
        // bug): also send the stack trace. 5xx are captured in apiRequest.
        if (status === null && !networkFailed) {
          analytics.captureException(err, { context: "analyze_image", stage });
        }
      }
      setResult({ teamScore: 0, gameName: "Unknown", players: [], error: "Failed to analyze image. Please try again." });
    } finally {
      if (cancelAnalysisRef.current === cancel) cancelAnalysisRef.current = null;
      if (!canceled) setLoading(false);
    }
  };

  const updatePlayerName = async (color: string, name: string) => {
    const previous = playerNames[color];
    const updated = { ...playerNames, [color]: name || undefined } as Record<string, string>;
    if (!name) delete updated[color];
    setPlayerNames(updated);
    if (savedId) {
      try {
        await apiRequest("PATCH", `/api/scores/${savedId}/player-names`, {
          playerNames: Object.keys(updated).length > 0 ? updated : null,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
        analytics.track("player_names_updated", { location: "upload", score_id: savedId, color });
      } catch (err) {
        // Revert this color's label (unless it was edited again meanwhile).
        setPlayerNames((current) => {
          if (current[color] !== updated[color]) return current;
          const reverted = { ...current };
          if (previous) reverted[color] = previous;
          else delete reverted[color];
          return reverted;
        });
        showToast(NAME_SAVE_ERROR_MESSAGE, { type: "error" });
        const status = err instanceof ApiError ? err.status : null;
        analytics.track("player_names_update_failed", { location: "upload", score_id: savedId, status });
        // HTTP errors are covered by api_request_failed; send the stack trace
        // only for non-HTTP ones (network or unexpected).
        if (status === null) {
          analytics.captureException(err, { context: "player_names_update", location: "upload", score_id: savedId });
        }
      }
    }
  };

  // Shared props for score_kept / score_discarded.
  const outcomeProps = () => ({
    score_id: savedId,
    had_warning: !!result?.warning,
    names_edited_count: Object.keys(playerNames).length,
    date_edited: dateEditedRef.current,
  });

  // X / Discard. Mid-analysis: cancels it. With a saved score: deletes it,
  // keeping the screen open (spinner) until the DELETE settles; on failure it
  // shows an inline error so the user can retry, or keep it with Done.
  const handleDiscard = async () => {
    if (cancelAnalysisRef.current) {
      cancelAnalysisRef.current();
      router.back();
      return;
    }
    if (savedId) {
      if (discardingRef.current) return;
      discardingRef.current = true;
      setDiscarding(true);
      setDiscardError(null);
      try {
        await apiRequest("DELETE", `/api/scores/${savedId}`);
      } catch (err) {
        // A 404 counts as success: the score is already gone.
        if (!(err instanceof ApiError && err.status === 404)) {
          analytics.track("score_discard_failed", {
            score_id: savedId,
            status: err instanceof ApiError ? err.status : null,
            error: err instanceof Error ? err.message : String(err),
          });
          setDiscardError(DISCARD_ERROR_MESSAGE);
          setDiscarding(false);
          discardingRef.current = false;
          // The error sits by the Discard button; X is at the top.
          scrollRef.current?.scrollToEnd({ animated: true });
          return;
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
      analytics.track("score_discarded", outcomeProps());
    }
    router.back();
  };

  const handleDone = () => {
    if (discardingRef.current) return;
    analytics.track("score_kept", outcomeProps());
    router.back();
  };

  const cancelDuplicate = () => {
    analytics.track("duplicate_upload_canceled");
    setShowDuplicateWarning(false);
    router.back();
  };

  const confirmDuplicate = () => {
    analytics.track("duplicate_upload_confirmed");
    analyzeImage(uri!, photoDate, fileName, { duplicateOverridden: true });
  };

  // Date editing helpers
  const openDateEditor = () => {
    analytics.track("played_date_edit_started");
    const d = new Date(playedDate);
    setEditDate(d);
    setWebDateStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setWebTimeStr(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setDateError(null);
    setEditingDate(true);
  };

  const closeDateEditor = () => {
    if (savingDateRef.current) return;
    setDateError(null);
    setEditingDate(false);
  };

  const saveDateEdit = async () => {
    if (savingDateRef.current) return;
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
    const iso = finalDate.toISOString();

    // Score already auto-saved: persist the edit. The modal stays open (spinner)
    // until the request settles; on failure it shows an inline error and the
    // previous date is kept so the user can retry or cancel.
    if (savedId) {
      savingDateRef.current = true;
      setSavingDate(true);
      setDateError(null);
      try {
        await apiRequest("PATCH", `/api/scores/${savedId}/played-date`, { playedDate: iso });
      } catch (err) {
        analytics.track("played_date_change_failed", {
          location: "upload",
          score_id: savedId,
          error: err instanceof Error ? err.message : String(err),
        });
        setDateError(DATE_SAVE_ERROR_MESSAGE);
        return;
      } finally {
        savingDateRef.current = false;
        setSavingDate(false);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/scores"] });
    }

    // No savedId means the auto-save failed; the edit stays local-only.
    const deltaMinutes = Math.round((finalDate.getTime() - new Date(playedDate).getTime()) / 60000);
    setPlayedDate(iso);
    setEditingDate(false);
    dateEditedRef.current = true;
    analytics.track("played_date_changed", { location: "upload", score_id: savedId, delta_minutes: deltaMinutes });
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
          disabled={discarding}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }, discarding && { opacity: 0.5 }]}
        >
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {loading ? "Analyzing…" : result?.error ? "Parse Error" : "Score Result"}
        </Text>
        {!loading && result && !result.error ? (
          <Pressable
            onPress={handleDone}
            disabled={discarding}
            style={({ pressed }) => [
              styles.doneBtn,
              { backgroundColor: colors.accentDim },
              pressed && { opacity: 0.7 },
              discarding && { opacity: 0.5 },
            ]}
          >
            <Text style={[styles.doneBtnText, { color: colors.accent }]}>Done</Text>
          </Pressable>
        ) : (
          <View style={{ width: 64 }} />
        )}
      </View>

      {/* Duplicate warning */}
      <Modal visible={showDuplicateWarning} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={cancelDuplicate}>
          <Pressable style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="warning-outline" size={32} color="#FFD700" style={{ alignSelf: "center" }} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>Possible Duplicate</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              A score from around the same time already exists. Upload anyway?
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                onPress={cancelDuplicate}
                style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceLight }, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmDuplicate}
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
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[styles.resultContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {result.error ? (
            <Animated.View entering={Platform.OS !== "web" ? FadeIn : undefined} style={[styles.errorCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>{result.error}</Text>
              <Pressable
                onPress={() => { analytics.track("parse_error_dismissed"); router.back(); }}
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

              {/* Discard button (hidden if the saved score's id is unknown — nothing to delete) */}
              {savedId ? (
                <>
                  {discardError ? (
                    <View style={styles.modalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                      <Ionicons name="alert-circle" size={16} color={colors.danger} />
                      <Text style={[styles.modalErrorText, { color: colors.danger }]}>{discardError}</Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={handleDiscard}
                    disabled={discarding}
                    accessibilityState={{ busy: discarding, disabled: discarding }}
                    style={({ pressed }) => [
                      styles.discardBtn,
                      { borderColor: colors.danger },
                      pressed && { opacity: 0.7 },
                      discarding && { opacity: 0.8 },
                    ]}
                  >
                    {discarding ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    )}
                    <Text style={[styles.discardText, { color: colors.danger }]}>
                      {discarding ? "Discarding…" : "Discard This Score"}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      {/* Date editor modal */}
      <Modal visible={editingDate} transparent animationType="fade" onRequestClose={closeDateEditor}>
        <Pressable style={styles.modalOverlay} onPress={closeDateEditor} disabled={savingDate}>
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

            {dateError ? (
              <View style={styles.modalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={[styles.modalErrorText, { color: colors.danger }]}>{dateError}</Text>
              </View>
            ) : null}

            <View style={styles.modalBtns}>
              <Pressable
                onPress={closeDateEditor}
                disabled={savingDate}
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  { backgroundColor: colors.surfaceLight },
                  pressed && { opacity: 0.7 },
                  savingDate && { opacity: 0.5 },
                ]}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveDateEdit}
                disabled={savingDate}
                accessibilityState={{ busy: savingDate, disabled: savingDate }}
                style={({ pressed }) => [
                  styles.modalConfirmBtn,
                  { backgroundColor: colors.accent },
                  pressed && { opacity: 0.7 },
                  savingDate && { opacity: 0.8 },
                ]}
              >
                {savingDate ? <ActivityIndicator size="small" color={colors.background} /> : null}
                <Text style={[styles.modalConfirmText, { color: colors.background }]}>{savingDate ? "Saving…" : "Save"}</Text>
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
