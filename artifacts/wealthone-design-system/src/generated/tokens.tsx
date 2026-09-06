/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#fcfaf8",
      "foreground": "#131c39",
      "border": "#ebe7e0",
      "card": "#ffffff",
      "cardForeground": "#131c39",
      "popover": "#ffffff",
      "popoverForeground": "#131c39",
      "primary": "#12286d",
      "primaryForeground": "#fcfaf8",
      "secondary": "#f8ab30",
      "secondaryForeground": "#131c39",
      "muted": "#efece7",
      "mutedForeground": "#626a84",
      "accent": "#efece7",
      "accentForeground": "#131c39",
      "destructive": "#ef4343",
      "destructiveForeground": "#ffffff",
      "input": "#ebe7e0",
      "ring": "#12286d",
      "chart1": "#12286d",
      "chart2": "#f8ab30",
      "chart3": "#6684e5",
      "chart4": "#626a84",
      "chart5": "#ef4343",
      "sidebar": "#fcfaf8",
      "sidebarForeground": "#131c39",
      "sidebarBorder": "#ebe7e0",
      "sidebarPrimary": "#12286d",
      "sidebarPrimaryForeground": "#fcfaf8",
      "sidebarAccent": "#efece7",
      "sidebarAccentForeground": "#131c39",
      "sidebarRing": "#12286d"
    },
    "dark": {
      "background": "#0d1326",
      "foreground": "#fcfaf8",
      "border": "#242b42",
      "card": "#12182b",
      "cardForeground": "#fcfaf8",
      "popover": "#12182b",
      "popoverForeground": "#fcfaf8",
      "primary": "#6684e5",
      "primaryForeground": "#0d1326",
      "secondary": "#f8ab30",
      "secondaryForeground": "#0d1326",
      "muted": "#242b42",
      "mutedForeground": "#a3aac2",
      "accent": "#242b42",
      "accentForeground": "#fcfaf8",
      "destructive": "#d92626",
      "destructiveForeground": "#ffffff",
      "input": "#242b42",
      "ring": "#6684e5",
      "chart1": "#6684e5",
      "chart2": "#f8ab30",
      "chart3": "#a3aac2",
      "chart4": "#ef4343",
      "chart5": "#fcfaf8",
      "sidebar": "#12182b",
      "sidebarForeground": "#fcfaf8",
      "sidebarBorder": "#242b42",
      "sidebarPrimary": "#6684e5",
      "sidebarPrimaryForeground": "#0d1326",
      "sidebarAccent": "#242b42",
      "sidebarAccentForeground": "#fcfaf8",
      "sidebarRing": "#6684e5"
    }
  },
  "fontFamily": {
    "sans": [
      "Plus Jakarta Sans",
      "sans-serif"
    ],
    "serif": [
      "Fraunces",
      "serif"
    ],
    "mono": [
      "Menlo",
      "monospace"
    ]
  },
  "radius": "0.75rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
