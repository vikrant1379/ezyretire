import { adviceRequestsTable, db } from "@workspace/db";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";

type AdvicePaymentDb = Pick<typeof db, "select" | "update">;

type PaymentSubmissionResult =
  | { ok: true; request: typeof adviceRequestsTable.$inferSelect }
  | { ok: false; reason: "invalid_reference" | "state_conflict" };

export function isDatabaseUniqueViolation(error: unknown): boolean {
  const candidate = error as {
    code?: string;
    cause?: { code?: string };
  };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

export function isAllowedAdminPaymentTransition({
  currentStatus,
  nextStatus,
  paymentReference,
}: {
  currentStatus: string;
  nextStatus: string;
  paymentReference: string | null;
}): boolean {
  if (nextStatus === currentStatus) return true;
  if (nextStatus === "waived") {
    return ["pending", "submitted", "rejected"].includes(currentStatus);
  }
  if (nextStatus === "refunded") return currentStatus === "paid";
  if (nextStatus === "paid" || nextStatus === "rejected") {
    return currentStatus === "submitted" && Boolean(paymentReference?.trim());
  }
  return false;
}

export async function submitAdvicePaymentReference({
  userId,
  paymentReference,
  now = new Date(),
  executor = db,
}: {
  userId: string;
  paymentReference: string;
  now?: Date;
  executor?: AdvicePaymentDb;
}): Promise<PaymentSubmissionResult> {
  const normalizedReference = paymentReference.trim();
  if (normalizedReference.length < 4) {
    return { ok: false, reason: "invalid_reference" };
  }

  const [target] = await executor
    .select({ id: adviceRequestsTable.id })
    .from(adviceRequestsTable)
    .where(
      and(
        eq(adviceRequestsTable.userId, userId),
        inArray(adviceRequestsTable.paymentStatus, ["pending", "rejected"]),
        notInArray(adviceRequestsTable.status, ["completed", "cancelled"]),
      ),
    )
    .orderBy(
      desc(adviceRequestsTable.createdAt),
      desc(adviceRequestsTable.id),
    )
    .limit(1);
  if (!target) {
    return { ok: false, reason: "state_conflict" };
  }

  const [request] = await executor
    .update(adviceRequestsTable)
    .set({
      paymentReference: normalizedReference,
      paymentSubmittedAt: now,
      paymentStatus: "submitted",
    })
    .where(
      and(
        eq(adviceRequestsTable.id, target.id),
        eq(adviceRequestsTable.userId, userId),
        inArray(adviceRequestsTable.paymentStatus, ["pending", "rejected"]),
        notInArray(adviceRequestsTable.status, ["completed", "cancelled"]),
      ),
    )
    .returning();

  if (!request) {
    return { ok: false, reason: "state_conflict" };
  }
  return { ok: true, request };
}