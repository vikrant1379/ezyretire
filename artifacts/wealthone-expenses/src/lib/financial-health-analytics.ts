import { trackEvent } from "./analytics.ts";

export type FinancialHealthUpdateDestination =
  | "financial_health"
  | "loans"
  | "income";

export type FinancialHealthUpdateOutcome =
  | "snapshot_saved"
  | "emergency_fund_saved"
  | "created"
  | "updated";

export function trackFinancialHealthUpdateCompleted(
  destination: FinancialHealthUpdateDestination,
  outcome: FinancialHealthUpdateOutcome,
): void {
  trackEvent("financial_health_update_completed", {
    destination,
    outcome,
  });
}

export function financialHealthCompletionCallbacks<TArgs extends unknown[]>(
  destination: FinancialHealthUpdateDestination,
  outcome: FinancialHealthUpdateOutcome,
  onSuccess?: (...args: TArgs) => void,
): { onSuccess: (...args: TArgs) => void } {
  return {
    onSuccess: (...args) => {
      trackFinancialHealthUpdateCompleted(destination, outcome);
      onSuccess?.(...args);
    },
  };
}