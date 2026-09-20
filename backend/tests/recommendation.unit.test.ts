/**
 * CampusNotes AI — Recommendation Unit Test Suite
 * ===============================================
 *
 * Module: backend/tests/recommendation.unit.test.ts
 * Purpose: Verifies the Express -> FastAPI recommendation integration in isolation.
 *          Mocks FastAPI and Prisma to ensure 100% test independence from external services.
 *
 * Required Checks (20 / 20):
 * 1. Authenticated recommendation request succeeds.
 * 2. Unauthenticated request returns 401.
 * 3. Authenticated user's ID is used.
 * 4. Supplied user_id query parameter is ignored.
 * 5. Default top_k = 10.
 * 6. top_k=5 works.
 * 7. top_k=100 works.
 * 8. top_k=0 returns 400.
 * 9. top_k=101 returns 400.
 * 10. Invalid top_k returns 400.
 * 11. FastAPI 404 maps correctly.
 * 12. FastAPI 503 maps correctly.
 * 13. FastAPI timeout maps to 503.
 * 14. FastAPI response is returned correctly.
 * 15. Recommendation ranking is not modified by Express.
 * 16. Internal FastAPI URL is not exposed to frontend response.
 * 17. No secrets appear in errors/logs.
 */

import http from 'http';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { prisma } from '../src/config/db.js';
import { signToken } from '../src/utils/jwt.js';

interface MockState {
  mode: 'success' | '404' | '503' | 'delay' | 'error';
  lastUrl: string | null;
  lastHeaders: http.IncomingHttpHeaders | null;
}

const mockState: MockState = {
  mode: 'success',
  lastUrl: null,
  lastHeaders: null,
};

const MOCK_RECOMMENDATION_PAYLOAD = {
  user_id: 'test-user-id',
  model_version: '1.0.0',
  inference_timestamp: '2026-09-16T12:00:00Z',
  candidate_count: 30,
  recommendation_count: 10,
  recommendations: [
    {
      rank: 1,
      note_id: 'note-uuid-1',
      title: 'Operating Systems Virtual Memory',
      subject_id: 'subj-1',
      semester: 4,
      branch_id: 'branch-1',
      engagement_score: 0.00931,
    },
    {
      rank: 2,
      note_id: 'note-uuid-2',
      title: 'Compiler Design Optimization',
      subject_id: 'subj-2',
      semester: 3,
      branch_id: 'branch-1',
      engagement_score: 0.000056,
    },
  ],
};

