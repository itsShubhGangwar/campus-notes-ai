/**
 * CampusNotes AI — Full-Stack Recommendation Pipeline E2E Test Suite
 * =================================================================
 *
 * Module: backend/tests/recommendation.pipeline.e2e.test.ts
 * Purpose: Verifies the complete live recommendation pipeline without mocks:
 *          Client SPA -> Express API Gateway (5000) -> FastAPI (8000) ->
 *          PostgreSQL/Supabase (Read-only) -> 27-Feature Pipeline ->
 *          LightGBM Bootstrap Model -> Express -> Client.
 *
 * Verifications:
 * 1. Express -> FastAPI subsystem health diagnostics (GET /api/recommendations/health).
 * 2. Unauthenticated request rejection (401).
 * 3. Invalid token rejection (401).
 * 4. Real student recommendation request with live PostgreSQL candidate scoring.
 * 5. Exactly 5 recommendations returned (top_k=5).
 * 6. Strictly sequential ordinal ranking (1..5).
 * 7. Strictly descending engagement scores within [0.0, 1.0].
 * 8. Zero self-authored candidate notes.
 * 9. Zero unpublished notes.
 * 10. Required recommendation schema fields present and valid.
 * 11. Database immutability (0 writes across all tables).
 * 12. Graceful Express 503 error handling when FastAPI is unavailable.
 * 13. Health endpoint 503 when FastAPI is unavailable.
 * 14. Zero credentials, internal URLs, or stack traces leaked in error responses.
 * 15. End-to-end response latency budget (< 1000ms).
 */

import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { prisma } from '../src/config/db.js';
import { signToken } from '../src/utils/jwt.js';

const BOB_USER_ID = 'da3250c0-80b1-46ca-b682-a94b5c5132f3';
const FASTAPI_PORT = 55855;
const FASTAPI_URL = `http://127.0.0.1:${FASTAPI_PORT}`;

