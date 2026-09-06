import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

function getReturnPath() {
  return `${window.location.pathname}${window.location.search}`;
}

function getBasePath() {
  return new URL(document.baseURI).pathname;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/user", { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ user: AuthUser | null }>;
      })
      .then(({ user: currentUser }) => {
        if (!cancelled) setUser(currentUser);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    window.location.href = `/login?returnTo=${encodeURIComponent(getReturnPath())}`;
  }, []);

  const logout = useCallback(() => {
    window.location.href = `/api/logout?returnTo=${encodeURIComponent(getBasePath())}`;
  }, []);

  return { user, isLoading, isAuthenticated: Boolean(user), login, logout };
}