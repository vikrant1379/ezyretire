import crypto from "crypto";
import { getEnv } from "./env.js";

const KEY_LENGTH = 32;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

function encode(value: Buffer): string {
  return value.toString("base64url");
}

async function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function isValidAccountPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

export async function createAccountPinHash(pin: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await derive(pin, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${encode(salt)}$${encode(key)}`;
}

export async function verifyAccountPin(pin: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltValue, keyValue] = encoded.split("$");
  if (
    algorithm !== "scrypt"
    || Number(n) !== SCRYPT_N
    || Number(r) !== SCRYPT_R
    || Number(p) !== SCRYPT_P
    || !saltValue
    || !keyValue
  ) return false;
  try {
    const expected = Buffer.from(keyValue, "base64url");
    const actual = await derive(pin, Buffer.from(saltValue, "base64url"));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const secret = getEnv("SESSION_SECRET");
if (!secret || secret.length < 32) {
  throw new Error("SESSION_SECRET must be configured with at least 32 characters");
}
const dummySalt = crypto.createHmac("sha256", secret).update("ezyretire-pin-dummy").digest().subarray(0, 16);
const dummyKey = crypto.scryptSync("0000", dummySalt, KEY_LENGTH, {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: MAX_MEMORY,
});
export const DUMMY_ACCOUNT_PIN_HASH =
  `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${encode(dummySalt)}$${encode(dummyKey)}`;