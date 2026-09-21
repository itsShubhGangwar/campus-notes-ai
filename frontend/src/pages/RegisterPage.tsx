import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { College, Branch, ApiResponse } from '../types';
import { BookOpen, AlertCircle, ArrowRight, User, Mail, Lock, School, GitBranch, Calendar } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Academic Dropdowns
  const [colleges, setColleges] = useState<College[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedSemester, setSelectedSemester] = useState<number>(1);

  const [isLoadingAcademics, setIsLoadingAcademics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Fetch Colleges on Mount
  useEffect(() => {
    const fetchColleges = async () => {
      try {
        setIsLoadingAcademics(true);
        const res = await api.get<ApiResponse<College[]>>('/api/academic/colleges');
        if (res.data.success) {
          setColleges(res.data.data);
          if (res.data.data.length > 0) {
            setSelectedCollegeId(res.data.data[0].id);
          }
        }
      } catch {
        console.warn('Academic hierarchy not yet initialized or offline.');
      } finally {
        setIsLoadingAcademics(false);
      }
    };
    fetchColleges();
  }, []);

  // 2. Fetch Branches whenever selected College changes
  useEffect(() => {
    if (!selectedCollegeId) {
      setBranches([]);
      setSelectedBranchId('');
      return;
    }

    const fetchBranches = async () => {
      try {
        const res = await api.get<ApiResponse<Branch[]>>(`/api/academic/colleges/${selectedCollegeId}/branches`);
        if (res.data.success) {

          setBranches(res.data.data);
          if (res.data.data.length > 0) {
            setSelectedBranchId(res.data.data[0].id);
          } else {
            setSelectedBranchId('');
          }
        }
      } catch {
        setBranches([]);
      }
    };
    fetchBranches();
  }, [selectedCollegeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await register({
        name,
        email,
        password,
        collegeId: selectedCollegeId || null,
        branchId: selectedBranchId || null,
        semester: Number(selectedSemester),
      });
      navigate('/dashboard');
    } catch (err: any) {
      const message =
        err.response?.data?.message || 'Registration failed. Please check your information.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 p-8 sm:p-10">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-brand-600 text-white flex items-center justify-center mx-auto mb-3 shadow-md shadow-brand-500/20">
            <BookOpen className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Create Student Account</h1>
          <p className="text-sm text-slate-500 mt-1">Join your campus repository and unlock AI study tools</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Registration Failed</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Full Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Johnson"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              College Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@stanford.edu"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Password (min. 6 characters)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition-all"
              />
            </div>
          </div>

          {/* Academic Profile Selection */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-bold text-brand-700 uppercase tracking-wider mb-3">
              Academic Curriculum Details
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                  <School className="w-3.5 h-3.5 text-slate-400" /> College / University
                </label>
                <select
                  value={selectedCollegeId}
                  onChange={(e) => setSelectedCollegeId(e.target.value)}
                  disabled={isLoadingAcademics || colleges.length === 0}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                >
                  {colleges.length === 0 ? (
                    <option value="">No colleges loaded yet (Database setup required)</option>
                  ) : (
                    colleges.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.city ? `(${c.city})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-slate-400" /> Branch / Dept
                  </label>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    disabled={branches.length === 0}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                  >
                    {branches.length === 0 ? (
                      <option value="">Select a college first</option>
                    ) : (
                      branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" /> Current Semester
                  </label>
                  <select
                    value={selectedSemester}
                    onChange={(e) => setSelectedSemester(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => (
                      <option key={sem} value={sem}>
                        Semester {sem}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm shadow-md shadow-brand-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Create Account
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-100 text-center text-sm text-slate-500">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};
