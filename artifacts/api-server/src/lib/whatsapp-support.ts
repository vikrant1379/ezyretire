const E164_DIGITS = /^[1-9]\d{7,14}$/;

export const WHATSAPP_SUPPORT_MESSAGE =
  "Hello ezyRetire support, I need help using my account.";

export function normalizeWhatsAppNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("+")) return null;

  const digits = trimmed.slice(1).replace(/[\s().-]/g, "");
  return E164_DIGITS.test(digits) ? `+${digits}` : null;
}

export function buildWhatsAppSupportUrl(value: string): string | null {
  const digits = normalizeWhatsAppNumber(value);
  if (!digits) return null;

  return `https://wa.me/${digits.slice(1)}?text=${encodeURIComponent(WHATSAPP_SUPPORT_MESSAGE)}`;
}