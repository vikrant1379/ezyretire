# EzyRetire — Design System & Typography Specification

## 1. Overview

This document defines the complete visual design system for EzyRetire. Every font, size, weight, color, spacing, and number formatting rule is specified here. This is the single source of truth for how text and UI elements should look across the web app and mobile app.

## 2. Philosophy

EzyRetire is a financial application handling sensitive data (salary, expenses, investments, loans, retirement projections). The design system must achieve three goals simultaneously:

* **Trust:** Users are entering their most private financial details. The typography must feel solid, established, and reliable — like a bank, not a startup experiment.
* **Clarity:** Financial data is dense. Every number, label, and description must be instantly scannable without squinting or re-reading.
* **Warmth:** Retirement planning is emotionally loaded. The design must feel approachable and encouraging, not cold or intimidating.

## 3. Font Selection

### 3.1 Two-Font System

| Role | Font | Why this font |
|------|------|---------------|
| **Headings** | DM Serif Display | Elegant serif with a modern edge. Matches the luxury infinity logo. Conveys trust and heritage — "we've been managing wealth for decades." Used by premium financial publications. |
| **Everything else** | Inter | The most readable screen font ever designed. Optimized for UI at every size. Used by Vercel, GitHub, Linear, Stripe, and most top-tier SaaS products. Has true tabular figures for number alignment. |

### 3.2 Font Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### 3.3 Fallback Stack

