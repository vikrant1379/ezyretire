import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AccountDeletionConfirmation, AccountDeletionStatus, AdviceAdminDashboard, AdviceOverview, AdvicePaymentReferenceInput, AdviceRequest, AdviceRequestInput, AdviceRequestUpdate, AdviceSettings, AdviceSettingsUpdate, Advisor, AdvisorInput, AdvisorUpdate, AuthProfileUpdate, AuthUserEnvelope, BankStatementImportResult, BeginAdminBrowserLoginParams, BeginBrowserLoginParams, BeginPasskeyAuthenticationBody, BeginPasskeyRegistrationBody, CleanupExpiredVaultStorageBody, CleanupStatus, ConfirmReceiptReviewBody, EntitlementContract, FinancialDataDocument, FinancialHealthPlanningUpdate, FinancialRestoreUploadReference, FinancialRetirementPlanReplacement, GetAdminLoginActivityParams, GetVaultCleanupStatus200, HealthStatus, ImportBankStatementExpensesBody, ListPasskeys200, LoginActivityPage, LoginWithAccountPinBody, LogoutBrowserSessionParams, NomineeInput, OtpVerification, PasskeyAuthenticationVerification, PasskeyCredentialEnvelope, PasskeyLoginEnvelope, PasskeyOptionsEnvelope, PasskeyRegistrationVerification, PinLoginEnvelope, PinSetupEnvelope, ReceiptConfirmationResult, ReceiptReviewInput, RenamePasskeyBody, RequestFinancialRestoreUploadUrl200, RequestFinancialRestoreUploadUrlBody, RetryWhatsAppNotification200, RevokePasskeyBody, SetupAccountPinBody, UpdateVaultDocumentLifecycleBody, VaultDocumentConfirmation, VaultUploadMetadata, VaultUploadUrl, WhatsAppSupport } from './api.schemas';
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
export declare const getSetupAccountPinUrl: () => string;
/**
 * @summary Create or replace a four-digit account PIN after recent email verification
 */
