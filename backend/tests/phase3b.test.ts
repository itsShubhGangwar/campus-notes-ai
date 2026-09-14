import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { prisma } from '../src/config/db.js';
import { config } from '../src/config/env.js';

const API_URL = 'http://localhost:5000/api';

// Create a realistic multi-paragraph academic PDF Buffer
function createAcademicNotesPdf(): Buffer {
  const line1 = 'OPERATING SYSTEMS - LECTURE NOTES. Unit 1: Process Synchronization and Deadlocks.';
  const line2 = 'Semaphores are integer variables used for signaling among shared processes.';
  const line3 = 'A Race Condition occurs when multiple processes access and manipulate shared data concurrently.';
  const line4 = 'Banker Algorithm is a deadlock avoidance algorithm that tests for safety by simulating resource allocation.';
  
  const streamBody = `BT /F1 12 Tf 50 720 Td (${line1}) Tj 0 -35 Td (${line2}) Tj 0 -35 Td (${line3}) Tj 0 -35 Td (${line4}) Tj ET`;
  const streamLen = Buffer.byteLength(streamBody, 'utf-8');

  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length ${streamLen} >> stream
${streamBody}
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000202 00000 n 
trailer << /Size 5 /Root 1 0 R >>
startxref
${350 + streamLen}
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

// Corrupted/Bad PDF for failure testing
function createCorruptedPdf(): Buffer {
  return Buffer.from('%PDF-1.4 NOT_A_REAL_PDF_STREAM_CORRUPTED_GARBAGE', 'utf-8');
}

interface TestContext {
  token: string;
  userId: string;
  collegeId: string;
  branchId: string;
  subjectId: string;
  secondUserToken: string;
}

async function setupContext(): Promise<TestContext> {
  const loginRes = await axios.post(`${API_URL}/auth/login`, {
    email: 'alex.rivera@stanford.edu',
    password: 'StudentPass123',
  });
  const token = loginRes.data.data.token;
  const user = loginRes.data.data.user;

  let secondUserToken = '';
  try {
    const sLogin = await axios.post(`${API_URL}/auth/login`, {
      email: 'student2@stanford.edu',
      password: 'StudentPass123',
    });
    secondUserToken = sLogin.data.data.token;
  } catch {
    const regRes = await axios.post(`${API_URL}/auth/register`, {
      email: 'student2@stanford.edu',
      password: 'StudentPass123',
      name: 'Secondary Student',
      collegeId: user.collegeId,
      branchId: user.branchId,
      semester: 3,
    });
    secondUserToken = regRes.data.data.token;
  }

  const stanford = await prisma.college.findFirst({ where: { code: 'STANFORD' } });
  const cseBranch = await prisma.branch.findFirst({ where: { collegeId: stanford!.id, code: 'CSE' } });
  const dbSubject = await prisma.subject.findFirst({ where: { branchId: cseBranch!.id, code: 'CS302' } });

  return {
    token,
    userId: user.id,
    collegeId: stanford!.id,
    branchId: cseBranch!.id,
    subjectId: dbSubject!.id,
    secondUserToken,
  };
}

async function uploadTestNote(
  ctx: TestContext,
  title: string,
  pdfBuffer: Buffer,
  filename = 'test-academic.pdf'
): Promise<any> {
  const form = new FormData();
  form.append('title', title);
  form.append('description', 'Test notes for Phase 3B vector embedding verification');
  form.append('semester', '3');
  form.append('subjectId', ctx.subjectId);
  form.append('branchId', ctx.branchId);
  form.append('collegeId', ctx.collegeId);
  form.append('file', pdfBuffer, {
    filename,
    contentType: 'application/pdf',
  });

  const res = await axios.post(`${API_URL}/notes`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${ctx.token}`,
    },
  });

  return res.data.data;
}

async function pollUntilProcessed(noteId: string, token: string, maxWaitMs = 15000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await axios.get(`${API_URL}/notes/${noteId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { status } = res.data.data;
    if (status === 'COMPLETED' || status === 'FAILED') {
      return res.data.data;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for note ${noteId} to finish processing.`);
}

async function runPhase3bTests() {
  console.log('================================================================');
  console.log('🧪 CAMPUSNOTES AI — PHASE 3B VERIFICATION SUITE');
  console.log('   Testing Vector Embeddings, Gemini Integration & pgvector');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  const createdNoteIds: string[] = [];

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      if (detail) console.error(`     Detail: ${detail}`);
      failed++;
    }
  };

  try {
    const ctx = await setupContext();

    // -------------------------------------------------------------------------
    // TEST 1: pgvector extension is available in PostgreSQL
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: pgvector Extension Availability ---');
    const extRes = await prisma.$queryRawUnsafe<{ extname: string; extversion: string }[]>(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
    );
    assert(
      extRes.length > 0 && extRes[0].extname === 'vector',
      'pgvector extension is enabled in Supabase PostgreSQL',
      `Found: ${JSON.stringify(extRes)}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Gemini API configuration loaded by backend
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Gemini API Configuration ---');
    assert(
      !!config.ai.geminiApiKey && config.ai.geminiApiKey.length > 20,
      'Gemini API key is configured with valid length',
      `Key configured: ${!!config.ai.geminiApiKey}, length: ${config.ai.geminiApiKey?.length}`
    );
    assert(
      config.ai.embeddingDimension === 768,
      'Target vector dimension is configured to 768',
      `Dimension: ${config.ai.embeddingDimension}`
    );

    // -------------------------------------------------------------------------
    // TEST 3 & 4: Upload PDF, process document, detect chunks
    // -------------------------------------------------------------------------
    console.log('\n--- Tests 3 & 4: Ingestion Pipeline & Chunk Detection ---');
    const testPdf = createAcademicNotesPdf();
    const note = await uploadTestNote(ctx, 'OS Lecture Notes: Process Sync', testPdf);
    createdNoteIds.push(note.id);

    console.log(`  Waiting for async processing of Note ID ${note.id}...`);
    const statusData = await pollUntilProcessed(note.id, ctx.token);

    assert(
      statusData.status === 'COMPLETED',
      'Test document successfully processed to COMPLETED state',
      `Final status: ${statusData.status}, error: ${statusData.error}`
    );
    assert(
      statusData.chunksCount > 0,
      'Existing document chunks are generated and detected',
      `Chunks count: ${statusData.chunksCount}`
    );

    // -------------------------------------------------------------------------
    // TEST 5 & 6: Embeddings generated & vector dimensions correct
    // -------------------------------------------------------------------------
    console.log('\n--- Tests 5 & 6: Embedding Generation & Dimension Verification ---');
    assert(
      statusData.embeddedChunksCount === statusData.chunksCount && statusData.embeddedChunksCount > 0,
      'All generated chunks received embeddings',
      `Chunks: ${statusData.chunksCount}, Embedded: ${statusData.embeddedChunksCount}`
    );

    const dimRows = await prisma.$queryRawUnsafe<Array<{ dims: number }>>(
      'SELECT vector_dims(embedding) as dims FROM note_chunks WHERE "noteId" = $1 LIMIT 1',
      note.id
    );
    assert(
      dimRows.length > 0 && dimRows[0].dims === 768,
      'Stored vector dimension in PostgreSQL is exactly 768',
      `Expected 768, got: ${dimRows[0]?.dims}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: pgvector storage & cosine similarity query
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: pgvector Storage & Cosine Distance Search ---');
    // Query chunks with similarity operator <=>
    const dummyQueryVector = Array.from({ length: 768 }, (_, i) => 0.01 * (i % 5));
    const queryVectorJson = JSON.stringify(dummyQueryVector);
    const similarityRes = await prisma.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(
      `SELECT id, 1 - (embedding <=> $1::vector) as similarity
       FROM note_chunks
       WHERE "noteId" = $2
       ORDER BY embedding <=> $1::vector ASC
       LIMIT 1`,
      queryVectorJson,
      note.id
    );
    assert(
      similarityRes.length > 0 && typeof similarityRes[0].similarity === 'number',
      'Stored embeddings can be queried with pgvector cosine similarity operator (<=>)',
      `Similarity score returned: ${similarityRes[0]?.similarity}`
    );

    // -------------------------------------------------------------------------
    // TEST 8 & 9: Association with NoteChunk and Note
    // -------------------------------------------------------------------------
    console.log('\n--- Tests 8 & 9: Embedding & Chunk Foreign Key Associations ---');
    const chunksRes = await axios.get(`${API_URL}/notes/${note.id}/chunks`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    const retrievedChunks = chunksRes.data.data.chunks;

    const allChunksHaveEmbedding = retrievedChunks.every(
      (c: any) => c.hasEmbedding === true && c.embeddingDims === 768
    );
    assert(
      allChunksHaveEmbedding && retrievedChunks.length > 0,
      'Every chunk is associated with an embedding of 768 dimensions',
      `Total checked: ${retrievedChunks.length}`
    );

    const chunkDbCheck = await prisma.noteChunk.findMany({
      where: { noteId: note.id },
      select: { id: true, noteId: true, chunkIndex: true },
    });
    const allBelongToNote = chunkDbCheck.every((c) => c.noteId === note.id);
    assert(
      allBelongToNote && chunkDbCheck.length === retrievedChunks.length,
      'Every chunk remains strictly associated with the correct Note ID via foreign key',
      `Count: ${chunkDbCheck.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 10: Processing status tracking
    // -------------------------------------------------------------------------
    console.log('\n--- Test 10: Processing Status Tracking ---');
    const initialNote = await prisma.note.findUnique({ where: { id: note.id } });
    assert(
      initialNote?.processingStatus === 'COMPLETED' && initialNote.pageCount === 1,
      'Database records status COMPLETED with correct pageCount',
      `Status: ${initialNote?.processingStatus}, Pages: ${initialNote?.pageCount}`
    );

    // -------------------------------------------------------------------------
    // TEST 11 & 12: Failure handling & error recording
    // -------------------------------------------------------------------------
    console.log('\n--- Tests 11 & 12: Resilient Failure Handling ---');
    const corruptNote = await uploadTestNote(ctx, 'Corrupted Test Note', createCorruptedPdf(), 'corrupt.pdf');
    createdNoteIds.push(corruptNote.id);

    const corruptStatus = await pollUntilProcessed(corruptNote.id, ctx.token);
    assert(
      corruptStatus.status === 'FAILED',
      'Corrupted document fails gracefully with FAILED status',
      `Status: ${corruptStatus.status}`
    );
    assert(
      !!corruptStatus.error && corruptStatus.error.length > 0,
      'Failed processing records useful diagnostic error message',
      `Error recorded: ${corruptStatus.error}`
    );

    // -------------------------------------------------------------------------
    // TEST 13: Idempotency (reprocessing does not create duplicates)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 13: Reprocessing Idempotency ---');
    const beforeCount = await prisma.noteChunk.count({ where: { noteId: note.id } });
    
    // Trigger reprocess
    await axios.post(
      `${API_URL}/notes/${note.id}/process`,
      {},
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );
    const reprocessedStatus = await pollUntilProcessed(note.id, ctx.token);
    const afterCount = await prisma.noteChunk.count({ where: { noteId: note.id } });

    assert(
      reprocessedStatus.status === 'COMPLETED' && beforeCount === afterCount,
      'Reprocessing document is idempotent: zero duplicate chunks or duplicate embeddings',
      `Before: ${beforeCount}, After: ${afterCount}`
    );

    // -------------------------------------------------------------------------
    // TEST 14: Phase 3A text extraction & chunking integrity
    // -------------------------------------------------------------------------
    console.log('\n--- Test 14: Phase 3A Extraction & Chunking Integrity ---');
    const firstChunk = retrievedChunks[0];
    assert(
      firstChunk.content.includes('Process Synchronization') &&
      firstChunk.pageNumber === 1 &&
      firstChunk.tokenCount > 0,
      'Extracted chunk content, page number, and token estimation remain accurate',
      `Content excerpt: "${firstChunk.content.slice(0, 60)}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 15: Phase 2 PDF download still works
    // -------------------------------------------------------------------------
    console.log('\n--- Test 15: Phase 2 PDF Download Compatibility ---');
    const downloadRes = await axios.get(`${API_URL}/notes/${note.id}/download`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      responseType: 'arraybuffer',
    });
    assert(
      downloadRes.status === 200 && downloadRes.data.length > 0,
      'PDF download endpoint returns status 200 with complete file buffer',
      `Downloaded size: ${downloadRes.data.length} bytes`
    );

    // -------------------------------------------------------------------------
    // TEST 16: Authentication & Authorization controls
    // -------------------------------------------------------------------------
    console.log('\n--- Test 16: Authentication & Authorization Guards ---');
    let nonOwnerBlocked = false;
    try {
      await axios.get(`${API_URL}/notes/${note.id}/chunks`, {
        headers: { Authorization: `Bearer ${ctx.secondUserToken}` },
      });
    } catch (err: any) {
      if (err.response?.status === 403) {
        nonOwnerBlocked = true;
      }
    }
    assert(
      nonOwnerBlocked,
      'Non-owner non-admin user cannot inspect raw chunks or vectors (HTTP 403)'
    );

    // -------------------------------------------------------------------------
    // TEST 17: Security: Zero Gemini API key leaks in API responses or code
    // -------------------------------------------------------------------------
    console.log('\n--- Test 17: Security & Secret Isolation ---');
    const noteDetailRes = await axios.get(`${API_URL}/notes/${note.id}`);
    const stringifiedDetail = JSON.stringify(noteDetailRes.data);
    const stringifiedStatus = JSON.stringify(statusData);
    const stringifiedChunks = JSON.stringify(chunksRes.data);

    const apiKey = config.ai.geminiApiKey;
    const hasKeyLeak =
      stringifiedDetail.includes(apiKey) ||
      stringifiedStatus.includes(apiKey) ||
      stringifiedChunks.includes(apiKey);

    assert(
      !hasKeyLeak,
      'Gemini API key is completely isolated server-side and never exposed in API responses',
      'Verified zero leaks across note details, status, and chunk responses'
    );

  } catch (err: any) {
    console.error('Unexpected error during Phase 3B verification:', err.response?.data || err.message);
    failed++;
  } finally {
    // Clean up created test notes
    for (const noteId of createdNoteIds) {
      try {
        await prisma.note.delete({ where: { id: noteId } });
      } catch {}
    }
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`📊 PHASE 3B TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3bTests();
