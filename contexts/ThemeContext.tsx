import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DarkColors, LightColors, ThemeColors } from "@/constants/colors";

export type AppearanceMode = "dark" | "light" | "system";

interface ThemeContextValue {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>("dark");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("appearance_mode").then((saved) => {
      if (saved === "dark" || saved === "light" || saved === "system") {
        setModeState(saved);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setMode = (newMode: AppearanceMode) => {
    setModeState(newMode);
    AsyncStorage.setItem("appearance_mode", newMode).catch(() => {});
  };

  const isDark = mode === "dark" || (mode === "system" && systemScheme !== "light");

  const colors = isDark ? DarkColors : LightColors;

  const value = useMemo(() => ({
    mode,
    setMode,
    colors,
    isDark,
  }), [mode, colors, isDark]);

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
