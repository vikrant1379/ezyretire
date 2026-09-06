import type { AuthUser } from "@workspace/api-client-react";
export type { AuthUser };
interface AuthState {
    user: AuthUser | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: () => void;
    logout: () => void;
}
export declare function useAuth(): AuthState;
//# sourceMappingURL=use-auth.d.ts.map