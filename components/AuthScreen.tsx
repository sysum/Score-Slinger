import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";

// ─── Auth method registry ─────────────────────────────────────────────────────
// To add a new sign-in method (e.g. email+password), create a new component
// following the same pattern as MagicLinkForm and add it here.
// ─────────────────────────────────────────────────────────────────────────────

type AuthMethod = "magic_link"; // | "email_password" | "google" etc.

export default function AuthScreen() {
  const { colors, isDark } = useTheme();
  const [activeMethod] = useState<AuthMethod>("magic_link");

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        {/* Logo / branding */}
        <View style={styles.logoArea}>
          <View
            style={[
              styles.logoCircle,
              { backgroundColor: colors.accentDim, borderColor: colors.accentBorder },
            ]}
          >
            <Ionicons name="trophy-outline" size={44} color={colors.accent} />
          </View>
          <Text style={[styles.appName, { color: colors.text }]}>Score Slinger</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Sign in to track your scores
          </Text>
        </View>

        {/* Active auth method form */}
        {activeMethod === "magic_link" && <MagicLinkForm colors={colors} isDark={isDark} />}

        {/*
          Future auth methods go here, e.g.:
          {activeMethod === "email_password" && <EmailPasswordForm colors={colors} isDark={isDark} />}
        */}

        {/*
          Method switcher — uncomment and extend when adding additional methods:

          <View style={styles.methodSwitcher}>
            <Text style={[styles.switcherLabel, { color: colors.textMuted }]}>
              Or sign in with
            </Text>
            <Pressable onPress={() => setActiveMethod("email_password")}>
              <Text style={{ color: colors.accent }}>Email & Password</Text>
            </Pressable>
          </View>
        */}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Magic Link form ──────────────────────────────────────────────────────────

function MagicLinkForm({
  colors,
  isDark,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  isDark: boolean;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setError(null);

    // Redirect back to the app after clicking the magic link.
    // On native this opens the app via the scoreslinger:// deep link scheme.
    // On web it redirects back to the current origin.
    const redirectTo =
      Platform.OS === "web"
        ? window.location.origin
        : Linking.createURL("/");

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });

    setLoading(false);

    if (authError) {
      setError(authError.message);
    } else {
      setSent(true);
    }
  };

  if (sent) {
    return (
      <View style={styles.sentContainer}>
        <View
          style={[
            styles.sentIcon,
            { backgroundColor: colors.accentDim, borderColor: colors.accentBorder },
          ]}
        >
          <Ionicons name="mail-outline" size={32} color={colors.accent} />
        </View>
        <Text style={[styles.sentTitle, { color: colors.text }]}>Check your email</Text>
        <Text style={[styles.sentBody, { color: colors.textSecondary }]}>
          We sent a magic link to{" "}
          <Text style={{ color: colors.accent }}>{email.trim().toLowerCase()}</Text>.
          {"\n"}Tap the link to sign in.
        </Text>
        <Pressable onPress={() => { setSent(false); setEmail(""); }}>
          <Text style={[styles.resendLink, { color: colors.textMuted }]}>
            Wrong address? Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={[styles.formLabel, { color: colors.textSecondary }]}>Email address</Text>
      <TextInput
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.cardBorder,
          },
        ]}
        value={email}
        onChangeText={(t) => { setEmail(t); setError(null); }}
        placeholder="you@example.com"
        placeholderTextColor={colors.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        returnKeyType="send"
        onSubmitEditing={handleSend}
      />

      {error && (
        <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
      )}

      <Pressable
        onPress={handleSend}
        disabled={loading}
        style={({ pressed }) => [
          styles.button,
          pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
          loading && { opacity: 0.6 },
        ]}
      >
        <LinearGradient
          colors={[colors.accent, isDark ? "#00C4B0" : "#009E8E"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {loading ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.background }]}>
            Send Magic Link
          </Text>
        )}
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  logoArea: {
    alignItems: "center",
    marginBottom: 48,
    gap: 12,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  appName: {
    fontSize: 28,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
  },
  form: {
    gap: 8,
  },
  formLabel: {
    fontSize: 13,
    fontFamily: "DMSans_500Medium",
    marginBottom: 2,
  },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
  },
  errorText: {
    fontSize: 13,
    fontFamily: "DMSans_400Regular",
    marginTop: 2,
  },
  button: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginTop: 8,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "DMSans_600SemiBold",
  },
  sentContainer: {
    alignItems: "center",
    gap: 16,
  },
  sentIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  sentTitle: {
    fontSize: 22,
    fontFamily: "SpaceGrotesk_700Bold",
  },
  sentBody: {
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  resendLink: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    marginTop: 8,
    textDecorationLine: "underline",
  },
});
