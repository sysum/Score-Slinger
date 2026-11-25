import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { analytics } from "@/lib/analytics";
import {
  checkForUpdate,
  setVersionCheckPathname,
  setVersionCheckSignedIn,
  startVersionCheck,
} from "@/lib/version-check";
import AuthScreen from "@/components/AuthScreen";
import type { Session } from "@supabase/supabase-js";
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";

SplashScreen.preventAutoHideAsync();

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} />;
}

// ─── Display name setup screen ────────────────────────────────────────────────

function DisplayNameSetup({ onSave }: { onSave: (name: string) => void }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");

  // Rendered above the Stack (no pathname), so track the screen manually.
  useEffect(() => {
    analytics.screen("display_name_setup");
  }, []);

  const handleSave = () => {
    const trimmed = input.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <View style={[setupStyles.container, { backgroundColor: colors.background, paddingTop: insets.top + 20 }]}>
      <View style={setupStyles.inner}>
        <View style={[setupStyles.iconCircle, { backgroundColor: colors.accentDim, borderColor: colors.accentBorder }]}>
          <Ionicons name="person-outline" size={44} color={colors.accent} />
        </View>
        <Text style={[setupStyles.title, { color: colors.text }]}>What&apos;s your name?</Text>
        <Text style={[setupStyles.subtitle, { color: colors.textSecondary }]}>
          This will be shown with your uploaded scores
        </Text>
        <TextInput
          style={[setupStyles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
          value={input}
          onChangeText={setInput}
          placeholder="Enter your display name"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />
        <Pressable
          onPress={handleSave}
          disabled={!input.trim()}
          style={({ pressed }) => [
            setupStyles.button,
            pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
            !input.trim() && { opacity: 0.4 },
          ]}
        >
          <LinearGradient
            colors={[colors.accent, isDark ? "#00C4B0" : "#009E8E"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={[setupStyles.buttonText, { color: colors.background }]}>Let&apos;s Go</Text>
        </Pressable>
      </View>
    </View>
  );
}

const setupStyles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingBottom: 40,
    gap: 16,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
  },
  input: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
    marginTop: 8,
  },
  button: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "DMSans_600SemiBold",
  },
});

// ─── Auth gate ────────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [displayNameLoaded, setDisplayNameLoaded] = useState(false);
  // User already identified to PostHog in this app run. The listener also
  // fires on TOKEN_REFRESHED, USER_UPDATED, web tab refocus, etc.
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    // onAuthStateChange emits INITIAL_SESSION on subscribe, so a separate
    // getSession() call isn't needed (it caused a duplicate identify).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setVersionCheckSignedIn(!!session);
      // supabase-js doesn't surface refresh errors: a failed refresh (e.g. a
      // stale bundle's disabled legacy key) just emits SIGNED_OUT. Check for a
      // newer deploy right away; the auth screen is always safe to reload.
      if (event === "SIGNED_OUT") void checkForUpdate({ force: true });
      const user = session?.user;
      if (!user) {
        // Also covers session expiry and sign-out from another tab. Profile's
        // sign-out resets first; a second reset is harmless.
        if (event === "SIGNED_OUT" && identifiedUserId.current) analytics.reset();
        identifiedUserId.current = null;
        return;
      }
      if (identifiedUserId.current === user.id) return;
      identifiedUserId.current = user.id;
      // Not keyed on event === "SIGNED_IN": Supabase also emits SIGNED_IN when
      // it restores a stored session (and on every web tab refocus), and the
      // web magic-link SIGNED_IN can fire before this listener subscribes.
      // A new PostHog identity (anonymous → user) is the reliable signal.
      analytics
        .identifyUser({
          id: user.id,
          email: user.email,
          displayName: user.user_metadata?.display_name as string | undefined,
        })
        .then((isNewIdentity) => {
          if (isNewIdentity) {
            analytics.track("signed_in", { method: "magic_link", platform: Platform.OS });
          }
        });
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle magic link deep links on native
  useEffect(() => {
    const sub = Linking.addEventListener("url", async ({ url }) => {
      if (url.includes("code=")) {
        await supabase.auth.exchangeCodeForSession(url);
      }
    });
    Linking.getInitialURL().then(async (url) => {
      if (url?.includes("code=")) {
        await supabase.auth.exchangeCodeForSession(url);
      }
    });
    return () => sub.remove();
  }, []);

  // Load display name
  useEffect(() => {
    const load = async () => {
      try {
        const local = await AsyncStorage.getItem("display_name");
        if (local) {
          setDisplayName(local);
        } else {
          const { data: { session } } = await supabase.auth.getSession();
          const metaName = session?.user?.user_metadata?.display_name as string | undefined;
          if (metaName) {
            setDisplayName(metaName);
            await AsyncStorage.setItem("display_name", metaName);
          }
        }
      } catch {}
      setDisplayNameLoaded(true);
    };
    load();
  }, []);

  const saveDisplayName = async (name: string) => {
    setDisplayName(name);
    await AsyncStorage.setItem("display_name", name);
    supabase.auth.updateUser({ data: { display_name: name } });
    analytics.setPersonProperties({ display_name: name });
    analytics.track("display_name_set");
  };

  if (session === undefined || !displayNameLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (session === null) {
    return <AuthScreen />;
  }

  if (!displayName) {
    return <DisplayNameSetup onSave={saveDisplayName} />;
  }

  return <>{children}</>;
}

// ─── Root layout ──────────────────────────────────────────────────────────────

// Screen names are the route path without its leading slash, with "/" →
// "history" and dynamic segments as their pattern ("score/[id]", with the id
// as a score_id prop). AuthScreen and DisplayNameSetup render outside the
// Stack and track themselves ("auth" / "display_name_setup").
function screenFromPathname(pathname: string): { name: string; props?: Record<string, string> } {
  if (pathname === "/") return { name: "history" };
  const score = pathname.match(/^\/score\/([^/]+)$/);
  if (score) return { name: "score/[id]", props: { score_id: score[1] } };
  return { name: pathname.replace(/^\//, "") };
}

function RootLayoutNav() {
  const pathname = usePathname();

  useEffect(() => {
    const { name, props } = screenFromPathname(pathname);
    analytics.screen(name, props);
    setVersionCheckPathname(pathname);
  }, [pathname]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="upload"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="score/[id]"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Web prod only: reload long-lived tabs onto a newer deploy (no-op elsewhere).
  useEffect(() => startVersionCheck(), []);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary
      onError={(error, componentStack) =>
        analytics.captureException(error, { component_stack: componentStack })
      }
    >
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <ThemedStatusBar />
              {/* Above the Stack so toasts survive navigation (e.g. detail → back). */}
              <ToastProvider>
                <AuthGate>
                  <RootLayoutNav />
                </AuthGate>
              </ToastProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