```css
--font-heading: 'DM Serif Display', Georgia, 'Times New Roman', serif;
--font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

## 4. Type Scale — Desktop

| Element | Font | Size | Line Height | Letter Spacing | Weight | Use Case |
|---------|------|------|-------------|----------------|--------|----------|
| H1 | DM Serif Display | 32px | 40px (1.25) | -0.5px | Regular (400) | Page titles: "Retirement Projection", "Monthly Expenses" |
| H2 | Inter | 24px | 32px (1.33) | -0.3px | SemiBold (600) | Section titles: "Income Sources", "Loan Summary" |
| H3 | Inter | 20px | 28px (1.4) | -0.2px | SemiBold (600) | Card titles: "Salary Breakdown", "EPF Details" |
| H4 | Inter | 16px | 24px (1.5) | 0px | SemiBold (600) | Subsections: "Tax Deductions", "Old Regime" |
| Body | Inter | 14px | 22px (1.57) | 0px | Regular (400) | Paragraphs, descriptions, explanations |
| Body Small | Inter | 13px | 20px (1.54) | 0px | Regular (400) | Secondary info: "Updated 3 hours ago" |
| Label | Inter | 12px | 16px (1.33) | 0.5px UPPERCASE | Medium (500) | Form labels, table headers: "MONTHLY INCOME" |
| Caption | Inter | 12px | 18px (1.5) | 0px | Regular (400) | Help text, hints: "Enter CTC as per offer letter" |
| Overline | Inter | 11px | 16px (1.45) | 0.8px UPPERCASE | Medium (500) | Category tags, badges: "ESSENTIAL", "DISCRETIONARY" |
| Tiny | Inter | 10px | 14px (1.4) | 0px | Regular (400) | Timestamps, legal: "Last synced: 2 min ago" |

## 5. Type Scale — Mobile

| Element | Size | Line Height | Why Different From Desktop |
|---------|------|-------------|---------------------------|
| H1 | 28px | 36px | Less screen width — needs to be slightly smaller |
| H2 | 22px | 30px | Proportional reduction |
| H3 | 18px | 26px | Proportional reduction |
| H4 | 16px | 22px | Same as desktop — already at minimum for a heading |
| Body | 15px | 24px | Slightly LARGER than desktop — phone held further from eyes |
| Body Small | 13px | 20px | Same as desktop |
| Label | 12px | 16px | Same as desktop |
| Caption | 12px | 18px | Same as desktop |
| Overline | 11px | 16px | Same as desktop |
| Tiny | 11px | 16px | Larger than desktop 10px — Apple HIG recommends 11px minimum on mobile |

**Hard rules:**
* Never go below 11px on mobile
* Never go below 10px on desktop
* Body text on mobile must be at least 15px for comfortable thumb-distance reading

## 6. Font Weight Rules

| Weight | Value | When To Use | When NOT To Use |
|--------|-------|-------------|-----------------|
| Regular (400) | Normal | Body text, paragraphs, descriptions, captions | Headings, financial amounts, buttons |
| Medium (500) | Slightly bold | Labels, navigation items, table headers, secondary amounts, badges | Long body paragraphs |
| SemiBold (600) | Noticeably bold | H2–H4 headings, buttons, primary amounts, CTAs, input values | Long paragraphs — too heavy for reading |
| Bold (700) | Heavy | H1, hero numbers, dashboard KPI amounts, alerts, critical emphasis | Body text — makes everything look like a warning |
| Light (300) | Thin | NEVER in EzyRetire | Everything — light fonts feel fragile, the opposite of financial trust |
| ExtraLight (200) | Very thin | NEVER in EzyRetire | Everything |

**Rule: A finance app must feel solid. Every weight below Regular is banned.**

## 7. Financial Number Formatting

### 7.1 Tabular Figures (Critical)

All financial numbers must use tabular (monospaced) figures so columns align perfectly:

```css
.amount, .currency, [data-type="money"] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  font-family: var(--font-body);
}
```

Without tabular figures, amounts in tables and lists look misaligned. With tabular figures, every digit occupies the same width and columns snap into perfect alignment.

### 7.2 Amount Sizes by Context

| Context | Size | Weight | Example |
|---------|------|--------|---------|
| Dashboard hero number (retirement corpus) | 36px | Bold (700) | ₹3,24,56,789 |
| Card primary amount (monthly income, total expense) | 24px | SemiBold (600) | ₹1,50,000 |
| Card secondary amount (savings rate, percentage) | 18px | Medium (500) | ₹30,000 |
| Table cell amount | 14px | Medium (500) | ₹12,500 |
| Inline amount (within a sentence) | 14px | SemiBold (600) | "You spent ₹2,340 on food" |
| Change indicator (+/-) | 12px | SemiBold (600) | +₹5,000 ↑ or -₹3,200 ↓ |

### 7.3 Indian Number System

All amounts must use the Indian numbering system (lakhs and crores), not the international system:

| Amount | Correct (Indian) | Wrong (International) |
|--------|------------------|-----------------------|
| One lakh | ₹1,00,000 | ₹100,000 |
| Ten lakh | ₹10,00,000 | ₹1,000,000 |
| One crore | ₹1,00,00,000 | ₹10,000,000 |
| Three crore twenty-four lakh | ₹3,24,00,000 | ₹32,400,000 |

Implementation: use `Intl.NumberFormat('en-IN')` in JavaScript.

### 7.4 Decimal Rules

| Context | Decimals | Example |
|---------|----------|---------|
| Rupee amounts (display) | 0 decimals | ₹1,50,000 |
| Rupee amounts (transactions, precise) | 2 decimals | ₹1,50,000.50 |
| Percentages | 1 decimal | 12.5% |
| Interest rates | 2 decimals | 7.10% |
| Mutual fund NAV | 4 decimals | ₹45.6789 |
| Units (mutual fund) | 3 decimals | 123.456 units |

## 8. Text Colors

### 8.1 Light Mode

| Text Type | Hex | Opacity | Use Case |
|-----------|-----|---------|----------|
| Primary | #1a2b4a (navy) | 100% | Headings, amounts, important content |
| Secondary | #4a5568 | 87% | Body text, descriptions, paragraphs |
| Tertiary | #718096 | 60% | Captions, help text, timestamps, placeholders |
| Disabled | #a0aec0 | 38% | Inactive elements, disabled buttons |
| Positive | #38a169 (green) | 100% | Income, gains, on track, under budget |
| Negative | #e53e3e (red) | 100% | Expenses over budget, losses, gap warnings |
| Warning | #d69e2e (amber) | 100% | Approaching limit, needs attention |
| Accent | #c5a55a (gold) | 100% | Links, interactive elements, CTAs, brand highlights |

### 8.2 Dark Mode

| Text Type | Hex | Use Case |
|-----------|-----|----------|
| Primary | #ffffff | Headings, amounts |
| Secondary | #a0aec0 | Body text, descriptions |
| Tertiary | #718096 | Captions, timestamps |
| Disabled | #4a5568 | Inactive elements |
| Positive | #68d391 | Gains, income |
| Negative | #fc8181 | Losses, overspend |
| Warning | #f6e05e | Approaching limit |
| Accent | #c5a55a (gold) | Links, brand highlights |

### 8.3 Background Colors

| Surface | Light Mode | Dark Mode |
|---------|-----------|-----------|
| Page background | #f7fafc | #0d1b2a |
| Card background | #ffffff | #1a2b4a |
| Card hover | #f7fafc | #243552 |
| Input field background | #ffffff | #0d1b2a |
| Input field border | #e2e8f0 | #2d3748 |
| Navbar | #ffffff | #0d1b2a |
| Sidebar | #f7fafc | #0f1f35 |
| Modal overlay | rgba(0,0,0,0.5) | rgba(0,0,0,0.7) |

## 9. Spacing System

### 9.1 Base Unit

All spacing uses a 4px base grid. Every margin, padding, and gap must be a multiple of 4:

```
4px   — tight (icon-to-text, badge padding)
8px   — compact (between related items)
12px  — default (label to input, list item gap)
16px  — comfortable (paragraph gap, card gap on mobile)
20px  — card padding on desktop
24px  — section heading to content, card padding generous
32px  — section to section on desktop
48px  — page sections, major visual breaks
64px  — navbar height on desktop
```

### 9.2 Margin Between Elements

| Between | Desktop | Mobile |
|---------|---------|--------|
| H1 → first content | 24px | 20px |
| H2 → content below | 16px | 14px |
| H3 → content below | 12px | 10px |
| Paragraph → paragraph | 16px | 14px |
| Label → input field | 6px | 6px |
| Input → next input (in a form) | 16px | 14px |
| Card → card | 16px | 12px |
| Section → section | 32px | 24px |
| Page top → H1 | 32px | 24px |

### 9.3 Padding Inside Elements

| Element | Desktop Padding | Mobile Padding |
|---------|----------------|----------------|
| Card | 20px all sides | 16px all sides |
| Button (primary) | 12px top/bottom, 24px left/right | 14px top/bottom, 20px left/right |
| Button (secondary) | 10px top/bottom, 20px left/right | 12px top/bottom, 16px left/right |
| Input field | 10px top/bottom, 14px left/right | 12px top/bottom, 14px left/right |
| Table cell | 10px top/bottom, 16px left/right | 8px top/bottom, 12px left/right |
| Badge / tag | 4px top/bottom, 10px left/right | 4px top/bottom, 8px left/right |
| Modal | 24px all sides | 20px all sides |
| Dropdown menu | 8px top/bottom, 0 left/right | 8px top/bottom, 0 left/right |
| Dropdown item | 10px top/bottom, 16px left/right | 12px top/bottom, 16px left/right |
| Navbar | 0 top/bottom, 24px left/right (height: 64px) | 0 top/bottom, 16px left/right (height: 56px) |
| Sidebar | 16px all sides | 12px all sides |
| Toast / snackbar | 12px top/bottom, 16px left/right | 12px top/bottom, 16px left/right |

## 10. Component-Specific Typography

### 10.1 Navigation Bar

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Logo text ("EzyRetire") | DM Serif Display | 20px | Regular | Navy / White |
| Nav items | Inter | 14px | Medium (500) | Secondary |
| Active nav item | Inter | 14px | SemiBold (600) | Primary + gold underline |

### 10.2 Dashboard Cards

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Card title | Inter | 13px | Medium (500) UPPERCASE | Tertiary |
| Primary amount | Inter | 24px | SemiBold (600) | Primary |
| Secondary amount | Inter | 14px | Medium (500) | Secondary |
| Change badge | Inter | 12px | SemiBold (600) | Green or Red |
| Card footer link | Inter | 12px | Medium (500) | Gold accent |

### 10.3 Forms

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Form section title | Inter | 16px | SemiBold (600) | Primary |
| Field label | Inter | 12px | Medium (500) UPPERCASE | Tertiary |
| Input value | Inter | 14px | Regular (400) | Primary |
| Placeholder | Inter | 14px | Regular (400) | Disabled |
| Helper text | Inter | 12px | Regular (400) | Tertiary |
| Error message | Inter | 12px | Medium (500) | Red |
| Required asterisk | Inter | 12px | Bold (700) | Red |

### 10.4 Tables (Expense List, Investment Holdings, Loan Amortisation)

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Table header | Inter | 12px | Medium (500) UPPERCASE | Tertiary |
| Table cell (text) | Inter | 14px | Regular (400) | Secondary |
| Table cell (amount) | Inter | 14px | Medium (500) | Primary |
| Table cell (positive) | Inter | 14px | Medium (500) | Green |
| Table cell (negative) | Inter | 14px | Medium (500) | Red |
| Table footer (totals) | Inter | 14px | SemiBold (600) | Primary |
| Empty state message | Inter | 14px | Regular (400) | Tertiary |

### 10.5 Charts and Graphs

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Chart title | Inter | 16px | SemiBold (600) | Primary |
| Axis labels | Inter | 11px | Regular (400) | Tertiary |
| Data labels | Inter | 12px | Medium (500) | Primary |
| Legend text | Inter | 12px | Regular (400) | Secondary |
| Tooltip title | Inter | 13px | SemiBold (600) | White (on dark bg) |
| Tooltip value | Inter | 14px | Bold (700) | White (on dark bg) |

### 10.6 Buttons

| Type | Font | Size | Weight | Letter Spacing | Text Transform |
|------|------|------|--------|----------------|---------------|
| Primary (filled) | Inter | 14px | SemiBold (600) | 0.2px | None |
| Secondary (outlined) | Inter | 14px | Medium (500) | 0.2px | None |
| Tertiary (ghost/text) | Inter | 14px | Medium (500) | 0px | None |
| Small button | Inter | 12px | Medium (500) | 0.2px | None |
| Large button | Inter | 16px | SemiBold (600) | 0.2px | None |
| Icon button | — | — | — | — | No text |

### 10.7 Alerts, Toasts, and Banners

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Alert title | Inter | 14px | SemiBold (600) | Primary |
| Alert body | Inter | 13px | Regular (400) | Secondary |
| Toast message | Inter | 13px | Medium (500) | White |
| Banner text | Inter | 13px | Medium (500) | Primary |
| Banner CTA link | Inter | 13px | SemiBold (600) | Gold accent |

### 10.8 Retirement Projection Section

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Retirement date headline | DM Serif Display | 28px | Regular | Primary |
| Corpus amount | Inter | 36px | Bold (700) | Primary |
| "Required" vs "Projected" labels | Inter | 12px | Medium (500) UPPERCASE | Tertiary |
| Gap amount | Inter | 24px | Bold (700) | Red (gap) or Green (surplus) |
| "Extra SIP needed" amount | Inter | 20px | SemiBold (600) | Gold accent |
| Scenario slider labels | Inter | 12px | Regular (400) | Tertiary |
| Scenario result | Inter | 16px | SemiBold (600) | Primary |
| Lifetime cost badge | Inter | 14px | SemiBold (600) | Red background, white text |

## 11. Brand Colors — Complete Palette

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Navy (Primary) | #1a2b4a | 26, 43, 74 | Primary text, headings, left infinity loop |
| Dark Navy | #0d1b2a | 13, 27, 42 | Dark mode background, splash screen |
| Mid Navy | #243552 | 36, 53, 82 | Dark mode card backgrounds, hover states |
| Rich Gold | #c5a55a | 197, 165, 90 | Accent, right infinity loop, CTAs, links |
| Light Gold | #d4b96a | 212, 185, 106 | Hover state for gold elements |
| Pale Gold | #f5ecd7 | 245, 236, 215 | Gold tinted backgrounds, highlights |
| Green (Positive) | #38a169 | 56, 161, 105 | Income, gains, on track |
| Green Light | #c6f6d5 | 198, 246, 213 | Positive background tint |
| Red (Negative) | #e53e3e | 229, 62, 62 | Overspend, losses, warnings |
| Red Light | #fed7d7 | 254, 215, 215 | Negative background tint |
| Amber (Warning) | #d69e2e | 214, 158, 46 | Approaching limits |
| Amber Light | #fefcbf | 254, 252, 191 | Warning background tint |
| Gray 50 | #f7fafc | 247, 250, 252 | Page background (light) |
| Gray 100 | #edf2f7 | 237, 242, 247 | Subtle backgrounds |
| Gray 200 | #e2e8f0 | 226, 232, 240 | Borders, dividers |
| Gray 300 | #cbd5e0 | 203, 213, 224 | Disabled borders |
| Gray 500 | #718096 | 113, 128, 150 | Tertiary text |
| Gray 600 | #4a5568 | 74, 85, 104 | Secondary text |
| Gray 800 | #2d3748 | 45, 55, 72 | Dark mode borders |
| White | #ffffff | 255, 255, 255 | Backgrounds, dark mode text |

## 12. CSS Variables — Complete Implementation

```css
:root {
  /* ---- Fonts ---- */
  --font-heading: 'DM Serif Display', Georgia, 'Times New Roman', serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* ---- Desktop Type Scale ---- */
  --text-h1: 32px;
  --text-h2: 24px;
  --text-h3: 20px;
  --text-h4: 16px;
  --text-body: 14px;
  --text-body-small: 13px;
  --text-label: 12px;
  --text-caption: 12px;
  --text-overline: 11px;
  --text-tiny: 10px;

  /* ---- Financial Number Sizes ---- */
  --text-hero: 36px;
  --text-amount-lg: 24px;
  --text-amount-md: 18px;
  --text-amount-sm: 14px;
  --text-amount-change: 12px;

  /* ---- Line Heights ---- */
  --leading-h1: 40px;
  --leading-h2: 32px;
  --leading-h3: 28px;
  --leading-h4: 24px;
  --leading-body: 22px;
  --leading-small: 20px;
  --leading-label: 16px;
  --leading-caption: 18px;

  /* ---- Brand Colors ---- */
  --color-navy: #1a2b4a;
  --color-navy-dark: #0d1b2a;
  --color-navy-mid: #243552;
  --color-gold: #c5a55a;
  --color-gold-light: #d4b96a;
  --color-gold-pale: #f5ecd7;

  /* ---- Text Colors (Light Mode) ---- */
  --color-text-primary: #1a2b4a;
  --color-text-secondary: #4a5568;
  --color-text-tertiary: #718096;
  --color-text-disabled: #a0aec0;
  --color-text-accent: #c5a55a;

  /* ---- Semantic Colors ---- */
  --color-positive: #38a169;
  --color-positive-bg: #c6f6d5;
  --color-negative: #e53e3e;
  --color-negative-bg: #fed7d7;
  --color-warning: #d69e2e;
  --color-warning-bg: #fefcbf;

  /* ---- Surface Colors (Light Mode) ---- */
  --color-bg-page: #f7fafc;
  --color-bg-card: #ffffff;
  --color-bg-card-hover: #f7fafc;
  --color-bg-input: #ffffff;
  --color-border: #e2e8f0;
  --color-border-disabled: #cbd5e0;

  /* ---- Spacing ---- */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* ---- Border Radius ---- */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* ---- Shadows ---- */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1);
}

