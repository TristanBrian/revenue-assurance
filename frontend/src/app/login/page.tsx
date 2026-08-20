"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { BRAND_CONFIG } from "@/lib/brand-config";

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
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the API. Is the backend running?"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex flex-col min-h-screen text-slate-100 font-sans p-6 overflow-hidden justify-between items-center bg-[#070D19]">
      
      {/* 
        DYNAMIC HERO BACKGROUND LAYER
        - Scalable: Image path, blur amount, and overlay blend are configured in BRAND_CONFIG & ENV.
        - Conforms to KPC Palette: Deep Blue / Midnight tint overlay keeps visual aesthetics visible without overpowering UI.
      */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        {/* Background Image with blur filter */}
        <div 
          className="absolute inset-0 w-full h-full transform scale-105 transition-all duration-700"
          style={{
            backgroundImage: `url(${BRAND_CONFIG.landing.bgImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: BRAND_CONFIG.landing.bgBlur || "blur(4px)",
            opacity: 0.75,
          }}
        />

        {/* KPC Color Tint Overlay (Ensures background conforms to KPC Blue/Midnight palette & keeps login card high contrast) */}
        <div 
          className="absolute inset-0"
          style={{
            background: BRAND_CONFIG.landing.overlayGradient,
            opacity: BRAND_CONFIG.landing.overlayOpacity,
          }}
        />
      </div>

      {/* TOP: KPC & FlowGuard Header Branding */}
      <header className="relative z-10 w-full pt-6 pb-2 text-center flex flex-col items-center gap-1.5 animate-fade-in">
        <div className="flex items-center gap-3 justify-center mb-1">
          {BRAND_CONFIG.logoUrl && (
            <Image 
              src={BRAND_CONFIG.logoUrl} 
              alt="KPC Logo" 
              width={44} 
              height={44} 
              className="object-contain drop-shadow-md"
            />
          )}
          <span className="text-sm md:text-base font-bold uppercase tracking-widest text-slate-300">
            {BRAND_CONFIG.companyName}
          </span>
        </div>
        <h1 
          className="text-4xl md:text-5xl font-extrabold tracking-tight filter drop-shadow-lg text-white"
        >
          {BRAND_CONFIG.systemName}
        </h1>
      </header>

      {/* CENTER: Floating Solid Glassmorphism Login Card (Conforms to HCI contrast & focus principles) */}
      <main className="relative z-10 w-full max-w-md mx-auto my-auto px-4 flex items-center justify-center animate-fade-in">
        <div className="w-full bg-white/95 dark:bg-[#0F172A]/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-700/60 p-8 md:p-10 rounded-2xl shadow-2xl transition-all duration-300 hover:shadow-[0_20px_50px_rgba(0,82,155,0.25)]">
          <div className="mb-6 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Sign In
            </h2>
            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400 mt-1.5">
              Access the KPC FlowGuard Revenue Assurance Portal
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label 
                htmlFor="email" 
                className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 text-left"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600 focus:border-[#00529B] focus:ring-2 focus:ring-[#00529B]/20 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none transition-all shadow-sm"
                placeholder="manager@kpc.co.ke"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label 
                htmlFor="password" 
                className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 text-left"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600 focus:border-[#00529B] focus:ring-2 focus:ring-[#00529B]/20 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none transition-all shadow-sm"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800/50 px-4 py-3 text-xs md:text-sm text-red-600 dark:text-red-400 font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-lg py-3.5 px-6 text-sm font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider bg-[#F58220] hover:bg-[#D96B0E] focus:ring-2 focus:ring-[#F58220]/50"
              style={{
                boxShadow: "0 8px 20px -4px rgba(245, 130, 32, 0.4)",
              }}
            >
              {submitting ? "Authenticating..." : "Sign in to Platform"}
            </button>
          </form>
        </div>
      </main>

      {/* BOTTOM: High-Visibility Tagline matching the hero visual */}
      <footer className="relative z-10 w-full pb-4 text-center text-xs md:text-sm font-semibold tracking-wide text-slate-300 select-none">
        <p>Detect, reconcile, predict, protect every transaction.</p>
      </footer>
    </div>
  );
}
