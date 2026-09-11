# EzyRetire — Complete Feature Backlog & Task List

**Priority Legend:** P0 = Critical (fix now) · P1 = High (this sprint) · P2 = Medium (next sprint) · P3 = Low (future) · P4 = Wishlist

**⚠️ Golden Rule: Every change MUST be tested on both mobile and web. UI on neither platform should break due to any feature addition, bug fix, or styling change.**

**⚠️ Font Rule: Any font change requires a FULL visual regression across every screen on 3 devices (iPhone SE, Samsung Galaxy, Desktop 1920×1080) BEFORE merging. Font changes are never "safe" — a 1px size change can cascade into layout breaks, text overflow, button misalignment, and card height changes across the entire app. See Section 15 for the mandatory font change protocol.**

---

## 1. Critical Bugs (P0)

### 1.1 App crashes on certain data entry
* **Issue:** Due to some data entry combinations, the application stops loading properly
* **Root cause:** Missing null/undefined checks, unhandled edge cases in form inputs
* **Fix required:**
  * Add defensive checks on every form input (null, undefined, empty string, NaN, negative numbers, zero)
  * Add try-catch wrappers on every page render that depends on user data
  * If a section's data is corrupted or malformed, that section should show a fallback UI ("Something went wrong — tap to retry") instead of crashing the entire app
  * Add input validation before saving to database — reject values that would break calculations (e.g., negative salary, EMI greater than income, retirement age less than current age)
  * Add error boundaries around every major component (Dashboard, Income, Expenses, Investments, Loans, Retirement, Tax)
  * **Test scenario:** Enter extreme values in every field (0, -1, 999999999, empty, special characters) and confirm the app never crashes
* **Acceptance criteria:** No combination of user inputs should ever cause a blank screen or crash. Every page must render gracefully for all data states (empty, partial, complete, corrupted).
* **Platform:** Web + Mobile — must work on both

### 1.2 App icon not displaying correctly
* **Issue:** App favicon and PWA icon are not showing the EzyRetire infinity logo
* **Fix required:**
  * Replace all icon files in `/public/icons/` with EzyRetire infinity logo in all required sizes (16×16, 32×32, 48×48, 72×72, 96×96, 128×128, 144×144, 192×192, 384×384, 512×512)
  * Update `manifest.webmanifest` — change name to "EzyRetire", short_name to "EzyRetire", update all icon paths
  * Update `<link rel="icon">` and `<link rel="apple-touch-icon">` in HTML head
  * Update theme_color to `#1a2b4a` (navy) and background_color to `#0d1b2a` (dark navy)
  * Clear Vercel cache and redeploy
  * **Test:** Open Chrome → ezyretire.com → check browser tab icon, check "Add to Home Screen" icon, check PWA splash screen
* **Acceptance criteria:** EzyRetire infinity logo appears in browser tab, PWA home screen icon, and splash screen on both Android and iOS.
* **Platform:** Web + Mobile

---

## 2. Performance (P0)

### 2.1 Investigate and fix mobile slowness
* **Issue:** Application is slow on mobile devices
* **Investigation required:**
  * Run Lighthouse audit on mobile preset — capture Performance score, LCP, FID, CLS
  * Identify largest content paint bottleneck (likely large JS bundle or unoptimised images)
  * Check if heavy calculations (retirement projection, amortisation) are running on main thread and blocking UI
  * Profile with Chrome DevTools → Performance tab → record page load on mobile throttling (Slow 3G)
