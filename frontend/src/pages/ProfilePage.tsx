import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { ApiResponse, User } from '../types';
import { User as UserIcon, School, GitBranch, Calendar, Shield, CheckCircle2, AlertCircle, Save } from 'lucide-react';

export const ProfilePage: React.FC = () => {
  const { user, refreshUser } = useAuth();

  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [semester, setSemester] = useState<number>(user?.semester || 1);

  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const res = await api.put<ApiResponse<User>>('/users/profile', {
        name,
        bio,
        semester: Number(semester),
      });

      if (res.data.success) {
        setSuccessMessage('Profile details updated successfully!');
        await refreshUser();
      }
    } catch (err: any) {
      setErrorMessage(err.response?.data?.message || 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Student Profile & Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your academic credentials and personal details</p>
      </div>

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-3 text-emerald-800 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p>{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-800 text-sm">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p>{errorMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Account Overview Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-brand-100 text-brand-700 font-extrabold text-2xl flex items-center justify-center mb-3 shadow-inner">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <h2 className="text-lg font-bold text-slate-900">{user?.name}</h2>
            <p className="text-xs text-slate-500">{user?.email}</p>

            <div className="mt-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
              {user?.role === 'ADMIN' ? (
                <>
                  <Shield className="w-3 h-3 text-purple-600" />
                  <span className="text-purple-700 font-bold">Admin</span>
                </>
              ) : (
                'Verified Student'
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Account Status:</span>
              <span className="font-semibold text-emerald-600">Active</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Member Since:</span>
              <span className="font-semibold text-slate-700">
                {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Recent'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Editable Profile Form */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
          <form onSubmit={handleUpdate} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Full Display Name
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Current Semester
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <select
                  value={semester}
                  onChange={(e) => setSemester(Number(e.target.value))}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>
                      Semester {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Bio / Academic Interests
              </label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Share your major, courses you're taking, or exam prep goals..."
                className="w-full p-3.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              />
            </div>

            {/* Readonly Academic Affiliations */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Institution & Department</p>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <School className="w-4 h-4 text-slate-400" />
                <span>College: <strong>{user?.college?.name || 'Not configured'}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <GitBranch className="w-4 h-4 text-slate-400" />
                <span>Branch: <strong>{user?.branch?.name || 'Not configured'}</strong></span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold shadow-md shadow-brand-500/20 transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
