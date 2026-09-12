import type { RetirementLifestyle } from "./storage.ts";

type RetirementAnalyticsInputs = {
  lifestyle: RetirementLifestyle;
  targetRetirementAge: number;
  lifeExpectancy: number;
  pensionSourceCount: number;
  monthlyContributionOverride: number;
  plannerOpened: boolean;
  fundingPercentage: number;
};

export function getLifestylePreviewDimensions(lifestyle: RetirementLifestyle) {
  return {
    lifestyle: lifestyle.toLowerCase(),
  };
}

export function getPlannerOpenDimensions(
  lifestyle: RetirementLifestyle,
  pensionSourceCount: number,
) {
  return {
    lifestyle: lifestyle.toLowerCase(),
    pension_source_count: Math.max(0, pensionSourceCount),
  };
}

export function getRetirementPlanDimensions({
  lifestyle,
  targetRetirementAge,
  lifeExpectancy,
  pensionSourceCount,
  monthlyContributionOverride,
  plannerOpened,
  fundingPercentage,
}: RetirementAnalyticsInputs) {
  return {
    lifestyle: lifestyle.toLowerCase(),
    target_retirement_age: targetRetirementAge,
    retirement_years: Math.max(0, lifeExpectancy - targetRetirementAge),
    pension_source_count: Math.max(0, pensionSourceCount),
    contribution_mode: monthlyContributionOverride > 0 ? "custom" : "automatic",
    planner_used: plannerOpened ? "yes" : "no",
    funding_status: fundingPercentage >= 100 ? "funded" : "shortfall",
  };
}