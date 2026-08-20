"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  clearAuthToken,
  getAuthToken,
  getCurrentUser,
  login as apiLogin,
  setAuthToken,
  setResetToken,
} from "./api";
import type { AuthUser } from "./types";

// Backend detail string for "authenticated, but must_reset_password is
// set" — see backend/app/core/dependencies.py's get_current_user(). A
// distinct code (not just any 401/403) so this can be told apart from
// "not logged in" and routed to /reset-password instead of /login.
const PASSWORD_RESET_REQUIRED = "PASSWORD_RESET_REQUIRED";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Returns { resetRequired: true } instead of establishing a session
   * when the account has must_reset_password set — the caller (login page)
   * should redirect to /reset-password rather than /dashboard in that case. */
  login: (email: string, password: string) => Promise<{ resetRequired: boolean }>;
  /** Hydrates the session after POST /auth/reset-password succeeds — same
   * end state as a normal login(), but starting from an access token we
   * already have rather than a fresh email/password pair. Needed because
   * AuthProvider's own token-loading effect only runs once on mount, which
   * already happened (with no token) before the reset-password page ever
   * gets a token to hand it. */
  completeReset: (accessToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    Promise.resolve()
      .then(() => (getAuthToken() ? getCurrentUser() : null))
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        clearAuthToken();
        // An admin forced a reset on this already-active session (see
        // dependencies.py's guard) — the stale token is dead either way;
        // send them back through /login, which will issue a fresh
        // reset_token this time instead of a normal session.
        if (err instanceof ApiError && err.message === PASSWORD_RESET_REQUIRED) {
          router.push("/login");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string): Promise<{ resetRequired: boolean }> {
    const data = await apiLogin(email, password);
    if (data.reset_required) {
      if (data.reset_token) setResetToken(data.reset_token);
      return { resetRequired: true };
    }
    setAuthToken(data.access_token as string);
    const u = await getCurrentUser();
    setUser(u);
    return { resetRequired: false };
  }

  async function completeReset(accessToken: string) {
    setAuthToken(accessToken);
    const u = await getCurrentUser();
    setUser(u);
  }

  function logout() {
    clearAuthToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, completeReset, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
