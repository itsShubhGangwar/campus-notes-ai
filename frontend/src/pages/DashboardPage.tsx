import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  GraduationCap,
  School,
  GitBranch,
  Calendar,
  Sparkles,
  UploadCloud,
  Brain,
  Shield,
} from 'lucide-react';
import { RecommendedNotes } from '../components/notes/RecommendedNotes';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Student Welcome & Academic Profile Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-gradient-to-br from-brand-100 to-indigo-50 rounded-full blur-3xl -mr-20 -mt-20 -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 bg-brand-50 text-brand-700 rounded-full border border-brand-200 inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Phase 1 Foundation Active
              </span>
              {user?.role === 'ADMIN' && (
                <span className="text-xs font-semibold px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full border border-purple-200 inline-flex items-center gap-1">
                  <Shield className="w-3 h-3" /> System Administrator
                </span>
              )}
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Welcome back, {user?.name}! 👋
            </h1>
            <p className="text-sm text-slate-500 max-w-xl">
              Here is your academic command center. As notes and study materials are uploaded, your personalized feeds and RAG study bots will appear here.
            </p>
          </div>

          <Link
            to="/profile"
            className="self-start md:self-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
          >
            Edit Academic Profile
          </Link>
        </div>

        {/* Academic Details Pill Grid */}
        <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <School className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Institution</p>
              <p className="text-sm font-bold text-slate-800 truncate max-w-[180px]">
                {user?.college?.name || 'Not specified'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Department</p>
              <p className="text-sm font-bold text-slate-800 truncate max-w-[180px]">
                {user?.branch?.name || 'Not specified'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Term</p>
              <p className="text-sm font-bold text-slate-800">
                {user?.semester ? `Semester ${user.semester}` : 'Not set'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Personalized Recommendations Feed (Phase 3 Step 2.8) */}
      <RecommendedNotes />

      {/* Quick Action & Milestone Hub */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Platform Roadmap & Modules</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Phase 1 (Completed) */}
          <div className="p-6 rounded-2xl bg-white border border-emerald-200 shadow-sm relative">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
              <GraduationCap className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Active • Phase 1
            </span>
            <h3 className="text-base font-bold text-slate-900 mt-2">Authentication & Academic Hierarchy</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              PostgreSQL schema, Prisma ORM, JWT security, password hashing, roles (USER/ADMIN), and student profiles.
            </p>
          </div>

          {/* Phase 3 (Next) */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 opacity-90 shadow-sm relative">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-3">
              <UploadCloud className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
              Upcoming • Phase 3
            </span>
            <h3 className="text-base font-bold text-slate-900 mt-2">Notes Repository & S3 Uploads</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              PDF file storage, explore/search by subject codes, ratings, comments, downloads counter, and bookmarks.
            </p>
          </div>

          {/* Phase 4 (Upcoming) */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 opacity-90 shadow-sm relative">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center mb-3">
              <Brain className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
              Upcoming • Phase 4
            </span>
            <h3 className="text-base font-bold text-slate-900 mt-2">FastAPI RAG & Study Studio</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              PDF text extraction, chunking, pgvector embeddings, grounded Q&A with page citations, and quiz generation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
