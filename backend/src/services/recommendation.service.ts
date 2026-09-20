/**
 * CampusNotes AI — Express to FastAPI Recommendation Service Client
 * =================================================================
 *
 * Module: backend/src/services/recommendation.service.ts
 * Purpose: Proxies recommendation requests from Express to the FastAPI
 *          recommendation microservice. Handles timeouts, connection failures,
 *          and error mappings while guaranteeing that credentials, internal
 *          URLs, and stack traces are never leaked.
 */

import { config } from '../config/env.js';

export interface RecommendationItem {
  rank: number;
  note_id: string;
  title: string;
  subject_id: string;
  semester: number | null;
  branch_id: string | null;
  engagement_score: number;
}

export interface RecommendationResponse {
  user_id: string;
  model_version: string;
  inference_timestamp: string;
  candidate_count: number;
  recommendation_count: number;
  recommendations: RecommendationItem[];
}

export interface RecommendationHealthStatus {
  available: boolean;
  status: string;
  model_loaded: boolean;
  database_connected: boolean;
  data_source: string;
  latency_ms: number;
}

export class RecommendationError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'RecommendationError';
    this.statusCode = statusCode;
  }
}

export class RecommendationService {
  private get serviceUrl(): string {
    return (config.recommendation?.serviceUrl || 'http://localhost:8000').replace(/\/+$/, '');
  }

  private get timeoutMs(): number {
    return config.recommendation?.timeoutMs ?? 5000;
  }

  /**
   * Fetches personalized note recommendations for an authenticated user from FastAPI.
   *
   * @param userId Authenticated user UUID
   * @param topK Number of recommendations to return (1-100)
   * @returns RecommendationResponse payload from FastAPI
   */
  public async getRecommendations(
    userId: string,
    topK: number = 10
  ): Promise<RecommendationResponse> {
    const url = `${this.serviceUrl}/recommendations/${encodeURIComponent(userId)}?top_k=${topK}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) {
        const data = (await response.json()) as RecommendationResponse;
        return data;
      }

      if (response.status === 404) {
        throw new RecommendationError('User not found', 404);
      }

      if (response.status === 400) {
        throw new RecommendationError('Invalid top_k parameter', 400);
      }

      if (response.status === 503) {
        throw new RecommendationError('Recommendation service temporarily unavailable', 503);
      }

      // Any other unexpected upstream status
      throw new RecommendationError('Recommendation service temporarily unavailable', 503);
    } catch (err: any) {
      if (err instanceof RecommendationError) {
        throw err;
      }

      // Handle timeout
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new RecommendationError('Recommendation service temporarily unavailable', 503);
      }

      // Handle connection refused / network error
      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new RecommendationError('Recommendation service temporarily unavailable', 503);
      }

      // Fallback safe 503
      throw new RecommendationError('Recommendation service temporarily unavailable', 503);
    }
  }

  /**
   * Probes FastAPI GET /health to diagnose recommendation engine readiness.
   * Enforces a 3000ms timeout and measures upstream roundtrip latency.
   * Never exposes internal URLs, credentials, or stack traces.
   *
   * @returns RecommendationHealthStatus
   */
  public async checkHealth(): Promise<RecommendationHealthStatus> {
    const url = `${this.serviceUrl}/health`;
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        const data: any = await response.json();
        return {
          available: true,
          status: typeof data.status === 'string' ? data.status : 'ok',
          model_loaded: Boolean(data.model_loaded),
          database_connected: data.database_connected !== false,
          data_source: typeof data.data_source === 'string' ? data.data_source : 'unknown',
          latency_ms: latencyMs,
        };
      }

      return {
        available: false,
        status: 'degraded',
        model_loaded: false,
        database_connected: false,
        data_source: 'unknown',
        latency_ms: latencyMs,
      };
    } catch {
      const latencyMs = Date.now() - startTime;
      return {
        available: false,
        status: 'unavailable',
        model_loaded: false,
        database_connected: false,
        data_source: 'unknown',
        latency_ms: latencyMs,
      };
    }
  }
}

export const recommendationService = new RecommendationService();
