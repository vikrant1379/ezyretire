import { trackEvent } from "./analytics.ts";

export type ExpenseSaveOperation = "create" | "edit" | "import";

export function trackExpenseSaveSucceeded(
  operation: ExpenseSaveOperation,
  emiChoiceRequired = false,
): void {
  trackEvent("expense_save_succeeded", {
    operation,
    emi_choice_required: emiChoiceRequired,
  });
}