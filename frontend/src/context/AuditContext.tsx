"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getAuditLogs, getAuditSummary, getAuditVerify, type AuditLog, type AuditSummary, type AuditVerifyResult } from '@/lib/api';

const CACHE_KEY = 'reconova_audit_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedData {
  logs: AuditLog[];
  summary: AuditSummary | null;
  verifyResult: AuditVerifyResult | null;
  timestamp: number;
}

interface AuditContextValue {
  logs: AuditLog[];
  summary: AuditSummary | null;
  verifyResult: AuditVerifyResult | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
  refresh: () => Promise<void>;
}

const AuditContext = createContext<AuditContextValue | undefined>(undefined);

export const useAudit = (): AuditContextValue => {
  const ctx = useContext(AuditContext);
  if (!ctx) {
    throw new Error('useAudit must be used within AuditProvider');
  }
  return ctx;
};

function loadCache(): CachedData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedData = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(data: Omit<CachedData, 'timestamp'>) {
  if (typeof window === 'undefined') return;
  try {
    const cached: CachedData = { ...data, timestamp: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
}

interface ProviderProps {
  children: ReactNode;
}

export const AuditProvider: React.FC<ProviderProps> = ({ children }) => {
  const cached = loadCache();

  const [logs, setLogs] = useState<AuditLog[]>(cached?.logs ?? []);
  const [summary, setSummary] = useState<AuditSummary | null>(cached?.summary ?? null);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(cached?.verifyResult ?? null);
  const [loading, setLoading] = useState<boolean>(!cached);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(cached?.timestamp ?? null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logsData, summaryData, verifyData] = await Promise.all([
        getAuditLogs({ limit: 100, offset: 0 }),
        getAuditSummary(7),
        getAuditVerify(),
      ]);
      const normalizedLogs = Array.isArray(logsData) ? logsData : (logsData as any)?.logs ?? [];
      setLogs(normalizedLogs);
      setSummary(summaryData);
      setVerifyResult(verifyData);
      setLastFetched(Date.now());
      saveCache({ logs: normalizedLogs, summary: summaryData, verifyResult: verifyData });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Prefetch audit data immediately on app start for instant verification.
  // If we loaded from cache, still refresh in background to keep data fresh.
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const refresh = useCallback(async () => {
    await fetchAll();
  }, [fetchAll]);

  return (
    <AuditContext.Provider value={{ logs, summary, verifyResult, loading, error, lastFetched, refresh }}>
      {children}
    </AuditContext.Provider>
  );
};
