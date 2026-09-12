import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";

const isTheme = (value: unknown): value is Theme =>
  value === "dark" || value === "light" || value === "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "ezyretire-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => {
      try {
        const item = localStorage.getItem(storageKey);
        const storedTheme: unknown = item ? JSON.parse(item) : defaultTheme;
        return isTheme(storedTheme) ? storedTheme : defaultTheme;
      } catch {
        return defaultTheme;
      }
    }
  );

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(
    () => theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme,
  );

  useEffect(() => {
    const root = window.document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      setResolvedTheme(resolvedTheme);
      root.classList.remove("light", "dark");
      root.classList.add(resolvedTheme);
      root.style.colorScheme = resolvedTheme;

      const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      const background = window.getComputedStyle(root).getPropertyValue("--background").trim();
      if (background) themeColor?.setAttribute("content", `hsl(${background})`);
    };
    applyTheme();
    if (theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  const value = {
    theme,
    resolvedTheme,
    setTheme: (theme: Theme) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(theme));
      } catch {}
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
