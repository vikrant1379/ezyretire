import {
  CreateAdviceRequestBody,
  CreateAdviceRequestResponse,
  SubmitAdvicePaymentReferenceBody,
  SubmitAdvicePaymentReferenceResponse,
  CreateAdvisorBody,
  CreateAdvisorResponse,
  GetAdviceAdminDashboardResponse,
  GetAdviceOverviewResponse,
  GetWhatsAppSupportResponse,
  UpdateAdviceRequestBody,
  UpdateAdviceRequestParams,
  UpdateAdviceRequestResponse,
  UpdateAdviceSettingsBody,
  UpdateAdviceSettingsResponse,
  UpdateAdvisorBody,
  UpdateAdvisorParams,
  UpdateAdvisorResponse,
} from "@workspace/api-zod";
import {
  adviceRequestsTable,
  adviceSettingsTable,
  advisorsTable,
  db,
} from "@workspace/db";
import { and, desc, eq, isNotNull, notInArray } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { scheduleWhatsAppTemplate } from "../lib/whatsapp.js";
import {
  isDatabaseUniqueViolation,
  isAllowedAdminPaymentTransition,
  submitAdvicePaymentReference,
} from "../lib/advice-payment.js";
import {
  buildWhatsAppSupportUrl,
  normalizeWhatsAppNumber,
} from "../lib/whatsapp-support.js";

const router: IRouter = Router();
const inactiveRequestStatuses = ["completed", "cancelled"];
const customerAdviceRequestsPaused = true;
const advicePausedResponse = {
  error:
    "Advice requests are temporarily unavailable while we update this service. Email hello@ezyretire.com and our team will contact you soon.",
};

function requireUser(req: Request, res: Response): req is Request & Express.AuthedRequest {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required" });
    return false;
  }
  return true;
}

function requireAdmin(req: Request, res: Response): req is Request & Express.AuthedRequest {
  if (!requireUser(req, res)) return false;
  if (!req.user.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

function serializeRequest(row: typeof adviceRequestsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeAdvisor(row: typeof advisorsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getSettings() {
  await db
    .insert(adviceSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: adviceSettingsTable.id });
  const [settings] = await db
    .select()
    .from(adviceSettingsTable)
    .where(eq(adviceSettingsTable.id, 1));
  return {
    consultationFee: settings.consultationFee,
    currency: settings.currency,
    businessWhatsapp: settings.businessWhatsapp,
    upiId: settings.upiId,
  };
}

async function getOverview(userId: string) {
  const settings = await getSettings();
  const [request] = await db
    .select()
    .from(adviceRequestsTable)
    .where(eq(adviceRequestsTable.userId, userId))
    .orderBy(desc(adviceRequestsTable.createdAt))
    .limit(1);

  let advisor: typeof advisorsTable.$inferSelect | undefined;
  if (request?.advisorId) {
    [advisor] = await db
      .select()
      .from(advisorsTable)
      .where(eq(advisorsTable.id, request.advisorId))
      .limit(1);
  }

  return {
    request: request ? serializeRequest(request) : null,
    advisor: advisor ? serializeAdvisor(advisor) : null,
    settings,
  };
}

router.get("/advice", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  res.json(GetAdviceOverviewResponse.parse(await getOverview(req.user.id)));
});

router.get("/support/whatsapp", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const settings = await getSettings();
  const whatsappUrl = buildWhatsAppSupportUrl(settings.businessWhatsapp);
  res.json(
    GetWhatsAppSupportResponse.parse({
      available: whatsappUrl !== null,
      whatsappUrl,
    }),
  );
});

router.post("/advice", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (customerAdviceRequestsPaused) {
    res.status(503).json(advicePausedResponse);
    return;
  }
  const parsed = CreateAdviceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [activeRequest] = await db
    .select({ id: adviceRequestsTable.id })
    .from(adviceRequestsTable)
    .where(
      and(
        eq(adviceRequestsTable.userId, req.user.id),
        notInArray(adviceRequestsTable.status, inactiveRequestStatuses),
      ),
    )
    .limit(1);
  if (activeRequest) {
    res.status(409).json({ error: "An active advice request already exists" });
    return;
  }

  const settings = await getSettings();
  let request: typeof adviceRequestsTable.$inferSelect;
  try {
    [request] = await db
      .insert(adviceRequestsTable)
      .values({
        userId: req.user.id,
        userName: parsed.data.userName.trim(),
        userEmail: req.user.email ?? "",
        whatsappNumber: parsed.data.whatsappNumber.replace(/[^\d+]/g, ""),
        topic: parsed.data.topic,
        note: parsed.data.note?.trim() ?? "",
        consent: parsed.data.consent,
        feeAmount: settings.consultationFee,
      })
      .returning();
  } catch (error) {
    if (isDatabaseUniqueViolation(error)) {
      res.status(409).json({ error: "An active advice request already exists" });
      return;
    }
    throw error;
  }
  await scheduleWhatsAppTemplate({
    adviceRequestId: request.id,
    eventType: "request_created",
    to: request.whatsappNumber,
    parameters: [request.userName, String(request.id)],
  });
  res.status(201).json(
    CreateAdviceRequestResponse.parse(await getOverview(req.user.id)),
  );
});

router.post("/advice/payment-reference", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (customerAdviceRequestsPaused) {
    res.status(503).json(advicePausedResponse);
    return;
  }
  const parsed = SubmitAdvicePaymentReferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const submission = await submitAdvicePaymentReference({
    userId: req.user.id,
    paymentReference: parsed.data.paymentReference,
  });
  if (!submission.ok && submission.reason === "invalid_reference") {
    res.status(400).json({ error: "Payment reference must be at least 4 characters" });
    return;
  }
  if (!submission.ok) {
    res.status(409).json({ error: "Payment reference cannot be changed now" });
    return;
  }

  res.json(
    SubmitAdvicePaymentReferenceResponse.parse(await getOverview(req.user.id)),
  );
});

