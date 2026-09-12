import { db, loginActivitiesTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import type { Request } from "express";

export const LOGIN_ACTIVITY_RETENTION_DAYS = 90;
export type LoginMethod = "email_otp" | "oidc" | "passkey" | "pin";

function bounded(value: string | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function decodedHeader(req: Request, name: string): string | undefined {
  const value = header(req, name);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseLoginMetadata(req: Request) {
  const userAgent = header(req, "user-agent") ?? "";
  const deviceType = /bot|crawler|spider/i.test(userAgent)
    ? "Bot"
    : /ipad|tablet|kindle|silk/i.test(userAgent)
      ? "Tablet"
      : /mobi|iphone|android/i.test(userAgent)
        ? "Mobile"
        : userAgent
          ? "Desktop"
          : null;
  const browser =
    userAgent.match(/Edg\/([\d.]+)/)?.[1] ? `Edge ${userAgent.match(/Edg\/([\d.]+)/)![1]}` :
    userAgent.match(/OPR\/([\d.]+)/)?.[1] ? `Opera ${userAgent.match(/OPR\/([\d.]+)/)![1]}` :
    userAgent.match(/Firefox\/([\d.]+)/)?.[1] ? `Firefox ${userAgent.match(/Firefox\/([\d.]+)/)![1]}` :
    userAgent.match(/Chrome\/([\d.]+)/)?.[1] ? `Chrome ${userAgent.match(/Chrome\/([\d.]+)/)![1]}` :
    userAgent.match(/Version\/([\d.]+).*Safari/)?.[1] ? `Safari ${userAgent.match(/Version\/([\d.]+).*Safari/)![1]}` :
    null;
  const operatingSystem =
    userAgent.match(/Windows NT ([\d.]+)/)?.[1] ? `Windows ${userAgent.match(/Windows NT ([\d.]+)/)![1]}` :
    /iPhone|iPad/.test(userAgent) ? `iOS ${userAgent.match(/OS ([\d_]+)/)?.[1]?.replaceAll("_", ".") ?? ""}`.trim() :
    /Android/.test(userAgent) ? `Android ${userAgent.match(/Android ([\d.]+)/)?.[1] ?? ""}`.trim() :
    userAgent.match(/Mac OS X ([\d_]+)/)?.[1] ? `macOS ${userAgent.match(/Mac OS X ([\d_]+)/)![1].replaceAll("_", ".")}` :
    /Linux/.test(userAgent) ? "Linux" :
    null;

  return {
    deviceType: bounded(deviceType ?? undefined, 32),
    browser: bounded(browser ?? undefined, 80),
    operatingSystem: bounded(operatingSystem ?? undefined, 80),
    country: bounded(header(req, "x-vercel-ip-country")?.toUpperCase(), 2),
    region: bounded(decodedHeader(req, "x-vercel-ip-country-region"), 100),
    city: bounded(decodedHeader(req, "x-vercel-ip-city"), 100),
  };
}

export function loginActivityRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - LOGIN_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export async function purgeExpiredLoginActivities(now = new Date()): Promise<number> {
  const deleted = await db
    .delete(loginActivitiesTable)
    .where(lt(loginActivitiesTable.createdAt, loginActivityRetentionCutoff(now)))
    .returning({ id: loginActivitiesTable.id });
  return deleted.length;
}

export async function recordLoginActivity(
  req: Request,
  userId: string,
  authMethod: LoginMethod,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(loginActivitiesTable).where(lt(loginActivitiesTable.createdAt, loginActivityRetentionCutoff()));
    await tx.insert(loginActivitiesTable).values({
      userId,
      authMethod,
      ...parseLoginMetadata(req),
    });
  });
}