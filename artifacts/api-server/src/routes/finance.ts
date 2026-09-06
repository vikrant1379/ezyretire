import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  clearFinancialData,
  loadFinancialData,
  managePlanningCategory,
  PlanningCategoryConflictError,
  saveFinancialData,
} from "../lib/finance-store.js";

const router: IRouter = Router();
const protectedPlanningCategories = new Set([
  "food & dining",
  "transportation",
  "shopping",
  "entertainment",
  "housing",
  "utilities",
  "health & wellness",
  "travel",
  "education",
  "miscellaneous",
  "home maintenance",
  "insurance",
  "family & caregiving",
  "domestic help",
  "taxes & fees",
]);

function requireUser(req: Request, res: Response): req is Request & Express.AuthedRequest {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required" });
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function loadUser(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user;
}

router.get("/financial-data", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(await loadFinancialData(user));
});

router.put("/financial-data", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isRecord(req.body)) {
    res.status(400).json({ error: "Invalid financial data payload" });
    return;
  }

  const payload = req.body;
  const profileInputs = isRecord(payload.profileInputs) ? payload.profileInputs : {};
  const retirementInputs = isRecord(payload.retirementInputs) ? payload.retirementInputs : {};
  const dateOfBirthInput = profileInputs.dateOfBirth ?? retirementInputs.dateOfBirth;
  if (typeof dateOfBirthInput === "string" && !isValidDate(dateOfBirthInput)) {
    res.status(400).json({ error: "dateOfBirth must be in YYYY-MM-DD format" });
    return;
  }

  const fullNameInput = profileInputs.fullName;
  if (
    fullNameInput !== undefined &&
    (typeof fullNameInput !== "string" || fullNameInput.trim().length < 2 || fullNameInput.trim().length > 100)
  ) {
    res.status(400).json({ error: "fullName must be 2-100 characters when provided" });
    return;
  }

  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      fullName:
        typeof fullNameInput === "string" && fullNameInput.trim()
          ? fullNameInput.trim()
          : undefined,
      gender:
        typeof profileInputs.gender === "string" ? profileInputs.gender.trim() || null : undefined,
      phone:
        typeof profileInputs.phone === "string" ? profileInputs.phone.trim() || null : undefined,
      dateOfBirth: typeof dateOfBirthInput === "string" ? dateOfBirthInput : undefined,
      onboardingCompleted:
        typeof profileInputs.onboardingCompleted === "boolean"
          ? profileInputs.onboardingCompleted
          : undefined,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, req.user.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  req.user = {
    ...req.user,
    fullName: updated.fullName,
    dateOfBirth: updated.dateOfBirth,
    gender: updated.gender,
    phone: updated.phone,
    onboardingCompleted: updated.onboardingCompleted,
  };
  res.json(await saveFinancialData(updated, payload));
});

router.patch("/financial-data/planning-categories/:category", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const category = req.params.category?.trim();
  if (!category || category.length > 80 || protectedPlanningCategories.has(category.toLocaleLowerCase())) {
    res.status(400).json({ error: "Only custom planning categories can be managed" });
    return;
  }
  if (
    !isRecord(req.body)
    || !["archive", "rename", "restore"].includes(String(req.body.action))
  ) {
    res.status(400).json({ error: "Choose whether to rename, archive, or restore this category" });
    return;
  }
  const nextCategory = req.body.action === "rename" && typeof req.body.nextCategory === "string"
    ? req.body.nextCategory.trim()
    : undefined;
  if (
    req.body.action === "rename"
    && (
      !nextCategory
      || nextCategory.length > 80
      || protectedPlanningCategories.has(nextCategory.toLocaleLowerCase())
    )
  ) {
    res.status(400).json({ error: "Choose a unique custom category name of up to 80 characters" });
    return;
  }

  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  try {
    res.json(await managePlanningCategory(
      user,
      category,
      req.body.action as "archive" | "rename" | "restore",
      nextCategory,
    ));
  } catch (error) {
    if (error instanceof PlanningCategoryConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.delete("/financial-data", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await clearFinancialData(req.user.id);
  const fresh = await loadUser(req.user.id);
  if (!fresh) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(await loadFinancialData(fresh));
});

export default router;
