import { trackEvent } from "./analytics.ts";

export const AUTH_FUNNEL_SUCCESS_EVENTS = {
  codeRequest: "email_sign_in_code_requested",
  verification: "email_sign_in_verified",
  profileCompletion: "email_sign_in_profile_completed",
} as const;

export type AuthFunnelSuccessStage = keyof typeof AUTH_FUNNEL_SUCCESS_EVENTS;
export type CodeRequestKind = "initial" | "resend";

export function trackAuthFunnelSuccess(stage: AuthFunnelSuccessStage): void {
  trackEvent(AUTH_FUNNEL_SUCCESS_EVENTS[stage]);
}

export function trackCodeRequestSuccess(requestKind: CodeRequestKind): void {
  trackEvent(AUTH_FUNNEL_SUCCESS_EVENTS.codeRequest, {
    request_kind: requestKind,
  });
}