async function runUnitTests() {
  console.log('================================================================');
  console.log('🧪 CAMPUSNOTES AI — RECOMMENDATION UNIT TEST SUITE (17 CHECKS)');
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

  // 1. Setup Mock FastAPI HTTP Server
  const mockServer = http.createServer((req, res) => {
    mockState.lastUrl = req.url || null;
    mockState.lastHeaders = req.headers;

    if (mockState.mode === 'delay') {
      // Delay response by 6 seconds (exceeds 5-second timeout)
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(MOCK_RECOMMENDATION_PAYLOAD));
      }, 6000);
      return;
    }

    if (mockState.mode === '404') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'User not found' }));
      return;
    }

    if (mockState.mode === '503') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Recommendation database temporarily unavailable' }));
      return;
    }

    if (req.url === '/health') {
      if (mockState.mode === '503') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Database unavailable' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'campusnotes-recommendation',
          model_loaded: true,
          database_connected: true,
          model_version: 'v1.0.0-synthetic-bootstrap',
          data_source: 'postgres',
        })
      );
      return;
    }

    // Default 'success'
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(MOCK_RECOMMENDATION_PAYLOAD));
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => resolve());
  });

  const mockAddress = mockServer.address() as any;
  const mockPort = mockAddress.port;
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  config.recommendation.serviceUrl = mockUrl;
  console.log(`  Mock FastAPI Server listening on ${mockUrl}`);

  // 2. Setup Mock Prisma User
  const origFindUnique = prisma.user.findUnique;
  (prisma.user.findUnique as any) = async ({ where }: any) => {
    if (where.id === 'test-user-id') {
      return {
        id: 'test-user-id',
        email: 'test@stanford.edu',
        name: 'Test Student',
        role: 'USER',
        collegeId: 'c1',
        branchId: 'b1',
        semester: 4,
        isActive: true,
      };
    }
    return null;
  };

  const validToken = signToken({
    userId: 'test-user-id',
    email: 'test@stanford.edu',
    role: 'USER' as any,
  });

  // 3. Setup Express App
  const app = createApp();
  const expressServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    expressServer.on('listening', () => resolve());
  });
  const expressPort = (expressServer.address() as any).port;
  const expressUrl = `http://127.0.0.1:${expressPort}`;
  console.log(`  Express Server listening on ${expressUrl}\n`);

  try {
    // Test 1: Authenticated recommendation request succeeds (200)
    mockState.mode = 'success';
    const res1 = await fetch(`${expressUrl}/api/recommendations`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(res1.status === 200, '1. Authenticated recommendation request succeeds (200)');

    // Test 2: Unauthenticated request returns 401
    const res2 = await fetch(`${expressUrl}/api/recommendations`);
    assert(res2.status === 401, '2. Unauthenticated request returns 401');

    // Test 3: Authenticated user's ID is used
    assert(
      mockState.lastUrl !== null && mockState.lastUrl.includes('/recommendations/test-user-id'),
      '3. Authenticated user ID is used in FastAPI request',
      `FastAPI URL requested: ${mockState.lastUrl}`
    );

    // Test 4: Supplied user_id query parameter is ignored
    await fetch(`${expressUrl}/api/recommendations?user_id=attacker-spoofed-id`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(
      mockState.lastUrl !== null && !mockState.lastUrl.includes('attacker-spoofed-id') && mockState.lastUrl.includes('test-user-id'),
      '4. Supplied user_id query parameter is strictly ignored',
      `FastAPI received authentic ID: ${mockState.lastUrl}`
    );

    // Test 5: Default top_k = 10
    await fetch(`${expressUrl}/api/recommendations`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(
      mockState.lastUrl !== null && mockState.lastUrl.includes('top_k=10'),
      '5. Default top_k = 10 when query parameter is omitted'
    );

    // Test 6: top_k=5 works
    await fetch(`${expressUrl}/api/recommendations?top_k=5`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(
      mockState.lastUrl !== null && mockState.lastUrl.includes('top_k=5'),
      '6. top_k=5 parameter forwarded correctly'
    );

    // Test 7: top_k=100 works
    await fetch(`${expressUrl}/api/recommendations?top_k=100`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(
      mockState.lastUrl !== null && mockState.lastUrl.includes('top_k=100'),
      '7. top_k=100 parameter forwarded correctly'
    );

    // Test 8: top_k=0 returns 400
    const res8 = await fetch(`${expressUrl}/api/recommendations?top_k=0`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(res8.status === 400, '8. top_k=0 returns 400 Bad Request');

    // Test 9: top_k=101 returns 400
    const res9 = await fetch(`${expressUrl}/api/recommendations?top_k=101`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(res9.status === 400, '9. top_k=101 returns 400 Bad Request');

    // Test 10: Invalid top_k ("abc") returns 400
    const res10 = await fetch(`${expressUrl}/api/recommendations?top_k=abc`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(res10.status === 400, '10. Non-integer top_k ("abc") returns 400 Bad Request');

    // Test 11: FastAPI 404 maps correctly
    mockState.mode = '404';
    const res11 = await fetch(`${expressUrl}/api/recommendations`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const body11 = (await res11.json()) as any;
    assert(
      res11.status === 404 && body11.message === 'User not found',
      '11. FastAPI 404 maps to Express 404 with clean message',
      `Body: ${JSON.stringify(body11)}`
    );

    // Test 12: FastAPI 503 maps correctly
    mockState.mode = '503';
    const res12 = await fetch(`${expressUrl}/api/recommendations`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const body12 = (await res12.json()) as any;
    assert(
      res12.status === 503 && body12.message === 'Recommendation service temporarily unavailable',
      '12. FastAPI 503 maps to Express 503 with clean message',
      `Body: ${JSON.stringify(body12)}`
    );

    // Test 13: FastAPI timeout maps to 503
    mockState.mode = 'delay';
    const tStart = Date.now();
    const res13 = await fetch(`${expressUrl}/api/recommendations`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const elapsed = Date.now() - tStart;
    const body13 = (await res13.json()) as any;
    assert(
      res13.status === 503 && body13.message === 'Recommendation service temporarily unavailable' && elapsed >= 4900,
      '13. FastAPI timeout (5s) aborts and returns 503',
      `Elapsed: ${elapsed} ms, Status: ${res13.status}`
    );

    // Test 14: FastAPI response is returned correctly
    mockState.mode = 'success';
    const res14 = await fetch(`${expressUrl}/api/recommendations?top_k=10`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data14 = (await res14.json()) as any;
    assert(
      data14.user_id === 'test-user-id' &&
        data14.candidate_count === 30 &&
        Array.isArray(data14.recommendations) &&
        data14.recommendations.length === 2,
      '14. FastAPI response structure returned intact to client'
    );

    // Test 15: Recommendation ranking is not modified by Express
    const recs = data14.recommendations;
    assert(
      recs[0].rank === 1 &&
        recs[0].engagement_score === 0.00931 &&
        recs[1].rank === 2 &&
        recs[1].engagement_score === 0.000056,
      '15. Recommendation ranking and scores are completely preserved'
    );

    // Test 16: Internal FastAPI URL is not exposed in frontend response
    const rawBody14 = JSON.stringify(data14);
    assert(
      !rawBody14.includes(mockUrl) && !rawBody14.includes(':8000') && !rawBody14.includes('http://'),
      '16. Internal FastAPI URL is not leaked in response body'
    );

    // Test 17: No secrets appear in errors/logs
    const rawBody12 = JSON.stringify(body12);
    assert(
      !rawBody12.includes('password') &&
        !rawBody12.includes('secret') &&
        !rawBody12.includes('DATABASE_URL') &&
        !rawBody12.includes('postgresql://'),
      '17. No credentials or secrets leaked in error responses'
    );

    // Test 18: GET /api/recommendations/health returns 200 when healthy
    mockState.mode = 'success';
    const res18 = await fetch(`${expressUrl}/api/recommendations/health`);
    const data18: any = await res18.json();
    assert(
      res18.status === 200 &&
        data18.success === true &&
        data18.data?.available === true &&
        data18.data?.model_loaded === true &&
        data18.data?.database_connected === true &&
        typeof data18.data?.latency_ms === 'number',
      '18. GET /api/recommendations/health returns 200 with diagnostic status when healthy',
      `Status: ${res18.status}, Body: ${JSON.stringify(data18)}`
    );

    // Test 19: GET /api/recommendations/health returns 503 when FastAPI reports 503
    mockState.mode = '503';
    const res19 = await fetch(`${expressUrl}/api/recommendations/health`);
    const data19: any = await res19.json();
    assert(
      res19.status === 503 &&
        data19.success === false &&
        data19.data?.available === false,
      '19. GET /api/recommendations/health returns 503 when FastAPI is degraded/unhealthy',
      `Status: ${res19.status}, Body: ${JSON.stringify(data19)}`
    );

    // Test 20: GET /api/recommendations/health returns 503 when service URL is unreachable
    config.recommendation.serviceUrl = 'http://127.0.0.1:1'; // invalid port
    const res20 = await fetch(`${expressUrl}/api/recommendations/health`);
    const data20: any = await res20.json();
    assert(
      res20.status === 503 &&
        data20.success === false &&
        data20.data?.available === false &&
        data20.data?.status === 'unavailable',
      '20. GET /api/recommendations/health returns 503 gracefully when FastAPI connection is refused',
      `Status: ${res20.status}, Body: ${JSON.stringify(data20)}`
    );
    config.recommendation.serviceUrl = mockUrl; // Restore
  } finally {
    // Cleanup
    prisma.user.findUnique = origFindUnique;
    await new Promise<void>((resolve) => expressServer.close(() => resolve()));
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    console.log('\nServers closed successfully.');
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runUnitTests().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
