export type ThemeColors = {
  background: string;
  surface: string;
  surfaceLight: string;
  card: string;
  cardBorder: string;
  accent: string;
  accentDim: string;
  accentBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  danger: string;
  success: string;
  playerColors: {
    blue: string;
    red: string;
    yellow: string;
    purple: string;
  };
};

const DarkColors: ThemeColors = {
  background: "#0f0f0f",
  surface: "#1a1a1a",
  surfaceLight: "#242424",
  card: "#1a1a1a",
  cardBorder: "#2a2a2a",
  accent: "#00E5CC",
  accentDim: "rgba(0, 229, 204, 0.12)",
  accentBorder: "rgba(0, 229, 204, 0.25)",
  text: "#FFFFFF",
  textSecondary: "#a0a0a0",
  textMuted: "#505050",
  danger: "#ef4444",
  success: "#00E5CC",
  playerColors: {
    blue: "#3b82f6",
    red: "#ef4444",
    yellow: "#eab308",
    purple: "#a855f7",
  },
};

const LightColors: ThemeColors = {
  background: "#f5f5f5",
  surface: "#ffffff",
  surfaceLight: "#ebebeb",
  card: "#ffffff",
  cardBorder: "#e0e0e0",
  accent: "#00B8A3",
  accentDim: "rgba(0, 184, 163, 0.1)",
  accentBorder: "rgba(0, 184, 163, 0.25)",
  text: "#111111",
  textSecondary: "#555555",
  textMuted: "#999999",
  danger: "#dc2626",
  success: "#00B8A3",
  playerColors: {
    blue: "#2563eb",
    red: "#dc2626",
    yellow: "#ca8a04",
    purple: "#9333ea",
  },
};

export { DarkColors, LightColors };

const Colors = DarkColors;
export default Colors;
