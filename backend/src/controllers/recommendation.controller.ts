/**
 * CampusNotes AI — Recommendation Controller
 * ==========================================
 *
 * Module: backend/src/controllers/recommendation.controller.ts
 * Purpose: Validates request parameters and proxies recommendations to FastAPI.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import {
  recommendationService,
  RecommendationError,
} from '../services/recommendation.service.js';

export const getRecommendations = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1. Enforce authenticated user context
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
      });
    }

    // 2. Validate top_k query parameter (default = 10, bounds 1-100)
    let topK = 10;
    if (req.query.top_k !== undefined) {
      const raw = String(req.query.top_k).trim();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100 || !/^-?\d+$/.test(raw)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid top_k parameter. Must be an integer between 1 and 100.',
        });
      }
      topK = parsed;
    }

    // 3. Delegate to RecommendationService using authoritative authenticated userId
    const recommendations = await recommendationService.getRecommendations(userId, topK);

    // 4. Return unmodified FastAPI recommendation response
    return res.status(200).json(recommendations);
  } catch (err: any) {
    if (err instanceof RecommendationError) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
      });
    }

    // Generic fallback
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while fetching recommendations.',
    });
  }
};

/**
 * Probes the recommendation microservice health and returns diagnostic status.
 * Returns HTTP 200 when healthy or HTTP 503 when unavailable.
 */
export const getRecommendationHealth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const health = await recommendationService.checkHealth();

    if (!health.available) {
      return res.status(503).json({
        success: false,
        message: 'Recommendation service temporarily unavailable',
        data: health,
      });
    }

    return res.status(200).json({
      success: true,
      data: health,
    });
  } catch (err: any) {
    return res.status(503).json({
      success: false,
      message: 'Recommendation service temporarily unavailable',
    });
  }
};

export const recommendationController = {
  getRecommendations,
  getRecommendationHealth,
};
