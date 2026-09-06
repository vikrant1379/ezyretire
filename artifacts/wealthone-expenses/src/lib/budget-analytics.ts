import { analyzeBudgetTimeline } from "./budget-timeline.ts";
import type { UIBudgetWindow } from "./budget-helpers.ts";

export type BudgetCategoryType = "core" | "optional" | "custom";
export type BudgetEndMode = "lifelong" | "retirement" | "custom" | "mixed";

export function getBudgetCategoryType(
  category: string,
  coreCategories: readonly string[],
  optionalCategories: readonly string[],
): BudgetCategoryType {
  if (coreCategories.includes(category)) return "core";
  if (optionalCategories.includes(category)) return "optional";
  return "custom";
}

export function getBudgetEndMode(windows: UIBudgetWindow[]): BudgetEndMode {
  const modes = new Set(windows.map((window) => window.endMode));
  if (modes.size !== 1) return "mixed";
  return modes.values().next().value ?? "lifelong";
}

export function getBudgetPlanDimensions(
  categoryType: BudgetCategoryType,
  windows: UIBudgetWindow[],
  retirementEndDate?: string | Date,
) {
  const normalizedRetirementEndDate = retirementEndDate instanceof Date
    ? retirementEndDate.toISOString().slice(0, 10)
    : retirementEndDate;
  const analysis = analyzeBudgetTimeline(windows, normalizedRetirementEndDate);

  return {
    category_type: categoryType,
    end_mode: getBudgetEndMode(windows),
    period_count: windows.length,
    overlap_present: analysis.issues.some((issue) => issue.type === "overlap"),
    warning_present: analysis.issues.length > 0,
    future_planning: windows.length > 1 || windows.some((window) =>
      Boolean(window.startDate) || window.endMode !== "lifelong"
    ),
  };
}