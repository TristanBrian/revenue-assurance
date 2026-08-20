"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, clearResetToken, getResetToken, resetPassword } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { BRAND_CONFIG } from "@/lib/brand-config";
import FlowGuardHeroIllustration from "@/components/FlowGuardHeroIllustration";

export default function ResetPasswordPage() {
  const { completeReset } = useAuth();
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read once per mount rather than per render — sessionStorage only, set
  // by the login page right before redirecting here (see
  // auth-context.tsx's login()). No token means this page was opened
  // directly rather than arrived at via the forced-reset redirect.
  const [resetToken] = useState(() => getResetToken());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!resetToken) {
      setError("This reset link has expired or wasn't reached from login. Please log in again.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const { access_token } = await resetPassword(resetToken, newPassword);
      clearResetToken();
      await completeReset(access_token);
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

      <header className="absolute top-8 left-0 right-0 z-10 w-full text-center flex flex-col items-center gap-2">
        <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight leading-none filter drop-shadow-sm select-none text-white">
          {BRAND_CONFIG.companyName}
        </h1>
        <h2
          className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1 select-none"
          style={{ color: BRAND_CONFIG.accentColor }}
        >
          {BRAND_CONFIG.systemName}
        </h2>
      </header>

      <div className="relative z-10 w-full max-w-lg mx-auto my-auto px-4 flex items-center justify-center">
        <div className="w-full bg-white border border-zinc-200 p-10 rounded-xl shadow-2xl transition-all duration-300 hover:shadow-[0_20px_50px_rgba(10,46,92,0.18)]">
          <div className="mb-8 text-center">
            <h2 className="text-4xl font-extrabold tracking-tight text-zinc-900">Set a new password</h2>
            <p className="text-sm text-zinc-500 mt-2">
              You signed in with a temporary password. Choose a new one to continue — it must be
              different from the temporary password you were emailed.
            </p>
          </div>

          {!resetToken ? (
            <div className="rounded border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-600 text-center">
              This reset link has expired or wasn&apos;t reached from login.{" "}
              <a href="/login" className="font-bold underline">
                Log in again
              </a>{" "}
              to request a new temporary password.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
              </div>

              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-3 rounded-lg py-4 text-base font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider bg-sky-600 hover:bg-sky-500 shadow-sky-600/10"
                style={{ boxShadow: `0 10px 15px -3px rgba(10, 46, 92, 0.15)` }}
              >
                {submitting ? "Setting password..." : "Set password & continue"}
              </button>
            </form>
          )}
        </div>
      </div>

      <footer className="absolute bottom-24 left-0 right-0 z-10 w-full text-center text-sm md:text-base font-bold tracking-wide text-zinc-200 select-none opacity-100">
        Detect, Reconcile, Predict, Protect every transaction.
      </footer>
    </div>
  );
}
