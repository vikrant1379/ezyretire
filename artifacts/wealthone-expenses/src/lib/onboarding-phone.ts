export function getOptionalOnboardingPhoneError(phone: string): string | undefined {
  const normalizedPhone = phone.trim();
  if (normalizedPhone && normalizedPhone.replace(/\D/g, "").length < 7) {
    return "Enter a valid mobile number";
  }
  return undefined;
}