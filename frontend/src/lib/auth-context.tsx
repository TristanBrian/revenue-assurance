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
  setConsentToken,
  setResetToken,
} from "./api";
import type { AuthUser } from "./types";

// Backend detail strings for "authenticated, but something else is
// required first" — see backend/app/core/dependencies.py's
// get_current_user(). Distinct codes (not just any 401/403) so these can
// be told apart from "not logged in" and routed to the right screen.
const PASSWORD_RESET_REQUIRED = "PASSWORD_RESET_REQUIRED";
const TERMS_ACCEPTANCE_REQUIRED = "TERMS_ACCEPTANCE_REQUIRED";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Returns { resetRequired: true } or { termsRequired: true } instead of
   * establishing a session when the account needs a forced password reset
   * or re-consent — the caller (login page) should redirect to
   * /reset-password rather than /dashboard in either case (that page
   * renders the right variant based on which token got stored). */
  login: (email: string, password: string) => Promise<{ resetRequired: boolean; termsRequired: boolean }>;
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
        // An admin forced a reset, or a newer Terms/Privacy Policy version
        // was published, mid-session (see dependencies.py's guard) — the
        // stale token is dead either way; send them back through /login,
        // which will issue a fresh reset_token/consent_token this time
        // instead of a normal session.
        if (
          err instanceof ApiError &&
          (err.message === PASSWORD_RESET_REQUIRED || err.message === TERMS_ACCEPTANCE_REQUIRED)
        ) {
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

  async function login(
    email: string,
    password: string,
  ): Promise<{ resetRequired: boolean; termsRequired: boolean }> {
    const data = await apiLogin(email, password);
    if (data.reset_required) {
      if (data.reset_token) setResetToken(data.reset_token);
      return { resetRequired: true, termsRequired: false };
    }
    if (data.terms_required) {
      if (data.consent_token) setConsentToken(data.consent_token);
      return { resetRequired: false, termsRequired: true };
    }
    setAuthToken(data.access_token as string);
    const u = await getCurrentUser();
    setUser(u);
    return { resetRequired: false, termsRequired: false };
  }

  /** Hydrates the session after POST /auth/reset-password or POST
   * /auth/accept-terms succeeds — same end state as a normal login(), but
   * starting from an access token we already have. See the docstring
   * above on why this can't just rely on the mount effect. */
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
