"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-black text-xl shadow-[0_0_20px_rgba(16,185,129,0.4)] mb-4">
            $
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white uppercase">
            KPC Revenue Assurance
          </h1>
          <p className="mt-1 text-xs text-zinc-500 uppercase tracking-widest font-semibold">
            Sign in to continue
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5 rounded-xl border border-zinc-900 bg-zinc-900/35 p-6 shadow-2xl"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-850 hover:border-zinc-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all"
              placeholder="e.g. manager@kpc-demo.co.ke"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-850 hover:border-zinc-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded border border-red-950 bg-red-950/20 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Signing in..." : "Sign in to Platform"}
          </button>
        </form>
      </div>
    </div>
  );
}
