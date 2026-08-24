"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { BRAND_CONFIG } from "@/lib/brand-config";
import FlowGuardHeroIllustration from "@/components/FlowGuardHeroIllustration";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { resetRequired, termsRequired } = await login(email, password);
      router.push(resetRequired || termsRequired ? "/reset-password" : "/dashboard");
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#1c1010] p-6 font-sans">
      {/* Full-bleed atmosphere layer: brand-reddish gradient scene + dimmed illustration,
          standing in for the reference's hero photograph without borrowing its assets. */}
      <div className="absolute inset-0 z-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 15% 10%, color-mix(in oklch, var(--sidebar-primary) 35%, transparent), transparent 55%), radial-gradient(110% 80% at 85% 90%, color-mix(in oklch, var(--sidebar-primary) 40%, black), transparent 60%), linear-gradient(160deg, #1c1010 0%, #2a1414 45%, #170c0c 100%)",
          }}
        />
        <Image
          src={BRAND_CONFIG.landing.bgImage}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-[0.34] mix-blend-screen"
        />
        <FlowGuardHeroIllustration className="absolute inset-0 h-full w-full object-cover opacity-[0.14] mix-blend-screen" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "42px 42px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />
      </div>

      {/* CENTER: frosted glass card floating over the scene */}
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-white/15 bg-white/10 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
          <div className="mb-8 flex flex-col items-center text-center">
            {BRAND_CONFIG.logoUrl ? (
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
                <div className="relative h-11 w-11">
                  <Image
                    src={BRAND_CONFIG.logoUrl}
                    alt={`${BRAND_CONFIG.companyName} logo`}
                    fill
                    sizes="44px"
                    className="object-contain"
                  />
                </div>
              </div>
            ) : (
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-black text-white shadow-lg"
                style={{ backgroundColor: "var(--sidebar-primary)" }}
              >
                {BRAND_CONFIG.shortName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <h1 className="text-xl font-bold tracking-tight text-white">
              {BRAND_CONFIG.companyName}
            </h1>
            <p className="mt-0.5 text-sm font-medium text-white/60">{BRAND_CONFIG.systemName}</p>
          </div>

          <div className="mb-6 text-center">
            <h2 className="text-lg font-semibold text-white">Welcome back</h2>
            <p className="mt-1 text-sm text-white/60">Sign in to access the reconciliation platform</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="text-[11px] font-semibold uppercase tracking-wider text-white/70"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-white/10 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 shadow-inner outline-none transition-all focus:border-white focus:ring-2 focus:ring-white/40"
                placeholder="manager@kpc.co.ke"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="password"
                className="text-[11px] font-semibold uppercase tracking-wider text-white/70"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-white/10 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 shadow-inner outline-none transition-all focus:border-white focus:ring-2 focus:ring-white/40"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-400/30 bg-red-500/15 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 rounded-lg py-3.5 text-sm font-bold uppercase tracking-wider text-white shadow-lg transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                backgroundColor: "var(--sidebar-primary)",
                boxShadow: "0 10px 25px -6px color-mix(in oklch, var(--sidebar-primary) 55%, transparent)",
              }}
            >
              {submitting ? "Authenticating..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs font-medium tracking-wide text-white/40">
          Detect, Reconcile, Predict, Protect every transaction.
        </p>
      </div>
    </div>
  );
}