export declare const setupAccountPin: (setupAccountPinBody: SetupAccountPinBody, options?: Parameters<typeof customFetch>[1]) => Promise<PinSetupEnvelope>;
export declare const getSetupAccountPinMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setupAccountPin>>, TError, {
        data: BodyType<SetupAccountPinBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof setupAccountPin>>, TError, {
    data: BodyType<SetupAccountPinBody>;
}, TContext>;
export type SetupAccountPinMutationResult = NonNullable<Awaited<ReturnType<typeof setupAccountPin>>>;
export type SetupAccountPinMutationBody = BodyType<SetupAccountPinBody>;
export type SetupAccountPinMutationError = ErrorType<void>;
/**
* @summary Create or replace a four-digit account PIN after recent email verification
*/
export declare const useSetupAccountPin: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setupAccountPin>>, TError, {
        data: BodyType<SetupAccountPinBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof setupAccountPin>>, TError, {
    data: BodyType<SetupAccountPinBody>;
}, TContext>;
export declare const getLoginWithAccountPinUrl: () => string;
/**
 * @summary Sign in to a remembered account with its four-digit PIN
 */
export declare const loginWithAccountPin: (loginWithAccountPinBody: LoginWithAccountPinBody, options?: Parameters<typeof customFetch>[1]) => Promise<PinLoginEnvelope>;
export declare const getLoginWithAccountPinMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loginWithAccountPin>>, TError, {
        data: BodyType<LoginWithAccountPinBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof loginWithAccountPin>>, TError, {
    data: BodyType<LoginWithAccountPinBody>;
}, TContext>;
export type LoginWithAccountPinMutationResult = NonNullable<Awaited<ReturnType<typeof loginWithAccountPin>>>;
export type LoginWithAccountPinMutationBody = BodyType<LoginWithAccountPinBody>;
export type LoginWithAccountPinMutationError = ErrorType<void>;
/**
* @summary Sign in to a remembered account with its four-digit PIN
*/
export declare const useLoginWithAccountPin: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loginWithAccountPin>>, TError, {
        data: BodyType<LoginWithAccountPinBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof loginWithAccountPin>>, TError, {
    data: BodyType<LoginWithAccountPinBody>;
}, TContext>;
export declare const getBeginPasskeyRegistrationUrl: () => string;
/**
 * @summary Create passkey registration options for a recently email-verified customer
 */
export declare const beginPasskeyRegistration: (beginPasskeyRegistrationBody: BeginPasskeyRegistrationBody, options?: Parameters<typeof customFetch>[1]) => Promise<PasskeyOptionsEnvelope>;
export declare const getBeginPasskeyRegistrationMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof beginPasskeyRegistration>>, TError, {
        data: BodyType<BeginPasskeyRegistrationBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof beginPasskeyRegistration>>, TError, {
    data: BodyType<BeginPasskeyRegistrationBody>;
}, TContext>;
export type BeginPasskeyRegistrationMutationResult = NonNullable<Awaited<ReturnType<typeof beginPasskeyRegistration>>>;
export type BeginPasskeyRegistrationMutationBody = BodyType<BeginPasskeyRegistrationBody>;
export type BeginPasskeyRegistrationMutationError = ErrorType<void>;
/**
* @summary Create passkey registration options for a recently email-verified customer
*/
export declare const useBeginPasskeyRegistration: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof beginPasskeyRegistration>>, TError, {
        data: BodyType<BeginPasskeyRegistrationBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof beginPasskeyRegistration>>, TError, {
    data: BodyType<BeginPasskeyRegistrationBody>;
}, TContext>;
export declare const getCompletePasskeyRegistrationUrl: () => string;
/**
 * @summary Verify and store a passkey
 */
export declare const completePasskeyRegistration: (passkeyRegistrationVerification: PasskeyRegistrationVerification, options?: Parameters<typeof customFetch>[1]) => Promise<PasskeyCredentialEnvelope>;
export declare const getCompletePasskeyRegistrationMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completePasskeyRegistration>>, TError, {
        data: BodyType<PasskeyRegistrationVerification>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof completePasskeyRegistration>>, TError, {
    data: BodyType<PasskeyRegistrationVerification>;
}, TContext>;
export type CompletePasskeyRegistrationMutationResult = NonNullable<Awaited<ReturnType<typeof completePasskeyRegistration>>>;
export type CompletePasskeyRegistrationMutationBody = BodyType<PasskeyRegistrationVerification>;
export type CompletePasskeyRegistrationMutationError = ErrorType<void>;
/**
* @summary Verify and store a passkey
*/
export declare const useCompletePasskeyRegistration: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completePasskeyRegistration>>, TError, {
        data: BodyType<PasskeyRegistrationVerification>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof completePasskeyRegistration>>, TError, {
    data: BodyType<PasskeyRegistrationVerification>;
}, TContext>;
export declare const getBeginPasskeyAuthenticationUrl: () => string;
/**
 * @summary Create discoverable username-less passkey authentication options
 */
export declare const beginPasskeyAuthentication: (beginPasskeyAuthenticationBody: BeginPasskeyAuthenticationBody, options?: Parameters<typeof customFetch>[1]) => Promise<PasskeyOptionsEnvelope>;
export declare const getBeginPasskeyAuthenticationMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof beginPasskeyAuthentication>>, TError, {
        data: BodyType<BeginPasskeyAuthenticationBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof beginPasskeyAuthentication>>, TError, {
    data: BodyType<BeginPasskeyAuthenticationBody>;
}, TContext>;
export type BeginPasskeyAuthenticationMutationResult = NonNullable<Awaited<ReturnType<typeof beginPasskeyAuthentication>>>;
export type BeginPasskeyAuthenticationMutationBody = BodyType<BeginPasskeyAuthenticationBody>;
export type BeginPasskeyAuthenticationMutationError = ErrorType<void>;
/**
* @summary Create discoverable username-less passkey authentication options
*/
export declare const useBeginPasskeyAuthentication: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof beginPasskeyAuthentication>>, TError, {
        data: BodyType<BeginPasskeyAuthenticationBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof beginPasskeyAuthentication>>, TError, {
    data: BodyType<BeginPasskeyAuthenticationBody>;
}, TContext>;
export declare const getCompletePasskeyAuthenticationUrl: () => string;
/**
 * @summary Verify a discoverable passkey and issue the normal session
 */
export declare const completePasskeyAuthentication: (passkeyAuthenticationVerification: PasskeyAuthenticationVerification, options?: Parameters<typeof customFetch>[1]) => Promise<PasskeyLoginEnvelope>;
export declare const getCompletePasskeyAuthenticationMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completePasskeyAuthentication>>, TError, {
        data: BodyType<PasskeyAuthenticationVerification>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof completePasskeyAuthentication>>, TError, {
    data: BodyType<PasskeyAuthenticationVerification>;
}, TContext>;
export type CompletePasskeyAuthenticationMutationResult = NonNullable<Awaited<ReturnType<typeof completePasskeyAuthentication>>>;
export type CompletePasskeyAuthenticationMutationBody = BodyType<PasskeyAuthenticationVerification>;
export type CompletePasskeyAuthenticationMutationError = ErrorType<void>;
/**
* @summary Verify a discoverable passkey and issue the normal session
*/
export declare const useCompletePasskeyAuthentication: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completePasskeyAuthentication>>, TError, {
        data: BodyType<PasskeyAuthenticationVerification>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof completePasskeyAuthentication>>, TError, {
    data: BodyType<PasskeyAuthenticationVerification>;
}, TContext>;
export declare const getListPasskeysUrl: () => string;
/**
 * @summary List active passkeys after recent email verification
 */
export declare const listPasskeys: (options?: Parameters<typeof customFetch>[1]) => Promise<ListPasskeys200>;
export declare const getListPasskeysQueryKey: () => readonly ["/api/auth/passkeys"];
export declare const getListPasskeysQueryOptions: <TData = Awaited<ReturnType<typeof listPasskeys>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPasskeys>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPasskeys>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPasskeysQueryResult = NonNullable<Awaited<ReturnType<typeof listPasskeys>>>;
export type ListPasskeysQueryError = ErrorType<void>;
/**
 * @summary List active passkeys after recent email verification
 */
export declare function useListPasskeys<TData = Awaited<ReturnType<typeof listPasskeys>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPasskeys>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRenamePasskeyUrl: (id: string) => string;
/**
 * @summary Rename an owned active passkey
 */
export declare const renamePasskey: (id: string, renamePasskeyBody: RenamePasskeyBody, options?: Parameters<typeof customFetch>[1]) => Promise<PasskeyCredentialEnvelope>;
export declare const getRenamePasskeyMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renamePasskey>>, TError, {
        id: string;
        data: BodyType<RenamePasskeyBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof renamePasskey>>, TError, {
    id: string;
    data: BodyType<RenamePasskeyBody>;
}, TContext>;
export type RenamePasskeyMutationResult = NonNullable<Awaited<ReturnType<typeof renamePasskey>>>;
export type RenamePasskeyMutationBody = BodyType<RenamePasskeyBody>;
export type RenamePasskeyMutationError = ErrorType<void>;
/**
* @summary Rename an owned active passkey
*/
export declare const useRenamePasskey: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renamePasskey>>, TError, {
        id: string;
        data: BodyType<RenamePasskeyBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof renamePasskey>>, TError, {
    id: string;
    data: BodyType<RenamePasskeyBody>;
}, TContext>;
export declare const getRevokePasskeyUrl: (id: string) => string;
/**
 * @summary Revoke an owned active passkey
 */
export declare const revokePasskey: (id: string, revokePasskeyBody: RevokePasskeyBody, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getRevokePasskeyMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokePasskey>>, TError, {
        id: string;
        data: BodyType<RevokePasskeyBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof revokePasskey>>, TError, {
    id: string;
    data: BodyType<RevokePasskeyBody>;
}, TContext>;
export type RevokePasskeyMutationResult = NonNullable<Awaited<ReturnType<typeof revokePasskey>>>;
export type RevokePasskeyMutationBody = BodyType<RevokePasskeyBody>;
export type RevokePasskeyMutationError = ErrorType<void>;
/**
* @summary Revoke an owned active passkey
*/
export declare const useRevokePasskey: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof revokePasskey>>, TError, {
        id: string;
        data: BodyType<RevokePasskeyBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof revokePasskey>>, TError, {
    id: string;
    data: BodyType<RevokePasskeyBody>;
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
export declare const getGetAdminLoginActivityUrl: (params?: GetAdminLoginActivityParams) => string;
/**
 * @summary Get paginated successful login history
 */
export declare const getAdminLoginActivity: (params?: GetAdminLoginActivityParams, options?: Parameters<typeof customFetch>[1]) => Promise<LoginActivityPage>;
export declare const getGetAdminLoginActivityQueryKey: (params?: GetAdminLoginActivityParams) => readonly ["/api/admin/login-activity", ...GetAdminLoginActivityParams[]];
export declare const getGetAdminLoginActivityQueryOptions: <TData = Awaited<ReturnType<typeof getAdminLoginActivity>>, TError = ErrorType<void>>(params?: GetAdminLoginActivityParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminLoginActivity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAdminLoginActivity>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAdminLoginActivityQueryResult = NonNullable<Awaited<ReturnType<typeof getAdminLoginActivity>>>;
export type GetAdminLoginActivityQueryError = ErrorType<void>;
/**
 * @summary Get paginated successful login history
 */
export declare function useGetAdminLoginActivity<TData = Awaited<ReturnType<typeof getAdminLoginActivity>>, TError = ErrorType<void>>(params?: GetAdminLoginActivityParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminLoginActivity>>, TError, TData>;
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
export declare const getGetFinancialDataUrl: () => string;
/**
 * @summary Get the signed-in account's financial planning document
 */
export declare const getFinancialData: (options?: Parameters<typeof customFetch>[1]) => Promise<FinancialDataDocument>;
export declare const getGetFinancialDataQueryKey: () => readonly ["/api/financial-data"];
export declare const getGetFinancialDataQueryOptions: <TData = Awaited<ReturnType<typeof getFinancialData>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFinancialData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getFinancialData>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetFinancialDataQueryResult = NonNullable<Awaited<ReturnType<typeof getFinancialData>>>;
export type GetFinancialDataQueryError = ErrorType<void>;
/**
 * @summary Get the signed-in account's financial planning document
 */
export declare function useGetFinancialData<TData = Awaited<ReturnType<typeof getFinancialData>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFinancialData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPutFinancialDataUrl: () => string;
/**
 * @summary Replace the signed-in account's financial planning document
 */
export declare const putFinancialData: (financialDataDocument: FinancialDataDocument, options?: Parameters<typeof customFetch>[1]) => Promise<FinancialDataDocument>;
export declare const getPutFinancialDataMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof putFinancialData>>, TError, {
        data: BodyType<FinancialDataDocument>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof putFinancialData>>, TError, {
    data: BodyType<FinancialDataDocument>;
}, TContext>;
export type PutFinancialDataMutationResult = NonNullable<Awaited<ReturnType<typeof putFinancialData>>>;
export type PutFinancialDataMutationBody = BodyType<FinancialDataDocument>;
export type PutFinancialDataMutationError = ErrorType<void>;
/**
* @summary Replace the signed-in account's financial planning document
*/
export declare const usePutFinancialData: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof putFinancialData>>, TError, {
        data: BodyType<FinancialDataDocument>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof putFinancialData>>, TError, {
    data: BodyType<FinancialDataDocument>;
}, TContext>;
export declare const getDeleteFinancialDataUrl: () => string;
/**
 * @summary Clear the signed-in account's financial planning document
 */
export declare const deleteFinancialData: (options?: Parameters<typeof customFetch>[1]) => Promise<FinancialDataDocument>;
export declare const getDeleteFinancialDataMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFinancialData>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteFinancialData>>, TError, void, TContext>;
export type DeleteFinancialDataMutationResult = NonNullable<Awaited<ReturnType<typeof deleteFinancialData>>>;
export type DeleteFinancialDataMutationError = ErrorType<void>;
/**
* @summary Clear the signed-in account's financial planning document
*/
export declare const useDeleteFinancialData: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFinancialData>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteFinancialData>>, TError, void, TContext>;
export declare const getImportBankStatementExpensesUrl: () => string;
/**
 * @summary Atomically commit reviewed premium bank statement expenses
 */
export declare const importBankStatementExpenses: (importBankStatementExpensesBody: ImportBankStatementExpensesBody, options?: Parameters<typeof customFetch>[1]) => Promise<BankStatementImportResult>;
export declare const getImportBankStatementExpensesMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof importBankStatementExpenses>>, TError, {
        data: BodyType<ImportBankStatementExpensesBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof importBankStatementExpenses>>, TError, {
    data: BodyType<ImportBankStatementExpensesBody>;
}, TContext>;
export type ImportBankStatementExpensesMutationResult = NonNullable<Awaited<ReturnType<typeof importBankStatementExpenses>>>;
export type ImportBankStatementExpensesMutationBody = BodyType<ImportBankStatementExpensesBody>;
export type ImportBankStatementExpensesMutationError = ErrorType<void>;
/**
* @summary Atomically commit reviewed premium bank statement expenses
*/
export declare const useImportBankStatementExpenses: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof importBankStatementExpenses>>, TError, {
        data: BodyType<ImportBankStatementExpensesBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof importBankStatementExpenses>>, TError, {
    data: BodyType<ImportBankStatementExpensesBody>;
}, TContext>;
export declare const getExportPersonalDataUrl: () => string;
/**
 * @summary Download a complete versioned export for the signed-in account
 */
export declare const exportPersonalData: (options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getExportPersonalDataQueryKey: () => readonly ["/api/account/export"];
export declare const getExportPersonalDataQueryOptions: <TData = Awaited<ReturnType<typeof exportPersonalData>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof exportPersonalData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof exportPersonalData>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ExportPersonalDataQueryResult = NonNullable<Awaited<ReturnType<typeof exportPersonalData>>>;
export type ExportPersonalDataQueryError = ErrorType<void>;
/**
 * @summary Download a complete versioned export for the signed-in account
 */
export declare function useExportPersonalData<TData = Awaited<ReturnType<typeof exportPersonalData>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof exportPersonalData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAccountDeletionStatusUrl: () => string;
/**
 * @summary Get the signed-in account deletion lifecycle
 */
export declare const getAccountDeletionStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<AccountDeletionStatus>;
export declare const getGetAccountDeletionStatusQueryKey: () => readonly ["/api/account/deletion"];
export declare const getGetAccountDeletionStatusQueryOptions: <TData = Awaited<ReturnType<typeof getAccountDeletionStatus>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAccountDeletionStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAccountDeletionStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAccountDeletionStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getAccountDeletionStatus>>>;
export type GetAccountDeletionStatusQueryError = ErrorType<void>;
/**
 * @summary Get the signed-in account deletion lifecycle
 */
export declare function useGetAccountDeletionStatus<TData = Awaited<ReturnType<typeof getAccountDeletionStatus>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAccountDeletionStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRequestAccountDeletionUrl: () => string;
/**
 * @summary Schedule deletion after recent authentication and strong confirmation
 */
export declare const requestAccountDeletion: (accountDeletionConfirmation: AccountDeletionConfirmation, options?: Parameters<typeof customFetch>[1]) => Promise<AccountDeletionStatus>;
export declare const getRequestAccountDeletionMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestAccountDeletion>>, TError, {
        data: BodyType<AccountDeletionConfirmation>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestAccountDeletion>>, TError, {
    data: BodyType<AccountDeletionConfirmation>;
}, TContext>;
export type RequestAccountDeletionMutationResult = NonNullable<Awaited<ReturnType<typeof requestAccountDeletion>>>;
export type RequestAccountDeletionMutationBody = BodyType<AccountDeletionConfirmation>;
export type RequestAccountDeletionMutationError = ErrorType<void>;
/**
* @summary Schedule deletion after recent authentication and strong confirmation
*/
export declare const useRequestAccountDeletion: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestAccountDeletion>>, TError, {
        data: BodyType<AccountDeletionConfirmation>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestAccountDeletion>>, TError, {
    data: BodyType<AccountDeletionConfirmation>;
}, TContext>;
export declare const getCancelAccountDeletionUrl: () => string;
/**
 * @summary Cancel deletion during the seven-day cooling period
 */
export declare const cancelAccountDeletion: (options?: Parameters<typeof customFetch>[1]) => Promise<AccountDeletionStatus>;
export declare const getCancelAccountDeletionMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cancelAccountDeletion>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof cancelAccountDeletion>>, TError, void, TContext>;
export type CancelAccountDeletionMutationResult = NonNullable<Awaited<ReturnType<typeof cancelAccountDeletion>>>;
export type CancelAccountDeletionMutationError = ErrorType<void>;
/**
* @summary Cancel deletion during the seven-day cooling period
*/
export declare const useCancelAccountDeletion: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cancelAccountDeletion>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof cancelAccountDeletion>>, TError, void, TContext>;
export declare const getUpdateFinancialHealthPlanningUrl: () => string;
/**
 * @summary Update emergency-fund settings or one monthly net-worth snapshot
 */
export declare const updateFinancialHealthPlanning: (financialHealthPlanningUpdate: FinancialHealthPlanningUpdate, options?: Parameters<typeof customFetch>[1]) => Promise<FinancialDataDocument>;
export declare const getUpdateFinancialHealthPlanningMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFinancialHealthPlanning>>, TError, {
        data: BodyType<FinancialHealthPlanningUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateFinancialHealthPlanning>>, TError, {
    data: BodyType<FinancialHealthPlanningUpdate>;
}, TContext>;
export type UpdateFinancialHealthPlanningMutationResult = NonNullable<Awaited<ReturnType<typeof updateFinancialHealthPlanning>>>;
export type UpdateFinancialHealthPlanningMutationBody = BodyType<FinancialHealthPlanningUpdate>;
export type UpdateFinancialHealthPlanningMutationError = ErrorType<void>;
/**
* @summary Update emergency-fund settings or one monthly net-worth snapshot
*/
export declare const useUpdateFinancialHealthPlanning: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFinancialHealthPlanning>>, TError, {
        data: BodyType<FinancialHealthPlanningUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateFinancialHealthPlanning>>, TError, {
    data: BodyType<FinancialHealthPlanningUpdate>;
}, TContext>;
export declare const getRestoreFinancialDataUrl: () => string;
/**
 * @summary Authoritatively restore the signed-in account's financial planning document
 */
export declare const restoreFinancialData: (financialDataDocumentFinancialRestoreUploadReference: FinancialDataDocument | FinancialRestoreUploadReference, options?: Parameters<typeof customFetch>[1]) => Promise<FinancialDataDocument>;
export declare const getRestoreFinancialDataMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof restoreFinancialData>>, TError, {
        data: BodyType<FinancialDataDocument | FinancialRestoreUploadReference>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof restoreFinancialData>>, TError, {
    data: BodyType<FinancialDataDocument | FinancialRestoreUploadReference>;
}, TContext>;
export type RestoreFinancialDataMutationResult = NonNullable<Awaited<ReturnType<typeof restoreFinancialData>>>;
export type RestoreFinancialDataMutationBody = BodyType<FinancialDataDocument | FinancialRestoreUploadReference>;
export type RestoreFinancialDataMutationError = ErrorType<void>;
/**
* @summary Authoritatively restore the signed-in account's financial planning document
*/
export declare const useRestoreFinancialData: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof restoreFinancialData>>, TError, {
        data: BodyType<FinancialDataDocument | FinancialRestoreUploadReference>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof restoreFinancialData>>, TError, {
    data: BodyType<FinancialDataDocument | FinancialRestoreUploadReference>;
}, TContext>;
export declare const getRequestFinancialRestoreUploadUrlUrl: () => string;
/**
 * @summary Create an owner-bound upload URL for a large financial restore backup
 */
export declare const requestFinancialRestoreUploadUrl: (requestFinancialRestoreUploadUrlBody: RequestFinancialRestoreUploadUrlBody, options?: Parameters<typeof customFetch>[1]) => Promise<RequestFinancialRestoreUploadUrl200>;
export declare const getRequestFinancialRestoreUploadUrlMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestFinancialRestoreUploadUrl>>, TError, {
        data: BodyType<RequestFinancialRestoreUploadUrlBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestFinancialRestoreUploadUrl>>, TError, {
    data: BodyType<RequestFinancialRestoreUploadUrlBody>;
}, TContext>;
export type RequestFinancialRestoreUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof requestFinancialRestoreUploadUrl>>>;
export type RequestFinancialRestoreUploadUrlMutationBody = BodyType<RequestFinancialRestoreUploadUrlBody>;
export type RequestFinancialRestoreUploadUrlMutationError = ErrorType<void>;
/**
* @summary Create an owner-bound upload URL for a large financial restore backup
*/
export declare const useRequestFinancialRestoreUploadUrl: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestFinancialRestoreUploadUrl>>, TError, {
        data: BodyType<RequestFinancialRestoreUploadUrlBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestFinancialRestoreUploadUrl>>, TError, {
    data: BodyType<RequestFinancialRestoreUploadUrlBody>;
}, TContext>;
export declare const getDeleteFinancialExpenseUrl: (id: string) => string;
/**
 * @summary Deliberately delete one owned expense
 */
export declare const deleteFinancialExpense: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<FinancialDataDocument>;
export declare const getDeleteFinancialExpenseMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFinancialExpense>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteFinancialExpense>>, TError, {
    id: string;
}, TContext>;
export type DeleteFinancialExpenseMutationResult = NonNullable<Awaited<ReturnType<typeof deleteFinancialExpense>>>;
export type DeleteFinancialExpenseMutationError = ErrorType<void>;
/**
* @summary Deliberately delete one owned expense
*/
export declare const useDeleteFinancialExpense: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFinancialExpense>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteFinancialExpense>>, TError, {
    id: string;
}, TContext>;
export declare const getUpdateRetirementPlanningUrl: () => string;
/**
 * @summary Replace retirement assumptions, lifestyle, and pension sources
 */
export declare const updateRetirementPlanning: (financialRetirementPlanReplacement: FinancialRetirementPlanReplacement, options?: Parameters<typeof customFetch>[1]) => Promise<FinancialDataDocument>;
export declare const getUpdateRetirementPlanningMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateRetirementPlanning>>, TError, {
        data: BodyType<FinancialRetirementPlanReplacement>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateRetirementPlanning>>, TError, {
    data: BodyType<FinancialRetirementPlanReplacement>;
}, TContext>;
export type UpdateRetirementPlanningMutationResult = NonNullable<Awaited<ReturnType<typeof updateRetirementPlanning>>>;
export type UpdateRetirementPlanningMutationBody = BodyType<FinancialRetirementPlanReplacement>;
export type UpdateRetirementPlanningMutationError = ErrorType<void>;
/**
* @summary Replace retirement assumptions, lifestyle, and pension sources
*/
export declare const useUpdateRetirementPlanning: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateRetirementPlanning>>, TError, {
        data: BodyType<FinancialRetirementPlanReplacement>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateRetirementPlanning>>, TError, {
    data: BodyType<FinancialRetirementPlanReplacement>;
}, TContext>;
export declare const getGetEntitlementsUrl: () => string;
/**
 * @summary Get effective account capabilities
 */
export declare const getEntitlements: (options?: Parameters<typeof customFetch>[1]) => Promise<EntitlementContract>;
export declare const getGetEntitlementsQueryKey: () => readonly ["/api/entitlements"];
export declare const getGetEntitlementsQueryOptions: <TData = Awaited<ReturnType<typeof getEntitlements>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEntitlements>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getEntitlements>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetEntitlementsQueryResult = NonNullable<Awaited<ReturnType<typeof getEntitlements>>>;
export type GetEntitlementsQueryError = ErrorType<void>;
/**
 * @summary Get effective account capabilities
 */
export declare function useGetEntitlements<TData = Awaited<ReturnType<typeof getEntitlements>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEntitlements>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRequestMobileOtpUrl: () => string;
/**
 * @summary Request mobile verification by SMS
 */
export declare const requestMobileOtp: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getRequestMobileOtpMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestMobileOtp>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestMobileOtp>>, TError, void, TContext>;
export type RequestMobileOtpMutationResult = NonNullable<Awaited<ReturnType<typeof requestMobileOtp>>>;
export type RequestMobileOtpMutationError = ErrorType<void>;
/**
* @summary Request mobile verification by SMS
*/
export declare const useRequestMobileOtp: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestMobileOtp>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestMobileOtp>>, TError, void, TContext>;
export declare const getVerifyMobileOtpUrl: () => string;
/**
 * @summary Verify a delivered mobile verification challenge
 */
export declare const verifyMobileOtp: (otpVerification: OtpVerification, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getVerifyMobileOtpMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyMobileOtp>>, TError, {
        data: BodyType<OtpVerification>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof verifyMobileOtp>>, TError, {
    data: BodyType<OtpVerification>;
}, TContext>;
export type VerifyMobileOtpMutationResult = NonNullable<Awaited<ReturnType<typeof verifyMobileOtp>>>;
export type VerifyMobileOtpMutationBody = BodyType<OtpVerification>;
export type VerifyMobileOtpMutationError = ErrorType<void>;
/**
* @summary Verify a delivered mobile verification challenge
*/
export declare const useVerifyMobileOtp: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyMobileOtp>>, TError, {
        data: BodyType<OtpVerification>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof verifyMobileOtp>>, TError, {
    data: BodyType<OtpVerification>;
}, TContext>;
export declare const getRequestVaultUploadUrlUrl: () => string;
/**
 * @summary Request a private direct-upload URL
 */
export declare const requestVaultUploadUrl: (vaultUploadMetadata: VaultUploadMetadata, options?: Parameters<typeof customFetch>[1]) => Promise<VaultUploadUrl>;
export declare const getRequestVaultUploadUrlMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestVaultUploadUrl>>, TError, {
        data: BodyType<VaultUploadMetadata>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestVaultUploadUrl>>, TError, {
    data: BodyType<VaultUploadMetadata>;
}, TContext>;
export type RequestVaultUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof requestVaultUploadUrl>>>;
export type RequestVaultUploadUrlMutationBody = BodyType<VaultUploadMetadata>;
export type RequestVaultUploadUrlMutationError = ErrorType<void>;
/**
* @summary Request a private direct-upload URL
*/
export declare const useRequestVaultUploadUrl: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestVaultUploadUrl>>, TError, {
        data: BodyType<VaultUploadMetadata>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestVaultUploadUrl>>, TError, {
    data: BodyType<VaultUploadMetadata>;
}, TContext>;
export declare const getCleanupExpiredVaultStorageUrl: () => string;
/**
 * @summary Retry cleanup of this account's expired uploads and receipt reviews
 */
export declare const cleanupExpiredVaultStorage: (cleanupExpiredVaultStorageBody?: CleanupExpiredVaultStorageBody, options?: Parameters<typeof customFetch>[1]) => Promise<CleanupStatus>;
export declare const getCleanupExpiredVaultStorageMutationOptions: <TError = ErrorType<void | CleanupStatus>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cleanupExpiredVaultStorage>>, TError, {
        data?: BodyType<CleanupExpiredVaultStorageBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof cleanupExpiredVaultStorage>>, TError, {
    data?: BodyType<CleanupExpiredVaultStorageBody>;
}, TContext>;
export type CleanupExpiredVaultStorageMutationResult = NonNullable<Awaited<ReturnType<typeof cleanupExpiredVaultStorage>>>;
export type CleanupExpiredVaultStorageMutationBody = BodyType<CleanupExpiredVaultStorageBody> | undefined;
export type CleanupExpiredVaultStorageMutationError = ErrorType<void | CleanupStatus>;
/**
* @summary Retry cleanup of this account's expired uploads and receipt reviews
*/
export declare const useCleanupExpiredVaultStorage: <TError = ErrorType<void | CleanupStatus>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cleanupExpiredVaultStorage>>, TError, {
        data?: BodyType<CleanupExpiredVaultStorageBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof cleanupExpiredVaultStorage>>, TError, {
    data?: BodyType<CleanupExpiredVaultStorageBody>;
}, TContext>;
export declare const getGetVaultCleanupStatusUrl: () => string;
/**
 * @summary Get account-scoped pending storage cleanup status
 */
export declare const getVaultCleanupStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<GetVaultCleanupStatus200>;
export declare const getGetVaultCleanupStatusQueryKey: () => readonly ["/api/vault/cleanup-status"];
export declare const getGetVaultCleanupStatusQueryOptions: <TData = Awaited<ReturnType<typeof getVaultCleanupStatus>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getVaultCleanupStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getVaultCleanupStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetVaultCleanupStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getVaultCleanupStatus>>>;
export type GetVaultCleanupStatusQueryError = ErrorType<void>;
/**
 * @summary Get account-scoped pending storage cleanup status
 */
export declare function useGetVaultCleanupStatus<TData = Awaited<ReturnType<typeof getVaultCleanupStatus>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getVaultCleanupStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListVaultDocumentsUrl: () => string;
/**
 * @summary List account vault metadata
 */
export declare const listVaultDocuments: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getListVaultDocumentsQueryKey: () => readonly ["/api/vault/documents"];
export declare const getListVaultDocumentsQueryOptions: <TData = Awaited<ReturnType<typeof listVaultDocuments>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listVaultDocuments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listVaultDocuments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListVaultDocumentsQueryResult = NonNullable<Awaited<ReturnType<typeof listVaultDocuments>>>;
export type ListVaultDocumentsQueryError = ErrorType<void>;
/**
 * @summary List account vault metadata
 */
export declare function useListVaultDocuments<TData = Awaited<ReturnType<typeof listVaultDocuments>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listVaultDocuments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getConfirmVaultDocumentUrl: () => string;
/**
 * @summary Confirm a completed upload and create metadata
 */
export declare const confirmVaultDocument: (vaultDocumentConfirmation: VaultDocumentConfirmation, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getConfirmVaultDocumentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof confirmVaultDocument>>, TError, {
        data: BodyType<VaultDocumentConfirmation>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof confirmVaultDocument>>, TError, {
    data: BodyType<VaultDocumentConfirmation>;
}, TContext>;
export type ConfirmVaultDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof confirmVaultDocument>>>;
export type ConfirmVaultDocumentMutationBody = BodyType<VaultDocumentConfirmation>;
export type ConfirmVaultDocumentMutationError = ErrorType<void>;
/**
* @summary Confirm a completed upload and create metadata
*/
export declare const useConfirmVaultDocument: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof confirmVaultDocument>>, TError, {
        data: BodyType<VaultDocumentConfirmation>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof confirmVaultDocument>>, TError, {
    data: BodyType<VaultDocumentConfirmation>;
}, TContext>;
export declare const getReplaceVaultDocumentUrl: (id: string) => string;
/**
 * @summary Replace document content after direct upload
 */
export declare const replaceVaultDocument: (id: string, vaultDocumentConfirmation: VaultDocumentConfirmation, options?: Parameters<typeof customFetch>[1]) => Promise<CleanupStatus>;
export declare const getReplaceVaultDocumentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof replaceVaultDocument>>, TError, {
        id: string;
        data: BodyType<VaultDocumentConfirmation>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof replaceVaultDocument>>, TError, {
    id: string;
    data: BodyType<VaultDocumentConfirmation>;
}, TContext>;
export type ReplaceVaultDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof replaceVaultDocument>>>;
export type ReplaceVaultDocumentMutationBody = BodyType<VaultDocumentConfirmation>;
export type ReplaceVaultDocumentMutationError = ErrorType<void>;
/**
* @summary Replace document content after direct upload
*/
export declare const useReplaceVaultDocument: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof replaceVaultDocument>>, TError, {
        id: string;
        data: BodyType<VaultDocumentConfirmation>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof replaceVaultDocument>>, TError, {
    id: string;
    data: BodyType<VaultDocumentConfirmation>;
}, TContext>;
export declare const getDeleteVaultDocumentUrl: (id: string) => string;
/**
 * @summary Delete document metadata and object
 */
export declare const deleteVaultDocument: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<CleanupStatus>;
export declare const getDeleteVaultDocumentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteVaultDocument>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteVaultDocument>>, TError, {
    id: string;
}, TContext>;
export type DeleteVaultDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof deleteVaultDocument>>>;
export type DeleteVaultDocumentMutationError = ErrorType<void>;
/**
* @summary Delete document metadata and object
*/
export declare const useDeleteVaultDocument: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteVaultDocument>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteVaultDocument>>, TError, {
    id: string;
}, TContext>;
export declare const getDownloadVaultDocumentUrl: (id: string) => string;
/**
 * @summary Download an account-owned private document
 */
export declare const downloadVaultDocument: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getDownloadVaultDocumentQueryKey: (id: string) => readonly [`/api/vault/documents/${string}/download`];
export declare const getDownloadVaultDocumentQueryOptions: <TData = Awaited<ReturnType<typeof downloadVaultDocument>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadVaultDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof downloadVaultDocument>>, TError, TData> & {
    queryKey: QueryKey;
};
export type DownloadVaultDocumentQueryResult = NonNullable<Awaited<ReturnType<typeof downloadVaultDocument>>>;
export type DownloadVaultDocumentQueryError = ErrorType<void>;
/**
 * @summary Download an account-owned private document
 */
export declare function useDownloadVaultDocument<TData = Awaited<ReturnType<typeof downloadVaultDocument>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadVaultDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPreviewVaultDocumentUrl: (id: string) => string;
/**
 * @summary Inline-preview an account-owned raster image
 */
export declare const previewVaultDocument: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getPreviewVaultDocumentQueryKey: (id: string) => readonly [`/api/vault/documents/${string}/preview`];
export declare const getPreviewVaultDocumentQueryOptions: <TData = Awaited<ReturnType<typeof previewVaultDocument>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof previewVaultDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof previewVaultDocument>>, TError, TData> & {
    queryKey: QueryKey;
};
export type PreviewVaultDocumentQueryResult = NonNullable<Awaited<ReturnType<typeof previewVaultDocument>>>;
export type PreviewVaultDocumentQueryError = ErrorType<void>;
/**
 * @summary Inline-preview an account-owned raster image
 */
export declare function usePreviewVaultDocument<TData = Awaited<ReturnType<typeof previewVaultDocument>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof previewVaultDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateVaultDocumentLifecycleUrl: (id: string) => string;
/**
 * @summary Archive or restore a document
 */
export declare const updateVaultDocumentLifecycle: (id: string, updateVaultDocumentLifecycleBody: UpdateVaultDocumentLifecycleBody, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getUpdateVaultDocumentLifecycleMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateVaultDocumentLifecycle>>, TError, {
        id: string;
        data: BodyType<UpdateVaultDocumentLifecycleBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateVaultDocumentLifecycle>>, TError, {
    id: string;
    data: BodyType<UpdateVaultDocumentLifecycleBody>;
}, TContext>;
export type UpdateVaultDocumentLifecycleMutationResult = NonNullable<Awaited<ReturnType<typeof updateVaultDocumentLifecycle>>>;
export type UpdateVaultDocumentLifecycleMutationBody = BodyType<UpdateVaultDocumentLifecycleBody>;
export type UpdateVaultDocumentLifecycleMutationError = ErrorType<void>;
/**
* @summary Archive or restore a document
*/
export declare const useUpdateVaultDocumentLifecycle: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateVaultDocumentLifecycle>>, TError, {
        id: string;
        data: BodyType<UpdateVaultDocumentLifecycleBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateVaultDocumentLifecycle>>, TError, {
    id: string;
    data: BodyType<UpdateVaultDocumentLifecycleBody>;
}, TContext>;
export declare const getCreateReceiptReviewUrl: () => string;
/**
 * @summary Stage OCR candidates without saving financial data
 */
export declare const createReceiptReview: (receiptReviewInput: ReceiptReviewInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getCreateReceiptReviewMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReceiptReview>>, TError, {
        data: BodyType<ReceiptReviewInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createReceiptReview>>, TError, {
    data: BodyType<ReceiptReviewInput>;
}, TContext>;
export type CreateReceiptReviewMutationResult = NonNullable<Awaited<ReturnType<typeof createReceiptReview>>>;
export type CreateReceiptReviewMutationBody = BodyType<ReceiptReviewInput>;
export type CreateReceiptReviewMutationError = ErrorType<void>;
/**
* @summary Stage OCR candidates without saving financial data
*/
export declare const useCreateReceiptReview: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReceiptReview>>, TError, {
        data: BodyType<ReceiptReviewInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createReceiptReview>>, TError, {
    data: BodyType<ReceiptReviewInput>;
}, TContext>;
export declare const getGetReceiptReviewUrl: (id: string) => string;
/**
 * @summary Get staged receipt candidates
 */
export declare const getReceiptReview: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getGetReceiptReviewQueryKey: (id: string) => readonly [`/api/receipts/reviews/${string}`];
export declare const getGetReceiptReviewQueryOptions: <TData = Awaited<ReturnType<typeof getReceiptReview>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReceiptReview>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReceiptReview>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReceiptReviewQueryResult = NonNullable<Awaited<ReturnType<typeof getReceiptReview>>>;
export type GetReceiptReviewQueryError = ErrorType<void>;
/**
 * @summary Get staged receipt candidates
 */
export declare function useGetReceiptReview<TData = Awaited<ReturnType<typeof getReceiptReview>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReceiptReview>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDiscardReceiptReviewUrl: (id: string) => string;
/**
 * @summary Discard staged candidates
 */
export declare const discardReceiptReview: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<CleanupStatus>;
export declare const getDiscardReceiptReviewMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof discardReceiptReview>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof discardReceiptReview>>, TError, {
    id: string;
}, TContext>;
export type DiscardReceiptReviewMutationResult = NonNullable<Awaited<ReturnType<typeof discardReceiptReview>>>;
export type DiscardReceiptReviewMutationError = ErrorType<unknown>;
/**
* @summary Discard staged candidates
*/
export declare const useDiscardReceiptReview: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof discardReceiptReview>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof discardReceiptReview>>, TError, {
    id: string;
}, TContext>;
export declare const getConfirmReceiptReviewUrl: (id: string) => string;
/**
 * @summary Confirm reviewed receipt values
 */
export declare const confirmReceiptReview: (id: string, confirmReceiptReviewBody: ConfirmReceiptReviewBody, options?: Parameters<typeof customFetch>[1]) => Promise<ReceiptConfirmationResult>;
export declare const getConfirmReceiptReviewMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof confirmReceiptReview>>, TError, {
        id: string;
        data: BodyType<ConfirmReceiptReviewBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof confirmReceiptReview>>, TError, {
    id: string;
    data: BodyType<ConfirmReceiptReviewBody>;
}, TContext>;
export type ConfirmReceiptReviewMutationResult = NonNullable<Awaited<ReturnType<typeof confirmReceiptReview>>>;
export type ConfirmReceiptReviewMutationBody = BodyType<ConfirmReceiptReviewBody>;
export type ConfirmReceiptReviewMutationError = ErrorType<void>;
/**
* @summary Confirm reviewed receipt values
*/
export declare const useConfirmReceiptReview: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof confirmReceiptReview>>, TError, {
        id: string;
        data: BodyType<ConfirmReceiptReviewBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof confirmReceiptReview>>, TError, {
    id: string;
    data: BodyType<ConfirmReceiptReviewBody>;
}, TContext>;
export declare const getListNomineesUrl: () => string;
/**
 * @summary List account nominees
 */
export declare const listNominees: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getListNomineesQueryKey: () => readonly ["/api/nominees"];
export declare const getListNomineesQueryOptions: <TData = Awaited<ReturnType<typeof listNominees>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listNominees>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listNominees>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListNomineesQueryResult = NonNullable<Awaited<ReturnType<typeof listNominees>>>;
export type ListNomineesQueryError = ErrorType<unknown>;
/**
 * @summary List account nominees
 */
export declare function useListNominees<TData = Awaited<ReturnType<typeof listNominees>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listNominees>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateNomineeUrl: () => string;
/**
 * @summary Create an account nominee
 */
export declare const createNominee: (nomineeInput: NomineeInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getCreateNomineeMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createNominee>>, TError, {
        data: BodyType<NomineeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createNominee>>, TError, {
    data: BodyType<NomineeInput>;
}, TContext>;
export type CreateNomineeMutationResult = NonNullable<Awaited<ReturnType<typeof createNominee>>>;
export type CreateNomineeMutationBody = BodyType<NomineeInput>;
export type CreateNomineeMutationError = ErrorType<void>;
/**
* @summary Create an account nominee
*/
export declare const useCreateNominee: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createNominee>>, TError, {
        data: BodyType<NomineeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createNominee>>, TError, {
    data: BodyType<NomineeInput>;
}, TContext>;
export declare const getUpdateNomineeUrl: (id: string) => string;
/**
 * @summary Replace an account nominee
 */
export declare const updateNominee: (id: string, nomineeInput: NomineeInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getUpdateNomineeMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateNominee>>, TError, {
        id: string;
        data: BodyType<NomineeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateNominee>>, TError, {
    id: string;
    data: BodyType<NomineeInput>;
}, TContext>;
export type UpdateNomineeMutationResult = NonNullable<Awaited<ReturnType<typeof updateNominee>>>;
export type UpdateNomineeMutationBody = BodyType<NomineeInput>;
export type UpdateNomineeMutationError = ErrorType<void>;
/**
* @summary Replace an account nominee
*/
export declare const useUpdateNominee: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateNominee>>, TError, {
        id: string;
        data: BodyType<NomineeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateNominee>>, TError, {
    id: string;
    data: BodyType<NomineeInput>;
}, TContext>;
export declare const getDeleteNomineeUrl: (id: string) => string;
/**
 * @summary Delete an account nominee
 */
export declare const deleteNominee: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getDeleteNomineeMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteNominee>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteNominee>>, TError, {
    id: string;
}, TContext>;
export type DeleteNomineeMutationResult = NonNullable<Awaited<ReturnType<typeof deleteNominee>>>;
export type DeleteNomineeMutationError = ErrorType<void>;
/**
* @summary Delete an account nominee
*/
export declare const useDeleteNominee: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteNominee>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteNominee>>, TError, {
    id: string;
}, TContext>;
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