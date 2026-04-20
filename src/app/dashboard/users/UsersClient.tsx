"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { createStaffAccount, deleteStaffAccount, syncStaffEmails, changeStaffPassword } from "@/lib/domain/users"; // syncStaffEmails used internally on load
import { timeAgo } from "@/lib/utils";
import type { Profile } from "@/lib/types";


export default function UsersClient({ initialProfiles }: { initialProfiles: Profile[] }) {
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [loading, setLoading] = useState(initialProfiles.length === 0);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState<string | null>(null);

  // Password Modal state
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUserDeleteDialogOpen, setIsUserDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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
        syncStaffEmails().catch(() => {/* silent — email column may not exist yet */ });
      } catch (e) {
        console.error("Failed to load profiles:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDelete = (userId: string) => {
    setUserToDelete(userId);
    setIsUserDeleteDialogOpen(true);
  };

  const confirmUserDelete = () => {
    if (!userToDelete) return;
    const userId = userToDelete;
    setIsUserDeleteDialogOpen(false);
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
      setUserToDelete(null);
    });
  };

  const handleOpenPasswordModal = (userId: string) => {
    setTargetUserId(userId);
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowOldPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError(null);
    setPasswordModalOpen(true);
  };

  const handleSavePassword = () => {
    if (!targetUserId || newPassword.length < 6) return;

    const isSelf = targetUserId === currentUser?.id;
    if (isSelf) {
      if (!oldPassword) {
        setError("Old password is required to change your own password.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New passwords do not match.");
        return;
      }
    }

    setIsChangingPassword(targetUserId);
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      // 1. Verify old password if changing own password
      if (isSelf && currentUser?.email) {
        const supabase = createClient();
        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email: currentUser.email,
          password: oldPassword,
        });

        if (verifyError) {
          setError("Incorrect old password.");
          setIsChangingPassword(null);
          return;
        }
      }

      // 2. Change password
      const result = await changeStaffPassword(targetUserId, newPassword);
      if (result.success) {
        setSuccess("Password successfully updated.");
        router.refresh();
        setPasswordModalOpen(false);
        setTargetUserId(null);
      } else {
        setError(result.error || "Failed to update password.");
      }
      setIsChangingPassword(null);
    });
  };

  const selectedUserEmail = profiles.find(p => p.id === userToDelete)?.email || "this user";

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
                placeholder="barista@Lebrew.local"
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
                    <th className="py-3 px-3 sm:px-4 font-medium text-gray-500">Email Address</th>
                    <th className="py-3 px-3 sm:px-4 font-medium text-gray-500">Role</th>
                    <th className="py-3 px-3 sm:px-4 font-medium text-gray-500 text-right">Created</th>
                    <th className="py-3 px-3 sm:px-4 font-medium text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                      <td className="py-3 px-3 sm:px-4 font-medium text-gray-700 break-all min-w-[120px]">
                        {profile.email || "—"}
                        {profile.id === currentUser?.id && (
                          <span className="ml-2 whitespace-nowrap inline-block text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100">YOU</span>
                        )}
                      </td>
                      <td className="py-3 px-3 sm:px-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${profile.role === 'admin'
                          ? 'bg-purple-100 text-purple-700 border border-purple-200'
                          : 'bg-blue-100 text-blue-700 border border-blue-200'
                          }`}>
                          {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right text-gray-500 text-xs whitespace-nowrap">
                        {timeAgo(profile.created_at)}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right">
                        <div className="flex justify-end gap-2">
                          {!(profile.role === 'admin' && profile.id !== currentUser?.id) && (
                            <button
                              onClick={() => handleOpenPasswordModal(profile.id)}
                              disabled={isChangingPassword === profile.id}
                              className={`w-[84px] flex items-center justify-center whitespace-nowrap text-[10px] font-bold uppercase tracking-wider py-1.5 rounded transition-all text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-600 hover:text-white disabled:opacity-50`}
                              title="Change password"
                            >
                              {isChangingPassword === profile.id ? "..." : "Change Pwd"}
                            </button>
                          )}
                          {profile.id !== currentUser?.id && (
                            <button
                              onClick={() => handleDelete(profile.id)}
                              disabled={isDeleting === profile.id}
                              className={`w-[84px] flex items-center justify-center whitespace-nowrap text-[10px] font-bold uppercase tracking-wider py-1.5 rounded transition-all bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-100`}
                              title="Delete this operator"
                            >
                              {isDeleting === profile.id ? "..." : "Delete"}
                            </button>
                          )}
                        </div>
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

      {/* PASSWORD CHANGE MODAL */}
      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden relative">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Change Password</h2>
              <p className="text-sm text-gray-500 mb-6">Enter new password for this account (minimum 6 characters).</p>

              {error && (
                <div className="mb-4 bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">
                  {error}
                </div>
              )}

              <div className="space-y-4 mb-6 relative">
                {targetUserId === currentUser?.id && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Old Password</label>
                    <div className="relative">
                      <input
                        type={showOldPassword ? "text" : "password"}
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        placeholder="Enter current password"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowOldPassword(!showOldPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                      >
                        {showOldPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.242m4.242 4.242L9.88 9.88" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      placeholder="Enter new password"
                      autoFocus={targetUserId !== currentUser?.id}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showNewPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.242m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {targetUserId === currentUser?.id && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        placeholder="Confirm new password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                      >
                        {showConfirmPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.242m4.242 4.242L9.88 9.88" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPasswordModalOpen(false);
                    setTargetUserId(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  disabled={isChangingPassword !== null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSavePassword()}
                  disabled={isChangingPassword !== null || newPassword.length < 6}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isChangingPassword !== null ? "Saving..." : "Save Password"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isUserDeleteDialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl border border-gray-100 animate-slide-in text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mb-4 mx-auto">
              <span className="text-2xl">⚠️</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Staff Account?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <span className="font-bold text-gray-900">{selectedUserEmail}</span>? 
              This action cannot be undone and will permanently remove their access.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setIsUserDeleteDialogOpen(false); setUserToDelete(null); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmUserDelete}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200 transition-all"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
