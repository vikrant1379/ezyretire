# Input OTP

- Source: `artifacts/wealthone-expenses/src/components/ui/input-otp.tsx`
- Usage evidence: 0 application imports found; catalog story: `src/preview/demos/input-otp.tsx`.
- Dependencies: React, `input-otp`, Lucide `Minus`, `cn`.
- Public API: `InputOTP`, `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator`.
- Behavior: Wraps `OTPInput`; slots render active, filled, disabled, and caret states from `OTPInputContext`, with an optional visual separator.