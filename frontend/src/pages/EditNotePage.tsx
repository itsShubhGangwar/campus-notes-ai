import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { Note, Subject, ApiResponse } from '../types';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Save, AlertCircle, BookOpen, Calendar, Tag } from 'lucide-react';

export const EditNotePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [semester, setSemester] = useState<number>(1);
  const [subjectId, setSubjectId] = useState('');
  const [tags, setTags] = useState('');

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [branchId, setBranchId] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNote = async () => {
      try {
        setIsLoading(true);
        const res = await api.get<ApiResponse<Note>>(`/notes/${id}`);
        if (res.data.success) {
          const note = res.data.data;

          // Check authorization
          const isOwner = user?.id === note.uploaderId;
          const isAdmin = user?.role === 'ADMIN';

          if (!isOwner && !isAdmin) {
            navigate(`/notes/${id}`);
            return;
          }

          setTitle(note.title);
          setDescription(note.description || '');
          setSemester(note.semester);
          setSubjectId(note.subjectId);
          setBranchId(note.branchId);

          if (note.tags) {
            setTags(note.tags.map((t) => t.tag.name).join(', '));
          }

          // Load subjects for this branch
          const subRes = await api.get<ApiResponse<Subject[]>>('/academic/subjects', {
            params: { branchId: note.branchId, semester: note.semester },
          });
          if (subRes.data.success) {
            setSubjects(subRes.data.data);
          }
        }
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to fetch note.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchNote();
  }, [id, user, navigate]);

  // Update subjects if semester changes
  useEffect(() => {
    if (branchId) {
      api.get<ApiResponse<Subject[]>>('/academic/subjects', {
        params: { branchId, semester },
      })
        .then((res) => {
          setSubjects(res.data.data);
          if (res.data.data.length > 0 && !res.data.data.some((s) => s.id === subjectId)) {
            setSubjectId(res.data.data[0].id);
          }
        })
        .catch(() => setSubjects([]));
    }
  }, [branchId, semester]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const res = await api.put<ApiResponse<Note>>(`/notes/${id}`, {
        title: title.trim(),
        description: description.trim(),
        semester,
        subjectId,
        tags: tags.trim(),
      });

      if (res.data.success) {
        navigate(`/notes/${id}`);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update note.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link
        to={`/notes/${id}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Cancel & Return to Note
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Edit Note Details</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Update the titles, descriptions, and syllabus classifications
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-sm">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Note Title
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Description
          </label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-3.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" /> Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-slate-400" /> Subject
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} - {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-slate-400" /> Tags (comma separated)
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm shadow-sm transition-colors disabled:opacity-50"
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
  );
};
