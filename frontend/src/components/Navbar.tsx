import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BookOpen, LogOut, LayoutDashboard, Shield, Upload, FileText, Compass } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
              CampusNotes <span className="text-xs bg-brand-100 text-brand-700 font-semibold px-2 py-0.5 rounded-full">AI</span>
            </span>
            <p className="text-[10px] text-slate-400 -mt-1 hidden sm:block">Verified Notes & AI Study Studio</p>
          </div>
        </Link>

        {/* Navigation Items */}
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/notes"
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              isActive('/notes')
                ? 'text-brand-600 bg-brand-50 font-semibold'
                : 'text-slate-700 hover:text-brand-600 hover:bg-slate-50'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span className="hidden sm:inline">Explore Notes</span>
          </Link>

          {user ? (
            <>
              <Link
                to="/upload"
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive('/upload')
                    ? 'text-brand-600 bg-brand-50 font-semibold'
                    : 'text-slate-700 hover:text-brand-600 hover:bg-slate-50'
                }`}
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Upload</span>
              </Link>

              <Link
                to="/my-notes"
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive('/my-notes')
                    ? 'text-brand-600 bg-brand-50 font-semibold'
                    : 'text-slate-700 hover:text-brand-600 hover:bg-slate-50'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">My Notes</span>
              </Link>

              <Link
                to="/dashboard"
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive('/dashboard')
                    ? 'text-brand-600 bg-brand-50 font-semibold'
                    : 'text-slate-700 hover:text-brand-600 hover:bg-slate-50'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>

              <Link
                to="/profile"
                className="flex items-center gap-2 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:text-brand-600 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-xs">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="hidden md:inline">{user.name.split(' ')[0]}</span>
                {user.role === 'ADMIN' && (
                  <span className="flex items-center gap-0.5 text-[10px] bg-purple-100 text-purple-700 font-semibold px-1.5 py-0.5 rounded">
                    <Shield className="w-3 h-3" /> Admin
                  </span>
                )}
              </Link>

              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-brand-600 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Log In
              </Link>
              <Link
                to="/register"
                className="px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-sm shadow-brand-500/20 transition-all hover:shadow-md"
              >
                Get Started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
};
