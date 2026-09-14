import React from 'react';
import { Link } from 'react-router-dom';
import { Note } from '../../types';
import { Eye, Download, School, Calendar, ArrowRight } from 'lucide-react';

interface NoteCardProps {
  note: Note;
}

export const NoteCard: React.FC<NoteCardProps> = ({ note }) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5 transition-all duration-200 flex flex-col justify-between overflow-hidden">
      <div className="p-5">
        {/* Header Badges */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
            {note.subject?.code || 'Course'}
          </span>
          <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
            <Calendar className="w-3 h-3 text-slate-400" /> Sem {note.semester}
          </span>
        </div>

        {/* Note Title */}
        <Link to={`/notes/${note.id}`} className="block group-hover:text-brand-600 transition-colors">
          <h3 className="font-bold text-slate-900 text-base line-clamp-2 leading-snug">
            {note.title}
          </h3>
        </Link>

        {/* Note Description */}
        <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
          {note.description || 'No description provided.'}
        </p>

        {/* Academic Details */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-600">
          <School className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span className="truncate">{note.college?.name}</span>
        </div>

        {/* Tags */}
        {note.tags && note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {note.tags.slice(0, 3).map(({ tag }) => (
              <span
                key={tag.id}
                className="text-[10px] font-medium bg-slate-50 text-slate-600 px-2 py-0.5 rounded border border-slate-100"
              >
                #{tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Footer Meta & Stats */}
      <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Eye className="w-3.5 h-3.5 text-slate-400" />
            {note.viewsCount}
          </span>
          <span className="flex items-center gap-1">
            <Download className="w-3.5 h-3.5 text-slate-400" />
            {note.downloadsCount}
          </span>
          <span className="text-[11px] text-slate-400">
            {formatFileSize(note.fileSize)}
          </span>
        </div>

        <Link
          to={`/notes/${note.id}`}
          className="font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
        >
          View <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
};
