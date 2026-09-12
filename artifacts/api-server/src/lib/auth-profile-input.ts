export function normalizeOptionalPhone(value: unknown): string | null {
  const phone = typeof value === "string" ? value.trim() : "";
  if (!phone) return null;
  return phone.startsWith("+") ? `+${phone.slice(1).replace(/\D/g, "")}` : phone.replace(/\D/g, "");
}

export function isValidOptionalPhone(phone: string | null): boolean {
  return phone === null || phone.replace(/\D/g, "").length >= 7;
}