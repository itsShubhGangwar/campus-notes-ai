import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Note, NoteChunk, ApiResponse } from '../types';
import { useAuth } from '../context/AuthContext';
import { PDFViewer } from '../components/notes/PDFViewer';
import { NoteAiChat } from '../components/chat/NoteAiChat';
import {
  ArrowLeft,
  Calendar,
  School,
  GitBranch,
  BookOpen,
  Download,
  Eye,
  Edit,
  Trash2,
  Shield,
  Layers,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

export const NoteDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 3A: Chunk Inspection & Processing State
  const [chunks, setChunks] = useState<NoteChunk[]>([]);
  const [showChunks, setShowChunks] = useState(false);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const fetchNote = async () => {
    try {
      setIsLoading(true);
      const res = await api.get<ApiResponse<Note>>(`/notes/${id}`);
      if (res.data.success) {
        setNote(res.data.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load note');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchNote();
  }, [id]);

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to permanently delete this note and its PDF?')) {
      return;
    }

    try {
      setIsDeleting(true);
      await api.delete(`/notes/${id}`);
      navigate('/notes');
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete note');
      setIsDeleting(false);
    }
  };

  const handleDownloadClick = () => {
    if (note) {
      setNote({ ...note, downloadsCount: note.downloadsCount + 1 });
    }
  };

  const handleFetchChunks = async () => {
    if (chunks.length > 0) {
      setShowChunks(!showChunks);
      return;
    }

    try {
      setIsLoadingChunks(true);
      const res = await api.get<ApiResponse<{ chunks: NoteChunk[]; totalChunks: number }>>(
        `/notes/${id}/chunks`
      );
      if (res.data.success) {
        setChunks(res.data.data.chunks);
        setShowChunks(true);
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to fetch chunks');
    } finally {
      setIsLoadingChunks(false);
    }
  };

  const handleReprocess = async () => {
    try {
      setIsReprocessing(true);
      const res = await api.post<ApiResponse<any>>(`/notes/${id}/process`);
      if (res.data.success) {
        await fetchNote();
        setChunks([]);
        setShowChunks(false);
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Reprocessing failed');
    } finally {
      setIsReprocessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500">Loading document...</p>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
          <BookOpen className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{error || 'Note not found'}</h2>
        <Link
          to="/notes"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Notes Catalog
        </Link>
      </div>
    );
  }

  const isOwner = user?.id === note.uploaderId;
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Navigation & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Link
          to="/notes"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Notes
        </Link>

        {/* Edit/Delete Actions for Owner or Admin */}
        {(isOwner || isAdmin) && (
          <div className="flex items-center gap-2">
            <Link
              to={`/notes/${note.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
            >
              <Edit className="w-3.5 h-3.5" />
              <span>Edit Note</span>
            </Link>

            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Columns: PDF Viewer & Chunks Accordion */}
        <div className="lg:col-span-2 space-y-6">
          <PDFViewer
            fileUrl={note.fileUrl}
            fileName={note.fileName}
            noteId={note.id}
            onDownload={handleDownloadClick}
          />

          {/* Phase 4: Interactive RAG Chat Assistant */}
          <NoteAiChat
            noteId={note.id}
            noteTitle={note.title}
            isReady={note.processingStatus === 'COMPLETED'}
          />

          {/* Phase 3A: Extracted Chunks Inspection Panel (For Owner / Admin) */}
          {(isOwner || isAdmin) && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div
                onClick={handleFetchChunks}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      Extracted Text Chunks (Developer RAG Preview)
                    </h4>
                    <p className="text-xs text-slate-500">
                      View the clean segments prepared for Phase 3B vector embeddings
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isLoadingChunks && (
                    <div className="w-4 h-4 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
                  )}
                  {showChunks ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </div>

              {showChunks && (
                <div className="p-4 pt-0 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 py-2">
                    <span>Total Chunks: <strong>{chunks.length}</strong></span>
                    <span>Pages Detected: <strong>{note.pageCount}</strong></span>
                  </div>

                  {chunks.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      No text chunks extracted yet. Trigger processing above if needed.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                      {chunks.map((chunk) => (
                        <div
                          key={chunk.id}
                          className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2 font-mono"
                        >
                          <div className="flex items-center justify-between text-[11px] font-sans font-semibold text-slate-600">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-white border border-slate-200">
                                Chunk #{chunk.chunkIndex + 1}
                              </span>
                              {chunk.hasEmbedding && (
                                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px]">
                                  {chunk.embeddingDims || 768}-dim Vector
                                </span>
                              )}
                            </div>
                            <span className="text-slate-400">
                              Page {chunk.pageNumber || 1} • ~{chunk.tokenCount} words
                            </span>
                          </div>
                          <p className="text-slate-800 font-sans leading-relaxed whitespace-pre-wrap bg-white p-2.5 rounded-lg border border-slate-100">
                            {chunk.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right 1 Column: Metadata & AI Processing Status */}
        <div className="space-y-6">
          {/* Note Information Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                  {note.subject?.code}
                </span>
                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" /> Sem {note.semester}
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 leading-snug">{note.title}</h1>
            </div>

            {/* Phase 3A: AI Processing Status Badge */}
            <div className="p-3 rounded-xl border flex items-center justify-between gap-2 text-xs">
              {note.processingStatus === 'COMPLETED' ? (
                <div className="flex items-center gap-2 text-emerald-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Ready for AI ({note.pageCount} Pages)</span>
                </div>
              ) : note.processingStatus === 'PROCESSING' ? (
                <div className="flex items-center gap-2 text-blue-700 font-medium">
                  <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                  <span>Processing text...</span>
                </div>
              ) : note.processingStatus === 'FAILED' ? (
                <div className="flex items-center gap-2 text-red-700 font-medium">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span>Processing failed</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>Queued for Processing</span>
                </div>
              )}

              {(isOwner || isAdmin) && (
                <button
                  onClick={handleReprocess}
                  disabled={isReprocessing}
                  className="text-slate-500 hover:text-brand-600 font-semibold flex items-center gap-1 text-[11px] disabled:opacity-50"
                  title="Re-run text extraction"
                >
                  <RotateCcw className={`w-3 h-3 ${isReprocessing ? 'animate-spin' : ''}`} />
                  <span>Re-extract</span>
                </button>
              )}
            </div>

            {note.processingError && (
              <p className="text-[11px] text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">
                Error: {note.processingError}
              </p>
            )}

            {/* Academic Details */}
            <div className="space-y-3 pt-4 border-t border-slate-100 text-xs text-slate-600">
              <div className="flex items-start gap-2.5">
                <School className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-800">{note.college?.name}</p>
                  <p className="text-slate-400">{note.college?.city}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <GitBranch className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-800">{note.branch?.name}</p>
                  <p className="text-slate-400">{note.branch?.code}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <BookOpen className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-800">{note.subject?.name}</p>
                  <p className="text-slate-400">{note.subject?.description || 'Course Syllabus Unit'}</p>
                </div>
              </div>
            </div>

            {/* Description */}
            {note.description && (
              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Description
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                  {note.description}
                </p>
              </div>
            )}

            {/* Tags */}
            {note.tags && note.tags.length > 0 && (
              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Keywords / Topics
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {note.tags.map(({ tag }) => (
                    <span
                      key={tag.id}
                      className="text-xs font-medium bg-brand-50 text-brand-700 px-2.5 py-0.5 rounded-full border border-brand-200"
                    >
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stats Metrics */}
            <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-center">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
                  <Eye className="w-3.5 h-3.5" /> Views
                </div>
                <p className="text-base font-bold text-slate-900">{note.viewsCount}</p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
                  <Download className="w-3.5 h-3.5" /> Downloads
                </div>
                <p className="text-base font-bold text-slate-900">{note.downloadsCount}</p>
              </div>
            </div>
          </div>

          {/* Uploader Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-3.5 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-base">
              {note.uploader?.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-grow min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-slate-900 truncate">{note.uploader?.name}</p>
                {note.uploader?.role === 'ADMIN' && (
                  <Shield className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />
                )}
              </div>
              <p className="text-xs text-slate-400 truncate">{note.uploader?.email}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Uploaded on {new Date(note.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
