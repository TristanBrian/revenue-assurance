"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readStoredTheme(): ThemeMode {
  const saved = window.localStorage.getItem("kpc_theme_mode");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Same hardcoded default on server and on the client's first render — the
  // real preference is read below, after mount, never during render. That
  // avoids a hydration mismatch (server can't read localStorage) without
  // going back to the setTimeout-raced version this replaced.
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const skipFirstApply = React.useRef(true);

  // Reconcile with the real stored preference once mounted. The blocking
  // inline script in layout.tsx already painted the correct .dark class
  // before hydration, so this only needs to sync React's own state — the
  // "apply theme" effect below skips its class mutation on this same first
  // run to avoid stomping what the script already got right.
  useEffect(() => {
    Promise.resolve().then(() => {
      const saved = readStoredTheme();
      setThemeState((current) => (current === saved ? current : saved));
    });
  }, []);

  // Apply theme to document element
  useEffect(() => {
    const root = window.document.documentElement;

    function applyTheme(mode: ThemeMode) {
      if (mode === "dark") {
        root.classList.add("dark");
      } else if (mode === "light") {
        root.classList.remove("dark");
      } else {
        // System preference
        const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (systemPrefersDark) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
      }
    }

    if (skipFirstApply.current) {
      skipFirstApply.current = false;
    } else {
      applyTheme(theme);
    }

    // Watch for OS theme changes if in system mode
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
      };

      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, [theme]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    localStorage.setItem("kpc_theme_mode", mode);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
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
