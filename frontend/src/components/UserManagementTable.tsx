"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, createUser, deleteUser, getAdminSecurityEvents, getUsers, resendTempPassword, updateUser } from "@/lib/api";
import type { AdminSecurityEvent, AdminUser, RoleName } from "@/lib/types";
import { ROLE_NAMES } from "@/lib/types";

function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(u: AdminUser): string {
  const source = u.full_name?.trim() || u.email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const ROLE_TONE: Record<string, { avatar: string; badge: string }> = {
  system_admin: { avatar: "bg-status-critical-bg text-status-critical", badge: "bg-status-critical-bg text-status-critical" },
  manager: { avatar: "bg-status-info-bg text-status-info", badge: "bg-status-info-bg text-status-info" },
  revenue_assurance: { avatar: "bg-status-low-bg text-status-low", badge: "bg-status-low-bg text-status-low" },
  depot_supervisor: { avatar: "bg-status-medium-bg text-status-medium", badge: "bg-status-medium-bg text-status-medium" },
};
const FALLBACK_TONE = { avatar: "bg-muted text-muted-foreground", badge: "bg-muted text-muted-foreground" };

const ROLE_DESCRIPTIONS: Record<string, { domain: string; access: string; action: string }> = {
  system_admin: { domain: "Platform administration", access: "Users, roles, security events", action: "Provision, disable, reset, and manage access" },
  manager: { domain: "Oil Revenue + Inuka Programs", access: "Executive metrics, cases, reports, alerts", action: "Oversight and escalation" },
  revenue_assurance: { domain: "Oil Revenue + Inuka Programs", access: "Cases, fraud intelligence, reports, e-billing", action: "Investigate and resolve Oil cases" },
  depot_supervisor: { domain: "Oil Revenue", access: "Live feed and assigned depot metrics", action: "Monitor assigned depot" },
  inuka_manager: { domain: "Inuka Programs", access: "Pillars, beneficiaries, payments, cases", action: "Review, request evidence, and escalate" },
};

interface UserFormState {
  email: string;
  full_name: string;
  role_name: RoleName;
}

const EMPTY_FORM: UserFormState = {
  email: "",
  full_name: "",
  role_name: "depot_supervisor",
};

function toCsv(users: AdminUser[]): string {
  const header = ["Email", "Full Name", "Role", "Status", "Joined"];
  const rows = users.map((u) => [
    u.email,
    u.full_name ?? "",
    (u.roles[0] ?? "").replace(/_/g, " "),
    u.is_active ? "Active" : "Disabled",
    u.created_at,
  ]);
  return [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/**
 * Admin's user-management view — this IS their dashboard (there is no
 * separate operational dashboard for system_admin; see dashboard/page.tsx's
 * admin branch, and dashboard/admin/page.tsx which now just redirects here).
 */
export default function UserManagementTable() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"All" | RoleName>("All");
  const [previewRole, setPreviewRole] = useState<RoleName>("system_admin");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Disabled">("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ role_name: RoleName; is_active: boolean; password: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [securityEvents, setSecurityEvents] = useState<AdminSecurityEvent[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUsers()
      .then((userData) => {
        if (!cancelled) setUsers(userData);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load users.");
      });
    getAdminSecurityEvents(1, 8)
      .then((securityData) => {
        if (!cancelled) setSecurityEvents(securityData.items);
      })
      .catch(() => {
        // Security monitoring is additive; a missing/older endpoint must not hide user management.
        if (!cancelled) setSecurityEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function refresh() {
    setReloadToken((t) => t + 1);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "All" && !u.roles.includes(roleFilter)) return false;
      if (statusFilter === "Active" && !u.is_active) return false;
      if (statusFilter === "Disabled" && u.is_active) return false;
      if (q && !u.email.toLowerCase().includes(q) && !(u.full_name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [users, roleFilter, statusFilter, search]);

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((s) => (s.size === filtered.length ? new Set() : new Set(filtered.map((u) => u.id))));
  }

  function handleExport() {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kpc-users.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      await createUser({
        email: createForm.email,
        full_name: createForm.full_name || undefined,
        role_name: createForm.role_name,
      });
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create user.");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u: AdminUser) {
    setEditingId(u.id);
    setEditForm({
      role_name: (u.roles[0] as RoleName) ?? "depot_supervisor",
      is_active: u.is_active,
      password: "",
    });
  }

  async function handleSaveEdit(userId: string) {
    if (!editForm) return;
    setSavingEdit(true);
    setRowError((r) => ({ ...r, [userId]: "" }));
    try {
      await updateUser(userId, {
        role_name: editForm.role_name,
        is_active: editForm.is_active,
        password: editForm.password || undefined,
      });
      setEditingId(null);
      setEditForm(null);
      refresh();
    } catch (err) {
      setRowError((r) => ({ ...r, [userId]: err instanceof ApiError ? err.message : "Could not save changes." }));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleResendTempPassword(user: AdminUser) {
    setResendingId(user.id);
    setRowError((current) => ({ ...current, [user.id]: "" }));
    try {
      await resendTempPassword(user.id);
      refresh();
    } catch (err) {
      setRowError((current) => ({ ...current, [user.id]: err instanceof ApiError ? err.message : "Could not initiate password reset." }));
    } finally {
      setResendingId(null);
    }
  }

  async function handleDelete(userId: string) {
    setDeletingId(userId);
    setRowError((r) => ({ ...r, [userId]: "" }));
    try {
      await deleteUser(userId);
      setConfirmDeleteId(null);
      refresh();
    } catch (err) {
      setRowError((r) => ({ ...r, [userId]: err instanceof ApiError ? err.message : "Could not delete user." }));
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }

  const activeCount = users.filter((u) => u.is_active).length;
  const pendingCount = users.filter((u) => u.account_status === "Invited / Pending first login").length;
  const resetCount = users.filter((u) => u.account_status === "Reset Required").length;
  const roleCount = new Set(users.flatMap((u) => u.roles)).size;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your organization members and their access.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm text-foreground placeholder-muted-foreground focus:border-ring focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/90 transition-colors hover:bg-accent"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateForm(EMPTY_FORM);
              setCreateError(null);
              setShowCreate(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add User
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Active accounts", activeCount.toString(), "text-status-low"],
          ["Pending first login", pendingCount.toString(), "text-status-medium"],
          ["Reset required", resetCount.toString(), "text-status-critical"],
          ["Roles in use", roleCount.toString(), "text-status-info"],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Access governance</p><h2 className="mt-1 text-sm font-bold text-foreground">Role permissions preview</h2><p className="mt-1 text-xs text-muted-foreground">Select a role to see its operational boundary before assigning it.</p></div>
          <select value={previewRole} onChange={(e) => setPreviewRole(e.target.value as RoleName)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
            {ROLE_NAMES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
        </div>
        {(() => { const detail = ROLE_DESCRIPTIONS[previewRole]; return <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3"><div><p className="text-muted-foreground">Domain</p><p className="mt-1 font-semibold text-foreground">{detail.domain}</p></div><div><p className="text-muted-foreground">Can access</p><p className="mt-1 font-semibold text-foreground">{detail.access}</p></div><div><p className="text-muted-foreground">Can act</p><p className="mt-1 font-semibold text-foreground">{detail.action}</p></div></div>; })()}
      </div>

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as "All" | RoleName)}
            className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/90 focus:border-ring focus:outline-none"
          >
            <option value="All">Role: All</option>
            {ROLE_NAMES.map((r) => (
              <option key={r} value={r}>
                Role: {roleLabel(r)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "All" | "Active" | "Disabled")}
            className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/90 focus:border-ring focus:outline-none"
          >
            <option value="All">Status: All</option>
            <option value="Active">Status: Active</option>
            <option value="Disabled">Status: Disabled</option>
          </select>
        </div>
        <span className="text-xs text-muted-foreground">{selected.size} selected</span>
      </div>

      {error && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ring/30 border-t-ring" />
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="max-h-[calc(100vh-430px)] min-h-[240px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 backdrop-blur-sm">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleSelectAll}
                      className="accent-primary"
                    />
                  </th>
                  <th className="px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">User</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Joined</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((u) => {
                  const isEditing = editingId === u.id;
                  const role = u.roles[0] ?? "";
                  const tone = ROLE_TONE[role] ?? FALLBACK_TONE;
                  return (
                    <tr key={u.id} className="align-top transition-colors hover:bg-accent/30">
                      <td className="px-4 py-3.5">
                        <input
                          type="checkbox"
                          checked={selected.has(u.id)}
                          onChange={() => toggleSelected(u.id)}
                          className="accent-primary"
                        />
                      </td>
                      <td className="px-2 py-3.5">
                        <button type="button" onClick={() => setSelectedUser(u)} className="flex items-center gap-3 text-left">
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone.avatar}`}>
                            {initials(u)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{u.full_name || u.email}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3.5">
                        {isEditing ? (
                          <select
                            value={editForm?.role_name}
                            onChange={(e) => setEditForm((f) => (f ? { ...f, role_name: e.target.value as RoleName } : f))}
                            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                          >
                            {ROLE_NAMES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.badge}`}>
                            {roleLabel(role)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {isEditing ? (
                          <label className="flex items-center gap-2 text-xs text-foreground/90">
                            <input
                              type="checkbox"
                              checked={editForm?.is_active}
                              onChange={(e) => setEditForm((f) => (f ? { ...f, is_active: e.target.checked } : f))}
                              className="accent-status-low"
                            />
                            Active
                          </label>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.is_active ? "text-status-low" : "text-muted-foreground"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? "bg-status-low" : "bg-muted-foreground"}`} />
                            {u.is_active ? "Active" : "Disabled"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">{formatDate(u.created_at)}</td>
                      <td className="px-4 py-3.5">
                        {isEditing ? (
                          <div className="flex flex-col items-end gap-2">
                            <input
                              type="password"
                              placeholder="New password (optional)"
                              value={editForm?.password}
                              onChange={(e) => setEditForm((f) => (f ? { ...f, password: e.target.value } : f))}
                              className="w-40 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditForm(null);
                                }}
                                className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveEdit(u.id)}
                                disabled={savingEdit}
                                className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-40"
                              >
                                {savingEdit ? "Saving…" : "Save"}
                              </button>
                            </div>
                            {rowError[u.id] && <p className="max-w-[180px] text-right text-[10px] text-status-critical">{rowError[u.id]}</p>}
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleResendTempPassword(u)}
                              disabled={resendingId === u.id}
                              className="rounded-md border border-status-medium/30 px-2.5 py-1 text-[11px] font-semibold text-status-medium transition-colors hover:bg-status-medium-bg disabled:opacity-40"
                            >
                              {resendingId === u.id ? "Sending…" : "Force reset"}
                            </button>
                            <button
                              onClick={() => startEdit(u)}
                              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground/90 transition-colors hover:bg-accent"
                            >
                              Edit
                            </button>
                            {confirmDeleteId === u.id ? (
                              <button
                                onClick={() => handleDelete(u.id)}
                                disabled={deletingId === u.id}
                                className="rounded-md bg-status-critical px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
                              >
                                {deletingId === u.id ? "Deleting…" : "Confirm delete?"}
                              </button>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(u.id)}
                                className="rounded-md border border-status-critical/30 px-2.5 py-1 text-[11px] font-semibold text-status-critical transition-colors hover:bg-status-critical-bg"
                              >
                                Delete
                              </button>
                            )}
                            {rowError[u.id] && <p className="self-center text-[10px] text-status-critical">{rowError[u.id]}</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm italic text-muted-foreground">
                      No users match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {filtered.length} of {users.length} user{users.length === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-muted-foreground">Page 1 of 1</span>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Security monitoring</p><h2 className="mt-1 text-sm font-bold text-foreground">Recent account events</h2><p className="mt-1 text-xs text-muted-foreground">Provisioning, password, role, and login events only. Operational Oil and Inuka records remain outside the admin view.</p></div>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">{securityEvents.length} recent</span>
        </div>
        <div className="mt-4 divide-y divide-border">
          {securityEvents.length === 0 ? <p className="py-5 text-sm text-muted-foreground">No security events recorded yet.</p> : securityEvents.map((event) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"><div><span className="font-semibold text-foreground">{event.action.replaceAll(".", " ")}</span><span className="ml-2 text-muted-foreground">{event.target_type || "system"}{event.target_id ? ` · ${event.target_id}` : ""}</span></div><span className="text-muted-foreground">{formatDate(event.created_at)}</span></div>)}
        </div>
      </section>

      {selectedUser && (() => { const role = selectedUser.roles[0] ?? ""; const detail = ROLE_DESCRIPTIONS[role] ?? ROLE_DESCRIPTIONS.system_admin; return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedUser(null)}><div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Account details</p><h2 className="mt-1 text-xl font-bold text-foreground">{selectedUser.full_name || selectedUser.email}</h2><p className="mt-1 text-sm text-muted-foreground">{selectedUser.email}</p></div><button type="button" onClick={() => setSelectedUser(null)} className="text-xl text-muted-foreground">×</button></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-[10px] uppercase text-muted-foreground">Status</p><p className="mt-1 font-semibold text-foreground">{selectedUser.account_status}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Joined</p><p className="mt-1 font-semibold text-foreground">{formatDate(selectedUser.created_at)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Domain</p><p className="mt-1 font-semibold text-foreground">{detail.domain}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Role</p><p className="mt-1 font-semibold capitalize text-foreground">{roleLabel(role)}</p></div></div><div className="mt-5 border-t border-border pt-4"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Permissions</p><div className="mt-2 flex flex-wrap gap-2">{selectedUser.permissions.map((permission) => <span key={permission} className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">{permission}</span>)}</div></div><div className="mt-5 flex justify-end"><button type="button" onClick={() => setSelectedUser(null)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Close</button></div></div></div>; })()}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <button
              onClick={() => setShowCreate(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className="mb-4 text-base font-bold text-foreground">Create a new user</h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Full name</label>
                <input
                  type="text"
                  value={createForm.full_name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground"
                />
              </div>
              <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                A temporary password will be generated and emailed to the new user. They must set a new password on first login.
              </p>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Role</label>
                <select
                  value={createForm.role_name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role_name: e.target.value as RoleName }))}
                  className="mt-1 w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground"
                >
                  {ROLE_NAMES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>

              {createError && <p className="text-xs text-status-critical">{createError}</p>}

              <button
                onClick={handleCreate}
                disabled={creating || !createForm.email}
                className="mt-2 w-full rounded-md bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-40"
              >
                {creating ? "Creating…" : "Create user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
