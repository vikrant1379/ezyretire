# EzyRetire — Authentication, Signup & Profile Page Specification

## 1. Current State Assessment

### What exists today

The current auth page at ezyretire.com shows:

* Logo + "Welcome to ezyRetire" heading
* One-line description: "Sign in to continue to your personal financial workspace, or create an account to get started."
* Two buttons: "Sign in" and "Create account"
* Footer with brand text

### What's wrong with it

| Problem | Impact | Priority |
|---------|--------|----------|
| No social login (Google/Apple) | Users must create yet another password — 50% drop-off risk | P0 |
| No value proposition visible | User sees a form, not a reason to sign up | P0 |
| Sign in and Create account look identical in weight | Users hesitate — which button do I press? | P1 |
| No trust signals | No encryption badge, no "free forever" assurance, no user count | P1 |
| No illustration or visual storytelling | The page feels empty, generic, forgettable | P1 |
| No mobile-specific optimisation | Same layout on 390px phone as 1440px desktop | P1 |
| No biometric or OTP option | Returning users must type email + password every time | P2 |
| No dark mode support | Inconsistent with the rest of the app if app has dark mode | P2 |

## 2. Research Summary — What the Best Apps Do

### Login patterns from 50+ professional apps studied

**Split-screen layout** is the dominant pattern for desktop fintech apps. Left side shows product value (illustration, testimonial, stats, or feature preview). Right side contains the form. On mobile, the left panel collapses and only the form remains. ([Eleken — 50+ Login Page Examples 2026](https://www.eleken.co/blog-posts/login-page-examples))

**Social login above email** is the 2026 standard for consumer apps. Google and Apple buttons appear first, then an "or continue with email" divider, then the email field. This pattern converts 20-40% better than email-first forms. ([Userpilot — Signup Page Best Practices](https://userpilot.com/blog/sign-up-page-design/))

**Progressive disclosure** — collect minimum at signup (email only, or Google SSO), then gather profile details during onboarding. Never ask for name, phone, DOB, and password all on one screen. ([OneThing — Top 10 Fintech UX Practices 2026](https://www.onething.design/post/top-10-fintech-ux-design-practices-2026))

**Biometric-first for returning users** — Face ID / fingerprint as default login on mobile, with OTP and password as fallbacks. Phone number + OTP as the default in India-focused fintech apps. ([ProCreator — 10 Best Fintech UX Practices 2026](https://procreator.design/blog/best-fintech-ux-practices-for-mobile-apps/))

**Trust cues on the auth page** — encryption badge, "No credit card required," user count ("50,000+ Indians plan their retirement here"), or a single testimonial. These are not decorative — they directly increase signup conversion. ([Duck.Design — 8 Best Practices Fintech App Design](https://duck.design/fintech-app-design/))

**Microcopy matters** — "Sign in" vs "Create account" should be visually distinct. Use different verbs: "Log in" for existing users, "Get started free" for new users. Never say "Submit." ([LogRocket — Login Screen Design Examples](https://blog.logrocket.com/ux-design/login-screen-design-examples/))

### Key design principles from top fintech apps

**Trust is a design decision, not a legal disclaimer.** The moment a user lands on the app, they ask: "Can I trust this with my money?" That question is answered in the first 3 seconds by layout density, typography weight, colour precision, and micro-interaction quality. ([The Skins Factory — Fintech UI/UX Best Practices 2026](https://www.theskinsfactory.com/uiux-design-blog/fintech-ui-ux-design))

**Friction is a feature when used correctly.** A wire transfer confirmation with a 1-second delay is trust. A login that asks for 3 codes is frustration. Add friction on high-stakes actions, remove it on routine tasks. ([The Skins Factory](https://www.theskinsfactory.com/uiux-design-blog/fintech-ui-ux-design))

**Security should be visible but invisible.** Users should see trust signals (padlock, encryption badge) but never have to wrestle with security mechanics. Biometrics and encryption happen in the background. ([Eleken — Fintech UX Best Practices 2026](https://www.eleken.co/blog-posts/fintech-ux-best-practices))

**Profile settings should be grouped, not dumped.** Related settings together, not a single endless form. Sections: Personal, Financial, Security, Notifications, Data. Each saves independently. ([DesignBrewery — Key UX Patterns Fintech Apps](https://designbrewery.in/8-key-ux-patterns-for-fintech-app-design/))

## 3. Auth Page — Redesigned Specification

### 3.1 Layout: Split-screen (desktop) / Single-column (mobile)

**Desktop (≥1024px):**

```
+----------------------------------------------------------+
|                                                          |
|   LEFT PANEL (50%)          |   RIGHT PANEL (50%)        |
|   Navy/dark background      |   White background         |
|                             |                            |
|   [infinity EzyRetire logo] |   "Welcome back"           |
|   "Track. Plan. Retire."   |                            |
|                             |   [Continue with Google]   |
|   +-------------------+    |   [Continue with Apple]    |
|   |                   |    |                            |
|   |   Illustration    |    |   --------- or ----------  |
|   |   or animated     |    |                            |
|   |   infinity loop   |    |   Email _______________    |
|   |   showing growth  |    |   Password _____________   |
|   |   to retirement   |    |   [ ] Remember me          |
|   |                   |    |       Forgot password?      |
|   +-------------------+    |                            |
|                             |   [ Log in ]  (primary)    |
|   "A Future, Well Planned." |                            |
|                             |   -------------------------  |
|   "Join 5,000+ Indians      |   Don't have an account?  |
|    planning their future"   |   [ Get started free ]     |
|                             |                            |
|   Lock Bank-grade encryption|                            |
|   Check Free forever plan   |                            |
|                             |                            |
+----------------------------------------------------------+
```

**Mobile (< 768px):**

```
+-------------------------+
|                         |
|    [infinity EzyRetire] |
|    "Track. Plan. Retire"|
|                         |
|    Welcome back         |
|                         |
|    [Continue with Google]|
|    [Continue with Apple] |
|                         |
|    --------- or ------  |
|                         |
|    Email ___________    |
|    Password _________   |
|    [ ] Remember me      |
|        Forgot password? |
|                         |
|    [    Log in    ]     |
|                         |
|    Don't have an account?|
|    Get started free     |
|                         |
|    Lock Secured | Free  |
|                         |
+-------------------------+
```

### 3.2 Left panel content (desktop only)

| Element | Specification |
|---------|--------------|
| Background | Gradient: #0d1b2a to #1a2b4a (brand navy) |
| Logo | EzyRetire infinity mark, white + gold variant |
| Tagline | "Track. Plan. Retire." in Inter SemiBold 14px, letter-spacing 2px, uppercase, gold (#c5a55a) |
| Illustration | Animated infinity loop: left loop shows bar chart growing, right loop shows sunset. Subtle CSS animation, 8-second loop. Fallback: static SVG. |
| Secondary tagline | "A Future, Well Planned." in DM Serif Display 24px, white |
| Social proof | "Join 5,000+ Indians planning their future" — update count monthly from real user data |
| Trust badges | Lock "Bank-grade encryption" and Check "Free forever plan" — Inter 13px, white 70% opacity |

### 3.3 Right panel: Login form

| Element | Desktop | Mobile | Specification |
|---------|---------|--------|--------------|
| Heading | "Welcome back" | "Welcome back" | DM Serif Display, 28px desktop / 24px mobile, #1a2b4a |
| Subheading | "Log in to your financial workspace" | Skip on mobile | Inter Regular, 14px, #718096 |
| Google button | Full width | Full width | White bg, black border 1px, Google "G" icon. Text: "Continue with Google." Height: 48px. Radius: 8px |
| Apple button | Full width | Full width | Black bg, white text, Apple logo. Text: "Continue with Apple." Height: 48px. Radius: 8px |
| Divider | "or continue with email" | "or" | Line with centered text, Inter 12px, #a0aec0 |
| Email field | Full width | Full width | Label: "Email address." Placeholder: "you@example.com." Height: 44px. Border: 1px #e2e8f0, focus: 2px #c5a55a. Radius: 8px |
| Password field | Full width | Full width | Label: "Password." Visibility toggle (eye icon). Height: 44px. Same border styling |
| Remember me | Checkbox + label | Checkbox + label | Left-aligned. Inter 13px. Checked by default |
| Forgot password | Text link | Text link | Right-aligned same row. Inter 13px, #c5a55a |
| Login button | Full width | Full width | Navy bg (#1a2b4a), white text, Inter SemiBold 16px. Height: 48px. Radius: 8px. Hover: lighten 10%. Loading: spinner |
| Signup link | Below login | Below login | "Don't have an account?" Inter 14px #718096, "Get started free" bold gold link (#c5a55a) |

### 3.4 Interaction states

| State | Behaviour |
|-------|-----------|
| Empty form | All fields empty, Login button enabled but shows "Please enter email" on click |
| Email entered, no password | Click Login then focus password field, subtle shake animation |
| Invalid email format | Inline error below email: "Please enter a valid email address" in red 12px, red border |
| Wrong password | Inline error below password: "Incorrect email or password. Try again or reset it." Red border. Never reveal which field is wrong. |
| Login success | Button text changes to spinner then redirect to dashboard. 300ms intentional delay. |
| Google/Apple SSO | Opens popup/redirect. Success leads to dashboard. Cancel returns to form, no error. |
| Rate limiting | After 5 failed attempts: "Too many attempts. Try again in 2 minutes." Disable form. Show countdown. |

### 3.5 Error message guidelines

| Principle | Rule |
|-----------|------|
| Never expose whether email exists | Always say "Incorrect email or password" — never "Email not found" or "Wrong password" separately |
| Be calm, not alarming | "Something went wrong. Please try again." — not "ERROR: Authentication Failed!" |
| Offer next steps | "Forgot password?" link appears more prominently after first failed attempt |
| Keep it inline | Errors appear directly below the relevant field, not in a popup or toast |

## 4. Signup Page — Redesigned Specification

### 4.1 Philosophy: Minimum now, everything later

Collect the absolute minimum at signup. Everything else goes into the onboarding wizard.

**Signup collects:** Email (or Google/Apple SSO) + Password. That's it.

**Onboarding collects (after first login):** Name, DOB, retirement age, city, salary range — one step at a time with a progress bar.

### 4.2 Layout

Same split-screen as login. Left panel identical. Right panel changes:

```
RIGHT PANEL:

    "Get started free"                    (heading)
    "Plan your retirement in 7 minutes"   (subheading)

    [Sign up with Google]
    [Sign up with Apple]

    ---------- or ----------

    Email _______________
    Password _____________
    (8+ characters, one number)

    [ Create free account ]

    -----------------------------
    Already have an account?
    Log in

    By creating an account, you agree to our
    Terms of Service and Privacy Policy.
```

### 4.3 Form fields

| Field | Specification |
|-------|--------------|
| Email | Same as login. Real-time validation on blur — check format, show green checkmark |
| Password | Real-time strength indicator: Weak (red) / Fair (amber) / Strong (green). Requirements shown BEFORE typing: "8+ characters, at least one number." Visibility toggle. |
| No "confirm password" field | Single password field with visibility toggle. Confirm-password is outdated and adds friction. |
| No name field | Collected during onboarding |
| No phone number field | Optional, collected later in profile |
| No CAPTCHA | Use invisible reCAPTCHA or Cloudflare Turnstile (free). Never show visible CAPTCHA. |

### 4.4 Signup button

| Attribute | Value |
|-----------|-------|
| Text | "Create free account" (NOT "Sign up" or "Submit") |
| Colour | Gold bg (#c5a55a), navy text (#1a2b4a) — different from login button to visually separate flows |
| Height | 48px |
| Loading | Spinner + "Creating your account..." |
| Success | Redirect to onboarding step 1 |

### 4.5 Post-signup flow

```
Step 1: User clicks "Create free account"
Step 2: Account created, auto-login, redirect to onboarding
Step 3: Onboarding wizard begins:
        "Welcome to EzyRetire! Let's set up your financial workspace."
        Step 1/7: What's your name?
        Step 2/7: When were you born?
        Step 3/7: When do you want to retire?
        ...
Step 4: After onboarding leads to Dashboard with real data
```

**No email verification wall.** Let the user in immediately. Send verification email in background. If unverified after 7 days, show gentle banner: "Please verify your email to keep your account secure."

### 4.6 Differentiating login vs signup visually

| Element | Login page | Signup page |
|---------|-----------|-------------|
| Heading | "Welcome back" | "Get started free" |
| Primary button colour | Navy (#1a2b4a) | Gold (#c5a55a) |
| Button text | "Log in" | "Create free account" |
| Google/Apple text | "Continue with Google" | "Sign up with Google" |
| Bottom link | "Don't have an account? Get started free" | "Already have an account? Log in" |
| Left panel stat | "Join 5,000+ Indians..." | "Join 5,000+ Indians..." (same) |

## 5. Forgot Password Page

### 5.1 Layout

Centered card on white background. No split-screen — this is a utility page.

```
+-----------------------------+
|                             |
|    [infinity EzyRetire]     |
|                             |
|    "Reset your password"    |
|    "Enter your email and    |
|     we'll send you a link"  |
|                             |
|    Email ________________   |
|                             |
|    [ Send reset link ]      |
|                             |
|    Back to login            |
|                             |
+-----------------------------+
```

### 5.2 States

| State | What happens |
|-------|-------------|
| Valid email submitted | "Check your email. We sent a password reset link to v***@gmail.com." Masked email. "Resend" link active after 60 seconds. |
| Unknown email | Same success message. Never reveal whether an email exists. |
| Rate limiting | After 3 attempts: "You've requested too many resets. Try again in 10 minutes." |

## 6. Profile Page — Redesigned Specification

### 6.1 Philosophy

The profile page is NOT a form dump. It's organised into clear sections that the user can expand and edit independently. Each section saves independently. No single "Save all" button requiring scrolling.

### 6.2 Layout — 8 sections

```
+---------------------------------------------------+
|  PROFILE                                    [Edit]|
|                                                   |
|  [Avatar]  Vikrant Chaudhary                      |
|   VC       vikrant@ezyretire.com                  |
|            Member since Sep 2026                  |
|            Free plan                              |
|                                                   |
+---------------------------------------------------+
|  PERSONAL DETAILS                       [Edit]    |
|  Full name        Vikrant Chaudhary               |
|  Date of birth    15 Jan 1995                     |
|  Gender           Male                            |
|  City             Gurugram                        |
|  Phone            +91 98765 43210 (optional)      |
|  Marital status   Married                         |
|  Dependants       1 (child, age 3)                |
+---------------------------------------------------+
|  RETIREMENT SETTINGS                    [Edit]    |
|  Current age              31                      |
|  Expected retirement age  55                      |
|  Life expectancy          85                      |
|  Risk tolerance           Moderate                |
+---------------------------------------------------+
|  FINANCIAL ASSUMPTIONS                  [Edit]    |
|  Expected return (equity)     12%                 |
|  Expected return (debt)       7%                  |
|  Inflation rate               6%                  |
|  Salary growth rate           8%                  |
|  Tax regime                   New regime          |
+---------------------------------------------------+
|  SECURITY & LOGIN                       [Edit]    |
|  Email              vikrant@ezyretire.com Verified|
|  Password           Last changed 3 days ago       |
|  Connected accounts Google connected              |
|  Two-factor auth    Not enabled [Enable]          |
|  Active sessions    1 device [View all]           |
|  Last login         Today, 11:42 PM from Chrome   |
+---------------------------------------------------+
|  NOTIFICATIONS                          [Edit]    |
|  Monthly summary email      ON                    |
|  Budget alerts              ON                    |
|  Retirement milestone       ON                    |
|  Marketing emails           OFF                   |
|  Push notifications         ON                    |
|  Quiet hours                10 PM - 8 AM          |
+---------------------------------------------------+
|  DATA & PRIVACY                         [Edit]    |
|  Export my data      [Download]                   |
|  Delete my account   [Request deletion]           |
|  Privacy policy      [View]                       |
|  Terms of service    [View]                       |
+---------------------------------------------------+
|  SUBSCRIPTION                           [Manage]  |
|  Current plan       Free                          |
|  Upgrade to Premium 499/month                     |
|  Premium includes   AI statement scanning, receipt|
|                     OCR, SMS OTP, priority support |
+---------------------------------------------------+
```

### 6.3 Section 1: Profile header (always visible)

| Element | Specification |
|---------|--------------|
| Avatar | Circle, 80px. Initials (VC) in navy bg + white text. Option to upload photo. |
| Name | Inter SemiBold 20px, #1a2b4a |
| Email | Inter Regular 14px, #718096 |
| Member since | Inter Regular 13px, #a0aec0 |
| Plan badge | Pill shape: "Free" in grey or "Premium" in gold |

### 6.4 Section 2: Personal details

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Full name | Text | Yes | Auto-populated from Google SSO if available |
| Date of birth | Date picker | Yes | Must be 18+. Used for age calculation everywhere |
| Gender | Select (Male/Female/Other/Prefer not to say) | No | Used for life expectancy defaults |
| City | Autocomplete text | No | Used for HRA (metro vs non-metro) |
| Phone | Phone input with +91 | No | "Add phone for quick OTP login" |
| Marital status | Select | No | Affects tax and retirement planning |
| Dependants | Number + type | No | Each: name, relationship, DOB |

### 6.5 Section 3: Retirement settings

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| Current age | Auto-calculated from DOB | Read-only | Shows "31 years" |
| Retirement age | Slider 40-75 | 60 | Shows "29 years to go" |
| Life expectancy | Slider 70-100 | 85 | Tooltip: "Average Indian male: 70.4, female: 73.1. Plan longer." |
| Risk tolerance | Select (Conservative/Moderate/Aggressive) | Moderate | "Not sure? Take a 2-minute quiz" link |

### 6.6 Section 4: Financial assumptions

| Field | Default | Source | Notes |
|-------|---------|--------|-------|
| Expected equity return | 12% | Admin default | Tooltip: "Historical Nifty 50 CAGR: ~12% over 20 years" |
| Expected debt return | 7% | Admin default | Tooltip: "Current FD rates: 6.5-7.5%" |
| Inflation rate | 6% | Admin default | Tooltip: "RBI target: 4%. Historical average: 6%" |
| Salary growth rate | 8% | Admin default | Tooltip: "Average Indian salary growth: 8-10% p.a." |
| Tax regime | New | Auto-recommended | "Recommended based on your salary" |

### 6.7 Section 5: Security and login

| Feature | Specification |
|---------|--------------|
| Email | Shown with verification status (Verified / Not verified) |
| Change password | Inline form: Current password, New password, Confirm. Strength indicator |
| Connected accounts | Google/Apple status. Connect/disconnect buttons |
| Two-factor auth | Toggle. Options: Authenticator app (TOTP) or SMS (premium). Setup wizard with QR |
| Active sessions | Device name, browser, location, last active. "Sign out all other devices" button |
| Last login | Date, time, browser, approximate location |

### 6.8 Section 6: Notifications

| Notification | Default | Premium? |
|-------------|---------|----------|
| Monthly summary email | ON | No |
| Budget exceeded alert | ON | No |
| Retirement milestone | ON | No |
| Bill/EMI due reminder | ON | No |
| Weekly financial tip | ON | No |
| Marketing emails | OFF | No |
| Push notifications | ON | No |
| SMS alerts | OFF | Yes |
| Quiet hours | 10 PM - 8 AM | No |

### 6.9 Section 7: Data and privacy

| Action | Specification |
|--------|--------------|
| Export my data | JSON/CSV download within 24 hours. Email when ready. DPDP Act compliance |
| Delete account | Confirmation modal: type "DELETE". 15-day cooling period with undo |
| Privacy policy | Opens in new tab |
| Terms of service | Opens in new tab |

### 6.10 Section 8: Subscription

| Element | Specification |
|---------|--------------|
| Current plan | "Free" or "Premium" with badge |
| Comparison | Expandable Free vs Premium feature comparison |
| Upgrade CTA | Gold button "Upgrade to Premium" |
| Billing history | Past invoices with download links |

### 6.11 Edit behaviour rules

| Behaviour | Specification |
|-----------|--------------|
| Click "Edit" | Section enters edit mode. Fields become editable. "Save" and "Cancel" appear. |
| Save | Saves only that section. Green toast: "Personal details updated." Returns to view mode. |
| Cancel | Discards changes. Returns to view mode. No confirmation needed. |
| Unsaved changes + navigate | Browser "unsaved changes" warning |
| Validation errors | Inline, below field, red. Save button disabled until resolved. |
| Toggles | Auto-save immediately. Brief "Saved" confirmation. |

## 7. Mobile-Specific Rules

### Auth pages

| Rule | Specification |
|------|--------------|
| No split-screen | Left panel becomes compact logo + tagline header above form |
| Larger targets | All buttons minimum 48px, fields minimum 44px |
| Keyboard-aware | Form scrolls when keyboard appears, active field always visible |
| Biometric | Show "Log in with Face ID/Fingerprint" above Google/Apple on supported devices |
| Autofill | Correct autocomplete attributes on all fields |
| Safe area | iPhone notch + home indicator padding |

### Profile page

| Rule | Specification |
|------|--------------|
| Sections collapsed | Only header visible by default. Tap to expand. |
| Sticky header | Avatar + name fixed at top during scroll |
| Bottom sheet editing | Edit opens bottom sheet instead of inline on mobile |
| Pull to refresh | Refresh profile data |

## 8. Accessibility Requirements

| Requirement | Specification |
|-------------|--------------|
| Keyboard | Tab through all fields, Enter to submit, Escape to cancel |
| Screen reader | All fields have proper label elements. Errors announced via aria-live |
| Colour contrast | WCAG AA: 4.5:1 body text, 3:1 large text |
| Focus indicators | 2px gold (#c5a55a) outline. Never remove focus outline |
| Reduced motion | Respect prefers-reduced-motion |
| Touch targets | Minimum 44x44px. 8px gap between tappable elements |

## 9. Security Specifications

| Specification | Rule |
|---------------|------|
| Password hashing | bcrypt with cost factor 12 minimum. Never plaintext |
| Session management | JWT 24-hour expiry. Refresh token 30-day. Rotate on use |
| Rate limiting | Login: 5/15min/IP. Signup: 3/hour/IP. Reset: 3/hour/email |
| CSRF | SameSite cookies + CSRF token on state-changing requests |
| Input sanitisation | Server-side. XSS prevention on all rendered content |
| Session display | Users can see and revoke active sessions |
| OAuth scopes | Google: email and profile only. Never request contacts or drive |

## 10. Implementation Priority

| Priority | Task | Effort | Sprint |
|----------|------|--------|--------|
| P0 | Add Google OAuth (most impactful single change) | 1 day | Sprint 1 |
| P0 | Split login/signup into two visually distinct pages | 1 day | Sprint 1 |
| P0 | Add split-screen layout with left panel on desktop | 2 days | Sprint 1 |
| P0 | Inline validation and error states | 1 day | Sprint 1 |
| P1 | Add Apple Sign-In | 1 day | Sprint 2 |
| P1 | Build profile page with all 8 sections | 3 days | Sprint 2 |
| P1 | Forgot password flow | 1 day | Sprint 2 |
| P1 | Mobile optimisation (targets, keyboard, safe area) | 2 days | Sprint 2 |
| P2 | Biometric login via WebAuthn | 2 days | Sprint 3 |
| P2 | OTP login for premium users | 2 days | Sprint 3 |
| P2 | Two-factor authentication setup | 2 days | Sprint 3 |
| P2 | Dark mode for auth pages | 1 day | Sprint 3 |
| P3 | Session management (view/revoke devices) | 1 day | Sprint 4 |
| P3 | Data export and account deletion | 2 days | Sprint 4 |

## 11. Professional Apps Referenced

| App | What we learned | Category |
|-----|----------------|----------|
| **Stripe** | Clean signup, minimal fields, developer trust | Payments |
| **Notion** | Centered card, multiple auth methods, monochrome | Productivity |
| **Linear** | Split-screen, dark mode, Inter font, minimal | Project management |
| **Wise** | Fintech auth, bold branding, conventional form | International payments |
| **Revolut** | Biometric-first, phone OTP, trust signals | Neobank |
| **CRED** | Premium dark aesthetic, Indian market | Indian fintech |
| **Groww** | Google login first, phone OTP, simple | Indian investments |
| **Zerodha** | Minimal, fast, mobile-first | Indian brokerage |
| **Scripbox** | Advisory feel, trust badges, retirement focus | Indian wealth |
| **Headspace** | Calm microcopy, warm split-screen, empathetic tone | Wellness |
| **Duolingo** | Lightweight modal, clear hierarchy | Education |
| **Canva** | Modal signup, lifestyle image, passwordless option | Design |
| **SoFi** | Finance login, all-white card, logical field sequence | US fintech |
| **Asana** | Single-promise signup, no card, multiple SSO | Productivity |

## 12. Golden Rules

1. **The auth page IS the first impression.** Users decide in 3 seconds whether they trust EzyRetire with their financial data. The page must look premium, not like a student project.

2. **Google login is the highest-leverage single change.** One click, no password, no email verification. 40-60% of users will choose it.

3. **Never ask for information you don't need right now.** Email + password at signup. Everything else during onboarding. Every extra field drops conversion by 10%.

4. **Inline validation, not post-submit errors.** Users should never hit a button and see a page full of red. Validate each field on blur.

5. **Login and signup must look visually different.** Different headings, different button colours, different microcopy. Users should never wonder which page they're on.

6. **Profile is sections, not a scroll-of-doom.** Collapsible sections that save independently. Nobody should scroll past Notifications to find Security.

7. **Security is visible but not intrusive.** Trust badges on auth page, biometrics and encryption invisible in background. Show the lock icon; hide the complexity.

8. **Mobile is not a compressed desktop.** Different layout, different interaction patterns (bottom sheets, larger targets, biometric prompts), different content priority.

9. **Every error message must be calm and helpful.** This is a finance app — users are already anxious about money. An aggressive error message is a trust violation.

10. **Test on real phones.** Not browser dev tools. Real phones, real thumbs, real keyboards, real network conditions.
