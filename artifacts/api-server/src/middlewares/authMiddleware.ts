import type { AuthUser } from "@workspace/api-zod";
import { type NextFunction, type Request, type Response } from "express";
import * as oidc from "openid-client";
import { accountDeletionRequestsTable, db, usersTable } from "@workspace/db";
import { and, eq, or, sql } from "drizzle-orm";
import { accountHash } from "../lib/account-compliance.js";
import {
  clearSession,
  getOidcConfig,
  getSession,
  getSessionId,
  updateSession,
  type SessionData,
} from "../lib/auth.js";

declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User;
    }
    interface AuthedRequest {
      user: User;
    }
  }
}

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;
  if (!session.refresh_token) return null;

  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(config, session.refresh_token);
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn()
      ? now + tokens.expiresIn()!
      : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    next();
    return;
  }

  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(res, sid);
    next();
    return;
  }
  const [validUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, refreshed.user.id)).limit(1);
  const [denied] = await db.select({ id: accountDeletionRequestsTable.id })
    .from(accountDeletionRequestsTable).where(and(
      or(
        eq(accountDeletionRequestsTable.userId, refreshed.user.id),
        eq(accountDeletionRequestsTable.accountHash, accountHash(refreshed.user.id)),
      ),
      sql`${accountDeletionRequestsTable.status} in ('processing', 'blocked', 'completed')`,
    )).limit(1);
  if (!validUser || denied) {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = refreshed.user;
  next();
}