router.get("/admin/advice", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const [requests, advisors, settings] = await Promise.all([
    db.select().from(adviceRequestsTable).orderBy(desc(adviceRequestsTable.createdAt)),
    db.select().from(advisorsTable).orderBy(desc(advisorsTable.active), advisorsTable.name),
    getSettings(),
  ]);
  res.json(
    GetAdviceAdminDashboardResponse.parse({
      requests: requests.map(serializeRequest),
      advisors: advisors.map(serializeAdvisor),
      settings,
    }),
  );
});

router.patch("/admin/advice/settings", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const parsed = UpdateAdviceSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const businessWhatsapp = parsed.data.businessWhatsapp;
  const normalizedWhatsapp =
    businessWhatsapp === undefined
      ? undefined
      : businessWhatsapp.trim() === ""
        ? ""
        : normalizeWhatsAppNumber(businessWhatsapp);
  if (businessWhatsapp !== undefined && normalizedWhatsapp === null) {
    res.status(400).json({
      error: "Enter a valid international WhatsApp number, including country code",
    });
    return;
  }
  const settingsUpdate = {
    ...parsed.data,
    ...(businessWhatsapp !== undefined
      ? { businessWhatsapp: normalizedWhatsapp as string }
      : {}),
  };
  await getSettings();
  const [settings] = await db
    .update(adviceSettingsTable)
    .set(settingsUpdate)
    .where(eq(adviceSettingsTable.id, 1))
    .returning();
  res.json(
    UpdateAdviceSettingsResponse.parse({
      consultationFee: settings.consultationFee,
      currency: settings.currency,
      businessWhatsapp: settings.businessWhatsapp,
      upiId: settings.upiId,
    }),
  );
});

router.post("/admin/advisors", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const parsed = CreateAdvisorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [advisor] = await db
    .insert(advisorsTable)
    .values({
      ...parsed.data,
      phone: parsed.data.phone ?? "",
      bookingUrl: parsed.data.bookingUrl ?? "",
      photoUrl: parsed.data.photoUrl ?? "",
      active: parsed.data.active ?? true,
    })
    .returning();
  res.status(201).json(CreateAdvisorResponse.parse(serializeAdvisor(advisor)));
});

router.patch("/admin/advisors/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const params = UpdateAdvisorParams.safeParse(req.params);
  const parsed = UpdateAdvisorBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid advisor update" });
    return;
  }
  const [advisor] = await db
    .update(advisorsTable)
    .set({
      ...parsed.data,
      phone: parsed.data.phone ?? "",
      bookingUrl: parsed.data.bookingUrl ?? "",
      photoUrl: parsed.data.photoUrl ?? "",
      active: parsed.data.active ?? true,
    })
    .where(eq(advisorsTable.id, params.data.id))
    .returning();
  if (!advisor) {
    res.status(404).json({ error: "Advisor not found" });
    return;
  }
  res.json(UpdateAdvisorResponse.parse(serializeAdvisor(advisor)));
});

router.patch("/admin/advice-requests/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const params = UpdateAdviceRequestParams.safeParse(req.params);
  const parsed = UpdateAdviceRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid request update" });
    return;
  }
  const [previousRequest] = await db
    .select()
    .from(adviceRequestsTable)
    .where(eq(adviceRequestsTable.id, params.data.id))
    .limit(1);
  if (!previousRequest) {
    res.status(404).json({ error: "Advice request not found" });
    return;
  }
  if (
    parsed.data.paymentStatus &&
    !isAllowedAdminPaymentTransition({
      currentStatus: previousRequest.paymentStatus,
      nextStatus: parsed.data.paymentStatus,
      paymentReference: previousRequest.paymentReference,
    })
  ) {
    res.status(409).json({
      error: "Payment must have a submitted reference before it can be approved or rejected",
    });
    return;
  }
  const update = {
    ...parsed.data,
    ...(parsed.data.advisorId && !parsed.data.status ? { status: "assigned" } : {}),
  };
  const [request] = await db
    .update(adviceRequestsTable)
    .set(update)
    .where(
      parsed.data.paymentStatus
        ? and(
            eq(adviceRequestsTable.id, params.data.id),
            eq(adviceRequestsTable.paymentStatus, previousRequest.paymentStatus),
            ["paid", "rejected"].includes(parsed.data.paymentStatus)
              ? isNotNull(adviceRequestsTable.paymentReference)
              : undefined,
          )
        : eq(adviceRequestsTable.id, params.data.id),
    )
    .returning();
  if (!request) {
    res.status(409).json({ error: "Advice request changed; reload and try again" });
    return;
  }
  const assignedAdvisorId = request.advisorId;
  const advisorWasAssigned =
    assignedAdvisorId !== null &&
    assignedAdvisorId !== previousRequest.advisorId;
  if (advisorWasAssigned && assignedAdvisorId !== null) {
    const [advisor] = await db
      .select({ name: advisorsTable.name })
      .from(advisorsTable)
      .where(eq(advisorsTable.id, assignedAdvisorId))
      .limit(1);
    if (advisor) {
      await scheduleWhatsAppTemplate({
        adviceRequestId: request.id,
        eventType: "advisor_assigned",
        to: request.whatsappNumber,
        parameters: [request.userName, advisor.name],
      });
    }
  }
  res.json(UpdateAdviceRequestResponse.parse(serializeRequest(request)));
});

export default router;