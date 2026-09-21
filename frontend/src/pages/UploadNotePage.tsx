import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { College, Branch, Subject, Note, ApiResponse } from '../types';
import {
  UploadCloud,
  FileText,
  AlertCircle,
  School,
  GitBranch,
  Calendar,
  BookOpen,
  Tag,
  ArrowLeft,
  X,
} from 'lucide-react';

export const UploadNotePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Dropdown States (Pre-populated from student's profile)
  const [colleges, setColleges] = useState<College[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [selectedCollegeId, setSelectedCollegeId] = useState(user?.collegeId || '');
  const [selectedBranchId, setSelectedBranchId] = useState(user?.branchId || '');
  const [selectedSemester, setSelectedSemester] = useState<number>(user?.semester || 1);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');

  // Status States
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 1. Fetch Colleges
  useEffect(() => {
    api.get<ApiResponse<College[]>>('/api/academic/colleges')
      .then((res) => {
        setColleges(res.data.data);
        if (!selectedCollegeId && res.data.data.length > 0) {
          setSelectedCollegeId(res.data.data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // 2. Fetch Branches when College changes
  useEffect(() => {
    if (!selectedCollegeId) {
      setBranches([]);
      setSelectedBranchId('');
      return;
    }

    api.get<ApiResponse<Branch[]>>(`/api/academic/colleges/${selectedCollegeId}/branches`)
      .then((res) => {
        setBranches(res.data.data);
        if (!selectedBranchId && res.data.data.length > 0) {
          setSelectedBranchId(res.data.data[0].id);
        }
      })
      .catch(() => setBranches([]));
  }, [selectedCollegeId]);


  // 3. Fetch Subjects when Branch or Semester changes
  useEffect(() => {
    if (!selectedBranchId) {
      setSubjects([]);
      setSelectedSubjectId('');
      return;
    }

    api.get<ApiResponse<Subject[]>>('/academic/subjects', {
      params: { branchId: selectedBranchId, semester: selectedSemester },
    })
      .then((res) => {
        setSubjects(res.data.data);
        if (res.data.data.length > 0) {
          setSelectedSubjectId(res.data.data[0].id);
        } else {
          setSelectedSubjectId('');
        }
      })
      .catch(() => setSubjects([]));
  }, [selectedBranchId, selectedSemester]);

  // Handle File Selection with client-side security checks
  const handleFileChange = (file: File) => {
    setErrorMessage(null);

    // Validate MIME and extension
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Please select a valid PDF file.');
      return;
    }

    // Validate size (25MB max)
    if (file.size > 25 * 1024 * 1024) {
      setErrorMessage('File size exceeds the 25MB limit.');
      return;
    }

    setSelectedFile(file);

    // Auto-fill title with filename if empty
    if (!title) {
      const cleanName = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
      setTitle(cleanName);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedFile) {
      setErrorMessage('Please choose a PDF file to upload.');
      return;
    }

    if (!selectedSubjectId) {
      setErrorMessage('Please select a course subject for this note.');
      return;
    }

    try {
      setIsUploading(true);

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', title.trim());
      if (description.trim()) formData.append('description', description.trim());
      formData.append('collegeId', selectedCollegeId);
      formData.append('branchId', selectedBranchId);
      formData.append('semester', String(selectedSemester));
      formData.append('subjectId', selectedSubjectId);
      if (tags.trim()) formData.append('tags', tags.trim());

      const res = await api.post<ApiResponse<Note>>('/notes', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (res.data.success) {
        navigate(`/notes/${res.data.data.id}`);
      }
    } catch (err: any) {
      setErrorMessage(err.response?.data?.message || 'Failed to upload note.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link
        to="/notes"
        className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Notes Catalog
      </Link>

      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Upload Course Notes
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Share lecture slides, handwritten derivations, or revision guides with your peers
        </p>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{errorMessage}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Drag & Drop PDF File Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center transition-all ${
            isDragging
              ? 'border-brand-500 bg-brand-50/50 scale-[0.99]'
              : selectedFile
              ? 'border-emerald-300 bg-emerald-50/30'
              : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-slate-50/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileChange(e.target.files[0]);
              }
            }}
          />

          {selectedFile ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <FileText className="w-7 h-7" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">{selectedFile.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • PDF Document Ready
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                }}
                className="mt-2 text-xs text-red-600 hover:text-red-700 font-semibold flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Remove file
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
                <UploadCloud className="w-7 h-7" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">
                  Click to select or drag and drop your PDF here
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Supported format: PDF up to 25MB (Files are securely stored in Object Storage)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Note Metadata Details */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Note Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unit 3 - Operating Systems Memory Management Notes"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Description / Topics Covered
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide a brief summary of what chapters, theorems, or questions are included in this PDF..."
              className="w-full p-3.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>

          {/* Academic Course Mapping */}
          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs font-bold text-brand-700 uppercase tracking-wider mb-4">
              Academic Course Association
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                  <School className="w-3.5 h-3.5 text-slate-400" /> College
                </label>
                <select
                  value={selectedCollegeId}
                  onChange={(e) => setSelectedCollegeId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                >
                  {colleges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-slate-400" /> Branch
                </label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  disabled={branches.length === 0}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm disabled:opacity-50"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Semester
                </label>
                <select
                  value={selectedSemester}
                  onChange={(e) => setSelectedSemester(Number(e.target.value))}
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
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" /> Course Subject
                </label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(e.target.value)}
                  disabled={subjects.length === 0}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm disabled:opacity-50"
                >
                  {subjects.length === 0 ? (
                    <option value="">No subjects found for this semester</option>
                  ) : (
                    subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="pt-4 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-400" /> Tags / Keywords (comma separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. paging, virtual memory, formulas, previous year exam"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={isUploading || !selectedFile || !selectedSubjectId}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm shadow-md shadow-brand-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Uploading & Processing PDF...</span>
              </div>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>Publish Notes to Platform</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
