import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const artifactRoot = new URL("../../", import.meta.url);
const designSystemRoot = new URL("../wealthone-design-system/", artifactRoot);

async function collectTsxSources(directory: URL): Promise<Array<{ file: string; source: string }>> {
  const collected: Array<{ file: string; source: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryUrl = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory);
    if (entry.isDirectory()) {
      collected.push(...await collectTsxSources(entryUrl));
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      collected.push({ file: entryUrl.pathname, source: await readFile(entryUrl, "utf8") });
    }
  }
  return collected;
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test("dark colors remain crisp, layered, and readable from one token source", async () => {
  const tokenText = await readFile(new URL("tokens.json", designSystemRoot), "utf8");
  const tokens = JSON.parse(tokenText) as {
    color: {
      light: Record<string, { $value: string }>;
      dark: Record<string, { $value: string }>;
    };
    typography: {
      fontFamily: {
        sans: { $value: string[] };
        serif: { $value: string[] };
      };
    };
  };

  const light = Object.fromEntries(
    Object.entries(tokens.color.light).map(([name, token]) => [name, token.$value]),
  );
  const dark = Object.fromEntries(
    Object.entries(tokens.color.dark).map(([name, token]) => [name, token.$value]),
  );

  assert.notEqual(dark.background, "#000000");
  assert.notEqual(dark.foreground, "#ffffff");
  assert.ok(contrastRatio(dark.foreground, dark.background) >= 7);
  assert.ok(relativeLuminance(dark.foreground) >= 0.75);
  assert.ok(contrastRatio(dark.mutedForeground, dark.background) >= 4.5);
  assert.notEqual(dark.card, dark.background);
  assert.notEqual(dark.border, dark.card);
  assert.notEqual(dark.primary, dark.secondary);
  assert.ok(contrastRatio(dark.border, dark.background) >= 1.2);
  assert.ok(contrastRatio(dark.primary, dark.background) >= 4.5);
  assert.ok(contrastRatio(dark.primaryForeground, dark.primary) >= 4.5);
  for (const surface of ["card", "popover", "accent", "sidebar"]) {
    const foreground = surface === "accent"
      ? dark.accentForeground
      : dark[`${surface}Foreground`];
    assert.ok(
      contrastRatio(foreground, dark[surface]) >= 7,
      `${surface} text should remain comfortable and readable`,
    );
  }
  for (const status of ["positive", "negative", "warning"]) {
    assert.ok(
      contrastRatio(dark[status], dark.background) >= 4.5,
      `${status} should remain legible without relying on saturation`,
    );
  }
  for (const chart of ["chart1", "chart2", "chart3", "chart4", "chart5"]) {
    assert.ok(
      contrastRatio(dark[chart], dark.background) >= 4.5,
      `${chart} should remain distinguishable on the chart canvas`,
    );
  }
  for (const [mode, palette] of [["light", light], ["dark", dark]] as const) {
    assert.ok(
      contrastRatio(palette.primary, palette.background) >= 4.5,
      `${mode} primary text should remain readable on the page background`,
    );
    assert.ok(
      contrastRatio(palette.primaryForeground, palette.primary) >= 4.5,
      `${mode} primary action text should remain readable`,
    );
    assert.ok(
      contrastRatio(palette.secondaryForeground, palette.secondary) >= 4.5,
      `${mode} neutral secondary surface text should remain readable`,
    );
    assert.ok(
      contrastRatio(palette.destructiveForeground, palette.destructive) >= 4.5,
      `${mode} neutral confirmation text should remain readable`,
    );
    assert.equal(
      palette.destructive,
      palette.secondary,
      `${mode} generic destructive UI must stay neutral`,
    );
    assert.equal(
      palette.support,
      palette.primary,
      `${mode} support actions must use interaction blue rather than financial green`,
    );
    for (const status of ["positive", "negative", "warning"]) {
      assert.ok(
        contrastRatio(palette[status], palette[`${status}Background`]) >= 4.5,
        `${mode} ${status} text should remain readable on its tinted surface`,
      );
    }
  }
  assert.ok(dark.support);
  assert.ok(dark.supportHover);
  assert.ok(dark.supportForeground);
  assert.deepEqual(tokens.typography.fontFamily.serif.$value, tokens.typography.fontFamily.sans.$value);

  assert.deepEqual(light, {
    background: "#f6f7f8",
    foreground: "#172026",
    border: "#d9e0e4",
    card: "#ffffff",
    cardForeground: "#172026",
    popover: "#ffffff",
    popoverForeground: "#172026",
    primary: "#0b6f93",
    primaryForeground: "#ffffff",
    secondary: "#e9eef1",
    secondaryForeground: "#172026",
    muted: "#eef1f3",
    mutedForeground: "#5d6870",
    accent: "#e9eef1",
    accentForeground: "#172026",
    destructive: "#e9eef1",
    destructiveForeground: "#172026",
    positive: "#116b49",
    positiveBackground: "#e7f3ed",
    negative: "#b8323a",
    negativeBackground: "#f8e9ea",
    warning: "#99510e",
    warningBackground: "#faeedc",
    support: "#0b6f93",
    supportHover: "#085a77",
    supportForeground: "#ffffff",
    disabled: "#8b959b",
    surfaceHover: "#eef1f3",
    input: "#d9e0e4",
    ring: "#3b9fbe",
    chart1: "#116b49",
    chart2: "#b8323a",
    chart3: "#0b6f93",
    chart4: "#b56a22",
    chart5: "#477d83",
    sidebar: "#f6f7f8",
    sidebarForeground: "#172026",
    sidebarBorder: "#d9e0e4",
    sidebarPrimary: "#0b6f93",
    sidebarPrimaryForeground: "#ffffff",
    sidebarAccent: "#e9eef1",
    sidebarAccentForeground: "#172026",
    sidebarRing: "#3b9fbe",
  });
});

