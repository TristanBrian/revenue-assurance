"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { BRAND_CONFIG } from "@/lib/brand-config";

// Static import guarantees Next.js webpack/Turbopack includes the image in HMR bundle immediately
import heroBackground from "../../../public/images/flowguard-landing-hero.png";

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

  const bgSrc = typeof heroBackground === "string" ? heroBackground : heroBackground.src;

  return (
    <div className="relative flex flex-col min-h-screen text-slate-100 font-sans p-6 md:p-12 overflow-hidden justify-between items-center bg-[#050814]">
      
      {/* BACKGROUND IMAGE */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden bg-[#050814]">
        <Image
          src={heroBackground}
          alt="KPC FlowGuard Pipeline Background"
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover object-center w-full h-full opacity-90 blur-[1px] scale-105 transition-all duration-500"
        />
        
        {/* INTERMEDIATE SEPARATION LAYER: Translucent dark scrim */}
        <div className="absolute inset-0 bg-[#050814]/60 backdrop-blur-[2px] pointer-events-none z-1 transition-opacity duration-300" />
        
        {/* Radial subtle contrast glow behind central login card */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#070D19]/70 via-transparent to-black/50 pointer-events-none z-2" />
      </div>

      {/* TOP HEADER: KPC Transparent Logo Header */}
      <header className="relative z-10 w-full pt-6 pb-2 flex items-center justify-start max-w-7xl mx-auto animate-fade-in">
        {/* KPC Logo + Title */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-16 md:w-16 md:h-20 relative shrink-0 drop-shadow-[0_0_25px_rgba(228,30,38,0.4)]">
            <Image 
              src="/svg/kpc-logo-transparent.svg" 
              alt="Kenya Pipeline Company Logo" 
              fill 
              className="object-contain" 
              priority 
            />
          </div>
          <div className="flex flex-col text-left">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white font-sans leading-none">
              Flowguard
            </h1>
            <span className="text-xs md:text-sm font-extrabold tracking-[0.25em] text-[#B3312C] uppercase mt-2">
              REVENUE ASSURANCE PLATFORM
            </span>
          </div>
        </div>
      </header>

      {/* DEAD-CENTERED FLOATING LOGIN CARD CONTAINER */}
      <main className="relative z-10 w-full max-w-lg mx-auto my-auto py-8 px-4 flex flex-col items-center justify-center animate-fade-in">
        <div className="w-full bg-white/50 dark:bg-[#1F1B19]/55 backdrop-blur-3xl border border-white/60 dark:border-white/25 p-8 sm:p-10 md:p-11 rounded-[32px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)] transition-all duration-300 relative overflow-hidden text-slate-900 dark:text-white">
          
          {/* Top Logo & Title Section */}
          <div className="mb-8 flex flex-col items-center text-center">
            {/* KPC Logo Emblem */}
            <div className="w-22 h-22 relative shrink-0 mb-3 drop-shadow-lg">
              <Image 
                src="/svg/kpc-logo-transparent.svg" 
                alt="KPC Logo" 
                fill 
                className="object-contain" 
                priority 
              />
            </div>

            <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
              FlowGuard
            </h2>
            <p className="text-xs sm:text-sm font-extrabold tracking-widest text-slate-800 dark:text-slate-100 mt-1 font-mono uppercase">
              Revenue Assurance Platform
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label 
                htmlFor="email" 
                className="text-xs md:text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white text-left pl-1"
              >
                Username
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-white/80 dark:border-slate-700 focus:border-[#B3312C] focus:ring-2 focus:ring-[#B3312C]/50 px-5 py-4 text-base font-bold text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none transition-all shadow-sm"
                placeholder="Enter your username"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label 
                htmlFor="password" 
                className="text-xs md:text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white text-left pl-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-white/80 dark:border-slate-700 focus:border-[#B3312C] focus:ring-2 focus:ring-[#B3312C]/50 px-5 py-4 text-base font-bold text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none transition-all shadow-sm"
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-[#B3312C]/50 bg-[#B3312C]/20 px-5 py-4 text-sm text-[#B3312C] dark:text-red-300 font-extrabold">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-2xl py-4 px-8 text-base sm:text-lg font-black text-white shadow-xl active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider bg-[#B3312C] hover:bg-[#962824] focus:ring-2 focus:ring-[#B3312C]/50"
              style={{
                boxShadow: "0 10px 25px -4px rgba(179, 49, 44, 0.55)",
              }}
            >
              {submitting ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 w-full pb-3 text-center text-xs font-medium tracking-wide text-slate-400 select-none">
        <p>© {new Date().getFullYear()} Kenya Pipeline Company • FlowGuard Revenue Assurance</p>
      </footer>
    </div>
  );
}
