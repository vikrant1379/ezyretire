import crypto from "crypto";
import type { AuthUser } from "@workspace/api-zod";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type Request, type Response } from "express";
import * as client from "openid-client";

import { getEnv } from "./env.js";
export const ISSUER_URL = getEnv("ISSUER_URL") ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    const clientId = getEnv("OIDC_CLIENT_ID") ?? getEnv("REPL_ID");
    if (!clientId) {
      throw new Error(
        "OIDC_CLIENT_ID (or REPL_ID on Replit) must be configured for authentication",
      );
    }
    const clientSecret = getEnv("OIDC_CLIENT_SECRET");
    oidcConfig = await client.discovery(
      new URL(ISSUER_URL),
      clientId,
      clientSecret ? { client_secret: clientSecret } : undefined,
      clientSecret ? client.ClientSecretPost(clientSecret) : undefined,
    );
  }
  return oidcConfig;
}

export function isAdminIdentity(id: string, email: string | null): boolean {
  const ownerId = getEnv("REPL_OWNER_ID");
  if (ownerId && id === ownerId) return true;
  const adminEmails = (getEnv("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && adminEmails.includes(email.toLowerCase()));
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }
  return row.sess as unknown as SessionData;
}

export async function updateSession(sid: string, data: SessionData): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return req.cookies?.[SESSION_COOKIE];
}