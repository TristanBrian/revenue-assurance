"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createUser,
  deleteUser,
  getUsers,
  resendTempPassword,
  updateUser,
} from "@/lib/api";
import type { AdminUser, RoleName } from "@/lib/types";
import { ROLE_NAMES } from "@/lib/types";
import RequirePermission from "@/components/RequirePermission";

function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

const ROLE_BADGE_CLASS: Record<string, string> = {
  system_admin: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  revenue_assurance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  manager: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  depot_supervisor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const ACCOUNT_STATUS_CLASS: Record<string, string> = {
  "Invited / Pending first login": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Reset Required": "bg-rose-500/10 text-rose-400 border-rose-500/20",
  Active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
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

function AdminContent() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ role_name: RoleName; is_active: boolean; password: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getUsers()
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load users.");
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

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createUser({
        email: createForm.email,
        full_name: createForm.full_name || undefined,
        role_name: createForm.role_name,
      });
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      setNotice(`Invitation sent — a temporary password was emailed to ${created.email}.`);
      refresh();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create user.");
    } finally {
      setCreating(false);
    }
  }

  async function handleResendTempPassword(u: AdminUser) {
    setResendingId(u.id);
    setRowError((r) => ({ ...r, [u.id]: "" }));
    setNotice(null);
    try {
      await resendTempPassword(u.id);
      setNotice(`A new temporary password was emailed to ${u.email}.`);
      refresh();
    } catch (err) {
      setRowError((r) => ({
        ...r,
        [u.id]: err instanceof ApiError ? err.message : "Could not resend temporary password.",
      }));
    } finally {
      setResendingId(null);
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
      setRowError((r) => ({
        ...r,
        [userId]: err instanceof ApiError ? err.message : "Could not save changes.",
      }));
    } finally {
      setSavingEdit(false);
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
      setRowError((r) => ({
        ...r,
        [userId]: err instanceof ApiError ? err.message : "Could not delete user.",
      }));
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto text-zinc-100">
      <header className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest leading-none">
            KPC Platform Configuration
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-white mt-1.5">User Management</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {users.length} account{users.length === 1 ? "" : "s"} across 4 roles
          </p>
        </div>
        <button
          onClick={() => {
            setCreateForm(EMPTY_FORM);
            setCreateError(null);
            setShowCreate(true);
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded bg-indigo-600 hover:bg-indigo-500 transition-colors text-xs font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.25)]"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New User
        </button>
      </header>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-900 bg-emerald-950/40 p-4 text-xs text-emerald-300">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-500 hover:text-emerald-300 font-bold">
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-xs text-red-300">{error}</div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
        </div>
      )}

      {!loading && !error && (
        <div className="bg-zinc-900/35 border border-zinc-900 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-900 bg-zinc-950/60">
              <tr>
                <th className="px-5 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">User</th>
                <th className="px-5 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = editingId === u.id;
                const role = u.roles[0] ?? "—";
                return (
                  <tr key={u.id} className="border-b border-zinc-900/70 last:border-0 align-top">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-zinc-200">{u.email}</p>
                      <p className="text-[11px] text-zinc-500">{u.full_name || "—"}</p>
                    </td>
                    <td className="px-5 py-4">
                      {isEditing ? (
                        <select
                          value={editForm?.role_name}
                          onChange={(e) =>
                            setEditForm((f) => (f ? { ...f, role_name: e.target.value as RoleName } : f))
                          }
                          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                        >
                          {ROLE_NAMES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            ROLE_BADGE_CLASS[role] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"
                          }`}
                        >
                          {roleLabel(role)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {isEditing ? (
                        <label className="flex items-center gap-2 text-xs text-zinc-300">
                          <input
                            type="checkbox"
                            checked={editForm?.is_active}
                            onChange={(e) =>
                              setEditForm((f) => (f ? { ...f, is_active: e.target.checked } : f))
                            }
                            className="accent-emerald-500"
                          />
                          Active
                        </label>
                      ) : (
                        <div className="flex flex-col gap-1.5 items-start">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              ACCOUNT_STATUS_CLASS[u.account_status] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"
                            }`}
                          >
                            {u.account_status}
                          </span>
                          {!u.is_active && (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                              Disabled
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[11px] text-zinc-500">{formatDate(u.created_at)}</td>
                    <td className="px-5 py-4">
                      {isEditing ? (
                        <div className="flex flex-col gap-2 items-end">
                          <input
                            type="password"
                            placeholder="New password (optional)"
                            value={editForm?.password}
                            onChange={(e) =>
                              setEditForm((f) => (f ? { ...f, password: e.target.value } : f))
                            }
                            className="w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingId(null);
                                setEditForm(null);
                              }}
                              className="px-2.5 py-1 rounded text-[11px] font-semibold text-zinc-400 hover:text-zinc-200"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(u.id)}
                              disabled={savingEdit}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold text-white disabled:opacity-40"
                            >
                              {savingEdit ? "Saving…" : "Save"}
                            </button>
                          </div>
                          {rowError[u.id] && (
                            <p className="text-[10px] text-rose-400 max-w-[180px] text-right">{rowError[u.id]}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          {u.account_status !== "Active" && (
                            <button
                              onClick={() => handleResendTempPassword(u)}
                              disabled={resendingId === u.id}
                              title="Regenerate and re-email a temporary password"
                              className="px-2.5 py-1 rounded border border-amber-900/50 hover:bg-amber-950/40 text-[11px] font-semibold text-amber-400 disabled:opacity-40"
                            >
                              {resendingId === u.id ? "Sending…" : "Resend temp password"}
                            </button>
                          )}
                          <button
                            onClick={() => startEdit(u)}
                            className="px-2.5 py-1 rounded border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 text-[11px] font-semibold text-zinc-300"
                          >
                            Edit
                          </button>
                          {confirmDeleteId === u.id ? (
                            <button
                              onClick={() => handleDelete(u.id)}
                              disabled={deletingId === u.id}
                              className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-[11px] font-bold text-white disabled:opacity-40"
                            >
                              {deletingId === u.id ? "Deleting…" : "Confirm delete?"}
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(u.id)}
                              className="px-2.5 py-1 rounded border border-rose-900/50 hover:bg-rose-950/40 text-[11px] font-semibold text-rose-400"
                            >
                              Delete
                            </button>
                          )}
                          {rowError[u.id] && (
                            <p className="text-[10px] text-rose-400 self-center">{rowError[u.id]}</p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md p-6 shadow-2xl relative">
            <button
              onClick={() => setShowCreate(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className="text-base font-bold text-white mb-4">Create a new user</h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Full name</label>
                <input
                  type="text"
                  value={createForm.full_name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                />
              </div>
              <p className="text-[11px] text-zinc-500 -mt-1">
                No password needed — a temporary password is generated and emailed to them. They&apos;ll
                be required to set their own on first login.
              </p>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Role</label>
                <select
                  value={createForm.role_name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role_name: e.target.value as RoleName }))}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                >
                  {ROLE_NAMES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>

              {createError && <p className="text-xs text-rose-400">{createError}</p>}

              <button
                onClick={handleCreate}
                disabled={creating || !createForm.email}
                className="mt-2 w-full rounded bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-bold text-white disabled:opacity-40"
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

export default function AdminPage() {
  return (
    <RequirePermission code="manage_users">
      <AdminContent />
    </RequirePermission>
  );
}
