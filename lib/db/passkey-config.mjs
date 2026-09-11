import { parse } from "tldts";

const LOOPBACK_RP_IDS = new Set(["localhost", "127.0.0.1"]);

export function validatePasskeyConfiguration({
  rpID: rawRpID,
  origin: rawOrigin,
  requireHttps = false,
}) {
  const problems = [];
  const rpID = rawRpID?.trim().toLowerCase() || "";
  const configuredOrigin = rawOrigin?.trim().replace(/\/+$/, "") || "";

  if (!rpID) problems.push("PASSKEY_RP_ID is not configured");
  if (!configuredOrigin) problems.push("PASSKEY_ORIGIN is not configured");

  if (rpID) {
    const parsedRpID = parse(rpID, { allowPrivateDomains: true });
    const loopbackAllowed = !requireHttps && LOOPBACK_RP_IDS.has(rpID);
    if (
      !loopbackAllowed
      && (
        parsedRpID.hostname !== rpID
        || parsedRpID.isIp
        || !parsedRpID.domain
        || parsedRpID.publicSuffix === rpID
      )
    ) {
      problems.push("PASSKEY_RP_ID must be a registrable domain suffix, not a public suffix, URL, port, or path");
    }
  }

  let origin;
  if (configuredOrigin) {
    try {
      origin = new URL(configuredOrigin);
      if (
        (origin.protocol !== "http:" && origin.protocol !== "https:")
        || origin.pathname !== "/"
        || origin.search
        || origin.hash
      ) {
        problems.push("PASSKEY_ORIGIN must be an HTTP or HTTPS origin without a path, query, or fragment");
      } else if (requireHttps && origin.protocol !== "https:") {
        problems.push("PASSKEY_ORIGIN must use HTTPS in production");
      }
    } catch {
      problems.push("PASSKEY_ORIGIN must be a valid HTTP or HTTPS origin");
    }
  }

  if (
    rpID
    && origin
    && origin.hostname !== rpID
    && !origin.hostname.endsWith(`.${rpID}`)
  ) {
    problems.push("PASSKEY_RP_ID must equal or be a registrable suffix of PASSKEY_ORIGIN");
  }

  return {
    problems: [...new Set(problems)],
    rpID,
    origin: origin?.origin,
  };
}