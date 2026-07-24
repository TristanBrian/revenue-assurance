"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
      await login(email, password);
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
      
      {/* BACKGROUND GRAPHICS LAYER (Covers the whole landing page) */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <FlowGuardHeroIllustration className="w-full h-full object-cover opacity-80" />
      </div>

      {/* TOP: Centered Branding spanning full page width */}
      <header className="absolute top-8 left-0 right-0 z-10 w-full text-center">
        <h1 
          className="text-6xl md:text-7xl font-extrabold tracking-tight leading-none filter drop-shadow-sm select-none text-white"
        >
          {BRAND_CONFIG.companyName}
        </h1>
        <h2 
          className="text-2xl md:text-3xl font-bold tracking-tight mt-3 select-none"
          style={{ color: BRAND_CONFIG.secondaryColor }}
        >
          {BRAND_CONFIG.systemName}
        </h2>
      </header>

      {/* CENTER: Floating Solid White Login Card */}
      <div className="relative z-10 w-full max-w-md mx-auto my-auto px-4 flex items-center justify-center">
        <div className="w-full bg-white border border-zinc-200 p-8 rounded-xl shadow-2xl transition-all duration-300 hover:shadow-[0_20px_50px_rgba(10,46,92,0.18)]">
          <div className="mb-6 text-center">
            <h2 
              className="text-3xl font-extrabold tracking-tight text-zinc-900"
            >
              Login
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Provide credentials to access FlowGuard Audit Center
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <label 
                htmlFor="email" 
                className="text-xs font-bold uppercase tracking-wider text-left text-zinc-700"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg bg-zinc-50/50 border border-zinc-200 hover:border-zinc-300 focus:border-[#0A2E5C] focus:bg-white px-4 py-3 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none transition-all shadow-inner"
                placeholder="manager@kpc.co.ke"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label 
                htmlFor="password" 
                className="text-xs font-bold uppercase tracking-wider text-left text-zinc-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg bg-zinc-50/50 border border-zinc-200 hover:border-zinc-300 focus:border-[#0A2E5C] focus:bg-white px-4 py-3 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none transition-all shadow-inner"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-lg py-3.5 text-base font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider bg-sky-600 hover:bg-sky-500 shadow-sky-600/10"
              style={{ 
                boxShadow: `0 10px 15px -3px rgba(10, 46, 92, 0.15)`
              }}
            >
              {submitting ? "Authenticating..." : "Sign in to Platform"}
            </button>
          </form>
        </div>
      </div>



    </div>
  );
}
