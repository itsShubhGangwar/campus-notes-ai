/**
 * CampusNotes AI — Recommendation Frontend Service
 * =================================================
 *
 * Module: frontend/src/services/recommendation.ts
 * Purpose: Fetches personalized note recommendations from the Express backend gateway.
 *          Does NOT communicate directly with FastAPI.
 */

import { api } from './api';
import { RecommendationResponse } from '../types';

/**
 * Retrieves personalized note recommendations for the authenticated student.
 *
 * @param topK Number of recommendations requested (default 10)
 * @returns RecommendationResponse payload from Express
 */
export const getRecommendations = async (topK: number = 10): Promise<RecommendationResponse> => {
  const response = await api.get<RecommendationResponse>(`/recommendations?top_k=${topK}`);
  return response.data;
};