test("financial health keeps status presentation neutral", async () => {
  const source = await readFile(
    new URL("src/components/financial-health-summary.tsx", artifactRoot),
    "utf8",
  );

  assert.doesNotMatch(source, /(?:emerald|amber|rose|green|red|yellow)-\d/);
  assert.doesNotMatch(source, /(?:bg|border|ring|text)-(?:positive|negative)/);
  assert.match(source, /border-border\/60 bg-muted\/40 text-foreground/);
  assert.match(source, /text-warning/);
});

test("high-impact UI surfaces consume semantic colors instead of hex palettes", async () => {
  const files = [
    "src/App.tsx",
    "src/components/theme-provider.tsx",
    "src/components/whatsapp-support.tsx",
    "src/pages/advice.tsx",
    "src/pages/advisor.tsx",
    "src/pages/login.tsx",
    "src/pages/profile.tsx",
  ];
  const sources = await Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(new URL(file, artifactRoot), "utf8"),
    })),
  );

  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${file} bypasses color tokens`);
  }
});

test("financial green and red never become decorative surfaces", async () => {
  const sources = [
    ...await collectTsxSources(new URL("src/", artifactRoot)),
    ...await collectTsxSources(new URL("src/", designSystemRoot)),
  ];

  for (const { file, source } of sources) {
    assert.doesNotMatch(
      source,
      /(?:bg|border|ring|from|via|to)-(?:positive|positive-background|negative|negative-background)(?:\/|\s|['"])/,
      `${file} uses financial green or red as a decorative surface`,
    );
    assert.doesNotMatch(
      source,
      /(?:text|bg|border|ring|from|via|to)-(?:green|emerald|red|rose)-/,
      `${file} bypasses the semantic financial color tokens`,
    );
  }
});

test("shared actions keep blue, neutral, and destructive roles distinct", async () => {
  const [buttonSource, toastSource] = await Promise.all([
    readFile(new URL("src/components/ui/button.tsx", designSystemRoot), "utf8"),
    readFile(new URL("src/components/ui/toast.tsx", designSystemRoot), "utf8"),
  ]);

  assert.match(buttonSource, /default: 'border border-primary-border bg-primary text-primary-foreground'/);
  assert.match(buttonSource, /secondary: 'border border-secondary-border bg-secondary text-secondary-foreground'/);
  assert.match(buttonSource, /link: 'text-primary underline-offset-4 hover:underline'/);
  assert.doesNotMatch(buttonSource, /\btext-secondary(?:\/|\s|['"])/);
  assert.match(toastSource, /destructive:\s*\n\s*"destructive group border-border bg-card text-foreground"/);
  assert.match(toastSource, /group-\[\.destructive\]:text-foreground\/70/);
  assert.doesNotMatch(toastSource, /(?:text|bg|border|ring|ring-offset)-(?:red|rose)-/);
});

test("retirement tooltip keeps its supplemental lifestyle label readable", async () => {
  const source = await readFile(
    new URL("src/pages/retirement.tsx", artifactRoot),
    "utf8",
  );

  assert.match(
    source,
    /font-medium text-muted-foreground">Monthly Lifestyle/,
  );
  assert.doesNotMatch(source, /text-accent font-medium">Monthly Lifestyle/);
});

test("profile summary stays neutral and readable in both themes", async () => {
  const [source, tokenText] = await Promise.all([
    readFile(new URL("src/pages/profile.tsx", artifactRoot), "utf8"),
    readFile(new URL("tokens.json", designSystemRoot), "utf8"),
  ]);
  const tokens = JSON.parse(tokenText) as {
    color: {
      light: Record<string, { $value: string }>;
      dark: Record<string, { $value: string }>;
    };
  };

  assert.match(
    source,
    /data-testid="text-profile-display-name"[\s\S]*?\{displayName\}/,
  );
  assert.match(
    source,
    /className="text-2xl font-serif font-medium text-foreground"/,
  );
  assert.match(source, /from-muted via-secondary\/70 to-card/);
  assert.doesNotMatch(source, /profile-summary-gradient"[\s\S]*?from-primary/);
  assert.ok(
    contrastRatio(
      tokens.color.light.foreground.$value,
      tokens.color.light.card.$value,
    ) >= 4.5,
    "light-mode profile name should contrast with the neutral card surface",
  );
  assert.ok(
    contrastRatio(
      tokens.color.dark.foreground.$value,
      tokens.color.dark.card.$value,
    ) >= 4.5,
    "dark-mode profile name should contrast with the neutral card surface",
  );
});
