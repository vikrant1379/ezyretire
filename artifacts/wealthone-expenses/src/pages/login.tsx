import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { BrandLogo } from "@/components/brand-logo";
import { readAuthResponse } from "../lib/auth-response";
import { getOtpEmailValidationError, normalizeOtpEmail } from "../lib/otp-email";

export default function Login({ adminOnly = false }: { adminOnly?: boolean }) {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const returnTo = adminOnly ? "/admin" : params.get("returnTo") || "/";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [step, setStep] = useState<"email" | "code" | "profile">("email");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  async function requestCode() {
    const validationError = getOtpEmailValidationError(email);
    if (validationError) throw new Error(validationError);
    const normalizedEmail = normalizeOtpEmail(email);
    setEmail(normalizedEmail);
    const response = await fetch("/api/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: normalizedEmail }),
    });
    const body = await readAuthResponse<{ error?: string; challengeId?: string; resendAfterSeconds?: number; retryAfterSeconds?: number }>(response);
    if (!response.ok || !body.challengeId) {
      if (body.retryAfterSeconds) setResendSeconds(body.retryAfterSeconds);
      throw new Error(body.error || "Unable to send a sign-in code");
    }
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
        await requestCode();
        return;
      }
      if (step === "profile" && (!fullName.trim() || !dateOfBirth || !gender || !phone.trim())) {
        throw new Error("Complete all profile fields to create your account");
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
                dateOfBirth,
                gender,
                phone: phone.trim(), onboardingCompleted: true,
              }
            : {}),
        }),
      });
      const body = await readAuthResponse<{
        error?: string;
        user?: {
          isAdmin?: boolean;
          fullName?: string | null;
          dateOfBirth?: string | null;
          gender?: string | null;
          phone?: string | null;
          onboardingCompleted?: boolean;
        };
        needsProfile?: boolean;
      }>(response);
      if (!response.ok) throw new Error(body.error || "Unable to sign in");
      if (step === "code" && body.needsProfile) {
        setStep("profile");
        return;
      }
      navigate(returnTo.startsWith("/") ? returnTo : "/");
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (adminOnly) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-serif text-xl text-foreground">Administrator sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Continue with your authorized Replit administrator identity.</p>
        </div>
        <Button asChild className="w-full"><a href={`/api/admin/login?returnTo=${encodeURIComponent(returnTo)}`}>Continue securely</a></Button>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-8 text-center">
          <BrandLogo className="mx-auto mb-5 h-24 max-w-full" />
          <h1 className="font-serif text-3xl font-semibold text-foreground">{adminOnly ? "ezyRetire admin" : "Welcome to ezyRetire"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "email" ? "Sign in or create an account with email" : step === "code" ? `Enter the code sent to ${email}` : "Finish creating your profile"}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-5">
          {step === "email" && <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="text" inputMode="email" autoComplete="email" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} />
           </div>}
          {step === "code" && <div className="space-y-2">
            <Label htmlFor="code">6-digit sign-in code</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="text-center text-xl tracking-[0.35em]" />
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-primary hover:underline" onClick={() => { setStep("email"); setError(""); }}>Use a different email</button>
              <button type="button" disabled={resendSeconds > 0 || isSubmitting} className="text-primary disabled:text-muted-foreground" onClick={async () => { setError(""); setIsSubmitting(true); try { await requestCode(); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to resend code"); } finally { setIsSubmitting(false); } }}>
                {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
              </button>
            </div>
          </div>}
           {step === "profile" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="full-name">Full name</Label>
                <Input id="full-name" autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="date-of-birth">Date of birth</Label>
                  <Input id="date-of-birth" type="date" required value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">Gender</Label>
                  <select id="gender" required value={gender} onChange={(event) => setGender(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground">
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-binary">Non-binary</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Mobile number</Label>
                <Input id="phone" type="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} />
                 <p className="text-xs text-muted-foreground">This number is saved as contact information. Mobile ownership is not yet verified.</p>
              </div>
            </>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
             {isSubmitting ? "Please wait..." : step === "email" ? "Email me a code" : step === "code" ? "Verify and continue" : "Complete account"}
          </Button>
        </form>
         <p className="mt-6 text-center text-xs text-muted-foreground">The same secure flow works for existing and new accounts. A session starts only after email verification.</p>
      </section>
    </main>
  );
}
