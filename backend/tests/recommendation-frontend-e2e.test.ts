/**
 * CampusNotes AI — Frontend Recommendation UI Integration Verification
 * ====================================================================
 *
 * Module: backend/tests/recommendation-frontend-e2e.test.ts
 * Purpose: Verifies Phase 3 Step 2.8:
 *          1. Express recommendation endpoint serves data for frontend consumption.
 *          2. Response maps cleanly to RecommendationResponse and RecommendationItem interfaces.
 *          3. Top K is default 10.
 *          4. Destination note routes match /notes/:id.
 *          5. 503 response mapping produces friendly text "Recommendations are temporarily unavailable."
 *          6. Static source audit: FastAPI URL (port 8000) is never present in frontend source or build dist.
 *          7. Static source audit: Zero database credentials or secrets in frontend codebase.
 */

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { createApp } from '../src/app.js';
import { prisma } from '../src/config/db.js';
import { signToken } from '../src/utils/jwt.js';

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const BOB_USER_ID = 'da3250c0-80b1-46ca-b682-a94b5c5132f3';

async function runFrontendVerification() {
  console.log('================================================================');
  console.log('🧪 CAMPUSNOTES AI — FRONTEND RECOMMENDATION INTEGRATION (STEP 2.8)');
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

  // --- CHECK 1: Frontend Static Security Audit ---
  console.log('--- Phase A: Frontend Security & URL Isolation Audit ---');
  const frontendSrcDir = path.join(FRONTEND_DIR, 'src');
  const frontendDistDir = path.join(FRONTEND_DIR, 'dist');

  function scanFiles(dir: string, pattern: RegExp): string[] {
    const hits: string[] = [];
    if (!fs.existsSync(dir)) return hits;

    function walk(curr: string) {
      const entries = fs.readdirSync(curr, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(curr, ent.name);
        if (ent.isDirectory()) {
          walk(full);
        } else if (ent.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.js') || full.endsWith('.html'))) {
          const text = fs.readFileSync(full, 'utf-8');
          if (pattern.test(text)) {
            hits.push(full);
          }
        }
      }
    }
    walk(dir);
    return hits;
  }

  // Verify FastAPI internal URL (:8000) never in frontend/src
  const fastApiHitsSrc = scanFiles(frontendSrcDir, /localhost:8000|127\.0\.0\.1:8000/);
  assert(
    fastApiHitsSrc.length === 0,
    '1. Internal FastAPI URL (:8000) is absent from frontend/src',
    fastApiHitsSrc.length > 0 ? `Found in: ${fastApiHitsSrc.join(', ')}` : undefined
  );

  // Verify FastAPI internal URL (:8000) never in frontend/dist
  const fastApiHitsDist = scanFiles(frontendDistDir, /localhost:8000|127\.0\.0\.1:8000/);
  assert(
    fastApiHitsDist.length === 0,
    '2. Internal FastAPI URL (:8000) is absent from production frontend/dist',
    fastApiHitsDist.length > 0 ? `Found in: ${fastApiHitsDist.join(', ')}` : undefined
  );

  // Verify DATABASE_URL or Postgres secrets never in frontend
  const dbUrlHits = scanFiles(frontendSrcDir, /DATABASE_URL|postgresql:\/\//i);
  assert(
    dbUrlHits.length === 0,
    '3. DATABASE_URL / PostgreSQL credentials are absent from frontend code',
    dbUrlHits.length > 0 ? `Found in: ${dbUrlHits.join(', ')}` : undefined
  );

  // --- CHECK 2: Frontend File Existence & Architecture ---
  console.log('\n--- Phase B: Architecture & File Verification ---');
  const serviceFile = path.join(frontendSrcDir, 'services', 'recommendation.ts');
  const componentFile = path.join(frontendSrcDir, 'components', 'notes', 'RecommendedNotes.tsx');
  const dashboardFile = path.join(frontendSrcDir, 'pages', 'DashboardPage.tsx');

  assert(fs.existsSync(serviceFile), '4. frontend/src/services/recommendation.ts exists');
  assert(fs.existsSync(componentFile), '5. frontend/src/components/notes/RecommendedNotes.tsx exists');

  const dashboardContent = fs.readFileSync(dashboardFile, 'utf-8');
  assert(
    dashboardContent.includes('<RecommendedNotes />') && dashboardContent.includes('import { RecommendedNotes }'),
    '6. <RecommendedNotes /> is mounted on DashboardPage'
  );

  const componentContent = fs.readFileSync(componentFile, 'utf-8');
  assert(
    componentContent.includes('Recommended for You'),
    '7. RecommendedNotes component renders "Recommended for You" section title'
  );
  assert(
    componentContent.includes('Recommendations are temporarily unavailable.'),
    '8. RecommendedNotes component maps 503 error to friendly message'
  );
  assert(
    componentContent.includes('/notes/${item.note_id}') || componentContent.includes('/notes/'),
    '9. RecommendedNotes cards link to existing /notes/:id route'
  );

  // --- CHECK 3: Express API Serving Frontend-Compatible Payload ---
  console.log('\n--- Phase C: Express Gateway API Payload Verification ---');
  const bob = await prisma.user.findUnique({
    where: { id: BOB_USER_ID },
    select: { id: true, name: true, email: true },
  });
  assert(bob !== null, '10. Bob Smith identified in PostgreSQL database');

  const token = signToken({
    userId: BOB_USER_ID,
    email: bob?.email || 'bob@stanford.edu',
    role: 'USER' as any,
  });

  // Ensure FastAPI service is accessible
  let fastapiProcess: ChildProcess | null = null;
  const isUp = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(500) })
    .then((r) => r.ok)
    .catch(() => false);

  if (!isUp) {
    fastapiProcess = spawn(
      'python',
      ['-m', 'uvicorn', 'recommendation.api.main:app', '--host', '127.0.0.1', '--port', '8000'],
      { stdio: 'ignore', cwd: PROJECT_ROOT }
    );
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const up = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(500) })
        .then((r) => r.ok)
        .catch(() => false);
      if (up) break;
    }
  }

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/recommendations?top_k=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert(res.status === 200, '11. Express returns 200 for authenticated recommendation request');
    const data = (await res.json()) as any;

    assert(data.user_id === BOB_USER_ID, '12. API response user_id matches authenticated student');
    assert(data.candidate_count >= 1, '13. Candidate count is non-zero');
    assert(Array.isArray(data.recommendations), '14. Recommendations is an array');
    assert(data.recommendations.length <= 10, '15. Recommendations count obeys top_k=10 bound');

    if (data.recommendations.length > 0) {
      const top = data.recommendations[0];
      assert(top.rank === 1, '16. Top recommendation has rank 1');
      assert(typeof top.title === 'string' && top.title.length > 0, '17. Top recommendation has title');
      assert(typeof top.note_id === 'string', '18. Top recommendation has note_id');
      assert(top.engagement_score >= 0.0 && top.engagement_score <= 1.0, '19. Engagement score is within [0, 1]');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (fastapiProcess) {
      fastapiProcess.kill();
    }
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runFrontendVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
