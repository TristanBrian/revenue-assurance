"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  acceptTerms,
  ApiError,
  clearConsentToken,
  clearResetToken,
  getConsentToken,
  getPasswordPolicy,
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
  const [minimumPasswordLength, setMinimumPasswordLength] = useState(12);

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

  useEffect(() => {
    getPasswordPolicy().then((policy) => setMinimumPasswordLength(policy.min_length)).catch(() => undefined);
  }, []);

  // Client-side gating is a UX nicety only — the backend validates all of
  // this again server-side regardless (see routes/auth.py's
  // reset_password()/accept_terms()).
  const passwordOk = mode !== "reset" || (
    newPassword.length >= minimumPasswordLength &&
    /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) && /\d/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword) &&
    newPassword === confirmPassword
  );
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
    <div className="flex min-h-screen flex-col items-center justify-between overflow-hidden bg-background p-6 font-sans text-foreground relative">
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <FlowGuardHeroIllustration className="h-full w-full object-cover opacity-[0.08] mix-blend-multiply" />
      </div>

      <header className="relative z-10 flex w-full flex-col items-center gap-3 pt-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-border">
          <Image src={BRAND_CONFIG.logoUrl || "/svg/kpc-logo-transparent.svg"} alt={`${BRAND_CONFIG.companyName} logo`} width={40} height={40} className="object-contain" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{BRAND_CONFIG.companyName}</h1>
          <h2 className="mt-0.5 text-sm font-medium text-muted-foreground">{BRAND_CONFIG.systemName}</h2>
        </div>
      </header>

      <div className="relative z-10 w-full max-w-2xl mx-auto my-6 px-4 flex items-center justify-center">
        <div className="w-full rounded-2xl border border-border bg-card p-8 shadow-xl md:p-10">
          <div className="mb-6 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground">
              {mode === "consent" ? "Updated Terms & Privacy Policy" : "Set a new password"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "consent"
                ? "Our Terms & Conditions / Privacy Policy have been updated. Please review and re-accept to continue."
                : "You signed in with a temporary password. Choose a new one and accept the Terms & Conditions / Privacy Policy to continue."}
            </p>
          </div>

          {mode === "invalid" ? (
            <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg px-4 py-3.5 text-center text-sm text-status-critical">
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
                      className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      New Password
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      required
                      minLength={minimumPasswordLength}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="rounded-lg border border-border bg-background px-4 py-3.5 text-base text-foreground placeholder-muted-foreground shadow-inner transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder={`At least ${minimumPasswordLength} characters`}
                    />
                    <p className="text-xs text-muted-foreground">Use uppercase and lowercase letters, a number, and a symbol.</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="confirm-password"
                      className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Confirm New Password
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      required
                      minLength={minimumPasswordLength}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="rounded-lg border border-border bg-background px-4 py-3.5 text-base text-foreground placeholder-muted-foreground shadow-inner transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="••••••••"
                    />
                    {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                      <p className="text-xs text-status-critical">Passwords don&apos;t match.</p>
                    )}
                  </div>
                </>
              )}

              <div className="flex flex-col gap-2">
                <span className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Terms &amp; Conditions and Privacy Policy
                </span>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed text-foreground shadow-inner whitespace-pre-wrap">
                  {termsLoading && "Loading…"}
                  {termsError && <span className="text-red-600">{termsError}</span>}
                  {terms && (
                    <>
                      {terms.terms_and_conditions && (
                        <>
                            <p className="mb-2 font-bold text-foreground">
                            Terms &amp; Conditions (v{terms.terms_and_conditions.version})
                          </p>
                          <p className="mb-4">{terms.terms_and_conditions.content}</p>
                        </>
                      )}
                      {terms.privacy_policy && (
                        <>
                            <p className="mb-2 font-bold text-foreground">
                            Privacy Policy (v{terms.privacy_policy.version})
                          </p>
                          <p>{terms.privacy_policy.content}</p>
                        </>
                      )}
                      {!terms.terms_and_conditions && !terms.privacy_policy && (
                        <span className="text-muted-foreground">No Terms & Conditions configured yet.</span>
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
                  <span className="text-sm text-foreground">
                    I have read and agree to the Terms &amp; Conditions and Privacy Policy
                  </span>
                </label>
              </div>

              {error && (
                <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg px-4 py-3.5 text-sm text-status-critical">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="mt-2 rounded-lg bg-primary py-4 text-base font-bold uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
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

      <footer className="relative z-10 w-full select-none pb-4 text-center text-sm font-medium tracking-wide text-muted-foreground md:text-base">
        Detect, Reconcile, Predict, Protect every transaction.
      </footer>
    </div>
  );
}
