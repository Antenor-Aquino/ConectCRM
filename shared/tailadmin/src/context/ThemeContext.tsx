import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "conectcrm-theme";

// shared/tailadmin é consumido pela extension (com chrome.storage.local) E
// pela pwa (sem APIs de extensão) - lido via globalThis pra não depender
// dos tipos de @types/chrome, que só existem no workspace da extension.
interface ChromeLocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function getChromeLocalStorage(): ChromeLocalStorageArea | undefined {
  const globalChrome = (globalThis as { chrome?: { storage?: { local?: ChromeLocalStorageArea } } }).chrome;
  return globalChrome?.storage?.local;
}

async function loadStoredTheme(): Promise<Theme | null> {
  const local = getChromeLocalStorage();
  if (local) {
    const stored = await local.get(STORAGE_KEY);
    return (stored[STORAGE_KEY] as Theme | undefined) ?? null;
  }
  return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? null;
}

async function saveStoredTheme(theme: Theme): Promise<void> {
  const local = getChromeLocalStorage();
  if (local) {
    await local.set({ [STORAGE_KEY]: theme });
  } else {
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    void loadStoredTheme().then((stored) => {
      if (stored) setTheme(stored);
      setIsInitialized(true);
    });
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    void saveStoredTheme(theme);
  }, [theme, isInitialized]);

  function toggleTheme() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de um ThemeProvider");
  return ctx;
}
