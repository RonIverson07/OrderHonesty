"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { createStaffAccount, deleteStaffAccount, syncStaffEmails } from "@/lib/domain/users"; // syncStaffEmails used internally on load
import { timeAgo } from "@/lib/utils";
import type { Profile } from "@/lib/types";


export default function UsersClient({ initialProfiles }: { initialProfiles: Profile[] }) {
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [loading, setLoading] = useState(initialProfiles.length === 0);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [{ data: { user } }, { data: list }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("profiles").select("*").order("created_at", { ascending: false })
        ]);

        if (list) setProfiles(list as Profile[]);
        if (user) {
          const profile = list?.find(p => p.id === user.id);
          if (profile) setCurrentUser(profile as Profile);
        }

        // Auto-sync emails silently on every load so emails are always up to date
        syncStaffEmails().catch(() => {/* silent — email column may not exist yet */});
      } catch (e) {
        console.error("Failed to load profiles:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDelete = (userId: string) => {
    if (!confirm("Are you sure you want to delete this staff account? This action cannot be undone.")) return;

    setIsDeleting(userId);
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await deleteStaffAccount(userId);
      if (result.success) {
        setProfiles(p => p.filter(prof => prof.id !== userId));
        setSuccess("Staff account successfully deleted.");
        router.refresh();
      } else {
        setError(result.error || "Failed to delete account.");
      }
      setIsDeleting(null);
    });
  };


  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(e.currentTarget);
    const formEl = e.currentTarget;

    startTransition(async () => {
      const result = await createStaffAccount(formData);
      if (result.success) {
        router.refresh();
        setSuccess("Account successfully created!");
        formEl.reset();

        // Refresh local list
        const supabase = createClient();
        const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
        if (data) setProfiles(data as Profile[]);
      } else {
        setError(result.error || "Failed to create account.");
      }
    });
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-sm text-gray-500">Add and manage staff accounts</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ADD USER FORM */}
        <div className="card p-5 h-fit">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span>👤</span> Add New Staff
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-50 text-emerald-700 text-sm p-3 rounded-lg border border-emerald-200">
                {success}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                name="email"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-amber-500 focus:border-amber-500"
                placeholder="barista@labrew.local"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Temporary Password</label>
              <input
                type="password"
                name="password"
                required
                minLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-amber-500 focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                name="role"
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white focus:ring-amber-500 focus:border-amber-500"
              >
                <option value="barista">Barista (Queue & Prep)</option>
                <option value="admin">Administrator (Full Access)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full btn-primary justify-center disabled:opacity-50"
            >
              {isPending ? "Creating..." : "Create Account"}
            </button>
            <p className="text-xs text-gray-500 mt-2 text-center">
              Requires SUPABASE_SERVICE_ROLE_KEY to be configured in your environment.
            </p>
          </form>
        </div>

        {/* USERS LIST */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h2 className="font-semibold text-gray-900">Current Staff</h2>
              <span className="text-xs font-medium text-gray-500 bg-white px-2 py-1 rounded-full border border-gray-200">
                {profiles.length} Accounts
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left bg-gray-50/50">
                    <th className="py-3 px-5 font-medium text-gray-500">Email Address</th>
                    <th className="py-3 px-5 font-medium text-gray-500">Role</th>
                    <th className="py-3 px-5 font-medium text-gray-500 text-right">Created</th>
                    <th className="py-3 px-5 font-medium text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                      <td className="py-3 px-5 font-medium text-gray-700">
                        {profile.email || "—"}
                        {profile.id === currentUser?.id && (
                          <span className="ml-2 text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100">YOU</span>
                        )}
                      </td>
                      <td className="py-3 px-5">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${profile.role === 'admin'
                            ? 'bg-purple-100 text-purple-700 border border-purple-200'
                            : 'bg-blue-100 text-blue-700 border border-blue-200'
                          }`}>
                          {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 px-5 text-right text-gray-500 text-xs">
                        {timeAgo(profile.created_at)}
                      </td>
                      <td className="py-3 px-5 text-right">
                        {profile.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDelete(profile.id)}
                            disabled={isDeleting === profile.id || profile.role === 'admin'}
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-all ${profile.role === 'admin'
                                ? 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-100'
                                : 'bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-100'
                              }`}
                            title={profile.role === 'admin' ? "Admins cannot delete other admins." : "Delete this operator"}
                          >
                            {isDeleting === profile.id ? "..." : "Delete"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {profiles.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-gray-400">
                        No staff accounts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
