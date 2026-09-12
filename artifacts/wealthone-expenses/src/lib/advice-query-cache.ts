import type { QueryClient } from "@tanstack/react-query";
import type {
  AdviceAdminDashboard,
  AdviceRequest,
  AdviceSettings,
  Advisor,
} from "@workspace/api-client-react";
import {
  getGetAdviceAdminDashboardQueryKey,
  getGetAdviceOverviewQueryKey,
  type AdviceOverview,
} from "@workspace/api-client-react";
import {
  isCurrentPrivateQueryGeneration,
  type PrivateQueryGeneration,
} from "./query-policy";

export function setAdviceOverview(
  queryClient: QueryClient,
  generation: PrivateQueryGeneration,
  overview: AdviceOverview,
): void {
  if (!isCurrentPrivateQueryGeneration(queryClient, generation)) return;
  queryClient.setQueryData(getGetAdviceOverviewQueryKey(), overview);
}

function updateDashboard(
  queryClient: QueryClient,
  generation: PrivateQueryGeneration,
  updater: (dashboard: AdviceAdminDashboard) => AdviceAdminDashboard,
): void {
  if (!isCurrentPrivateQueryGeneration(queryClient, generation)) return;
  queryClient.setQueryData<AdviceAdminDashboard>(
    getGetAdviceAdminDashboardQueryKey(),
    (dashboard) => dashboard ? updater(dashboard) : dashboard,
  );
}

export function setAdminAdviceSettings(
  queryClient: QueryClient,
  generation: PrivateQueryGeneration,
  settings: AdviceSettings,
): void {
  updateDashboard(queryClient, generation, (dashboard) => ({ ...dashboard, settings }));
}

export function addAdminAdvisor(
  queryClient: QueryClient,
  generation: PrivateQueryGeneration,
  advisor: Advisor,
): void {
  updateDashboard(queryClient, generation, (dashboard) => ({
    ...dashboard,
    advisors: [advisor, ...dashboard.advisors],
  }));
}

export function replaceAdminAdvisor(
  queryClient: QueryClient,
  generation: PrivateQueryGeneration,
  advisor: Advisor,
): void {
  updateDashboard(queryClient, generation, (dashboard) => ({
    ...dashboard,
    advisors: dashboard.advisors.map((current) =>
      current.id === advisor.id ? advisor : current
    ),
  }));
}

export function replaceAdminAdviceRequest(
  queryClient: QueryClient,
  generation: PrivateQueryGeneration,
  request: AdviceRequest,
): void {
  updateDashboard(queryClient, generation, (dashboard) => ({
    ...dashboard,
    requests: dashboard.requests.map((current) =>
      current.id === request.id ? request : current
    ),
  }));
}