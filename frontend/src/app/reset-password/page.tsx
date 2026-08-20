"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  acceptTerms,
  ApiError,
  clearConsentToken,
  clearResetToken,
  getConsentToken,
  getResetToken,
  getTermsBundle,
  resetPassword,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { BRAND_CONFIG } from "@/lib/brand-config";
import FlowGuardHeroIllustration from "@/components/FlowGuardHeroIllustration";
import type { TermsBundle } from "@/lib/types";

// Two modes, one screen (spec: consent bundled into the reset screen, not
// a separate page) — which mode depends entirely on which single-purpose
// token the login page stashed in sessionStorage:
//   "reset"   — reset_token present: full form (password + confirm + consent).
//   "consent" — no reset_token, but a consent_token: consent-only variant
//               for an already-active user re-accepting a newer version.
//   "invalid" — neither present: page opened directly, not via login's redirect.
type Mode = "reset" | "consent" | "invalid";

export default function ResetPasswordPage() {
  const { completeReset } = useAuth();
  const router = useRouter();

  const [resetToken] = useState(() => getResetToken());
  const [consentToken] = useState(() => getConsentToken());
  const mode: Mode = resetToken ? "reset" : consentToken ? "consent" : "invalid";

  const [terms, setTerms] = useState<TermsBundle | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termsLoading, setTermsLoading] = useState(true);

  const [checkboxAccepted, setCheckboxAccepted] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTermsBundle()
      .then((bundle) => {
        if (!cancelled) setTerms(bundle);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTermsError(err instanceof ApiError ? err.message : "Could not load Terms & Conditions.");
      })
      .finally(() => {
        if (!cancelled) setTermsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Client-side gating is a UX nicety only — the backend validates all of
  // this again server-side regardless (see routes/auth.py's
  // reset_password()/accept_terms()).
  const passwordOk = mode !== "reset" || (newPassword.length >= 8 && newPassword === confirmPassword);
  const canSubmit = checkboxAccepted && passwordOk && !termsLoading && !termsError && mode !== "invalid";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "reset" && resetToken) {
        const { access_token } = await resetPassword(resetToken, newPassword, confirmPassword, checkboxAccepted);
        clearResetToken();
        await completeReset(access_token);
      } else if (mode === "consent" && consentToken) {
        const { access_token } = await acceptTerms(consentToken, checkboxAccepted);
        clearConsentToken();
        await completeReset(access_token);
      }
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the API. Is the backend running?",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen text-zinc-100 font-sans p-6 relative overflow-hidden justify-between items-center bg-[#071225]">
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <FlowGuardHeroIllustration className="w-full h-full object-cover opacity-[0.32]" />
      </div>

      <header className="relative z-10 w-full text-center flex flex-col items-center gap-2 pt-4">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-none filter drop-shadow-sm select-none text-white">
          {BRAND_CONFIG.companyName}
        </h1>
        <h2
          className="text-xl md:text-2xl font-extrabold tracking-tight mt-1 select-none"
          style={{ color: BRAND_CONFIG.accentColor }}
        >
          {BRAND_CONFIG.systemName}
        </h2>
      </header>

      <div className="relative z-10 w-full max-w-2xl mx-auto my-6 px-4 flex items-center justify-center">
        <div className="w-full bg-white border border-zinc-200 p-8 md:p-10 rounded-xl shadow-2xl">
          <div className="mb-6 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-zinc-900">
              {mode === "consent" ? "Updated Terms & Privacy Policy" : "Set a new password"}
            </h2>
            <p className="text-sm text-zinc-500 mt-2">
              {mode === "consent"
                ? "Our Terms & Conditions / Privacy Policy have been updated. Please review and re-accept to continue."
                : "You signed in with a temporary password. Choose a new one and accept the Terms & Conditions / Privacy Policy to continue."}
            </p>
          </div>

          {mode === "invalid" ? (
            <div className="rounded border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-600 text-center">
              This link has expired or wasn&apos;t reached from login.{" "}
              <a href="/login" className="font-bold underline">
                Log in again
              </a>{" "}
              to continue.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {mode === "reset" && (
                <>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="new-password"
                      className="text-xs font-black uppercase tracking-wider text-left text-zinc-700"
                    >
                      New Password
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="rounded-lg bg-zinc-50/50 border border-zinc-250 hover:border-zinc-350 focus:border-[#0A2E5C] focus:bg-white px-4 py-3.5 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none transition-all shadow-inner"
                      placeholder="At least 8 characters"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="confirm-password"
                      className="text-xs font-black uppercase tracking-wider text-left text-zinc-700"
                    >
                      Confirm New Password
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="rounded-lg bg-zinc-50/50 border border-zinc-250 hover:border-zinc-350 focus:border-[#0A2E5C] focus:bg-white px-4 py-3.5 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none transition-all shadow-inner"
                      placeholder="••••••••"
                    />
                    {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                      <p className="text-xs text-red-600">Passwords don&apos;t match.</p>
                    )}
                  </div>
                </>
              )}

              <div className="flex flex-col gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-left text-zinc-700">
                  Terms &amp; Conditions and Privacy Policy
                </span>
                <div className="rounded-lg border border-zinc-250 bg-zinc-50/50 max-h-56 overflow-y-auto p-4 text-xs text-zinc-700 whitespace-pre-wrap leading-relaxed shadow-inner">
                  {termsLoading && "Loading…"}
                  {termsError && <span className="text-red-600">{termsError}</span>}
                  {terms && (
                    <>
                      {terms.terms_and_conditions && (
                        <>
                          <p className="font-bold text-zinc-900 mb-2">
                            Terms &amp; Conditions (v{terms.terms_and_conditions.version})
                          </p>
                          <p className="mb-4">{terms.terms_and_conditions.content}</p>
                        </>
                      )}
                      {terms.privacy_policy && (
                        <>
                          <p className="font-bold text-zinc-900 mb-2">
                            Privacy Policy (v{terms.privacy_policy.version})
                          </p>
                          <p>{terms.privacy_policy.content}</p>
                        </>
                      )}
                      {!terms.terms_and_conditions && !terms.privacy_policy && (
                        <span className="text-zinc-500">No Terms & Conditions configured yet.</span>
                      )}
                    </>
                  )}
                </div>
                <label className="flex items-start gap-2.5 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkboxAccepted}
                    onChange={(e) => setCheckboxAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-sky-600"
                  />
                  <span className="text-sm text-zinc-700">
                    I have read and agree to the Terms &amp; Conditions and Privacy Policy
                  </span>
                </label>
              </div>

              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="mt-2 rounded-lg py-4 text-base font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider bg-sky-600 hover:bg-sky-500 shadow-sky-600/10"
                style={{ boxShadow: `0 10px 15px -3px rgba(10, 46, 92, 0.15)` }}
              >
                {submitting
                  ? "Saving…"
                  : mode === "consent"
                    ? "Accept & continue"
                    : "Set password & continue"}
              </button>
            </form>
          )}
        </div>
      </div>

      <footer className="relative z-10 w-full text-center text-sm md:text-base font-bold tracking-wide text-zinc-200 select-none opacity-100 pb-4">
        Detect, Reconcile, Predict, Protect every transaction.
      </footer>
    </div>
  );
}
