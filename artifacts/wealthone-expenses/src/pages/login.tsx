import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { BrandLogo } from "@/components/brand-logo";
import { formatDateOnly } from "@/lib/storage";
import { readAuthResponse } from "../lib/auth-response";
import { getOtpEmailValidationError, normalizeOtpEmail } from "../lib/otp-email";
import { getOptionalOnboardingPhoneError } from "../lib/onboarding-phone";
import {
  forgetRememberedAccount,
  readRememberedAccount,
  rememberAccount,
  type RememberedAccount,
} from "../lib/remembered-account";
import {
  trackAuthFunnelSuccess,
  trackCodeRequestSuccess,
  type CodeRequestKind,
} from "../lib/auth-analytics";
import {
  authenticationCredentialToJSON,
  getWebAuthnErrorMessage,
  isWebAuthnAvailable,
  parseRequestOptions,
} from "../lib/webauthn";
import { ShieldCheck, KeyRound, Loader2, Delete, Check } from "lucide-react";

type LoginStep = "email" | "code" | "profile" | "pin" | "pinSetup";

export default function Login() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const returnTo = safeReturnTo(params.get("returnTo"));
  const deletionScheduled = params.get("accountDeletion") === "scheduled";
  const changingPin = params.get("changePin") === "true";
  const verifyingPasskeys = params.get("verify") === "passkeys";
  const [rememberedAccount, setRememberedAccount] = useState<RememberedAccount | null>(() =>
    deletionScheduled ? null : readRememberedAccount(),
  );
  const [email, setEmail] = useState(() => verifyingPasskeys ? "" : rememberedAccount?.email ?? "");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [step, setStep] = useState<LoginStep>(
    changingPin || verifyingPasskeys ? "email" : rememberedAccount ? "pin" : "email",
  );
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [confirmingPin, setConfirmingPin] = useState(false);
  const [resettingPin, setResettingPin] = useState(changingPin);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState<Date>();
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneChallengeId, setPhoneChallengeId] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [isVerifyingPhone, setIsVerifyingPhone] = useState(false);
  const [phoneResendSeconds, setPhoneResendSeconds] = useState(0);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [isPasskeySubmitting, setIsPasskeySubmitting] = useState(false);
  const [passkeyStepUpReady, setPasskeyStepUpReady] = useState(!verifyingPasskeys);

  useEffect(() => {
    setPasskeyAvailable(isWebAuthnAvailable());
  }, []);

  useEffect(() => {
    if (!verifyingPasskeys) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/auth/user", { credentials: "include", signal: controller.signal });
        const body = await readAuthResponse<{ error?: string; user?: { email?: string | null } }>(response);
        if (!response.ok || !body.user?.email) {
          throw new Error(body.error || "Sign in again from Settings before verifying passkeys.");
        }
        setEmail(normalizeOtpEmail(body.user.email));
        setPasskeyStepUpReady(true);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Sign in again from Settings before verifying passkeys.");
      }
    })();
    return () => controller.abort();
  }, [verifyingPasskeys]);

  useEffect(() => {
    if (deletionScheduled) forgetRememberedAccount();
  }, [deletionScheduled]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (phoneResendSeconds <= 0) return;
    const timer = window.setInterval(() => setPhoneResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [phoneResendSeconds]);

  async function requestPhoneCode() {
    if (!fullName.trim() || !dateOfBirth || !gender) {
      throw new Error("Complete your name, date of birth, and gender before verifying mobile");
    }
    const phoneError = getOptionalOnboardingPhoneError(phone);
    if (phoneError) throw new Error(phoneError);
    const saveResponse = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        fullName: fullName.trim(),
        dateOfBirth: formatDateOnly(dateOfBirth),
        gender,
        phone: phone.trim(),
        onboardingCompleted: false,
      }),
    });
    const saveBody = await readAuthResponse<{ error?: string }>(saveResponse);
    if (!saveResponse.ok) throw new Error(saveBody.error || "Unable to save mobile number");
    const response = await fetch("/api/auth/mobile-otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ phone: phone.trim() }),
    });
    const body = await readAuthResponse<{ error?: string; challengeId?: string; resendAfterSeconds?: number }>(response);
    if (!response.ok || !body.challengeId) throw new Error(body.error || "Unable to send mobile code");
    setPhoneChallengeId(body.challengeId);
    setPhoneResendSeconds(body.resendAfterSeconds ?? 60);
    setPhoneCode("");
  }

  async function verifyPhoneCode() {
    const response = await fetch("/api/auth/mobile-otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ challengeId: phoneChallengeId, code: phoneCode }),
    });
    const body = await readAuthResponse<{ error?: string }>(response);
    if (!response.ok) throw new Error(body.error || "Unable to verify mobile code");
    setPhoneVerified(true);
  }

  async function requestCode(requestKind: CodeRequestKind) {
    const validationError = getOtpEmailValidationError(email);
    if (validationError) throw new Error(validationError);
    const normalizedEmail = normalizeOtpEmail(email);
    setEmail(normalizedEmail);
    const response = await fetch("/api/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(verifyingPasskeys ? { purpose: "passkey_management" } : { email: normalizedEmail }),
    });
    const body = await readAuthResponse<{ error?: string; challengeId?: string; resendAfterSeconds?: number; retryAfterSeconds?: number }>(response);
    if (!response.ok || !body.challengeId) {
      if (body.retryAfterSeconds) setResendSeconds(body.retryAfterSeconds);
      throw new Error(body.error || "Unable to send a sign-in code");
    }
    trackCodeRequestSuccess(requestKind);
    setChallengeId(body.challengeId);
    setResendSeconds(body.resendAfterSeconds ?? 60);
    setCode("");
    setStep("code");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      if (step === "email") {
        await requestCode("initial");
        return;
      }
      if (step === "profile" && (!fullName.trim() || !dateOfBirth || !gender)) {
        throw new Error("Complete your name, date of birth, and gender to create your account");
      }
      if (step === "profile") {
        const phoneError = getOptionalOnboardingPhoneError(phone);
        if (phoneError) throw new Error(phoneError);
        if (phone.trim() && !phoneVerified) {
          throw new Error("Verify this mobile number, or clear it to continue with email only");
        }
      }
      const response = await fetch(step === "code" ? "/api/auth/otp/verify" : "/api/auth/profile", {
        method: step === "profile" ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(step === "code"
            ? { challengeId, code }
            : step === "profile"
              ? {
                  fullName: fullName.trim(),
                  dateOfBirth: formatDateOnly(dateOfBirth!),
                  gender,
                  phone: phoneVerified ? phone.trim() : null,
                  onboardingCompleted: true,
                }
              : {}),
        }),
      });
      const body = await readAuthResponse<{
        error?: string;
        user?: {
          isAdmin?: boolean;
          email?: string | null;
          fullName?: string | null;
          dateOfBirth?: string | null;
          gender?: string | null;
          phone?: string | null;
          onboardingCompleted?: boolean;
        };
        needsProfile?: boolean;
        pinConfigured?: boolean;
        passkeyStepUpAuthorized?: boolean;
      }>(response);
      if (!response.ok) throw new Error(body.error || "Unable to sign in");
      if (step === "code") {
        trackAuthFunnelSuccess("verification");
        if (verifyingPasskeys) {
          if (!body.passkeyStepUpAuthorized) throw new Error("Sign in again from Settings before verifying passkeys.");
          rememberAuthenticatedAccount(body.user);
          navigate(returnTo);
          window.location.reload();
          return;
        }
        if (body.needsProfile) {
          setStep("profile");
          return;
        }
        if (resettingPin || !body.pinConfigured) {
          setPin("");
          setFirstPin("");
          setConfirmingPin(false);
          setStep("pinSetup");
          return;
        }
      }
      if (step === "profile") {
        trackAuthFunnelSuccess("profileCompletion");
        setPin("");
        setFirstPin("");
        setConfirmingPin(false);
        setStep("pinSetup");
        return;
      }
      rememberAuthenticatedAccount(body.user);
      navigate(returnTo);
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in");
    } finally {
      setIsSubmitting(false);
    }
  }

  function rememberAuthenticatedAccount(user: { email?: string | null; fullName?: string | null } | undefined) {
    const nextEmail = user?.email || email;
    const nextName = user?.fullName || fullName || rememberedAccount?.fullName;
    if (!nextEmail || !nextName) return;
    const account = { email: nextEmail, fullName: nextName };
    rememberAccount(account);
    setRememberedAccount(account);
  }

  async function completePinEntry() {
    if (pin.length !== 4) return;
    setError("");
    if (step === "pinSetup" && !confirmingPin) {
      setFirstPin(pin);
      setPin("");
      setConfirmingPin(true);
      return;
    }
    if (step === "pinSetup" && pin !== firstPin) {
      setPin("");
      setFirstPin("");
      setConfirmingPin(false);
      setError("Those PINs did not match. Create your PIN again.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch(step === "pin" ? "/api/auth/pin/login" : "/api/auth/pin/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(step === "pin" ? { email: rememberedAccount?.email, pin } : { pin }),
      });
      const body = await readAuthResponse<{ error?: string; user?: { email?: string | null; fullName?: string | null } }>(response);
      if (!response.ok) throw new Error(body.error || "Unable to sign in with this PIN");
      rememberAuthenticatedAccount(body.user);
      navigate(returnTo);
      window.location.reload();
    } catch (pinError) {
      setPin("");
      setError(pinError instanceof Error ? pinError.message : "Unable to sign in with this PIN");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resetPinWithEmail() {
    if (!rememberedAccount) return;
    setError("");
    setResettingPin(true);
    setEmail(rememberedAccount.email);
    setIsSubmitting(true);
    try {
      await requestCode("initial");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to send a sign-in code");
    } finally {
      setIsSubmitting(false);
    }
  }

  function useDifferentAccount() {
    forgetRememberedAccount();
    setRememberedAccount(null);
    setEmail("");
    setPin("");
    setError("");
    setResettingPin(false);
    setStep("email");
  }

  async function signInWithPasskey() {
    setError("");
    setIsPasskeySubmitting(true);
    try {
      if (!navigator.onLine) throw new Error("offline");
      const optionsResponse = await fetch("/api/auth/passkeys/authentication/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      const optionsBody = await readAuthResponse<{
        error?: string;
        challengeId?: string;
        options?: Parameters<typeof parseRequestOptions>[0];
        publicKey?: Parameters<typeof parseRequestOptions>[0];
      }>(optionsResponse);
      if (!optionsResponse.ok) throw new Error("unavailable");
      const publicKey = optionsBody.options || optionsBody.publicKey;
      if (!publicKey || !optionsBody.challengeId) throw new Error("unavailable");
      const credential = await navigator.credentials.get({ publicKey: parseRequestOptions(publicKey) });
      if (!(credential instanceof PublicKeyCredential)) throw new Error("unavailable");
      const verifyResponse = await fetch("/api/auth/passkeys/authentication/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          challengeId: optionsBody.challengeId,
          response: authenticationCredentialToJSON(credential),
        }),
      });
      await readAuthResponse<unknown>(verifyResponse);
      if (!verifyResponse.ok) throw new Error("verification");
      window.location.assign(returnTo);
    } catch (passkeyError) {
      setError(
        passkeyError instanceof Error && passkeyError.message === "offline"
          ? "Passkey sign-in needs an internet connection. You can use an email code when you're back online."
          : getWebAuthnErrorMessage(passkeyError, "sign in"),
      );
    } finally {
      setIsPasskeySubmitting(false);
    }
  }

  const heading = step === "pin"
    ? `Hi, ${rememberedAccount?.fullName || "there"}`
    : step === "pinSetup"
      ? confirmingPin ? "Confirm your PIN" : changingPin ? "Choose your new PIN" : "Create your ezyRetire PIN"
      : step === "email"
        ? changingPin ? "Verify to change your PIN" : verifyingPasskeys ? "Verify to manage passkeys" : "Welcome back"
        : step === "code" ? "Check your email" : "Complete your profile";
  const description = step === "pin"
    ? "Enter your ezyRetire PIN"
    : step === "pinSetup"
      ? confirmingPin ? "Enter the same four digits once more." : changingPin ? "Choose four digits to replace your current ezyRetire PIN." : "Choose four digits for faster secure sign-in on this account."
      : step === "email"
        ? changingPin
          ? "We’ll send a fresh six-digit code to your account email before you can replace your PIN."
          : verifyingPasskeys
            ? "We’ll send a fresh six-digit code to your account email before you can add or manage passkeys."
            : "Sign in to continue to your personal financial workspace, or create an account to get started."
        : step === "code" ? `Enter the 6-digit code sent to ${email}.` : "Tell us a little about yourself to personalize your retirement plan.";

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-muted/25 font-sans">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.10),transparent_42%)] dark:bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_46%)]" aria-hidden="true" />
      <section
        className="safe-area-x relative flex h-full w-full flex-col items-center overflow-x-hidden overflow-y-auto py-[calc(1.25rem+var(--app-safe-top))] pb-[calc(1.25rem+var(--app-safe-bottom))] sm:px-[calc(2rem+var(--app-safe-left))] sm:py-[calc(2rem+var(--app-safe-top))] sm:pb-[calc(2rem+var(--app-safe-bottom))]"
        data-testid="auth-scroll-container"
      >
        <div className="my-auto w-full max-w-[460px] rounded-2xl border border-border/70 bg-card px-5 py-7 shadow-xl shadow-primary/5 sm:px-9 sm:py-9" aria-labelledby="auth-heading" data-testid="auth-content">
          <div className="mb-7 flex flex-col items-center"><BrandLogo className="h-14 max-w-[13rem] sm:h-16 sm:max-w-[14rem]" /></div>
          <div className="mb-7 text-center">
            <h1 id="auth-heading" className="font-serif text-3xl font-medium text-foreground sm:text-4xl">{heading}</h1>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">{description}</p>
          </div>

          {deletionScheduled && (
            <div role="status" className="mb-6 rounded-lg border border-warning/30 bg-warning-background p-3.5 text-sm text-foreground" data-testid="status-account-deletion-signed-out">
              Deletion is scheduled and all sessions are signed out. Sign in within seven days to return to Settings and cancel.
            </div>
          )}

          {step === "email" && passkeyAvailable && !changingPin && !verifyingPasskeys && (
            <div className="mb-6 space-y-5">
              <Button type="button" variant="outline" className="h-12 w-full gap-2 rounded-lg border-primary/30 bg-background text-base font-medium shadow-sm" disabled={isPasskeySubmitting || isSubmitting} onClick={signInWithPasskey} data-testid="button-sign-in-passkey" aria-describedby="passkey-sign-in-help">
                {isPasskeySubmitting ? <><Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" /> Waiting for your passkey…</> : <><KeyRound className="h-5 w-5" aria-hidden="true" /> Sign in with a passkey</>}
              </Button>
              <p id="passkey-sign-in-help" className="text-center text-xs leading-relaxed text-muted-foreground">Use your device screen lock, fingerprint, or face. ezyRetire never receives your biometric data.</p>
              <div className="flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-border" /><span className="text-xs font-medium text-muted-foreground">or use email</span><span className="h-px flex-1 bg-border" /></div>
            </div>
          )}
          {isPasskeySubmitting && <p className="sr-only" role="status" aria-live="polite">Waiting for your browser to verify your passkey.</p>}

          {(step === "pin" || step === "pinSetup") && (
            <>
              <PinKeypad value={pin} disabled={isSubmitting} onChange={setPin} onComplete={completePinEntry} />
              {error && <div className="mt-6 rounded-lg border border-destructive/20 bg-destructive/10 p-3.5"><p role="alert" className="text-sm font-medium text-destructive">{error}</p></div>}
            </>
          )}
          {step === "pin" && (
            <div className="mt-7 flex flex-col items-center gap-2 text-sm">
              <button type="button" className="min-h-11 px-3 font-medium text-primary transition-colors hover:text-primary/80" onClick={resetPinWithEmail} disabled={isSubmitting} data-testid="button-forgot-pin">Forgot PIN?</button>
              <button type="button" className="min-h-11 px-3 text-muted-foreground transition-colors hover:text-foreground" onClick={useDifferentAccount} disabled={isSubmitting} data-testid="button-use-different-account">Not {rememberedAccount?.fullName}? Use another account</button>
            </div>
          )}

          <form onSubmit={submit} className={step === "pin" || step === "pinSetup" ? "hidden" : "space-y-6"}>
            {step === "email" && (
              <div className="space-y-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
                <Label htmlFor="email" className="font-medium text-foreground/80">Email address</Label>
                <Input id="email" type="text" inputMode="email" autoComplete="email" spellCheck={false} required autoFocus readOnly={verifyingPasskeys} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="h-12 rounded-lg border-border/80 bg-background px-4 shadow-sm transition-all focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring" data-testid="input-email" />
              </div>
            )}
            {step === "code" && (
              <div className="space-y-3 motion-safe:animate-in motion-safe:slide-in-from-right-2 motion-safe:duration-300">
                <Label htmlFor="code" className="font-medium text-foreground/80">6-digit sign-in code</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="h-14 rounded-lg border-border/80 bg-background text-center text-2xl font-medium tracking-[0.35em] shadow-sm transition-all focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring" data-testid="input-code" />
                <div className="flex items-center justify-between pt-2 text-sm">
                  <button type="button" className="min-h-11 font-medium text-primary transition-colors hover:text-primary/80" onClick={() => { setStep("email"); setError(""); }} data-testid="button-use-different-email">Use a different email</button>
                  <button type="button" disabled={resendSeconds > 0 || isSubmitting} className="min-h-11 font-medium text-primary transition-colors hover:text-primary/80 disabled:text-muted-foreground disabled:hover:text-muted-foreground" onClick={async () => { setError(""); setIsSubmitting(true); try { await requestCode("resend"); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to resend code"); } finally { setIsSubmitting(false); } }} data-testid="button-resend-code">{resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}</button>
                </div>
              </div>
            )}
            {step === "profile" && (
              <div className="space-y-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
                <div className="space-y-2"><Label htmlFor="full-name" className="font-medium text-foreground/80">Full name</Label><Input id="full-name" autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} className="h-11 border-border/80 bg-background shadow-sm focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring" data-testid="input-full-name" /></div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="date-of-birth" className="font-medium text-foreground/80">Date of birth</Label><DatePickerInput id="date-of-birth" value={dateOfBirth} onChange={setDateOfBirth} minDate={new Date(new Date().getFullYear() - 100, 0, 1)} maxDate={new Date()} showTodayShortcut={false} /></div>
                  <div className="space-y-2"><Label htmlFor="gender" className="font-medium text-foreground/80">Gender</Label><Select value={gender} onValueChange={setGender} required><SelectTrigger id="gender" className="h-11 border-border/80 bg-background shadow-sm focus:border-ring focus:ring-1 focus:ring-ring" data-testid="select-gender"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem><SelectItem value="Non-binary">Non-binary</SelectItem><SelectItem value="Prefer not to say">Prefer not to say</SelectItem></SelectContent></Select></div>
                </div>
                <div className="mt-2 space-y-3 rounded-xl border border-border/40 bg-muted/30 p-5">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Contact details</p>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="font-medium text-foreground/80">Mobile number <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setPhoneVerified(false); }} className="h-11 border-border/80 bg-background shadow-sm focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring" data-testid="input-phone" />
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" disabled={!phone.trim() || phoneVerified || isVerifyingPhone || phoneResendSeconds > 0} onClick={async () => { setError(""); setIsVerifyingPhone(true); try { await requestPhoneCode(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to send mobile code"); } finally { setIsVerifyingPhone(false); } }} data-testid="button-request-mobile-code">{phoneVerified ? "Verified" : phoneResendSeconds > 0 ? `Resend in ${phoneResendSeconds}s` : phoneChallengeId ? "Resend code" : "Verify by SMS"}</Button>
                      {phoneChallengeId && !phoneVerified && <><Input aria-label="Mobile verification code" inputMode="numeric" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} placeholder="SMS code" data-testid="input-mobile-code" /><Button type="button" onClick={async () => { setError(""); try { await verifyPhoneCode(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to verify mobile code"); } }} data-testid="button-verify-mobile-code">Confirm</Button></>}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{phoneVerified ? "Mobile number verified by SMS." : "Optional. Verify by SMS for recovery and security alerts. Email verification remains sufficient for access; it does not verify mobile ownership."}</p>
                    {phone.trim() && !phoneVerified && <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => { setPhone(""); setPhoneCode(""); setPhoneChallengeId(""); setError(""); }} data-testid="button-continue-email-only">Continue with email only</Button>}
                  </div>
                </div>
              </div>
            )}
            {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"><p role="alert" className="flex items-start gap-2.5 text-sm font-medium text-destructive"><span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-destructive/50 text-xs font-bold">!</span>{error}</p></div>}
            <Button type="submit" className="mt-2 h-12 w-full rounded-lg bg-primary text-base font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 active:scale-[0.99]" disabled={isSubmitting || (step === "email" && resendSeconds > 0) || (step === "email" && verifyingPasskeys && !passkeyStepUpReady)} data-testid="button-submit-auth">
              {isSubmitting ? <span className="flex items-center gap-2"><Loader2 className="h-5 w-5 motion-safe:animate-spin" />Please wait...</span> : step === "email" && resendSeconds > 0 ? `Try again in ${resendSeconds}s` : step === "email" ? "Email me a code" : step === "code" ? "Verify and continue" : "Complete account"}
            </Button>
          </form>

          {step !== "pin" && step !== "pinSetup" && (
            <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground/80">
              {step === "email"
                ? changingPin
                  ? "The code must be verified before you can choose a new PIN."
                  : verifyingPasskeys
                    ? "The code authorizes passkey management in this browser for 15 minutes."
                    : "We’ll email you a 6-digit code. New here? Your account will be created after verification."
                : step === "code"
                  ? "Your code verifies your email before a secure session begins."
                  : "Your details are used to personalize your plan."}
            </p>
          )}
          {step === "email" && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border/60 pt-5 text-xs text-muted-foreground" data-testid="status-passwordless-trust">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />Email verified</span>
              <span className="inline-flex items-center gap-1.5"><KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />Passwordless</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

interface PinKeypadProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onComplete: () => void;
}

function PinKeypad({ value, disabled, onChange, onComplete }: PinKeypadProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (disabled) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        onChange(`${value}${event.key}`.slice(0, 4));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        onChange(value.slice(0, -1));
      } else if (event.key === "Enter" && value.length === 4) {
        event.preventDefault();
        onComplete();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, onChange, onComplete, value]);

  return (
    <div className="mx-auto w-full max-w-[340px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      <div className="mb-10 flex justify-center gap-3 sm:gap-4" role="group" aria-label={`${value.length} of 4 PIN digits entered`} data-testid="pin-digit-boxes">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={`flex h-16 w-14 items-center justify-center rounded-2xl border text-3xl font-semibold transition-all sm:h-[4.5rem] sm:w-16 ${index === value.length ? "border-primary ring-2 ring-primary/20" : index < value.length ? "border-primary/60 bg-primary/5" : "border-border bg-card/40"}`} aria-hidden="true">
            {index < value.length ? "•" : ""}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-x-8 gap-y-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
          <button key={number} type="button" className="mx-auto flex h-14 w-16 items-center justify-center rounded-full text-2xl font-medium text-foreground transition-colors hover:bg-muted active:bg-muted/80 disabled:opacity-40" onClick={() => onChange(`${value}${number}`.slice(0, 4))} disabled={disabled || value.length >= 4} aria-label={`Enter ${number}`}>{number}</button>
        ))}
        <button type="button" className="mx-auto flex h-14 w-16 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted active:bg-muted/80 disabled:opacity-40" onClick={() => onChange(value.slice(0, -1))} disabled={disabled || value.length === 0} aria-label="Delete last digit"><Delete className="h-6 w-6" aria-hidden="true" /></button>
        <button type="button" className="mx-auto flex h-14 w-16 items-center justify-center rounded-full text-2xl font-medium text-foreground transition-colors hover:bg-muted active:bg-muted/80 disabled:opacity-40" onClick={() => onChange(`${value}0`.slice(0, 4))} disabled={disabled || value.length >= 4} aria-label="Enter 0">0</button>
        <button type="button" className="mx-auto flex h-14 w-16 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 active:bg-primary/15 disabled:text-muted-foreground" onClick={onComplete} disabled={disabled || value.length !== 4} aria-label="Continue" data-testid="button-submit-pin">{disabled ? <Loader2 className="h-6 w-6 motion-safe:animate-spin" /> : <Check className="h-7 w-7" />}</button>
      </div>
    </div>
  );
}