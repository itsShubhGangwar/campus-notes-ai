import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotesListPage } from './pages/NotesListPage';
import { NoteDetailPage } from './pages/NoteDetailPage';
import { UploadNotePage } from './pages/UploadNotePage';
import { EditNotePage } from './pages/EditNotePage';
import { MyNotesPage } from './pages/MyNotesPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-brand-500 selection:text-white">
          <Navbar />
          <main className="flex-grow">
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/notes" element={<NotesListPage />} />
              <Route path="/notes/:id" element={<NoteDetailPage />} />

              {/* Protected Student Routes */}
              <Route
                path="/upload"
                element={
                  <ProtectedRoute>
                    <UploadNotePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/notes/:id/edit"
                element={
                  <ProtectedRoute>
                    <EditNotePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-notes"
                element={
                  <ProtectedRoute>
                    <MyNotesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />

              {/* Catch-all Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
