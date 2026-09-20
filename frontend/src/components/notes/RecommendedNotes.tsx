/**
 * CampusNotes AI — RecommendedNotes Component
 * ==========================================
 *
 * Module: frontend/src/components/notes/RecommendedNotes.tsx
 * Purpose: Renders personalized note recommendations for authenticated students.
 *          Handles loading (skeletons), empty, error (503 friendly message),
 *          and success states. Links directly to existing /notes/:id view.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getRecommendations } from '../../services/recommendation';
import { RecommendationItem } from '../../types';
import {
  Sparkles,
  BookOpen,
  Calendar,
  ArrowRight,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';

export const RecommendedNotes: React.FC = () => {
  const { user, token } = useAuth();
  const isAuthenticated = Boolean(user && token);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = async () => {
    if (!isAuthenticated || !user) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getRecommendations(10);
      setRecommendations(data.recommendations || []);
    } catch (err: any) {
      if (err.response?.status === 503) {
        setError('Recommendations are temporarily unavailable.');
      } else if (err.response?.status === 404) {
        setError('No personalized profile found for recommendations.');
      } else {
        setError('Unable to load recommendations right now. Please try again later.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, [isAuthenticated, user?.id]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 text-white flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Recommended for You
            </h2>
            <p className="text-xs text-slate-500">
              Personalized study materials aligned with your term, branch, and learning activity.
            </p>
          </div>
        </div>

        <Link
          to="/notes"
          className="self-start sm:self-auto text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
        >
          Browse All Notes <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* State 1: Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 animate-pulse"
            >
              <div className="flex items-center justify-between">
                <div className="h-5 w-24 bg-slate-200 rounded-full" />
                <div className="h-4 w-16 bg-slate-100 rounded-md" />
              </div>
              <div className="space-y-2 pt-1">
                <div className="h-5 w-3/4 bg-slate-200 rounded-md" />
                <div className="h-4 w-1/2 bg-slate-100 rounded-md" />
              </div>
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="h-4 w-20 bg-slate-100 rounded" />
                <div className="h-4 w-16 bg-slate-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* State 2: Error State */}
      {!isLoading && error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-800">{error}</p>
              <p className="text-xs text-slate-500">
                You can still browse the catalog or retry loading your feed.
              </p>
            </div>
          </div>
          <button
            onClick={fetchRecommendations}
            className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {/* State 3: Empty State */}
      {!isLoading && !error && recommendations.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No Recommendations Yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Upload notes, browse subjects, or complete your profile to unlock personalized curriculum suggestions.
          </p>
          <Link
            to="/notes"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            Explore Catalog <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* State 4: Success Grid */}
      {!isLoading && !error && recommendations.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {recommendations.map((item) => (
            <div
              key={item.note_id}
              className="group bg-white rounded-2xl border border-slate-200 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5 transition-all duration-200 flex flex-col justify-between overflow-hidden"
            >
              <div className="p-5 space-y-3">
                {/* Header Rank Badge */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1 ${
                      item.rank === 1
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : item.rank <= 3
                        ? 'bg-brand-50 text-brand-700 border-brand-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    #{item.rank} Recommended
                  </span>

                  {item.semester && (
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" /> Sem {item.semester}
                    </span>
                  )}
                </div>

                {/* Note Title */}
                <Link
                  to={`/notes/${item.note_id}`}
                  className="block group-hover:text-brand-600 transition-colors"
                >
                  <h3 className="font-bold text-slate-900 text-base line-clamp-2 leading-snug">
                    {item.title}
                  </h3>
                </Link>

                <p className="text-xs text-slate-500">
                  Recommended based on your current semester and branch coursework.
                </p>
              </div>

              {/* Action Footer */}
              <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Curriculum Match</span>
                <Link
                  to={`/notes/${item.note_id}`}
                  className="font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
                >
                  View Note <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
