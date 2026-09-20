/**
 * CampusNotes AI — Recommendation Routes
 * ======================================
 *
 * Module: backend/src/routes/recommendation.routes.ts
 * Purpose: Protected endpoint for personalized note recommendations.
 */

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { recommendationController } from '../controllers/recommendation.controller.js';

const router = Router();

// GET /api/recommendations/health (Health check and subsystem diagnostics)
router.get('/health', recommendationController.getRecommendationHealth);

// GET /api/recommendations?top_k=10
router.get('/', authenticate, recommendationController.getRecommendations);

export default router;
