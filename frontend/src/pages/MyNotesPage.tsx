import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Note, ApiResponse } from '../types';
import { NoteCard } from '../components/notes/NoteCard';
import { Upload, BookOpen, Plus } from 'lucide-react';

export const MyNotesPage: React.FC = () => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      api.get<ApiResponse<{ notes: Note[] }>>('/notes', {
        params: { uploaderId: user.id },
      })
        .then((res) => setNotes(res.data.data.notes))
        .catch(() => setNotes([]))
        .finally(() => setIsLoading(false));
    }
  }, [user]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            My Uploaded Notes
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your shared study guides, lecture slides, and monitor engagement
          </p>
        </div>

        <Link
          to="/upload"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Upload New Note</span>
        </Link>
      </div>

      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-500">Loading your uploads...</p>
        </div>
      ) : notes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">You haven't uploaded any notes yet</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Share your course notes to help other students on your campus and unlock future RAG study studio features!
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Your First Note
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  );
};
