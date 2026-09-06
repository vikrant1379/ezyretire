import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AdviceAdminDashboard, AdviceOverview, AdvicePaymentReferenceInput, AdviceRequest, AdviceRequestInput, AdviceRequestUpdate, AdviceSettings, AdviceSettingsUpdate, Advisor, AdvisorInput, AdvisorUpdate, AuthProfileUpdate, AuthUserEnvelope, BeginAdminBrowserLoginParams, BeginBrowserLoginParams, HealthStatus, LogoutBrowserSessionParams, RetryWhatsAppNotification200, WhatsAppSupport } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetCurrentAuthUserUrl: () => string;
/**
 * @summary Get the current authenticated user
 */
export declare const getCurrentAuthUser: (options?: Parameters<typeof customFetch>[1]) => Promise<AuthUserEnvelope>;
export declare const getGetCurrentAuthUserQueryKey: () => readonly ["/api/auth/user"];
export declare const getGetCurrentAuthUserQueryOptions: <TData = Awaited<ReturnType<typeof getCurrentAuthUser>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCurrentAuthUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCurrentAuthUser>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCurrentAuthUserQueryResult = NonNullable<Awaited<ReturnType<typeof getCurrentAuthUser>>>;
export type GetCurrentAuthUserQueryError = ErrorType<unknown>;
/**
 * @summary Get the current authenticated user
 */
export declare function useGetCurrentAuthUser<TData = Awaited<ReturnType<typeof getCurrentAuthUser>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCurrentAuthUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateAuthProfileUrl: () => string;
/**
 * @summary Update the authenticated user's profile
 */
