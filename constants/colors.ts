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
  background: "#0A0E1A",
  surface: "#131829",
  surfaceLight: "#1C2240",
  card: "#161D35",
  cardBorder: "#232B4A",
  accent: "#00E5CC",
  accentDim: "rgba(0, 229, 204, 0.15)",
  accentBorder: "rgba(0, 229, 204, 0.3)",
  text: "#FFFFFF",
  textSecondary: "#8B93B0",
  textMuted: "#4A5278",
  danger: "#FF4D6A",
  success: "#00E5CC",
  playerColors: {
    blue: "#4D8AFF",
    red: "#FF4D6A",
    yellow: "#FFD84D",
    purple: "#A855F7",
  },
};

const LightColors: ThemeColors = {
  background: "#F2F4F8",
  surface: "#FFFFFF",
  surfaceLight: "#E8ECF2",
  card: "#FFFFFF",
  cardBorder: "#D5DAE6",
  accent: "#00B8A3",
  accentDim: "rgba(0, 184, 163, 0.1)",
  accentBorder: "rgba(0, 184, 163, 0.25)",
  text: "#1A1D2E",
  textSecondary: "#5A6178",
  textMuted: "#9BA3BD",
  danger: "#E8364E",
  success: "#00B8A3",
  playerColors: {
    blue: "#3A72E8",
    red: "#E8364E",
    yellow: "#D4A520",
    purple: "#8B3FD9",
  },
};

export { DarkColors, LightColors };

const Colors = DarkColors;
export default Colors;