/* ---- Dark Mode Overrides ---- */
[data-theme="dark"], .dark {
  --color-text-primary: #ffffff;
  --color-text-secondary: #a0aec0;
  --color-text-tertiary: #718096;
  --color-text-disabled: #4a5568;
  --color-positive: #68d391;
  --color-negative: #fc8181;
  --color-warning: #f6e05e;
  --color-bg-page: #0d1b2a;
  --color-bg-card: #1a2b4a;
  --color-bg-card-hover: #243552;
  --color-bg-input: #0d1b2a;
  --color-border: #2d3748;
}

/* ---- Tabular Figures for Financial Numbers ---- */
.amount, .currency, [data-type="money"] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  font-family: var(--font-body);
}
```

## 13. Tailwind CSS Configuration

```js
// tailwind.config.js
module.exports = {
  theme: {
    fontFamily: {
      heading: ['DM Serif Display', 'Georgia', 'serif'],
      body: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
    },
    fontSize: {
      'h1':      ['32px', { lineHeight: '40px', letterSpacing: '-0.5px' }],
      'h2':      ['24px', { lineHeight: '32px', letterSpacing: '-0.3px' }],
      'h3':      ['20px', { lineHeight: '28px', letterSpacing: '-0.2px' }],
      'h4':      ['16px', { lineHeight: '24px' }],
      'body':    ['14px', { lineHeight: '22px' }],
      'small':   ['13px', { lineHeight: '20px' }],
      'label':   ['12px', { lineHeight: '16px', letterSpacing: '0.5px' }],
      'caption': ['12px', { lineHeight: '18px' }],
      'overline':['11px', { lineHeight: '16px', letterSpacing: '0.8px' }],
      'tiny':    ['10px', { lineHeight: '14px' }],
      'hero':    ['36px', { lineHeight: '44px', letterSpacing: '-1px' }],
      'amt-lg':  ['24px', { lineHeight: '32px', letterSpacing: '-0.3px' }],
      'amt-md':  ['18px', { lineHeight: '26px' }],
      'amt-sm':  ['14px', { lineHeight: '20px' }],
    },
    extend: {
      colors: {
        navy:      { DEFAULT: '#1a2b4a', dark: '#0d1b2a', mid: '#243552' },
        gold:      { DEFAULT: '#c5a55a', light: '#d4b96a', pale: '#f5ecd7' },
        positive:  { DEFAULT: '#38a169', bg: '#c6f6d5' },
        negative:  { DEFAULT: '#e53e3e', bg: '#fed7d7' },
        warning:   { DEFAULT: '#d69e2e', bg: '#fefcbf' },
      },
      spacing: {
        '1': '4px', '2': '8px', '3': '12px', '4': '16px',
        '5': '20px', '6': '24px', '8': '32px', '12': '48px', '16': '64px',
      },
      borderRadius: {
        sm: '4px', md: '8px', lg: '12px', xl: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px rgba(0, 0, 0, 0.07)',
        lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
        xl: '0 20px 25px rgba(0, 0, 0, 0.1)',
      },
    },
  },
}
```

## 14. Responsive Breakpoints

| Name | Min Width | Target |
|------|-----------|--------|
| Mobile | 0px | Phones (portrait) |
| Mobile Large | 480px | Phones (landscape), small tablets |
| Tablet | 768px | Tablets (portrait), small laptops |
| Desktop | 1024px | Laptops, desktops |
| Wide | 1280px | Large desktops, wide monitors |

```css
/* Mobile first — default styles are for mobile */
@media (min-width: 480px)  { /* Mobile Large */ }
@media (min-width: 768px)  { /* Tablet */ }
@media (min-width: 1024px) { /* Desktop */ }
@media (min-width: 1280px) { /* Wide */ }
```

## 15. Accessibility Requirements

| Rule | Minimum | EzyRetire Target |
|------|---------|-----------------|
| Color contrast (text on background) | 4.5:1 (AA) | 7:1 (AAA) for all financial data |
| Color contrast (large text > 18px) | 3:1 (AA) | 4.5:1 (AAA) |
| Touch target size (mobile) | 44×44px (Apple HIG) | 48×48px |
| Focus indicator | Visible on all interactive elements | 2px gold outline with 2px offset |
| Font size (user override) | Must support browser zoom to 200% | Tested at 200% without layout breaks |
| Color-only indicators | Never rely solely on color | Always pair with icon or text (↑↓ for positive/negative) |

## 16. Quick Reference Card

```
HEADINGS:     DM Serif Display — elegant, trustworthy
EVERYTHING:   Inter — clean, readable, professional

H1:  32px  Regular(400)   -0.5px   DM Serif   (page titles)
H2:  24px  SemiBold(600)  -0.3px   Inter       (sections)
H3:  20px  SemiBold(600)  -0.2px   Inter       (cards)
H4:  16px  SemiBold(600)   0px     Inter       (subsections)

Body:    14px  Regular(400)                     (descriptions)
Label:   12px  Medium(500)   CAPS               (form labels)
Caption: 12px  Regular(400)                     (help text)
Tiny:    10px  Regular(400)                     (timestamps)

Hero amount:  36px  Bold(700)                   (retirement corpus)
Card amount:  24px  SemiBold(600)               (monthly income)
Table amount: 14px  Medium(500)                 (individual items)

NEVER:  Light/Thin weights, below 10px desktop, below 11px mobile
ALWAYS: tabular-nums on money columns, Indian number system
```
