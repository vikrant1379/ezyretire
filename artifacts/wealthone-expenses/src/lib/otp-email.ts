export function normalizeOtpEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function getOtpEmailValidationError(value: string): string | null {
  const email = normalizeOtpEmail(value);
  if ((email.match(/@/g) ?? []).length > 1 || /[,;\s]/.test(email)) {
    return "Enter one email address only. It looks like two addresses may have been joined together.";
  }
  if (!email || email.length > 254 || email.includes("..")) {
    return "Enter a valid email address, such as name@example.com.";
  }
  const [local, domain, extra] = email.split("@");
  if (
    extra !== undefined
    || !local
    || local.length > 64
    || local.startsWith(".")
    || local.endsWith(".")
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    || !domain
    || !domain.includes(".")
    || domain.length > 253
    || !domain.split(".").every((label) =>
      label.length > 0
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  ) {
    return "Enter a valid email address, such as name@example.com.";
  }
  return null;
}