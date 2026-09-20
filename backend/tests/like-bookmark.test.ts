import axios from 'axios';
import { prisma } from '../src/config/db.js';

const API_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 CAMPUSNOTES AI — PHASE 2 STEP 2 VERIFICATION SUITE');
  console.log('   Testing Like & Bookmark Interactions, Atomicity & Isolation');
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
    console.log('--- Setting Up Test Users ---');
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
      select: { id: true, title: true, likesCount: true, bookmarksCount: true },
    });

    if (!publishedNote) {
      throw new Error('No published note available for testing');
    }

    const noteId = publishedNote.id;
    console.log(`  Target Note: "${publishedNote.title}" (ID: ${noteId})`);

    // Clean up baseline interactions for these users on target note
    await prisma.like.deleteMany({ where: { noteId, userId: { in: [userA.id, userB.id] } } });
    await prisma.bookmark.deleteMany({ where: { noteId, userId: { in: [userA.id, userB.id] } } });

    // Sync baseline counts in Note record
    const [actualLikes, actualBookmarks] = await Promise.all([
      prisma.like.count({ where: { noteId } }),
      prisma.bookmark.count({ where: { noteId } }),
    ]);
    await prisma.note.update({
      where: { id: noteId },
      data: { likesCount: actualLikes, bookmarksCount: actualBookmarks },
    });

    const baselineNote = await prisma.note.findUnique({ where: { id: noteId } });
    const baselineLikes = baselineNote?.likesCount || 0;
    const baselineBookmarks = baselineNote?.bookmarksCount || 0;
    console.log(`  Baseline: ${baselineLikes} Likes, ${baselineBookmarks} Bookmarks\n`);

    // -------------------------------------------------------------------------
    // TEST A & D: Authenticated User Can Like Note & Increment likesCount
    // -------------------------------------------------------------------------
    console.log('--- Test A & D: Like Note & likesCount Synchronization ---');
    const likeResA = await axios.post(
      `${API_URL}/notes/${noteId}/like`,
      {},
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );

    assert(
      likeResA.status === 201 && likeResA.data.data.isLiked === true,
      'Authenticated User A successfully liked published note (HTTP 201)'
    );

    const noteAfterLike = await prisma.note.findUnique({ where: { id: noteId } });
    const likeRowsA = await prisma.like.count({ where: { noteId, userId: userA.id } });

    assert(
      noteAfterLike?.likesCount === baselineLikes + 1 && likeRowsA === 1,
      'likesCount accurately incremented by 1 and Like record persisted in PostgreSQL',
      `likesCount: ${baselineLikes} → ${noteAfterLike?.likesCount}, DB Rows: ${likeRowsA}`
    );

    // -------------------------------------------------------------------------
    // TEST B: Repeated Like Does Not Create Duplicate Rows (Idempotency)
    // -------------------------------------------------------------------------
    console.log('\n--- Test B: Repeated Like Request Idempotency ---');
    const repeatLikeRes = await axios.post(
      `${API_URL}/notes/${noteId}/like`,
      {},
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );

    const noteAfterRepeatLike = await prisma.note.findUnique({ where: { id: noteId } });
    const likeRowsAfterRepeat = await prisma.like.count({ where: { noteId, userId: userA.id } });

    assert(
      repeatLikeRes.data.data.isLiked === true &&
        likeRowsAfterRepeat === 1 &&
        noteAfterRepeatLike?.likesCount === baselineLikes + 1,
      'Repeated like request does NOT create duplicate Like rows or inflate likesCount',
      `DB Rows: ${likeRowsAfterRepeat}, likesCount: ${noteAfterRepeatLike?.likesCount}`
    );

    // -------------------------------------------------------------------------
    // TEST C & D: User Can Unlike Note & Decrement likesCount
    // -------------------------------------------------------------------------
    console.log('\n--- Test C & D: Unlike Note & likesCount Restoration ---');
    const unlikeRes = await axios.delete(`${API_URL}/notes/${noteId}/like`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert(
      unlikeRes.status === 200 && unlikeRes.data.data.isLiked === false,
      'User A successfully unliked note (HTTP 200)'
    );

    const noteAfterUnlike = await prisma.note.findUnique({ where: { id: noteId } });
    const likeRowsAfterUnlike = await prisma.like.count({ where: { noteId, userId: userA.id } });

    assert(
      noteAfterUnlike?.likesCount === baselineLikes && likeRowsAfterUnlike === 0,
      'likesCount accurately decremented and Like row deleted from PostgreSQL',
      `likesCount restored to: ${noteAfterUnlike?.likesCount}, DB Rows: ${likeRowsAfterUnlike}`
    );

    // -------------------------------------------------------------------------
    // TEST E & H: Authenticated User Can Bookmark Note & Increment bookmarksCount
    // -------------------------------------------------------------------------
    console.log('\n--- Test E & H: Bookmark Note & bookmarksCount Synchronization ---');
    const bookmarkResA = await axios.post(
      `${API_URL}/notes/${noteId}/bookmark`,
      {},
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );

    assert(
      bookmarkResA.status === 201 && bookmarkResA.data.data.isBookmarked === true,
      'Authenticated User A successfully bookmarked note (HTTP 201)'
    );

    const noteAfterBookmark = await prisma.note.findUnique({ where: { id: noteId } });
    const bookmarkRowsA = await prisma.bookmark.count({ where: { noteId, userId: userA.id } });

    assert(
      noteAfterBookmark?.bookmarksCount === baselineBookmarks + 1 && bookmarkRowsA === 1,
      'bookmarksCount accurately incremented by 1 and Bookmark record persisted in PostgreSQL',
      `bookmarksCount: ${baselineBookmarks} → ${noteAfterBookmark?.bookmarksCount}, DB Rows: ${bookmarkRowsA}`
    );

    // -------------------------------------------------------------------------
    // TEST F: Repeated Bookmark Idempotency
    // -------------------------------------------------------------------------
    console.log('\n--- Test F: Repeated Bookmark Request Idempotency ---');
    const repeatBookmarkRes = await axios.post(
      `${API_URL}/notes/${noteId}/bookmark`,
      {},
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );

    const noteAfterRepeatBookmark = await prisma.note.findUnique({ where: { id: noteId } });
    const bookmarkRowsAfterRepeat = await prisma.bookmark.count({ where: { noteId, userId: userA.id } });

    assert(
      repeatBookmarkRes.data.data.isBookmarked === true &&
        bookmarkRowsAfterRepeat === 1 &&
        noteAfterRepeatBookmark?.bookmarksCount === baselineBookmarks + 1,
      'Repeated bookmark request does NOT create duplicate Bookmark rows or inflate bookmarksCount',
      `DB Rows: ${bookmarkRowsAfterRepeat}, bookmarksCount: ${noteAfterRepeatBookmark?.bookmarksCount}`
    );

    // -------------------------------------------------------------------------
    // TEST G & H: User Can Remove Bookmark & Decrement bookmarksCount
    // -------------------------------------------------------------------------
    console.log('\n--- Test G & H: Remove Bookmark & bookmarksCount Restoration ---');
    const unbookmarkRes = await axios.delete(`${API_URL}/notes/${noteId}/bookmark`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert(
      unbookmarkRes.status === 200 && unbookmarkRes.data.data.isBookmarked === false,
      'User A successfully removed bookmark (HTTP 200)'
    );

    const noteAfterUnbookmark = await prisma.note.findUnique({ where: { id: noteId } });
    const bookmarkRowsAfterUnbookmark = await prisma.bookmark.count({ where: { noteId, userId: userA.id } });

    assert(
      noteAfterUnbookmark?.bookmarksCount === baselineBookmarks && bookmarkRowsAfterUnbookmark === 0,
      'bookmarksCount accurately decremented and Bookmark row deleted from PostgreSQL',
      `bookmarksCount restored to: ${noteAfterUnbookmark?.bookmarksCount}, DB Rows: ${bookmarkRowsAfterUnbookmark}`
    );

    // -------------------------------------------------------------------------
    // TEST I: User Isolation (User A cannot modify User B's interactions)
    // -------------------------------------------------------------------------
    console.log('\n--- Test I: User Isolation & Cross-User Protection ---');
    // User B likes and bookmarks note
    await axios.post(`${API_URL}/notes/${noteId}/like`, {}, { headers: { Authorization: `Bearer ${tokenB}` } });
    await axios.post(`${API_URL}/notes/${noteId}/bookmark`, {}, { headers: { Authorization: `Bearer ${tokenB}` } });

    // User A attempts to unlike / unbookmark User B's records
    const userAUnlikeAttempt = await axios.delete(`${API_URL}/notes/${noteId}/like`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const userAUnbookmarkAttempt = await axios.delete(`${API_URL}/notes/${noteId}/bookmark`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    const userBLikeCheck = await prisma.like.findUnique({
      where: { userId_noteId: { userId: userB.id, noteId } },
    });
    const userBBookmarkCheck = await prisma.bookmark.findUnique({
      where: { userId_noteId: { userId: userB.id, noteId } },
    });

    assert(
      userBLikeCheck !== null && userBBookmarkCheck !== null,
      'User A requests strictly operate within User A scope; User B records remain intact',
      `User B Like exists: ${!!userBLikeCheck} | User B Bookmark exists: ${!!userBBookmarkCheck}`
    );

    // Clean up User B
    await axios.delete(`${API_URL}/notes/${noteId}/like`, { headers: { Authorization: `Bearer ${tokenB}` } });
    await axios.delete(`${API_URL}/notes/${noteId}/bookmark`, { headers: { Authorization: `Bearer ${tokenB}` } });

    // -------------------------------------------------------------------------
    // TEST J: Unauthorized / Private Note Protection
    // -------------------------------------------------------------------------
    console.log('\n--- Test J: Private Note Security Guard ---');
    const fullUserA = await prisma.user.findUnique({
      where: { id: userA.id },
      include: { college: true, branch: true },
    });
    const subject = await prisma.subject.findFirst({
      where: { branchId: fullUserA?.branchId || undefined },
    });

    const privateNote = await prisma.note.create({
      data: {
        title: 'Secret Study Outline',
        uploaderId: userA.id,
        collegeId: fullUserA!.collegeId!,
        branchId: fullUserA!.branchId!,
        semester: 4,
        subjectId: subject!.id,
        fileUrl: 'http://localhost:5000/private.pdf',
        fileKey: 'notes/test/private.pdf',
        fileName: 'private.pdf',
        fileSize: 1024,
        isPublished: false,
      },
    });

    let likePrivateBlocked = false;
    let bookmarkPrivateBlocked = false;

    try {
      await axios.post(
        `${API_URL}/notes/${privateNote.id}/like`,
        {},
        { headers: { Authorization: `Bearer ${tokenB}` } }
      );
    } catch (err: any) {
      if (err.response?.status === 403) likePrivateBlocked = true;
    }

    try {
      await axios.post(
        `${API_URL}/notes/${privateNote.id}/bookmark`,
        {},
        { headers: { Authorization: `Bearer ${tokenB}` } }
      );
    } catch (err: any) {
      if (err.response?.status === 403) bookmarkPrivateBlocked = true;
    }

    assert(
      likePrivateBlocked && bookmarkPrivateBlocked,
      'Unauthorized like and bookmark attempts on private note blocked with HTTP 403',
      `Like Blocked: ${likePrivateBlocked} | Bookmark Blocked: ${bookmarkPrivateBlocked}`
    );

    await prisma.note.delete({ where: { id: privateNote.id } });

    // -------------------------------------------------------------------------
    // TEST K & L: Existing NoteView & Download Non-Regression
    // -------------------------------------------------------------------------
    console.log('\n--- Test K & L: NoteView & Download Non-Regression Check ---');
    // Test NoteView creation on detail access
    const viewRes = await axios.get(`${API_URL}/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    assert(
      viewRes.status === 200 &&
        typeof viewRes.data.data.viewsCount === 'number' &&
        typeof viewRes.data.data.isLiked === 'boolean' &&
        typeof viewRes.data.data.isBookmarked === 'boolean',
      'GET /notes/:id returns full state including isLiked, isBookmarked, viewsCount',
      `isLiked: ${viewRes.data.data.isLiked}, isBookmarked: ${viewRes.data.data.isBookmarked}`
    );

    // Test Download endpoint
    const dlRes = await axios.get(`${API_URL}/notes/${noteId}/download`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      responseType: 'arraybuffer',
    });

    assert(
      dlRes.status === 200 && dlRes.data.length > 0,
      'Download endpoint continues streaming PDF attachment and tracking downloads',
      `Downloaded bytes: ${dlRes.data.length}`
    );

    // -------------------------------------------------------------------------
    // TEST M: Existing RAG / Ollama Non-Regression
    // -------------------------------------------------------------------------
    console.log('\n--- Test M: RAG / Ollama Chatbot Non-Regression Check ---');
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
      'RAG Chatbot remains fully operational and grounded',
      `Answer: "${ragRes.data.data.answer.slice(0, 60)}..."`
    );

  } catch (error: any) {
    console.error('Fatal test error:', error.response?.data || error.message);
    failed++;
  } finally {
    console.log('\n================================================================');
    console.log(`📊 PHASE 2 STEP 2 SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('================================================================\n');
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
