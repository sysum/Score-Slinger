import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import Toast, { type ToastData, type ToastType } from "@/components/Toast";

// ─── App-level toast ──────────────────────────────────────────────────────────
//
// Mounted once near the root (app/_layout.tsx) so a toast survives navigation,
// e.g. Score Detail → router.back() → toast still visible on History.
// One toast at a time; a new toast replaces the current one.

interface ToastOptions {
  type?: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, type: options?.type ?? "success" });
    // iOS VoiceOver ignores live regions; announce explicitly.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const hideToast = useCallback((id: number) => {
    setToast((current) => (current?.id === id ? null : current));
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast toast={toast} onHide={hideToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
