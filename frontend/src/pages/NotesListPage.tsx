import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import { Note, College, Branch, Subject, Pagination, ApiResponse } from '../types';
import { NoteCard } from '../components/notes/NoteCard';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Upload,
  BookOpen,
  RotateCcw,
} from 'lucide-react';

export const NotesListPage: React.FC = () => {
  const [searchParams] = useSearchParams();

  // Filter States
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [selectedCollege, setSelectedCollege] = useState(searchParams.get('collegeId') || '');
  const [selectedBranch, setSelectedBranch] = useState(searchParams.get('branchId') || '');
  const [selectedSemester, setSelectedSemester] = useState(searchParams.get('semester') || '');
  const [selectedSubject, setSelectedSubject] = useState(searchParams.get('subjectId') || '');
  const [selectedSort, setSelectedSort] = useState(searchParams.get('sort') || 'recent');
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));

  // Data States
  const [notes, setNotes] = useState<Note[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filter Dropdown Options
  const [colleges, setColleges] = useState<College[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  // 1. Fetch Colleges on Mount
  useEffect(() => {
    api.get<ApiResponse<College[]>>('/api/academic/colleges')
      .then((res) => setColleges(res.data.data))
      .catch(() => {});
  }, []);

  // 2. Fetch Branches when College changes
  useEffect(() => {
    if (selectedCollege) {
      api.get<ApiResponse<Branch[]>>(`/api/academic/colleges/${selectedCollege}/branches`)
        .then((res) => setBranches(res.data.data))
        .catch(() => setBranches([]));

    } else {
      setBranches([]);
      setSelectedBranch('');
    }
  }, [selectedCollege]);

  // 3. Fetch Subjects when Branch or Semester changes
  useEffect(() => {
    if (selectedBranch) {
      const params: any = { branchId: selectedBranch };
      if (selectedSemester) params.semester = selectedSemester;

      api.get<ApiResponse<Subject[]>>('/academic/subjects', { params })
        .then((res) => setSubjects(res.data.data))
        .catch(() => setSubjects([]));
    } else {
      setSubjects([]);
      setSelectedSubject('');
    }
  }, [selectedBranch, selectedSemester]);

  // 4. Fetch Notes based on all active query filters
  const fetchNotes = async () => {
    try {
      setIsLoading(true);
      const params: any = {
        page: currentPage,
        limit: 12,
        sort: selectedSort,
      };

      if (search.trim()) params.search = search.trim();
      if (selectedCollege) params.collegeId = selectedCollege;
      if (selectedBranch) params.branchId = selectedBranch;
      if (selectedSemester) params.semester = selectedSemester;
      if (selectedSubject) params.subjectId = selectedSubject;

      const res = await api.get<ApiResponse<{ notes: Note[]; pagination: Pagination }>>('/notes', {
        params,
      });

      if (res.data.success) {
        setNotes(res.data.data.notes);
        setPagination(res.data.data.pagination);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
      setNotes([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [currentPage, selectedSort, selectedCollege, selectedBranch, selectedSemester, selectedSubject]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchNotes();
  };

  const handleResetFilters = () => {
    setSearch('');
    setSelectedCollege('');
    setSelectedBranch('');
    setSelectedSemester('');
    setSelectedSubject('');
    setSelectedSort('recent');
    setCurrentPage(1);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Explore Course Notes
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Browse lecture slides, handwritten notes, and exam prep PDFs across colleges
          </p>
        </div>

        <Link
          to="/upload"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm shadow-sm transition-all"
        >
          <Upload className="w-4 h-4" />
          <span>Upload Notes</span>
        </Link>
      </div>

      {/* Search and Filter Panel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-grow">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by topic, keyword, or course code (e.g. CS201, Algorithms)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-xl transition-colors"
          >
            Search
          </button>
        </form>

        {/* Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t border-slate-100 text-xs">
          {/* College Filter */}
          <select
            value={selectedCollege}
            onChange={(e) => {
              setSelectedCollege(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full p-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Colleges</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Branch Filter */}
          <select
            value={selectedBranch}
            onChange={(e) => {
              setSelectedBranch(e.target.value);
              setCurrentPage(1);
            }}
            disabled={!selectedCollege}
            className="w-full p-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>

          {/* Semester Filter */}
          <select
            value={selectedSemester}
            onChange={(e) => {
              setSelectedSemester(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full p-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Semesters</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>

          {/* Subject Filter */}
          <select
            value={selectedSubject}
            onChange={(e) => {
              setSelectedSubject(e.target.value);
              setCurrentPage(1);
            }}
            disabled={!selectedBranch}
            className="w-full p-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          >
            <option value="">All Subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>

          {/* Sort Filter */}
          <select
            value={selectedSort}
            onChange={(e) => {
              setSelectedSort(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full p-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="recent">Most Recent</option>
            <option value="popular">Most Viewed</option>
            <option value="downloads">Most Downloaded</option>
          </select>
        </div>

        {(selectedCollege || selectedBranch || selectedSemester || selectedSubject || search) && (
          <div className="flex justify-end pt-1">
            <button
              onClick={handleResetFilters}
              className="text-xs text-brand-600 hover:text-brand-800 flex items-center gap-1 font-semibold"
            >
              <RotateCcw className="w-3 h-3" /> Reset all filters
            </button>
          </div>
        )}
      </div>

      {/* Notes Grid */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-500">Loading notes catalog...</p>
        </div>
      ) : notes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">No notes found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              No course documents matched your current search filters. Be the first to upload lecture notes for this course!
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload First Note
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>

          {/* Pagination Controls */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-6 border-t border-slate-200">
              <p className="text-xs text-slate-500">
                Showing Page <span className="font-bold text-slate-900">{pagination.page}</span> of{' '}
                <span className="font-bold text-slate-900">{pagination.totalPages}</span> ({pagination.total} total notes)
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={currentPage === pagination.totalPages}
                  className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