* **Likely fixes:**
  * Lazy-load routes/pages that are not immediately visible (React.lazy + Suspense)
  * Move heavy calculations (retirement projection, tax computation, amortisation schedules) to Web Workers so they don't block the UI thread
  * Optimise images — use WebP format, add width/height attributes, use lazy loading
  * Reduce initial JS bundle — code-split by route
  * Add skeleton loaders for every section while data loads (don't show a blank screen)
  * Debounce input handlers — don't recalculate on every keystroke, wait 300ms after the user stops typing
  * Cache API responses on the client (React Query or SWR with stale-while-revalidate)
* **Target performance:**
  * Lighthouse Mobile Performance score: > 85
  * Largest Contentful Paint (LCP): < 2.5 seconds
  * First Input Delay (FID): < 100ms
  * Cumulative Layout Shift (CLS): < 0.1
  * Time to Interactive (TTI): < 3.5 seconds
* **Acceptance criteria:** App loads and becomes interactive within 3.5 seconds on a mid-range Android phone (e.g., Redmi Note) on 4G connection.
* **Platform:** Mobile (primary) + Web (verify no regression)

### 2.2 Improve font size for mobile
* **Issue:** Font sizes need to match mobile best practices without breaking existing features
* **⚠️ CAUTION: Follow Section 15 (Font Change Protocol) strictly for this task**
* **Fix required:**
  * Follow the EzyRetire Design System typography specification
  * Body text on mobile: 15px (not 14px — phones are held further from eyes)
  * Minimum font size on mobile: 11px (never below this)
  * Touch targets: minimum 44×44px for all tappable elements
  * Test EVERY screen after changes — no text overflow, no truncation, no layout breaking
  * Use responsive font scaling: `clamp()` in CSS for fluid typography across screen sizes
* **Key sizes for mobile:**
  * H1: 28px · H2: 22px · H3: 18px · Body: 15px · Labels: 12px (uppercase)
  * Amounts (hero): 32px · Amounts (card): 22px · Amounts (table): 14px
* **Acceptance criteria:** All text is readable without zooming on a 5.5-inch screen. No existing feature layout breaks. All touch targets are at least 44×44px.
* **Platform:** Mobile (primary) + Web (verify no regression)

---

## 3. Expense Module Enhancements (P1)

### 3.1 Yearly expense entry option
* **Current:** Only monthly expense entry is available
* **Required:** Add a toggle or dropdown to switch between Monthly and Yearly expense entry
* **Implementation:**
  * Add a frequency selector on each expense entry: "Monthly" | "Quarterly" | "Half-yearly" | "Yearly" | "One-time"
  * When user selects "Yearly" → input accepts annual amount → app auto-calculates monthly equivalent for dashboard and retirement projection
  * When user selects "Quarterly" → input accepts quarterly amount → app divides by 3 for monthly
  * When user selects "One-time" → date picker for when the expense occurs → app amortises impact on retirement projection
  * Dashboard always shows monthly equivalent for consistency, with yearly total available on hover/tap
  * Budget tracking should support all frequency types
* **Database:** Add `frequency` column to expense records (enum: 'monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time')
* **Acceptance criteria:** User can enter expenses in any frequency. Dashboard calculations are correct regardless of entry frequency.
* **Platform:** Web + Mobile

### 3.2 Upcoming / planned future expenses
* **Required:** A dedicated section for future planned expenses that are not yet recurring
* **Categories to support:**
  * Old age / healthcare expenses (medical inflation at 10%)
  * Children's higher education (education inflation at 10%)
  * Children's wedding
  * Property purchase / renovation
  * Vacation / travel (planned future)
  * Vehicle purchase
  * Emergency fund target
  * Parent care / eldercare
  * Custom planned expense
* **Implementation:**
  * Each planned expense has: name, estimated amount, expected year, inflation rate, category
  * App inflates the amount from today to the expected year using the category-specific inflation rate
  * These expenses flow into the retirement projection — the corpus must cover them
  * Timeline view showing when each planned expense hits
  * Warning if a planned expense would create a corpus shortfall
* **Acceptance criteria:** User can add future planned expenses with expected year and inflation. Retirement projection accounts for all planned expenses at their inflated future value.
* **Platform:** Web + Mobile

### 3.3 Kids / dependant expense estimator
* **Required:** Dedicated section to estimate the total cost of raising children
* **Implementation:**
  * Input: Number of kids (or planned), current age of each (or expected birth year)
  * Auto-estimate based on Indian averages (admin-configurable):
    * Delivery and maternity: ₹1-5 lakh (normal) / ₹3-10 lakh (C-section/private hospital)
    * Childcare (0-3 years): ₹5,000-20,000/month
    * Pre-school (3-5): ₹10,000-30,000/month
    * School (6-17): ₹15,000-80,000/month (varies by city and school type)
    * Higher education (18-22): ₹5-25 lakh/year (India) / ₹20-80 lakh/year (abroad)
    * Extracurriculars: ₹3,000-15,000/month
    * Healthcare: ₹2,000-5,000/month
    * Wedding: ₹10-50 lakh (admin-configurable default)
  * All amounts inflate at category-specific rates (education at 10%, healthcare at 10%, general at 6%)
  * User can override any default with their own estimate
  * Total lifetime cost per child displayed with year-by-year breakdown
  * Feeds directly into retirement projection
* **Acceptance criteria:** User can add kids (existing or planned), see estimated lifetime cost with inflation, and see the impact on their retirement date.
* **Platform:** Web + Mobile

### 3.4 Maternity and life-event expense templates
* **Required:** Pre-built expense templates for major life events
* **Templates to include:**
  * Maternity (pregnancy + delivery + post-natal)
  * Wedding (self)
  * House purchase (down payment + registration + stamp duty + interiors + society charges)
  * Car purchase (down payment + insurance + maintenance + fuel)
  * Relocation / job change (deposit + moving + furnishing)
  * Medical emergency fund
  * Sabbatical / career break (zero income + ongoing expenses for X months)
  * Starting a business (investment + runway)
  * Parents' medical emergency
  * Divorce / separation (legal + settlement + lifestyle change)
* **Implementation:**
  * Each template has pre-filled line items with Indian average amounts (admin-configurable)
  * User selects a template → reviews and adjusts amounts → saves as a planned expense
  * Feeds into the upcoming expenses section and retirement projection
* **Acceptance criteria:** User can select a life-event template, customise amounts, and see it reflected in their financial plan.
* **Platform:** Web + Mobile

### 3.5 Receipt scanning (Premium feature)
* **Required:** User can photograph or upload a receipt; app extracts merchant, amount, date, and category
* **Implementation:**
  * Camera capture (mobile) or file upload (web)
  * Send image to AI API (Google Vision / OpenAI GPT-4o / AWS Textract) for OCR
  * Extract: merchant name, total amount, date, line items
  * Auto-categorise based on merchant name using the category rules engine
  * User confirms or edits before saving
  * Premium-only feature — gated behind subscription entitlement
  * Store original receipt image in Supabase Storage linked to the expense record
* **Acceptance criteria:** Receipt scan extracts amount and merchant with >90% accuracy. User can confirm/edit before saving. Only premium users can access this feature.
* **Platform:** Mobile (primary — camera) + Web (file upload)

### 3.6 Automatic bank statement fetch
* **Required:** Automatically pull transaction data from user's bank account
* **Implementation approach (phased):**
  * **Phase 1 (v1):** Manual upload of bank statement PDF/CSV → AI parses and categorises transactions
  * **Phase 2 (v2):** Account Aggregator (AA) integration — requires FIU licence, 5-10 months lead time, ₹5-25 lakh cost
  * **Phase 3 (v3):** Open Banking APIs as they become available in India
* **For v1 (manual upload):**
  * Support PDF and CSV formats from top 8 banks (SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, IndusInd)
  * AI pipeline: PDF extraction → row parsing → deduplication → self-transfer detection → categorisation → user review
  * Premium-only feature
* **Acceptance criteria (v1):** User uploads a bank statement PDF; app extracts >99% of transaction rows, auto-categorises >90%, and presents for user review before saving.
* **Platform:** Web (primary — file upload) + Mobile (file picker)

---

## 4. Loan Module Enhancements (P1)

### 4.1 One-time payment / bullet loan option
* **Current:** All loans assume EMI-based repayment
* **Required:** Option for lump-sum / bullet repayment with calculated interest
* **Implementation:**
  * Add repayment type selector: "EMI" | "Bullet / One-time payment" | "Interest-only + Bullet"
  * **EMI:** Works as today
  * **Bullet:** No monthly EMI. Interest accrues. Total repayment = Principal + (Principal × Rate × Tenure). Show the total interest cost and compare with EMI option.
  * **Interest-only + Bullet:** Monthly payment = interest only. Principal repaid at end. Common for business loans and some gold loans.
  * For each type, show: total interest paid, effective annual cost, retirement impact
  * Prepay-vs-invest analysis should work for all three types
* **Acceptance criteria:** User can add a loan with any of the three repayment types. Calculations are correct for each. Retirement projection handles all types.
* **Platform:** Web + Mobile

### 4.2 Debt-free date calculator
* **Required:** A single view showing when ALL loans will be paid off
* **Implementation:**
  * Aggregate all active loans — show combined EMI burden per month
  * Calculate the "debt-free date" — the date when the last loan closes
  * Timeline visualisation: horizontal bar per loan showing start-to-end, stacked vertically
  * Highlight if any loan extends past retirement date (red warning)
  * Show total interest paid across all loans (lifetime cost of debt)
  * Scenario: "If you add ₹X extra to the highest-rate loan each month, you'll be debt-free Y months earlier and save ₹Z in interest"
  * Debt-to-income ratio displayed as a health indicator
* **Acceptance criteria:** User sees a single debt-free date, total interest across all loans, and a visual timeline. Retirement overlap warning works.
* **Platform:** Web + Mobile

---

## 5. Authentication Enhancements (P2)

### 5.1 Mobile number optional + OTP quick login
* **Current:** Mobile number may be required during signup
* **Required:**
  * Make mobile number **optional** during signup — email is sufficient
  * If mobile number IS provided, offer **OTP-based quick login** as an alternative to email OTP
  * Quick login flow: Enter mobile → receive SMS OTP → enter OTP → logged in (under 15 seconds)
  * This could be a **premium feature** — free users login with email OTP, premium users get SMS quick login
* **Implementation:**
  * SMS OTP provider: MSG91, Twilio, or AWS SNS
  * Cost: ₹0.15-0.30 per SMS (factor into premium pricing)
  * Rate limit: max 3 OTP requests per phone number per hour
  * Cooldown: 30 seconds between OTP requests
  * OTP expiry: 5 minutes
* **Database:** Mobile number field already exists — just make it nullable/optional
* **Acceptance criteria:** User can sign up with email only (no mobile required). If mobile is provided, OTP quick login works. Premium gating is enforced if decided.
* **Platform:** Web + Mobile

---

## 6. UI/UX Improvements (P1)

### 6.1 Responsive design audit
* **Requirement:** Every screen must look perfect on both web (1280px+) and mobile (360px-428px) without any layout breaking
* **Audit checklist for EVERY screen:**
  * Text doesn't overflow or truncate unexpectedly
  * Tables scroll horizontally on mobile (not break layout)
  * Cards stack vertically on mobile, side-by-side on desktop
  * Input fields are full-width on mobile
  * Modals/dialogs fit within mobile viewport
  * Bottom navigation doesn't overlap content on mobile
  * Keyboard doesn't cover input fields on mobile
  * Charts resize properly on mobile
  * Touch targets are minimum 44×44px
  * No horizontal scroll on any page
* **Screens to audit:**
  * Dashboard, Profile, Income, Expenses (ledger), Budgets, Investments, Loans, Retirement, Tax, Trends, Settings, Onboarding wizard
* **Acceptance criteria:** Zero horizontal scroll, zero text overflow, zero overlapping elements on any screen at any viewport width from 360px to 1920px.
* **Platform:** Web + Mobile — this IS the task

### 6.2 Error states and empty states for every section
* **Requirement:** Every section must handle three states gracefully:
  * **Empty state:** No data yet → show helpful illustration + "Add your first [expense/investment/loan]" CTA
  * **Error state:** Data failed to load → show "Something went wrong. Tap to retry." with retry button
  * **Loading state:** Data is loading → show skeleton loader (not spinner, not blank screen)
* **Sections that need all three states:**
  * Dashboard cards (each card independently), Income, Expense ledger, Budget tracking, Investment portfolio, Loan list, Retirement projection, Tax computation, Trends/charts, Goals, Net worth, Insurance, Financial calendar
* **Acceptance criteria:** No blank screens anywhere in the app. Every section shows appropriate empty, loading, or error state.
* **Platform:** Web + Mobile

### 6.3 Dark mode
* **Required:** Full dark mode following EzyRetire brand colors
* **Implementation:**
  * System preference detection (auto-switch) + manual toggle in settings
  * Dark background: `#0d1b2a` · Card surfaces: `#1a2b4a` · Text: `#ffffff` / `#a0aec0`
  * Charts must be legible in dark mode (adjust grid lines, labels, legend)
  * Financial numbers — green for positive, soft red for negative (adjusted for dark background contrast)
  * All images/icons must have dark mode variants or transparent backgrounds
* **Acceptance criteria:** Every screen is fully legible and beautiful in dark mode. No white flashes during page transitions. Toggle works correctly.
* **Platform:** Web + Mobile

---

## 7. Onboarding & First-Time Experience (P1)

### 7.1 Guided onboarding wizard
* **Required:** A step-by-step setup flow for first-time users that collects essential data and delivers a retirement projection within 7 minutes
* **Steps:**
  1. **Welcome** — "Let's plan your retirement in 7 minutes" (30 sec)
  2. **Profile** — Name, DOB, retirement age, life expectancy, city, dependants (45 sec)
  3. **Income** — Monthly salary or CTC (can be rough estimate) (30 sec)
  4. **Expenses** — Rent, EMIs, utilities, groceries — pre-filled suggestions based on city (90 sec)
  5. **Loans** — Any active loans — type, EMI, outstanding (60 sec)
  6. **Investments** — Existing holdings — even rough numbers (90 sec)
  7. **First Retirement Projection** — the payoff moment (auto-generated)
  8. **Next Steps** — "Here's your retirement date. Here's what you can do to improve it." (CTA to explore app)
* **UX rules:**
  * Every step has a progress bar showing completion
  * "Skip for now" option on every step (except Profile — that's required)
  * Back button on every step
  * Data saves after each step (don't lose progress if user drops off)
  * Estimated time shown on each step
  * Can be re-triggered from Settings → "Redo setup wizard"
* **Acceptance criteria:** First-time user reaches a retirement projection within 7 minutes. Progress is saved per step. Skipped steps show "complete this to improve accuracy" nudges on the dashboard.
* **Platform:** Web + Mobile

### 7.2 Contextual tooltips and help
* **Required:** First-time contextual hints on every section explaining what each number means
* **Implementation:**
  * Subtle "?" icon next to every financial term (CTC, gross, EPF, 80C, XIRR, CAGR, corpus)
  * Tapping shows a 1-2 sentence plain-English explanation in a tooltip/popover
  * "Learn more" link opens a longer explanation in a side panel (not a new page — don't break the flow)
  * First-visit guided tour highlights 5 key areas of the dashboard with coach marks
  * Can be dismissed permanently ("Don't show again" checkbox)
* **Acceptance criteria:** Every financial term in the app has a tooltip explanation. A user with zero finance knowledge can understand every number.
* **Platform:** Web + Mobile

---

## 8. Financial Health & Net Worth (P1)

### 8.1 Financial health score
* **Required:** A single score (0-100) summarising the user's overall financial health
* **Components of the score:**
  * Savings rate (weight: 20%) — percentage of income saved/invested
  * Emergency fund (weight: 15%) — months of expenses covered by liquid assets
  * Debt-to-income ratio (weight: 15%) — total EMIs as percentage of income
  * Insurance coverage (weight: 10%) — adequate life and health coverage
  * Investment diversification (weight: 10%) — not over-concentrated in one asset class
  * Retirement readiness (weight: 20%) — projected corpus vs required corpus
  * Expense trend (weight: 10%) — are expenses growing faster than income?
* **Display:**
  * Circular gauge on dashboard — color coded (0-40 red, 41-70 amber, 71-100 green)
  * Breakdown showing each component's contribution
  * Month-over-month trend arrow (improving ↑ / declining ↓ / stable →)
  * Actionable suggestions: "Improve your score: Build 3 more months of emergency fund (+8 points)"
* **Acceptance criteria:** Score updates in real-time as user changes data. Each component is independently calculated. Suggestions are actionable and specific.
* **Platform:** Web + Mobile

### 8.2 Net worth tracker
* **Required:** A single view showing total assets minus total liabilities over time
* **Assets:**
  * Investment portfolio (equity, MF, gold, FD, PPF, NPS, EPF, SCSS, crypto)
  * Cash and savings accounts
  * Real estate (market value, user-entered)
  * Vehicle (depreciated value)
  * Other assets (jewellery, art, collectibles — user-entered)
* **Liabilities:**
  * All active loans (home, car, personal, education, credit card, gold, etc.)
* **Display:**
  * Net worth = Total Assets − Total Liabilities
  * Monthly snapshot saved automatically (net_worth_snapshots table)
  * Line chart showing net worth growth over time
  * Breakdown: asset composition pie chart + liability composition pie chart
  * Month-over-month change amount and percentage
* **Acceptance criteria:** Net worth auto-computes from investment + cash + property – loans. Historical trend is tracked monthly. Chart shows growth over time.
* **Platform:** Web + Mobile

### 8.3 Emergency fund tracker
* **Required:** Track whether the user has adequate emergency reserves
* **Implementation:**
  * Target: 6 months of essential expenses (admin-configurable default, user can override to 3-12 months)
  * Current emergency fund: user enters liquid savings (savings account + liquid MF + FD maturing within 30 days)
  * Display: progress bar showing current vs target
  * Months covered = Emergency fund ÷ Monthly essential expenses
  * If below target: warning + "You need ₹X more. Save ₹Y/month for Z months to reach your target."
  * The emergency fund is excluded from the retirement corpus (it's not investable — it must stay liquid)
* **Acceptance criteria:** User sees months of expenses covered, progress toward target, and a clear plan to build the fund.
* **Platform:** Web + Mobile

---

## 9. Insurance Gap Analysis (P2)

### 9.1 Life insurance coverage check
* **Required:** Calculate whether the user has adequate term insurance
* **Human Life Value (HLV) method:**
  * Annual income × remaining working years (adjusted for inflation and discount rate)
  * Minus: existing life insurance sum assured
  * Minus: existing investments and savings
  * Plus: all outstanding liabilities (loans)
  * Plus: planned future expenses (children's education, wedding, etc.)
  * Result: insurance gap (positive = underinsured, zero/negative = adequately covered)
* **Display:**
  * Current coverage vs required coverage (bar chart)
  * Gap amount in large text
  * "You need ₹X more in term insurance. Estimated premium: ₹Y/year" (using industry average rates by age)
  * Premium is shown as a monthly expense → feeds into expense tracking
* **Acceptance criteria:** Insurance gap calculated using HLV method. Estimated premium shown. Gap feeds into retirement planning.
* **Platform:** Web + Mobile

### 9.2 Health insurance coverage check
* **Required:** Check if family has adequate health insurance
* **Implementation:**
  * Input: existing health insurance sum insured (individual + family floater + employer-provided + super top-up)
  * Recommended coverage: based on city, age, family size, and medical inflation (admin-configurable benchmark table)
  * Gap: recommended minus current
  * Show: "Medical costs in your city average ₹X for a major hospitalisation. Your coverage handles Y% of that."
  * Premium estimate feeds into expense tracking
* **Acceptance criteria:** User sees whether health coverage is adequate. Gap amount and estimated premium shown.
* **Platform:** Web + Mobile

---

## 10. Goal-Based Planning (P2)

### 10.1 Multiple financial goals
* **Required:** Not everyone thinks only about retirement. Users should be able to create and track multiple financial goals.
* **Goal types:**
  * Retirement (primary — always exists)
  * Child's education
  * Child's wedding
  * House down payment
  * Car purchase
  * Vacation fund
  * Emergency fund (linked to 8.3)
  * Parent care fund
  * Sabbatical / FIRE fund
  * Custom goal
* **Each goal has:**
  * Name, target amount (today's value), target year, inflation rate, priority
  * Auto-inflated future value = today's value × (1 + inflation)^years
  * Current allocation (how much of investments is earmarked for this goal)
  * Monthly contribution needed to reach the goal
  * Progress percentage
  * On-track / behind / ahead status
* **Display:**
  * Card per goal on a goals dashboard
  * Progress bar per goal
  * Combined view: total monthly allocation across all goals vs available investable surplus
  * Warning if goals are over-allocated (more than 100% of surplus committed)
* **Acceptance criteria:** User can create multiple goals. Each shows progress, monthly requirement, and on-track status. Goals don't over-allocate beyond available surplus.
* **Platform:** Web + Mobile

---

## 11. Smart Notifications & Financial Calendar (P2)

### 11.1 Financial calendar
* **Required:** A calendar view showing all upcoming financial events
* **Events to track:**
  * SIP dates (auto-detected from investment entries)
  * Loan EMI due dates
  * Insurance premium renewal dates
  * Credit card bill dates and payment due dates
  * Tax deadlines (advance tax: 15 Jun, 15 Sep, 15 Dec, 15 Mar; ITR filing: 31 Jul)
  * FD/RD maturity dates
  * PPF/NPS contribution deadlines
  * Investment NAV record dates (dividend)
  * Rent due date
  * Salary credit date
  * License / registration renewals
  * Custom reminders
* **Display:**
  * Monthly calendar view with dots on event dates
  * List view of upcoming 30 days
  * Today view showing what's due today
  * Overdue items highlighted in red
* **Acceptance criteria:** All recurring financial events auto-populate from existing data. User can add custom events. Calendar shows upcoming 30 days clearly.
* **Platform:** Web + Mobile

### 11.2 Smart notification system
* **Required:** Proactive nudges that help users stay on track
* **Notification types:**
  * **Spending alerts:** "You've spent 80% of your food budget with 10 days left this month"
  * **Retirement impact:** "Your spending this month pushed your retirement date by 3 months"
  * **Goal nudges:** "You're ₹15,000 behind on your house fund this quarter"
  * **Positive reinforcement:** "Great month! You saved 45% of your income — 3% more than last month"
  * **Upcoming events:** "Your home loan EMI of ₹35,000 is due in 3 days"
  * **Milestone celebrations:** "Your net worth crossed ₹25 lakh! 🎉"
  * **Market context (future):** "Your equity portfolio dropped 8% this month — here's why that's normal for long-term investors"
  * **Tax reminders:** "Advance tax deadline is in 7 days. Your estimated liability: ₹X"
  * **Anomaly detection:** "Your electricity bill this month is 3× higher than your average — worth checking?"
* **Delivery:**
  * In-app notification bell with badge count
  * Push notification (mobile) — user can control which types
  * Weekly email digest (optional) — summary of the week's financial activity
  * Quiet hours: no push notifications between 10pm-7am (user-configurable)
* **Acceptance criteria:** At least 5 notification types active from launch. User can toggle each type on/off. Push notifications work on Android and iOS.
* **Platform:** Web + Mobile

### 11.3 Monthly financial summary report
* **Required:** Auto-generated monthly report delivered on the 1st of every month
* **Contents:**
  * Income received vs expected
  * Total expenses vs budget, by category
  * Savings amount and savings rate
  * Investment portfolio change (value, returns)
  * Net worth change
  * Retirement date movement (improved / worsened / unchanged)
  * Financial health score change
  * Top 3 actionable suggestions for next month
* **Delivery:**
  * In-app report page (always accessible)
  * Email report (optional, auto-sent on 1st of month)
  * PDF export option
* **Acceptance criteria:** Report auto-generates on the 1st. Covers all 8 sections above. Email delivery works.
* **Platform:** Web + Mobile

---

## 12. Retirement Planning Enhancements (P1)

### 12.1 Retirement lifestyle planner
* **Required:** Before projecting the corpus, ask "What kind of retirement do you want?"
* **Lifestyle options:**
  * **Basic:** Stay in current home, minimal travel, covered by pension and EPF (inflation-adjusted current essential expenses only)
  * **Comfortable:** Current lifestyle maintained, 1-2 domestic trips/year, occasional dining, hobbies (80-100% of current expenses, inflation-adjusted)
  * **Premium:** Upgraded lifestyle, international travel, club memberships, healthcare concierge (120-150% of current expenses)
  * **Custom:** User defines their own retirement monthly expense
* **Each option shows:**
  * Monthly expense at retirement (inflated)
  * Total corpus needed
  * Gap from current projected corpus
  * Retirement age at which each lifestyle becomes affordable
* **Acceptance criteria:** User selects a lifestyle tier. Corpus requirement adjusts accordingly. User can see at what age each tier becomes affordable.
* **Platform:** Web + Mobile

### 12.2 Pension income estimator
* **Required:** Calculate all pension income streams the user will receive at retirement
* **Income streams:**
  * EPF corpus (lump sum at retirement)
  * EPS pension (monthly, ₹/month = avg salary × years / 70, capped)
  * NPS annuity (40% mandatory annuity from NPS corpus, at admin-configurable annuity rate)
  * PPF maturity (if PPF is active)
  * SCSS interest (if invested in Senior Citizens Savings Scheme post-retirement)
  * Rental income (if user has rental property — from income section)
  * Any other pension (government pension, military pension, user-entered)
* **Display:**
  * Total monthly pension income at retirement
  * Gap: retirement expenses − pension income = amount that must come from corpus drawdown
  * This gap determines the real corpus requirement (lower than if pension is ignored)
* **Acceptance criteria:** All pension streams auto-populate from existing data (EPF, NPS, PPF). Total pension income is shown. Corpus requirement adjusts accordingly.
* **Platform:** Web + Mobile

### 12.3 What-if scenario simulator
* **Required:** "What happens if..." simulations for major life changes
* **Scenarios to support:**
  * Job loss for X months (zero income period)
  * Salary hike of X% (mid-year change)
  * Major medical expense of ₹X lakh
  * Early retirement at age X (instead of planned age)
  * Adding a new loan (home, car)
  * Having another child
  * Moving to a different city (expense change)
  * Spouse starts/stops working
  * One-time windfall (bonus, inheritance, property sale)
  * Market crash (portfolio drops by X%)
* **Implementation:**
  * Each scenario creates a parallel projection — doesn't change real data
  * Side-by-side comparison: "Current plan" vs "With this scenario"
  * Shows impact on: retirement date, corpus, monthly savings requirement
  * Can stack multiple scenarios ("Job loss + market crash + medical emergency")
* **Acceptance criteria:** User can simulate any life event without changing real data. Impact on retirement date and corpus shown clearly. Multiple scenarios can be stacked.
* **Platform:** Web + Mobile

### 12.4 Inflation impact visualiser
* **Required:** Show how inflation erodes purchasing power over time
* **Display:**
  * "₹1 lakh today = ₹X in 10 years = ₹Y in 20 years = ₹Z at retirement"
  * Category-wise: "Your ₹50,000 medical expense today will cost ₹X at retirement (at 10% medical inflation)"
  * Interactive slider: adjust inflation rate and see impact in real-time
  * Show total inflation-adjusted expenses at retirement vs today's expenses
* **Acceptance criteria:** User can visualise inflation impact per category. Interactive slider works smoothly.
* **Platform:** Web + Mobile

### 12.5 SIP step-up calculator
* **Required:** Show the impact of increasing SIP by X% every year
* **Implementation:**
  * Input: current monthly SIP, annual step-up percentage (default: 10%), expected return, tenure
  * Output: corpus with step-up vs corpus without step-up
  * The difference is always dramatic — great motivation to commit to step-ups
  * "If you increase your SIP by just 10% every year, your corpus grows from ₹X to ₹Y — that's ₹Z more"
  * Integrate into retirement projection: the projection engine uses step-up if the user commits to it
* **Acceptance criteria:** Step-up calculator shows both scenarios. Retirement projection optionally includes step-up.
* **Platform:** Web + Mobile

---

## 13. Comparison & Decision Tools (P2)

### 13.1 Rent vs buy calculator
* **Required:** Should I rent or buy a house?
* **Inputs:**
  * Property value, down payment, loan rate, tenure, expected property appreciation
  * Current rent, expected rent increase
  * Investment return if the down payment is invested instead
* **Output:**
  * Year-by-year comparison: renting + investing surplus vs buying + paying EMI
  * Break-even year (when buying becomes cheaper than renting)
  * Impact on retirement date (both scenarios)
* **Acceptance criteria:** Both scenarios computed year-by-year. Break-even year shown. Retirement impact shown.
* **Platform:** Web + Mobile

### 13.2 Prepay vs invest tool (enhanced)
* **Current:** Basic prepay vs invest exists
* **Enhanced version:**
  * Input: loan details + lump sum amount available
  * Compare: prepay the loan vs invest in equity/MF/FD
  * Factor in: tax benefit on loan interest (Section 24b), tax on investment gains (STCG/LTCG)
  * Show: after-tax effective cost of both paths
  * Recommendation with clear reasoning
  * Link to retirement impact ("Prepaying saves ₹X in interest but investing earns ₹Y after tax — net difference: ₹Z for your retirement")
* **Acceptance criteria:** After-tax comparison is accurate. Tax implications are correctly calculated. Retirement impact shown.
* **Platform:** Web + Mobile

### 13.3 Old vs new tax regime comparison (enhanced)
* **Current:** Basic comparison may exist
* **Enhanced version:**
  * Auto-populate all deductions from existing data: PF from salary → 80C, HRA from salary → auto-calculate, insurance premiums → 80D, home loan interest → 24b, NPS → 80CCD(1B)
  * Show side-by-side: old regime tax vs new regime tax
  * Show: which deductions you'd lose by choosing new regime
  * Show: monthly take-home difference
  * Recommendation: "Based on your deductions, [old/new] regime saves you ₹X/year"
  * Year-by-year projection: as salary grows, which regime is better in 3/5/10 years
* **Acceptance criteria:** Both regimes auto-populated from existing data. Clear recommendation with reasoning. Forward projection works.
* **Platform:** Web + Mobile

---

## 14. Data Management & Security (P2)

### 14.1 Document vault
* **Required:** Secure storage for important financial documents
* **Document types:**
  * PAN card, Aadhaar (for reference)
  * Salary slips (monthly)
  * Form 16 (annual)
  * Investment proofs (80C, 80D receipts)
  * Insurance policies (life, health, vehicle)
  * Loan sanction letters
  * Property documents
  * Nominee declarations
  * Will (if exists)
  * Bank statements (uploaded for parsing)
* **Implementation:**
  * Upload and store in Supabase Storage (encrypted at rest)
  * Categorised folders per document type
  * Expiry tracking for insurance policies, registrations
  * Reminders before expiry
  * Premium feature — free users can store up to 5 documents, premium unlimited
* **Acceptance criteria:** User can upload, view, and organise financial documents. Encryption at rest. Expiry reminders work.
* **Platform:** Web + Mobile

### 14.2 Nominee and beneficiary tracker
* **Required:** Track who is the nominee for each financial instrument
* **Implementation:**
  * For each investment, insurance, bank account, loan — record nominee name, relationship, share percentage
  * Dashboard view: "Is every instrument covered?" — show instruments without nominees
  * Warning: "3 of your 7 investments have no nominee. In case of emergency, your family may face delays claiming these."
  * Premium feature
* **Acceptance criteria:** User can add nominee per instrument. Missing nominee warnings shown. Summary view of all nominees.
* **Platform:** Web + Mobile

### 14.3 Data export (DPDP compliance)
* **Required:** User can download all their data
* **Formats:**
  * JSON (full data export — all tables, all records)
  * CSV (per section — expenses, investments, loans)
  * PDF (formatted financial summary report)
* **Implementation:**
  * Settings → Privacy → "Download my data" button
  * Generates a ZIP file with all data
  * Delivered via email or direct download
  * Must complete within 72 hours per DPDP Act requirements
* **Acceptance criteria:** User receives complete data export in chosen format. All sections included. Completes within 72 hours.
* **Platform:** Web + Mobile

### 14.4 Account deletion
* **Required:** User can permanently delete their account and all data
* **Implementation:**
  * Settings → Privacy → "Delete my account"
  * 15-day cooling period — account is deactivated, not deleted
  * After 15 days — all data permanently purged from database, storage, backups
  * Confirmation email sent at deletion request and at actual purge
  * Required by DPDP Act
* **Acceptance criteria:** Account deletion completes within 15 days. No data remains after purge. Confirmation emails sent.
* **Platform:** Web + Mobile

---

## 15. Font Change Protocol (MANDATORY)

**⚠️ This protocol is MANDATORY for any change that touches typography — font family, font size, font weight, line height, letter spacing, or text transform.**

### Why this protocol exists

A 1px font size change can cascade into:
* Text overflow in cards that previously fit perfectly
* Button labels wrapping to two lines
* Table columns becoming too wide or too narrow
* Mobile layouts breaking while desktop looks fine
* Amount formatting misalignment
* Truncated labels in navigation
* Modal dialogs overflowing viewport

### Pre-change checklist

Before touching any font property:
1. **Screenshot every screen** on 3 devices BEFORE the change (iPhone SE 375px, Samsung Galaxy 412px, Desktop 1920px)
2. **Document the exact change:** which CSS property, which selector, old value → new value
3. **Check the blast radius:** `grep -r` for every selector being changed — how many components are affected?

### The change process

1. Make the font change in CSS/Tailwind
2. **Immediately** test on these 3 screens first (most likely to break):
   * Dashboard (has the most diverse typography — hero numbers, card titles, labels, amounts)
   * Expense ledger table (has dense data, column alignment, amount formatting)
   * Retirement projection (has charts, large numbers, small labels)
3. If any of these 3 break → fix before testing further
4. Test every remaining screen on all 3 devices
5. Specifically check:
   * No text is truncated or overflowing
   * No buttons have text wrapping to second line
   * No cards have changed height unexpectedly (this breaks card grids)
   * All financial amounts still align in tabular columns
   * All touch targets are still ≥ 44×44px on mobile
   * Navigation items still fit without wrapping

### Post-change verification

1. **Screenshot every screen** AFTER the change on the same 3 devices
2. **Side-by-side comparison** with before screenshots
3. Run Lighthouse on mobile — CLS score must not increase
4. If CLS increased → the font change caused layout shift → revert and investigate

### If using `clamp()` for responsive fonts

```css
/* SAFE pattern — test the MIN, PREFERRED, and MAX values independently */
font-size: clamp(14px, 2vw + 0.5rem, 18px);

/* Test at 360px width (should use 14px) */
/* Test at 768px width (should use calculated middle) */
/* Test at 1920px width (should use 18px) */
```

---

## 16. Task Priority Matrix

### Sprint 1 — Foundation (Weeks 1-2)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 1.1 | Fix app crash on data entry | P0 | Medium | Critical |
| 1.2 | Fix app icon | P0 | Low | High |
| 2.1 | Fix mobile slowness | P0 | High | Critical |
| 2.2 | Mobile font sizes (with protocol) | P1 | Medium | High |
| 6.1 | Responsive design audit | P1 | High | High |
| 6.2 | Error/empty/loading states | P1 | Medium | High |

### Sprint 2 — Core Features (Weeks 3-4)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 7.1 | Onboarding wizard | P1 | High | Critical — first impression |
| 3.1 | Yearly expense option | P1 | Low | Medium |
| 4.1 | Bullet loan option | P1 | Medium | Medium |
| 3.2 | Upcoming/planned expenses | P1 | Medium | High |
| 4.2 | Debt-free date calculator | P1 | Medium | High |

### Sprint 3 — Retirement & Health (Weeks 5-6)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 8.1 | Financial health score | P1 | High | High — engagement driver |
| 8.2 | Net worth tracker | P1 | Medium | High |
| 8.3 | Emergency fund tracker | P1 | Low | High |
| 12.1 | Retirement lifestyle planner | P1 | Medium | High |
| 12.2 | Pension income estimator | P1 | Medium | High |

### Sprint 4 — Planning & Tools (Weeks 7-8)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 3.3 | Kids expense estimator | P1 | High | High |
| 3.4 | Life-event templates | P2 | Medium | Medium |
| 12.3 | What-if scenario simulator | P2 | High | High |
| 12.4 | Inflation impact visualiser | P2 | Medium | Medium |
| 12.5 | SIP step-up calculator | P2 | Low | Medium |

### Sprint 5 — Notifications & Goals (Weeks 9-10)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 10.1 | Multiple financial goals | P2 | High | High |
| 11.1 | Financial calendar | P2 | Medium | High |
| 11.2 | Smart notifications | P2 | High | High |
| 11.3 | Monthly summary report | P2 | Medium | Medium |
| 6.3 | Dark mode | P2 | Medium | Medium |

### Sprint 6 — Comparisons & Insurance (Weeks 11-12)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 9.1 | Life insurance gap | P2 | Medium | Medium |
| 9.2 | Health insurance gap | P2 | Medium | Medium |
| 13.1 | Rent vs buy calculator | P2 | Medium | Medium |
| 13.2 | Prepay vs invest (enhanced) | P2 | Medium | Medium |
| 13.3 | Tax regime comparison (enhanced) | P2 | Medium | Medium |

### Sprint 7 — Premium & Auth (Weeks 13-14)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 5.1 | Mobile OTP quick login | P2 | Medium | Medium |
| 3.5 | Receipt scanning | P2 | High | Medium |
| 7.2 | Contextual tooltips | P2 | Medium | Medium |
| 14.1 | Document vault | P2 | Medium | Low |
| 14.2 | Nominee tracker | P3 | Low | Low |

### Sprint 8 — Data & Compliance (Weeks 15-16)

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 3.6 | Auto bank statement fetch | P2 | Very High | High |
| 14.3 | Data export (DPDP) | P2 | Medium | Required by law |
| 14.4 | Account deletion (DPDP) | P2 | Medium | Required by law |

---

## 17. Testing Requirements

Every task above must pass these tests before merging.

### Device testing matrix

| Device | Browser | Must test |
|--------|---------|-----------|
| iPhone 13/14 | Safari | Every task |
| iPhone SE (small screen) | Safari | Every task |
| Samsung Galaxy S21/S22 | Chrome | Every task |
| Redmi Note (budget Android) | Chrome | Performance tasks |
| Desktop 1920×1080 | Chrome | Every task |
| Desktop 1366×768 (laptop) | Chrome | Every task |
| iPad | Safari | Layout tasks |

### Regression checklist (run after EVERY change)

* [ ] Dashboard loads without errors on web and mobile
* [ ] All existing expenses display correctly
* [ ] All existing investments display correctly
* [ ] All existing loans display correctly
* [ ] Retirement projection calculates correctly
* [ ] Tax computation shows correct values
* [ ] No console errors in browser DevTools
* [ ] No layout shift or visual glitches on web
* [ ] No layout shift or visual glitches on mobile
* [ ] No horizontal scroll on any page (mobile)
* [ ] All touch targets ≥ 44×44px (mobile)
* [ ] Financial numbers align in tabular columns
* [ ] Dark mode renders correctly (after 6.3 is implemented)
* [ ] Empty states show correctly for sections with no data
* [ ] Error states show correctly (simulate network failure)
* [ ] Font sizes match design system specification