export declare const updateAuthProfile: (authProfileUpdate: AuthProfileUpdate, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getUpdateAuthProfileMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAuthProfile>>, TError, {
        data: BodyType<AuthProfileUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAuthProfile>>, TError, {
    data: BodyType<AuthProfileUpdate>;
}, TContext>;
export type UpdateAuthProfileMutationResult = NonNullable<Awaited<ReturnType<typeof updateAuthProfile>>>;
export type UpdateAuthProfileMutationBody = BodyType<AuthProfileUpdate>;
export type UpdateAuthProfileMutationError = ErrorType<void>;
/**
* @summary Update the authenticated user's profile
*/
export declare const useUpdateAuthProfile: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAuthProfile>>, TError, {
        data: BodyType<AuthProfileUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAuthProfile>>, TError, {
    data: BodyType<AuthProfileUpdate>;
}, TContext>;
export declare const getBeginBrowserLoginUrl: (params?: BeginBrowserLoginParams) => string;
/**
 * @summary Start browser login
 */
export declare const beginBrowserLogin: (params?: BeginBrowserLoginParams, options?: Parameters<typeof customFetch>[1]) => Promise<unknown>;
export declare const getBeginBrowserLoginQueryKey: (params?: BeginBrowserLoginParams) => readonly ["/api/login", ...BeginBrowserLoginParams[]];
export declare const getBeginBrowserLoginQueryOptions: <TData = Awaited<ReturnType<typeof beginBrowserLogin>>, TError = ErrorType<void>>(params?: BeginBrowserLoginParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof beginBrowserLogin>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof beginBrowserLogin>>, TError, TData> & {
    queryKey: QueryKey;
};
export type BeginBrowserLoginQueryResult = NonNullable<Awaited<ReturnType<typeof beginBrowserLogin>>>;
export type BeginBrowserLoginQueryError = ErrorType<void>;
/**
 * @summary Start browser login
 */
export declare function useBeginBrowserLogin<TData = Awaited<ReturnType<typeof beginBrowserLogin>>, TError = ErrorType<void>>(params?: BeginBrowserLoginParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof beginBrowserLogin>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getBeginAdminBrowserLoginUrl: (params?: BeginAdminBrowserLoginParams) => string;
/**
 * @summary Start admin-only browser login
 */
export declare const beginAdminBrowserLogin: (params?: BeginAdminBrowserLoginParams, options?: Parameters<typeof customFetch>[1]) => Promise<unknown>;
export declare const getBeginAdminBrowserLoginQueryKey: (params?: BeginAdminBrowserLoginParams) => readonly ["/api/admin/login", ...BeginAdminBrowserLoginParams[]];
export declare const getBeginAdminBrowserLoginQueryOptions: <TData = Awaited<ReturnType<typeof beginAdminBrowserLogin>>, TError = ErrorType<void>>(params?: BeginAdminBrowserLoginParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof beginAdminBrowserLogin>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof beginAdminBrowserLogin>>, TError, TData> & {
    queryKey: QueryKey;
};
export type BeginAdminBrowserLoginQueryResult = NonNullable<Awaited<ReturnType<typeof beginAdminBrowserLogin>>>;
export type BeginAdminBrowserLoginQueryError = ErrorType<void>;
/**
 * @summary Start admin-only browser login
 */
export declare function useBeginAdminBrowserLogin<TData = Awaited<ReturnType<typeof beginAdminBrowserLogin>>, TError = ErrorType<void>>(params?: BeginAdminBrowserLoginParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof beginAdminBrowserLogin>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getHandleBrowserLoginCallbackUrl: () => string;
/**
 * @summary Complete browser login
 */
export declare const handleBrowserLoginCallback: (options?: Parameters<typeof customFetch>[1]) => Promise<unknown>;
export declare const getHandleBrowserLoginCallbackQueryKey: () => readonly ["/api/callback"];
export declare const getHandleBrowserLoginCallbackQueryOptions: <TData = Awaited<ReturnType<typeof handleBrowserLoginCallback>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof handleBrowserLoginCallback>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof handleBrowserLoginCallback>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HandleBrowserLoginCallbackQueryResult = NonNullable<Awaited<ReturnType<typeof handleBrowserLoginCallback>>>;
export type HandleBrowserLoginCallbackQueryError = ErrorType<void>;
/**
 * @summary Complete browser login
 */
export declare function useHandleBrowserLoginCallback<TData = Awaited<ReturnType<typeof handleBrowserLoginCallback>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof handleBrowserLoginCallback>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getLogoutBrowserSessionUrl: (params?: LogoutBrowserSessionParams) => string;
/**
 * @summary Log out
 */
export declare const logoutBrowserSession: (params?: LogoutBrowserSessionParams, options?: Parameters<typeof customFetch>[1]) => Promise<unknown>;
export declare const getLogoutBrowserSessionQueryKey: (params?: LogoutBrowserSessionParams) => readonly ["/api/logout", ...LogoutBrowserSessionParams[]];
export declare const getLogoutBrowserSessionQueryOptions: <TData = Awaited<ReturnType<typeof logoutBrowserSession>>, TError = ErrorType<void>>(params?: LogoutBrowserSessionParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof logoutBrowserSession>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof logoutBrowserSession>>, TError, TData> & {
    queryKey: QueryKey;
};
export type LogoutBrowserSessionQueryResult = NonNullable<Awaited<ReturnType<typeof logoutBrowserSession>>>;
export type LogoutBrowserSessionQueryError = ErrorType<void>;
/**
 * @summary Log out
 */
export declare function useLogoutBrowserSession<TData = Awaited<ReturnType<typeof logoutBrowserSession>>, TError = ErrorType<void>>(params?: LogoutBrowserSessionParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof logoutBrowserSession>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAdviceOverviewUrl: () => string;
/**
 * @summary Get the signed-in user's latest advice request and assigned advisor
 */
export declare const getAdviceOverview: (options?: Parameters<typeof customFetch>[1]) => Promise<AdviceOverview>;
export declare const getGetAdviceOverviewQueryKey: () => readonly ["/api/advice"];
export declare const getGetAdviceOverviewQueryOptions: <TData = Awaited<ReturnType<typeof getAdviceOverview>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdviceOverview>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAdviceOverview>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAdviceOverviewQueryResult = NonNullable<Awaited<ReturnType<typeof getAdviceOverview>>>;
export type GetAdviceOverviewQueryError = ErrorType<void>;
/**
 * @summary Get the signed-in user's latest advice request and assigned advisor
 */
export declare function useGetAdviceOverview<TData = Awaited<ReturnType<typeof getAdviceOverview>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdviceOverview>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateAdviceRequestUrl: () => string;
/**
 * @summary Request financial advice with manual payment
 */
export declare const createAdviceRequest: (adviceRequestInput: AdviceRequestInput, options?: Parameters<typeof customFetch>[1]) => Promise<AdviceOverview>;
export declare const getCreateAdviceRequestMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdviceRequest>>, TError, {
        data: BodyType<AdviceRequestInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAdviceRequest>>, TError, {
    data: BodyType<AdviceRequestInput>;
}, TContext>;
export type CreateAdviceRequestMutationResult = NonNullable<Awaited<ReturnType<typeof createAdviceRequest>>>;
export type CreateAdviceRequestMutationBody = BodyType<AdviceRequestInput>;
export type CreateAdviceRequestMutationError = ErrorType<void>;
/**
* @summary Request financial advice with manual payment
*/
export declare const useCreateAdviceRequest: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdviceRequest>>, TError, {
        data: BodyType<AdviceRequestInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAdviceRequest>>, TError, {
    data: BodyType<AdviceRequestInput>;
}, TContext>;
export declare const getGetWhatsAppSupportUrl: () => string;
/**
 * @summary Get the signed-in customer's WhatsApp support destination
 */
export declare const getWhatsAppSupport: (options?: Parameters<typeof customFetch>[1]) => Promise<WhatsAppSupport>;
export declare const getGetWhatsAppSupportQueryKey: () => readonly ["/api/support/whatsapp"];
export declare const getGetWhatsAppSupportQueryOptions: <TData = Awaited<ReturnType<typeof getWhatsAppSupport>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWhatsAppSupport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getWhatsAppSupport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetWhatsAppSupportQueryResult = NonNullable<Awaited<ReturnType<typeof getWhatsAppSupport>>>;
export type GetWhatsAppSupportQueryError = ErrorType<void>;
/**
 * @summary Get the signed-in customer's WhatsApp support destination
 */
export declare function useGetWhatsAppSupport<TData = Awaited<ReturnType<typeof getWhatsAppSupport>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWhatsAppSupport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSubmitAdvicePaymentReferenceUrl: () => string;
/**
 * @summary Submit a manual payment reference for the signed-in user's active request
 */
export declare const submitAdvicePaymentReference: (advicePaymentReferenceInput: AdvicePaymentReferenceInput, options?: Parameters<typeof customFetch>[1]) => Promise<AdviceOverview>;
export declare const getSubmitAdvicePaymentReferenceMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitAdvicePaymentReference>>, TError, {
        data: BodyType<AdvicePaymentReferenceInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof submitAdvicePaymentReference>>, TError, {
    data: BodyType<AdvicePaymentReferenceInput>;
}, TContext>;
export type SubmitAdvicePaymentReferenceMutationResult = NonNullable<Awaited<ReturnType<typeof submitAdvicePaymentReference>>>;
export type SubmitAdvicePaymentReferenceMutationBody = BodyType<AdvicePaymentReferenceInput>;
export type SubmitAdvicePaymentReferenceMutationError = ErrorType<void>;
/**
* @summary Submit a manual payment reference for the signed-in user's active request
*/
export declare const useSubmitAdvicePaymentReference: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitAdvicePaymentReference>>, TError, {
        data: BodyType<AdvicePaymentReferenceInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof submitAdvicePaymentReference>>, TError, {
    data: BodyType<AdvicePaymentReferenceInput>;
}, TContext>;
export declare const getGetAdviceAdminDashboardUrl: () => string;
/**
 * @summary List advisors, requests, and consultation settings
 */
export declare const getAdviceAdminDashboard: (options?: Parameters<typeof customFetch>[1]) => Promise<AdviceAdminDashboard>;
export declare const getGetAdviceAdminDashboardQueryKey: () => readonly ["/api/admin/advice"];
export declare const getGetAdviceAdminDashboardQueryOptions: <TData = Awaited<ReturnType<typeof getAdviceAdminDashboard>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdviceAdminDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAdviceAdminDashboard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAdviceAdminDashboardQueryResult = NonNullable<Awaited<ReturnType<typeof getAdviceAdminDashboard>>>;
export type GetAdviceAdminDashboardQueryError = ErrorType<void>;
/**
 * @summary List advisors, requests, and consultation settings
 */
export declare function useGetAdviceAdminDashboard<TData = Awaited<ReturnType<typeof getAdviceAdminDashboard>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdviceAdminDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateAdviceSettingsUrl: () => string;
/**
 * @summary Update manual payment and WhatsApp settings
 */
export declare const updateAdviceSettings: (adviceSettingsUpdate: AdviceSettingsUpdate, options?: Parameters<typeof customFetch>[1]) => Promise<AdviceSettings>;
export declare const getUpdateAdviceSettingsMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdviceSettings>>, TError, {
        data: BodyType<AdviceSettingsUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAdviceSettings>>, TError, {
    data: BodyType<AdviceSettingsUpdate>;
}, TContext>;
export type UpdateAdviceSettingsMutationResult = NonNullable<Awaited<ReturnType<typeof updateAdviceSettings>>>;
export type UpdateAdviceSettingsMutationBody = BodyType<AdviceSettingsUpdate>;
export type UpdateAdviceSettingsMutationError = ErrorType<void>;
/**
* @summary Update manual payment and WhatsApp settings
*/
export declare const useUpdateAdviceSettings: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdviceSettings>>, TError, {
        data: BodyType<AdviceSettingsUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAdviceSettings>>, TError, {
    data: BodyType<AdviceSettingsUpdate>;
}, TContext>;
export declare const getCreateAdvisorUrl: () => string;
/**
 * @summary Create an advisor profile
 */
export declare const createAdvisor: (advisorInput: AdvisorInput, options?: Parameters<typeof customFetch>[1]) => Promise<Advisor>;
export declare const getCreateAdvisorMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdvisor>>, TError, {
        data: BodyType<AdvisorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAdvisor>>, TError, {
    data: BodyType<AdvisorInput>;
}, TContext>;
export type CreateAdvisorMutationResult = NonNullable<Awaited<ReturnType<typeof createAdvisor>>>;
export type CreateAdvisorMutationBody = BodyType<AdvisorInput>;
export type CreateAdvisorMutationError = ErrorType<void>;
/**
* @summary Create an advisor profile
*/
export declare const useCreateAdvisor: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdvisor>>, TError, {
        data: BodyType<AdvisorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAdvisor>>, TError, {
    data: BodyType<AdvisorInput>;
}, TContext>;
export declare const getUpdateAdvisorUrl: (id: number) => string;
/**
 * @summary Update an advisor profile
 */
export declare const updateAdvisor: (id: number, advisorUpdate: AdvisorUpdate, options?: Parameters<typeof customFetch>[1]) => Promise<Advisor>;
export declare const getUpdateAdvisorMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdvisor>>, TError, {
        id: number;
        data: BodyType<AdvisorUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAdvisor>>, TError, {
    id: number;
    data: BodyType<AdvisorUpdate>;
}, TContext>;
export type UpdateAdvisorMutationResult = NonNullable<Awaited<ReturnType<typeof updateAdvisor>>>;
export type UpdateAdvisorMutationBody = BodyType<AdvisorUpdate>;
export type UpdateAdvisorMutationError = ErrorType<void>;
/**
* @summary Update an advisor profile
*/
export declare const useUpdateAdvisor: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdvisor>>, TError, {
        id: number;
        data: BodyType<AdvisorUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAdvisor>>, TError, {
    id: number;
    data: BodyType<AdvisorUpdate>;
}, TContext>;
export declare const getUpdateAdviceRequestUrl: (id: number) => string;
/**
 * @summary Verify manual payment, assign an advisor, or update status
 */
export declare const updateAdviceRequest: (id: number, adviceRequestUpdate: AdviceRequestUpdate, options?: Parameters<typeof customFetch>[1]) => Promise<AdviceRequest>;
export declare const getUpdateAdviceRequestMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdviceRequest>>, TError, {
        id: number;
        data: BodyType<AdviceRequestUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAdviceRequest>>, TError, {
    id: number;
    data: BodyType<AdviceRequestUpdate>;
}, TContext>;
export type UpdateAdviceRequestMutationResult = NonNullable<Awaited<ReturnType<typeof updateAdviceRequest>>>;
export type UpdateAdviceRequestMutationBody = BodyType<AdviceRequestUpdate>;
export type UpdateAdviceRequestMutationError = ErrorType<void>;
/**
* @summary Verify manual payment, assign an advisor, or update status
*/
export declare const useUpdateAdviceRequest: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdviceRequest>>, TError, {
        id: number;
        data: BodyType<AdviceRequestUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAdviceRequest>>, TError, {
    id: number;
    data: BodyType<AdviceRequestUpdate>;
}, TContext>;
export declare const getRetryWhatsAppNotificationUrl: (id: number) => string;
/**
 * @summary Retry a failed or skipped WhatsApp notification
 */
export declare const retryWhatsAppNotification: (id: number, options?: Parameters<typeof customFetch>[1]) => Promise<RetryWhatsAppNotification200>;
export declare const getRetryWhatsAppNotificationMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof retryWhatsAppNotification>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof retryWhatsAppNotification>>, TError, {
    id: number;
}, TContext>;
export type RetryWhatsAppNotificationMutationResult = NonNullable<Awaited<ReturnType<typeof retryWhatsAppNotification>>>;
export type RetryWhatsAppNotificationMutationError = ErrorType<void>;
/**
* @summary Retry a failed or skipped WhatsApp notification
*/
export declare const useRetryWhatsAppNotification: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof retryWhatsAppNotification>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof retryWhatsAppNotification>>, TError, {
    id: number;
}, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map