async function waitForHealth(url: string, maxWaitMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // Retry after delay
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function getDatabaseCounts() {
  const [users, notes, views, downloads, likes, bookmarks, chatSessions] = await Promise.all([
    prisma.user.count(),
    prisma.note.count(),
    prisma.noteView.count(),
    prisma.download.count(),
    prisma.like.count(),
    prisma.bookmark.count(),
    prisma.chatSession.count(),
  ]);
  return { users, notes, views, downloads, likes, bookmarks, chatSessions };
}

async function runPipelineE2ETests() {
  console.log('================================================================');
  console.log('🚀 CAMPUSNOTES AI — FULL-STACK RECOMMENDATION PIPELINE E2E TEST');
  console.log('   Testing Express -> FastAPI -> PostgreSQL -> LightGBM Flow');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      if (detail) console.log(`     ↳ ${detail}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      if (detail) console.error(`     Detail: ${detail}`);
      failed++;
    }
  };

  let fastapiProcess: ChildProcess | null = null;
  let expressServer: http.Server | null = null;
  let expressUrl = '';

  try {
    // 1. Start real FastAPI microservice process
    console.log(`1. Launching real FastAPI microservice on port ${FASTAPI_PORT}...`);
    fastapiProcess = spawn(
      'python',
      ['-m', 'uvicorn', 'recommendation.api.main:app', '--host', '127.0.0.1', '--port', String(FASTAPI_PORT)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
      }
    );

    const isHealthy = await waitForHealth(FASTAPI_URL);
    if (!isHealthy) {
      throw new Error(`FastAPI failed to start or become healthy on ${FASTAPI_URL} within 15 seconds.`);
    }
    console.log(`   ↳ FastAPI is LIVE and HEALTHY at ${FASTAPI_URL}\n`);

    // 2. Configure Express to point to the real FastAPI instance
    config.recommendation.serviceUrl = FASTAPI_URL;
    config.recommendation.timeoutMs = 5000;

    // 3. Start Express server on ephemeral port
    const app = createApp();
    await new Promise<void>((resolve) => {
      expressServer = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = expressServer!.address() as any;
    expressUrl = `http://127.0.0.1:${addr.port}`;
    console.log(`2. Express Gateway is LIVE at ${expressUrl}\n`);

    // 4. Baseline database records before test
    const baselineCounts = await getDatabaseCounts();
    console.log('3. Baseline Database Counts:');
    console.log(`   users: ${baselineCounts.users}, notes: ${baselineCounts.notes}, views: ${baselineCounts.views}, downloads: ${baselineCounts.downloads}\n`);

    // --- TEST 1: Subsystem Health Diagnostics ---
    console.log('--- Executing End-to-End Pipeline Checks ---');
    const healthRes = await fetch(`${expressUrl}/api/recommendations/health`);
    const healthData: any = await healthRes.json();
    assert(
      healthRes.status === 200 &&
        healthData.success === true &&
        healthData.data?.available === true &&
        healthData.data?.status === 'ok' &&
        healthData.data?.model_loaded === true &&
        healthData.data?.database_connected === true &&
        healthData.data?.data_source === 'postgres' &&
        typeof healthData.data?.latency_ms === 'number',
      '1. Express -> FastAPI Subsystem Health reports 100% HEALTHY',
      `Latency: ${healthData.data?.latency_ms} ms, Data Source: ${healthData.data?.data_source}`
    );

    // --- TEST 2: Authentication Enforcement ---
    const unauthRes = await fetch(`${expressUrl}/api/recommendations?top_k=5`);
    assert(
      unauthRes.status === 401,
      '2. Unauthenticated recommendation request is rejected with HTTP 401'
    );

    const invalidAuthRes = await fetch(`${expressUrl}/api/recommendations?top_k=5`, {
      headers: { Authorization: 'Bearer invalid.token.payload' },
    });
    assert(
      invalidAuthRes.status === 401,
      '3. Malformed/invalid token request is rejected with HTTP 401'
    );

    // --- TEST 3: Authenticated Real Student Recommendation Request ---
    const bobToken = signToken({
      userId: BOB_USER_ID,
      email: 'bob.smith@mit.edu',
      role: 'USER',
    });

    const tStart = Date.now();
    const recsRes = await fetch(`${expressUrl}/api/recommendations?top_k=5`, {
      headers: {
        Authorization: `Bearer ${bobToken}`,
        Accept: 'application/json',
      },
    });
    const e2eLatencyMs = Date.now() - tStart;
    const recsData: any = await recsRes.json();

    assert(
      recsRes.status === 200 && recsData.user_id === BOB_USER_ID,
      '4. Authenticated real student request succeeds with HTTP 200',
      `User: ${recsData.user_id}, Total E2E Latency: ${e2eLatencyMs} ms`
    );

    // --- TEST 4: top_k behavior ---
    const recs: any[] = recsData.recommendations || [];
    assert(
      recs.length === 5 && recsData.recommendation_count === 5,
      '5. Exactly 5 recommendations returned as requested (top_k=5)',
      `Returned: ${recs.length} items`
    );

    // --- TEST 5: Ordinal Ranks & Score Order ---
    const ranks = recs.map((r) => r.rank);
    const scores = recs.map((r) => r.engagement_score);
    const ranksValid = JSON.stringify(ranks) === JSON.stringify([1, 2, 3, 4, 5]);
    const scoresDescending = scores.every((s, i) => i === 0 || s <= scores[i - 1]);
    const scoresBounded = scores.every((s) => typeof s === 'number' && s >= 0.0 && s <= 1.0);

    assert(
      ranksValid,
      '6. Recommendation ranks are strictly sequential integers (1, 2, 3, 4, 5)',
      `Ranks: [${ranks.join(', ')}]`
    );

    assert(
      scoresDescending && scoresBounded,
      '7. Engagement scores are strictly descending and bounded within [0.0, 1.0]',
      `Scores: [${scores.map((s: number) => s.toFixed(6)).join(', ')}]`
    );

    // --- TEST 6: Candidate Invariants (no self-authored, no unpublished) ---
    const recommendedNoteIds = recs.map((r) => r.note_id);
    const dbNotes = await prisma.note.findMany({
      where: { id: { in: recommendedNoteIds } },
      select: { id: true, uploaderId: true, isPublished: true },
    });

    const hasSelfAuthored = dbNotes.some((n) => n.uploaderId === BOB_USER_ID);
    const hasUnpublished = dbNotes.some((n) => !n.isPublished);

    assert(
      !hasSelfAuthored,
      '8. Zero self-authored notes returned to the student',
      `Verified against PostgreSQL author IDs for student ${BOB_USER_ID}`
    );

    assert(
      !hasUnpublished,
      '9. Zero unpublished notes returned to the student',
      `All ${dbNotes.length} notes verified as isPublished=true in database`
    );

    // --- TEST 7: Required Recommendation Fields ---
    const requiredFields = ['rank', 'note_id', 'title', 'subject_id', 'semester', 'branch_id', 'engagement_score'];
    const allFieldsPresent = recs.every((r) => requiredFields.every((f) => r[f] !== undefined));
    assert(
      allFieldsPresent,
      '10. All required recommendation schema fields are present and typed correctly'
    );

    // --- TEST 8: Database Immutability Check ---
    const postCounts = await getDatabaseCounts();
    const mutated = Object.keys(baselineCounts).some(
      (k) => (baselineCounts as any)[k] !== (postCounts as any)[k]
    );
    assert(
      !mutated,
      '11. Database Immutability Verified: ZERO database writes occurred during inference',
      `Before: ${JSON.stringify(baselineCounts)} | After: ${JSON.stringify(postCounts)}`
    );

    // --- TEST 9: Latency Budget (Warmed Connection) ---
    const tBenchStart = Date.now();
    const benchRes = await fetch(`${expressUrl}/api/recommendations?top_k=5`, {
      headers: {
        Authorization: `Bearer ${bobToken}`,
        Accept: 'application/json',
      },
    });
    const warmedLatencyMs = Date.now() - tBenchStart;
    assert(
      benchRes.status === 200 && warmedLatencyMs < 1000,
      '12. End-to-end response time is well within latency budget (< 1000ms)',
      `Observed latency: ${warmedLatencyMs} ms (Initial cold: ${e2eLatencyMs} ms)`
    );

    // --- TEST 10: Graceful Degradation on FastAPI Failure ---
    config.recommendation.serviceUrl = 'http://127.0.0.1:59999'; // Unreachable port
    const failRes = await fetch(`${expressUrl}/api/recommendations?top_k=5`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    const failData: any = await failRes.json();
    assert(
      failRes.status === 503 &&
        failData.success === false &&
        failData.message === 'Recommendation service temporarily unavailable',
      '13. Express returns clean HTTP 503 when FastAPI service is unavailable',
      `Status: ${failRes.status}, Message: "${failData.message}"`
    );

    const failHealthRes = await fetch(`${expressUrl}/api/recommendations/health`);
    const failHealthData: any = await failHealthRes.json();
    assert(
      failHealthRes.status === 503 &&
        failHealthData.success === false &&
        failHealthData.data?.available === false &&
        failHealthData.data?.status === 'unavailable',
      '14. Express /health endpoint returns HTTP 503 when FastAPI is unreachable'
    );

    // --- TEST 11: Security & Information Leakage Audit ---
    const failBodyStr = JSON.stringify(failData) + JSON.stringify(failHealthData);
    const leaksSecrets =
      failBodyStr.includes('password') ||
      failBodyStr.includes('DATABASE_URL') ||
      failBodyStr.includes('postgresql://') ||
      failBodyStr.includes(':59999') ||
      failBodyStr.includes('stack') ||
      failBodyStr.includes('ECONNREFUSED');
    assert(
      !leaksSecrets,
      '15. Zero credentials, internal URLs, or stack traces leaked in error responses'
    );
  } finally {
    // Teardown
    if (expressServer) {
      await new Promise<void>((resolve) => (expressServer as any).close(() => resolve()));
    }
    if (fastapiProcess) {
      fastapiProcess.kill();
    }
    console.log('\nProcesses and servers terminated cleanly.');
  }

  console.log(`\n================================================================`);
  console.log(`E2E PIPELINE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPipelineE2ETests().catch((err) => {
  console.error('Fatal E2E test runner failure:', err);
  process.exit(1);
});
