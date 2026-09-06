import { GetAdminLoginActivityResponse, GetAdminLoginActivityQueryParams } from "@workspace/api-zod";
import { db, loginActivitiesTable, usersTable } from "@workspace/db";
import { count, desc, eq, lt } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { loginActivityRetentionCutoff } from "../lib/login-activity.js";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response): req is Request & Express.AuthedRequest {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required" });
    return false;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

router.get("/admin/login-activity", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const parsed = GetAdminLoginActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pagination" });
    return;
  }
  const { page, pageSize } = parsed.data;
  await db.delete(loginActivitiesTable).where(lt(loginActivitiesTable.createdAt, loginActivityRetentionCutoff()));
  const [{ total }] = await db.select({ total: count() }).from(loginActivitiesTable);
  const rows = await db
    .select({
      id: loginActivitiesTable.id,
      userId: loginActivitiesTable.userId,
      userName: usersTable.fullName,
      userEmail: usersTable.email,
      loggedInAt: loginActivitiesTable.createdAt,
      authMethod: loginActivitiesTable.authMethod,
      deviceType: loginActivitiesTable.deviceType,
      browser: loginActivitiesTable.browser,
      operatingSystem: loginActivitiesTable.operatingSystem,
      country: loginActivitiesTable.country,
      region: loginActivitiesTable.region,
      city: loginActivitiesTable.city,
    })
    .from(loginActivitiesTable)
    .innerJoin(usersTable, eq(loginActivitiesTable.userId, usersTable.id))
    .orderBy(desc(loginActivitiesTable.createdAt), desc(loginActivitiesTable.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json(GetAdminLoginActivityResponse.parse({
    items: rows.map((row) => ({ ...row, loggedInAt: row.loggedInAt.toISOString() })),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  }));
});

export default router;