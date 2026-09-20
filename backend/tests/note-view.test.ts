import axios from 'axios';
import { prisma } from '../src/config/db.js';

const API_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 CAMPUSNOTES AI — PHASE 2 STEP 1 VERIFICATION SUITE');
  console.log('   Testing Per-User Note View Tracking, Authorization & Debounce');
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

  try {
    // 1. Setup authenticated test users
    console.log('--- Setting Up Test Environment ---');
    const userARes = await axios.post(`${API_URL}/auth/login`, {
      email: 'alex.rivera@stanford.edu',
      password: 'StudentPass123',
    });
    const tokenA = userARes.data.data.token;
    const userA = userARes.data.data.user;

    const userBRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'student2@stanford.edu',
      password: 'StudentPass123',
    });
    const tokenB = userBRes.data.data.token;
    const userB = userBRes.data.data.user;

    console.log(`  User A: ${userA.name} (${userA.id})`);
    console.log(`  User B: ${userB.name} (${userB.id})`);

    // Pick a published note
    const publishedNote = await prisma.note.findFirst({
      where: { isPublished: true, processingStatus: 'COMPLETED' },
      select: { id: true, title: true, viewsCount: true },
    });

    if (!publishedNote) {
      throw new Error('No published note available for testing');
    }

    const noteId = publishedNote.id;
    console.log(`  Target Note: "${publishedNote.title}" (ID: ${noteId})`);

    // Clean up any previous test views for this note and users to have clean baseline
    await prisma.noteView.deleteMany({
      where: {
        noteId,
        userId: { in: [userA.id, userB.id] },
      },
    });

    // -------------------------------------------------------------------------
    // TEST 1: Database Migration & Model Readiness
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: Database Migration & Schema Readiness ---');
    const noteViewsCountBefore = await prisma.noteView.count();
    assert(
      typeof noteViewsCountBefore === 'number',
      'NoteView table exists and is queryable via Prisma Client',
      `Current total note_views in DB: ${noteViewsCountBefore}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Unauthenticated Note Access (Public Behavior Intact)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Unauthenticated Access & View Counter Increment ---');
    const initialNoteViews = await prisma.noteView.count({ where: { noteId } });
    const initialNoteState = await prisma.note.findUnique({
      where: { id: noteId },
      select: { viewsCount: true },
    });
    const initialViewsCount = initialNoteState?.viewsCount || 0;

    const unauthRes = await axios.get(`${API_URL}/notes/${noteId}`);
    assert(
      unauthRes.status === 200 && unauthRes.data.success === true,
      'Unauthenticated user can successfully view published note (HTTP 200)'
    );

    const noteAfterUnauth = await prisma.note.findUnique({
      where: { id: noteId },
      select: { viewsCount: true },
    });
    const unauthViewsInDb = await prisma.noteView.count({
      where: { noteId },
    });

    assert(
      (noteAfterUnauth?.viewsCount || 0) === initialViewsCount + 1,
      'Global viewsCount successfully incremented for unauthenticated view',
      `Views before: ${initialViewsCount} → Views after: ${noteAfterUnauth?.viewsCount}`
    );

    assert(
      unauthViewsInDb === initialNoteViews,
      'Unauthenticated access did NOT create a NoteView activity record (Clean telemetry)',
      `NoteView count for note before: ${initialNoteViews} → after: ${unauthViewsInDb}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Authenticated User Viewing Note Creates NoteView Record
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Authenticated User View Tracking ---');
    const authRes = await axios.get(`${API_URL}/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert(
      authRes.status === 200 && authRes.data.data.id === noteId,
      'Authenticated user successfully viewed published note'
    );

    const userAViews = await prisma.noteView.findMany({
      where: { userId: userA.id, noteId },
    });

    assert(
      userAViews.length === 1,
      'NoteView record successfully created for authenticated user',
      `Created View ID: ${userAViews[0]?.id}, Timestamp: ${userAViews[0]?.createdAt.toISOString()}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Accidental Rapid Duplicate View Prevention (Debounce Window)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Duplicate View Handling (Rapid Burst Deduplication) ---');
    // Rapid duplicate request immediately (< 1 sec)
    await axios.get(`${API_URL}/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    const userAViewsAfterBurst = await prisma.noteView.findMany({
      where: { userId: userA.id, noteId },
    });

    assert(
      userAViewsAfterBurst.length === 1,
      'Rapid consecutive view within 5s debounce window ignored to prevent duplicate telemetry',
      `User A View records: ${userAViewsAfterBurst.length} (deduplicated)`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Legitimate Repeat View Recorded After Cooldown
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Legitimate Repeat View Tracking ---');
    console.log('  Waiting 5.5s for legitimate session cooldown...');
    await new Promise((resolve) => setTimeout(resolve, 5500));

    await axios.get(`${API_URL}/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    const userAViewsAfterCooldown = await prisma.noteView.findMany({
      where: { userId: userA.id, noteId },
      orderBy: { createdAt: 'asc' },
    });

    assert(
      userAViewsAfterCooldown.length === 2,
      'Legitimate repeat view after cooldown successfully recorded as separate event',
      `Total views by User A: ${userAViewsAfterCooldown.length} | First: ${userAViewsAfterCooldown[0]?.createdAt.toISOString().slice(11, 19)} | Second: ${userAViewsAfterCooldown[1]?.createdAt.toISOString().slice(11, 19)}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Distinct User Activity Tracking (User B)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Multi-User Independent View Tracking ---');
    await axios.get(`${API_URL}/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    const userBViews = await prisma.noteView.findMany({
      where: { userId: userB.id, noteId },
    });

    assert(
      userBViews.length === 1,
      'User B view recorded independently with User B ID',
      `User B View ID: ${userBViews[0]?.id}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Private / Unpublished Note Authorization & Zero Leakage
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Private Unpublished Note Authorization Guard ---');
    // Get user A's college and branch
    const fullUserA = await prisma.user.findUnique({
      where: { id: userA.id },
      include: { college: true, branch: true },
    });

    const subject = await prisma.subject.findFirst({
      where: { branchId: fullUserA?.branchId || undefined },
    });

    // Create an unpublished note owned by User A
    const privateNote = await prisma.note.create({
      data: {
        title: 'Confidential Exam Review Notes',
        uploaderId: userA.id,
        collegeId: fullUserA!.collegeId!,
        branchId: fullUserA!.branchId!,
        semester: 4,
        subjectId: subject!.id,
        fileUrl: 'http://localhost:5000/mock.pdf',
        fileKey: 'notes/test/private.pdf',
        fileName: 'private.pdf',
        fileSize: 1024,
        isPublished: false,
      },
    });

    // User B tries to view User A's private note
    let privateBlocked = false;
    try {
      await axios.get(`${API_URL}/notes/${privateNote.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
    } catch (err: any) {
      if (err.response?.status === 403) {
        privateBlocked = true;
      }
    }

    const privateNoteViews = await prisma.noteView.count({
      where: { noteId: privateNote.id },
    });

    assert(
      privateBlocked && privateNoteViews === 0,
      'Unauthorized access to private note blocked with HTTP 403 and zero NoteView created',
      `HTTP Status: 403 Forbidden | NoteViews created: ${privateNoteViews}`
    );

    // Clean up private test note
    await prisma.note.delete({ where: { id: privateNote.id } });

    // -------------------------------------------------------------------------
    // TEST 8: RAG & Chatbot Non-Regression Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: RAG & Chatbot Non-Regression Check ---');
    const ragRes = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'What is a process?',
        noteId,
      },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );

    assert(
      ragRes.status === 200 &&
        ragRes.data.success === true &&
        ragRes.data.data.answer.length > 10,
      'Existing RAG Chatbot remains fully operational and unaffected',
      `Answer excerpt: "${ragRes.data.data.answer.slice(0, 60)}..."`
    );

  } catch (error: any) {
    console.error('Fatal test runner error:', error.response?.data || error.message);
    failed++;
  } finally {
    console.log('\n================================================================');
    console.log(`📊 PHASE 2 STEP 1 SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('================================================================\n');
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
