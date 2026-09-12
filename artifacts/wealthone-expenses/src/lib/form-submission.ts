export type SubmissionGate = { current: boolean };

export type DraftIdentity = {
  id: string;
  createdAt: string;
};

export function createDraftIdentity(
  createId: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
): DraftIdentity {
  return { id: createId(), createdAt: now().toISOString() };
}

export async function runSingleSubmission(
  gate: SubmissionGate,
  submit: () => Promise<void>,
): Promise<boolean> {
  if (gate.current) return false;
  gate.current = true;
  try {
    await submit();
    return true;
  } finally {
    gate.current = false;
  }
}