import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Sparkles, Brain, FileCheck, ArrowRight, Zap } from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-between">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 sm:py-24 lg:py-32">
        <div className="absolute inset-0 -z-10 flex items-center justify-center">
          <div className="w-[600px] h-[600px] bg-brand-500/10 rounded-full blur-3xl" />
          <div className="w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-3xl -ml-40 mt-40" />
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold mb-8 animate-fade-in">
            <Sparkles className="w-3.5 h-3.5 text-brand-600" />
            <span>Next-Gen College Academic Platform</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight sm:leading-none">
            Share Peer Notes.{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-indigo-600">
              Study Smarter with RAG AI.
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            The all-in-one collaborative repository for college engineering and university lecture notes. Upload verified PDFs, chat with documents with grounded page citations, and auto-generate quizzes.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            {user ? (
              <Link
                to="/dashboard"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 text-base font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-lg shadow-brand-500/25 transition-all hover:scale-105"
              >
                Go to Dashboard
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link
                  to="/register"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl shadow-lg shadow-brand-500/25 transition-all hover:scale-105"
                >
                  Create Free Account
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/login"
                  className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3.5 text-base font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-sm transition-colors"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section className="bg-white border-t border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">Engineered for College Success</h2>
            <p className="mt-2 text-slate-500 text-sm">Everything you need to excel in your semester exams.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100 hover:border-brand-200 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <FileCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Curriculum-Aligned Notes</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Filter lecture notes specifically tagged by your college, branch, semester, and course subject code.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100 hover:border-brand-200 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center mb-4">
                <Brain className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Citation-Grounded RAG</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Ask questions against complex PDFs and get instant answers with verifiable page references and zero hallucinations.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100 hover:border-brand-200 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Instant Exam Prep</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Auto-generate interactive MCQ quizzes, formula flashcard decks, and high-yield revision summaries with one click.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 bg-slate-50 text-center text-xs text-slate-500">
        <p>© {new Date().getFullYear()} CampusNotes AI. Built for students, powered by grounded AI.</p>
      </footer>
    </div>
  );
};
