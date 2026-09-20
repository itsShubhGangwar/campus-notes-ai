/**
 * CampusNotes AI — End-to-End Express -> FastAPI Integration Test
 * ==============================================================
 *
 * Module: backend/tests/recommendation.integration.test.ts
 * Purpose: Tests the full end-to-end integration:
 *          Client -> Express -> FastAPI (port 8000) -> PostgreSQL -> LightGBM -> Express -> Client.
 */

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/db.js';
import { signToken } from '../src/utils/jwt.js';

const BOB_USER_ID = 'da3250c0-80b1-46ca-b682-a94b5c5132f3'; // Bob Smith

async function runIntegrationTest() {
  console.log('================================================================');
  console.log('🧪 CAMPUSNOTES AI — LIVE END-TO-END RECOMMENDATION INTEGRATION');
  console.log('   Express -> FastAPI -> PostgreSQL/Supabase -> LightGBM');
  console.log('================================================================\n');

  // Verify Bob Smith exists in DB
  const bob = await prisma.user.findUnique({
    where: { id: BOB_USER_ID },
    select: { id: true, name: true, email: true, semester: true },
  });

  if (!bob) {
    console.error(`Fatal: Bob Smith (${BOB_USER_ID}) not found in PostgreSQL database!`);
    process.exit(1);
  }

  console.log(`  Identified test student: ${bob.name} (${bob.id}, Semester ${bob.semester})`);

  // Sign authoritative JWT for Bob Smith
  const token = signToken({
    userId: bob.id,
    email: bob.email,
    role: 'USER' as any,
  });

  // Start Express on an ephemeral port
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    server.on('listening', () => resolve());
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Express test instance running on ${baseUrl}\n`);

  try {
    console.log('  Dispatching: GET /api/recommendations?top_k=10 with Bob Smith JWT...');
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/api/recommendations?top_k=10`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const elapsed = Date.now() - t0;

    console.log(`  Response Status: ${res.status} (${elapsed} ms)`);
    if (res.status !== 200) {
      const errBody = await res.text();
      console.error('  Failed to get recommendations from Express:', errBody);
      process.exit(1);
    }

    const data = (await res.json()) as any;
    console.log(`  User ID: ${data.user_id}`);
    console.log(`  Model Version: ${data.model_version}`);
    console.log(`  Candidate Count: ${data.candidate_count}`);
    console.log(`  Recommendation Count: ${data.recommendation_count}`);
    console.log('\n  Top 5 Ranked Recommendations:');
    for (const item of (data.recommendations || []).slice(0, 5)) {
      console.log(`    Rank ${item.rank}: "${item.title}" (Score: ${item.engagement_score}, Subject: ${item.subject_id}, Sem: ${item.semester})`);
    }

    if (data.user_id !== BOB_USER_ID) {
      console.error('  FAIL: Returned user_id does not match Bob Smith!');
      process.exit(1);
    }

    if (!Array.isArray(data.recommendations) || data.recommendations.length === 0) {
      console.error('  FAIL: No recommendations returned!');
      process.exit(1);
    }

    console.log('\n✅ LIVE END-TO-END INTEGRATION TEST PASSED SUCCESSFULLY!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runIntegrationTest().catch((err) => {
  console.error('Fatal integration test error:', err);
  process.exit(1);
});
