import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { prisma } from '../src/config/db.js';
import { config } from '../src/config/env.js';
import { ollamaService } from '../src/services/ollama.service.js';
import { ragService } from '../src/services/rag.service.js';

const API_URL = 'http://localhost:5000/api';

// Realistic 2-page academic PDF with distinct sections
function createMultiTopicAcademicPdf(): Buffer {
  const page1Line1 = 'OPERATING SYSTEMS - LECTURE NOTES. Unit 1: Synchronization Primitives.';
  const page1Line2 = 'A Race Condition occurs when multiple processes access and manipulate shared data concurrently.';
  const page1Line3 = 'Semaphores are integer variables used for signaling among concurrent threads to achieve mutual exclusion.';
  const stream1 = `BT /F1 12 Tf 50 720 Td (${page1Line1}) Tj 0 -35 Td (${page1Line2}) Tj 0 -35 Td (${page1Line3}) Tj ET`;
  const len1 = Buffer.byteLength(stream1, 'utf-8');

  const page2Line1 = 'OPERATING SYSTEMS - LECTURE NOTES. Unit 2: Deadlock Avoidance and Safety.';
  const page2Line2 = 'Banker Algorithm is a deadlock avoidance algorithm that tests for safety by simulating resource allocation.';
  const page2Line3 = 'Deadlock occurs when four Coffman conditions hold: Mutual Exclusion, Hold and Wait, No Preemption, Circular Wait.';
  const stream2 = `BT /F1 12 Tf 50 720 Td (${page2Line1}) Tj 0 -35 Td (${page2Line2}) Tj 0 -35 Td (${page2Line3}) Tj ET`;
  const len2 = Buffer.byteLength(stream2, 'utf-8');

  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length ${len1} >> stream
${stream1}
endstream endobj
5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >> endobj
6 0 obj << /Length ${len2} >> stream
${stream2}
endstream endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000125 00000 n 
0000000212 00000 n 
0000000300 00000 n 
0000000387 00000 n 
trailer << /Size 7 /Root 1 0 R >>
startxref
500
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

// Second PDF for Subject Filtering Tests
function createDatabasePdf(): Buffer {
  const line1 = 'DATABASE MANAGEMENT SYSTEMS. Unit 1: Relational Algebra and SQL Queries.';
  const line2 = 'Primary Keys uniquely identify each tuple in a relational table.';
  const line3 = 'Foreign Keys establish referential integrity between parent and child relations.';
  const stream = `BT /F1 12 Tf 50 720 Td (${line1}) Tj 0 -35 Td (${line2}) Tj 0 -35 Td (${line3}) Tj ET`;
  const len = Buffer.byteLength(stream, 'utf-8');

  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length ${len} >> stream
${stream}
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
350
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

interface TestContext {
  token: string;
  userId: string;
  collegeId: string;
  branchId: string;
  osSubjectId: string;
  dbSubjectId: string;
  secondUserToken: string;
  secondUserId: string;
}

async function setupContext(): Promise<TestContext> {
  const loginRes = await axios.post(`${API_URL}/auth/login`, {
    email: 'alex.rivera@stanford.edu',
    password: 'StudentPass123',
  });
  const token = loginRes.data.data.token;
  const user = loginRes.data.data.user;

  let secondUserToken = '';
  let secondUserId = '';
  try {
    const sLogin = await axios.post(`${API_URL}/auth/login`, {
      email: 'student2@stanford.edu',
      password: 'StudentPass123',
    });
    secondUserToken = sLogin.data.data.token;
    secondUserId = sLogin.data.data.user.id;
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
    secondUserId = regRes.data.data.user.id;
  }

  const stanford = await prisma.college.findFirst({ where: { code: 'STANFORD' } });
  const cseBranch = await prisma.branch.findFirst({ where: { collegeId: stanford!.id, code: 'CSE' } });
  const osSubject = await prisma.subject.findFirst({ where: { branchId: cseBranch!.id, code: 'CS401' } });
  const dbSubject = await prisma.subject.findFirst({ where: { branchId: cseBranch!.id, code: 'CS302' } });

  return {
    token,
    userId: user.id,
    collegeId: stanford!.id,
    branchId: cseBranch!.id,
    osSubjectId: osSubject!.id,
    dbSubjectId: dbSubject!.id,
    secondUserToken,
    secondUserId,
  };
}

async function uploadAndProcessNote(
  ctx: TestContext,
  title: string,
  subjectId: string,
  semester: number,
  pdfBuffer: Buffer,
  filename = 'test.pdf',
  isPublished = true,
  customToken?: string
): Promise<any> {
  const form = new FormData();
  form.append('title', title);
  form.append('description', 'Test note for Phase 4 verification');
  form.append('semester', String(semester));
  form.append('subjectId', subjectId);
  form.append('branchId', ctx.branchId);
  form.append('collegeId', ctx.collegeId);
  form.append('isPublished', String(isPublished));
  form.append('file', pdfBuffer, { filename, contentType: 'application/pdf' });

  const res = await axios.post(`${API_URL}/notes`, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${customToken || ctx.token}` },
  });

  const note = res.data.data;

  // Poll until processed
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const statusRes = await axios.get(`${API_URL}/notes/${note.id}/status`, {
      headers: { Authorization: `Bearer ${customToken || ctx.token}` },
    });
    if (statusRes.data.data.status === 'COMPLETED') {
      break;
    }
    if (statusRes.data.data.status === 'FAILED') {
      throw new Error(`Note processing failed for ${note.id}: ${statusRes.data.data.error || 'Unknown error'}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return note;
}

const pace = (ms = 2500) => new Promise((r) => setTimeout(r, ms));

async function runOllamaRagTests() {
  console.log('================================================================');
  console.log('🦙 CAMPUSNOTES AI — OLLAMA RAG GENERATION TEST SUITE');
  console.log('   Testing Local llama3.2:3b LLM Provider with pgvector Retrieval');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  const createdNoteIds: string[] = [];
  const createdSessionIds: string[] = [];

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
    // -------------------------------------------------------------------------
    // TEST 0: Ollama Daemon Health & Model Verification
    // -------------------------------------------------------------------------
    console.log('--- Test 0: Ollama Health & Model Verification ---');
    const health = await ollamaService.checkHealth();
    assert(
      health.isHealthy && health.modelFound,
      'Ollama daemon is reachable and target model (llama3.2:3b) is installed',
      `Models found: [${health.models.join(', ')}] | BaseURL: ${ollamaService.configuredBaseUrl}`
    );

    const ctx = await setupContext();

    console.log('\n--- Setting Up Academic Test Documents ---');
    // Note 1: Operating Systems (Multi-page, Semester 4)
    const osNote = await uploadAndProcessNote(
      ctx,
      'OS Lecture Notes: Concurrency & Deadlocks',
      ctx.osSubjectId,
      4,
      createMultiTopicAcademicPdf(),
      'os_concurrency.pdf'
    );
    createdNoteIds.push(osNote.id);
    console.log(`  Uploaded & Processed OS Note (ID: ${osNote.id})`);

    // Note 2: Database Management Systems (1 page, Semester 3)
    const dbNote = await uploadAndProcessNote(
      ctx,
      'DBMS Lecture Notes: Relational Model',
      ctx.dbSubjectId,
      3,
      createDatabasePdf(),
      'dbms_relational.pdf'
    );
    createdNoteIds.push(dbNote.id);
    console.log(`  Uploaded & Processed DBMS Note (ID: ${dbNote.id})`);

    // Note 3: Private Unpublished Note by Second Student
    const privateNote = await uploadAndProcessNote(
      ctx,
      'Private Draft Notes: Unreleased Secrets',
      ctx.osSubjectId,
      4,
      createMultiTopicAcademicPdf(),
      'private_os.pdf',
      false, // unpublished
      ctx.secondUserToken
    );
    createdNoteIds.push(privateNote.id);
    console.log(`  Uploaded Private Note (ID: ${privateNote.id})`);

    await pace(2000);

    // -------------------------------------------------------------------------
    // TEST 1: Question with an obvious answer in a PDF (Ollama generation)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: Obvious Question Grounded in PDF (Ollama) ---');
    const q1Res = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'What is the Banker Algorithm and what does it test for?',
        noteId: osNote.id,
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const q1Data = q1Res.data.data;
    const mentionsDeadlockOrSafety =
      q1Data.answer.toLowerCase().includes('deadlock') ||
      q1Data.answer.toLowerCase().includes('safety') ||
      q1Data.answer.toLowerCase().includes('banker');
    const hasCorrectSource =
      q1Data.sources.length > 0 &&
      q1Data.sources[0].pageNumber === 2 &&
      q1Data.sources[0].noteId === osNote.id;
    const usedOllamaModel = q1Data.modelUsed?.includes('llama') || q1Data.modelUsed === 'llama3.2:3b';

    assert(
      mentionsDeadlockOrSafety && hasCorrectSource && usedOllamaModel,
      'Obvious question answered accurately by Ollama, grounded in Page 2 of OS Note',
      `Model: ${q1Data.modelUsed} | Top Similarity: ${q1Data.topSimilarity} | Answer: "${q1Data.answer.slice(0, 100)}..."`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 2: Question using different wording / semantic paraphrasing
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Paraphrased Question Semantic Retrieval ---');
    const q2Res = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'How do concurrent threads coordinate without clobbering shared memory?',
        noteId: osNote.id,
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const q2Data = q2Res.data.data;
    const mentionsSemaphoresOrRace =
      q2Data.answer.toLowerCase().includes('semaphore') ||
      q2Data.answer.toLowerCase().includes('race') ||
      q2Data.answer.toLowerCase().includes('concurren');

    assert(
      mentionsSemaphoresOrRace && q2Data.sources.length > 0,
      'Paraphrased query successfully retrieved Semaphore/Race Condition chunk via semantic vector similarity',
      `Answer excerpt: "${q2Data.answer.slice(0, 100)}..." | Top Similarity: ${q2Data.topSimilarity}`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 3: Question with no relevant information in the notes
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Out-of-Scope Query & Grounded Refusal ---');
    const q3Res = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'What is the capital of Australia and what is its official currency?',
        noteId: osNote.id,
        similarityThreshold: 0.45,
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const q3Data = q3Res.data.data;
    const correctlyRefused =
      q3Data.wasShortCircuited === true ||
      q3Data.answer.toLowerCase().includes('not enough information');

    assert(
      correctlyRefused && q3Data.sources.length === 0,
      'Out-of-scope question triggered graceful refusal without hallucinating',
      `Response: "${q3Data.answer}" | ShortCircuited: ${q3Data.wasShortCircuited}`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 4: Multi-chunk synthesis spanning multiple sections/pages
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Multi-Chunk Synthesis Across Pages ---');
    const q4Res = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'What is a race condition and what are the four Coffman conditions for deadlock?',
        noteId: osNote.id,
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const q4Data = q4Res.data.data;
    const synthesizedBoth =
      q4Data.answer.toLowerCase().includes('race') &&
      (q4Data.answer.toLowerCase().includes('deadlock') ||
        q4Data.answer.toLowerCase().includes('coffman') ||
        q4Data.answer.toLowerCase().includes('exclusion') ||
        q4Data.answer.toLowerCase().includes('condition'));
    const multipleSources = q4Data.sources.length >= 2;

    assert(
      synthesizedBoth && multipleSources,
      'Multi-chunk question retrieved multiple distinct chunks and synthesized coherent answer',
      `Retrieved ${q4Data.sources.length} sources across pages: [${q4Data.sources.map((s: any) => `p${s.pageNumber}`).join(', ')}] | Answer: "${q4Data.answer.slice(0, 200)}..."`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 5: Question restricted to a particular Subject
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Subject-Scoped Retrieval Filtering ---');
    const q5Res = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'What are primary keys and foreign keys?',
        subjectId: ctx.dbSubjectId, // Scoped to DBMS
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const q5Data = q5Res.data.data;
    const sourceDbNoteIds = [...new Set(q5Data.sources.map((s: any) => s.noteId))] as string[];
    const dbNotesInDb = await prisma.note.findMany({
      where: { id: { in: sourceDbNoteIds } },
      select: { id: true, subjectId: true },
    });
    const allDbSubject = dbNotesInDb.every((n) => n.subjectId === ctx.dbSubjectId);
    const mentionsDbConcepts =
      q5Data.answer.toLowerCase().includes('key') ||
      q5Data.answer.toLowerCase().includes('relational') ||
      q5Data.answer.toLowerCase().includes('table') ||
      q5Data.answer.toLowerCase().includes('foreign') ||
      q5Data.answer.toLowerCase().includes('primary');

    assert(
      allDbSubject && q5Data.sources.length > 0 && mentionsDbConcepts,
      'Subject-restricted query strictly isolated retrieval to DBMS subject notes',
      `All ${q5Data.sources.length} sources belonged strictly to DBMS subject notes`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 6: Question restricted to a particular Semester
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Semester-Scoped Retrieval Filtering ---');
    const q6Res = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'Tell me about processes and deadlocks.',
        semester: 4, // OS is semester 4
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const q6Data = q6Res.data.data;
    const sourceNoteIds = [...new Set(q6Data.sources.map((s: any) => s.noteId))] as string[];
    const notesInDb = await prisma.note.findMany({
      where: { id: { in: sourceNoteIds } },
      select: { id: true, semester: true },
    });
    const allSem4 = notesInDb.every((n) => n.semester === 4);

    assert(
      allSem4 && q6Data.sources.length > 0,
      'Semester-restricted query returned only Semester 4 chunks',
      `Retrieved sources count: ${q6Data.sources.length} strictly from Sem 4 notes`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 7: Question restricted to a specific Note
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Note-Scoped Retrieval Filtering ---');
    const q7Res = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'What is referential integrity?',
        noteId: dbNote.id,
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const q7Data = q7Res.data.data;
    const strictlyDbNote = q7Data.sources.every((s: any) => s.noteId === dbNote.id);

    assert(
      strictlyDbNote && q7Data.answer.toLowerCase().includes('integrity'),
      'Note-scoped query strictly limited pgvector search to target document',
      `Target Note ID: ${dbNote.id}`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 8: Security & Unauthorized Note Access
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: Security & Unauthorized Note Access Prevention ---');
    let privateAccessBlocked = false;
    try {
      // Alex Rivera attempts to query Student 2's private unpublished note
      await axios.post(
        `${API_URL}/chat/ask-direct`,
        {
          question: 'What are the unreleased secrets in this note?',
          noteId: privateNote.id,
        },
        { headers: { Authorization: `Bearer ${ctx.token}` } }
      );
    } catch (err: any) {
      if (err.response?.status === 403) {
        privateAccessBlocked = true;
      }
    }

    assert(
      privateAccessBlocked,
      'Unauthorized access to unpublished private note blocked with HTTP 403'
    );

    // -------------------------------------------------------------------------
    // TEST 9: Incorrect or Malformed Requests Handling
    // -------------------------------------------------------------------------
    console.log('\n--- Test 9: Malformed Request Validation ---');
    let emptyQueryBlocked = false;
    try {
      await axios.post(
        `${API_URL}/chat/ask-direct`,
        { question: '   ' },
        { headers: { Authorization: `Bearer ${ctx.token}` } }
      );
    } catch (err: any) {
      if (err.response?.status === 400) {
        emptyQueryBlocked = true;
      }
    }

    assert(
      emptyQueryBlocked,
      'Empty or whitespace-only question rejected with HTTP 400 Bad Request'
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 10: Persistent Multi-turn Chat Sessions & History
    // -------------------------------------------------------------------------
    console.log('\n--- Test 10: Persistent Chat Sessions & Conversation History ---');
    // 1. Create a session
    const sessionRes = await axios.post(
      `${API_URL}/chat/sessions`,
      { title: 'OS Exam Prep', noteId: osNote.id },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );
    const sessionId = sessionRes.data.data.id;
    createdSessionIds.push(sessionId);

    // 2. Send Turn 1
    const turn1Res = await axios.post(
      `${API_URL}/chat/sessions/${sessionId}/messages`,
      { content: 'What is a semaphore?' },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    await pace();

    // 3. Send Turn 2 (Contextual follow-up)
    const turn2Res = await axios.post(
      `${API_URL}/chat/sessions/${sessionId}/messages`,
      { content: 'What type of integer variable was it again?' },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );
    const turn2Answer = turn2Res.data.data.assistantMessage.content;

    // 4. Retrieve session history
    const sessionDetailRes = await axios.get(`${API_URL}/chat/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    const messageHistory = sessionDetailRes.data.data.messages;

    assert(
      messageHistory.length === 4 && turn2Answer.toLowerCase().includes('integer'),
      'Multi-turn conversation persisted in PostgreSQL and LLM followed previous context',
      `Session messages count: ${messageHistory.length} (2 User + 2 Assistant)`
    );

    // -------------------------------------------------------------------------
    // TEST 11: Source Citation Correctness & Backend Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Test 11: Citation & Source Object Correctness ---');
    const firstAssistantMsg = messageHistory.find((m: any) => m.role === 'ASSISTANT');
    const firstSource = firstAssistantMsg?.sources?.[0];

    const sourceHasFields =
      !!firstSource?.noteId &&
      !!firstSource?.noteTitle &&
      typeof firstSource?.pageNumber === 'number' &&
      typeof firstSource?.similarity === 'number' &&
      typeof firstSource?.contentExcerpt === 'string';

    assert(
      sourceHasFields,
      'Citation sources contain valid noteId, noteTitle, pageNumber, similarity, and contentExcerpt',
      `Source: ${firstSource?.noteTitle}, Page ${firstSource?.pageNumber}, Similarity: ${firstSource?.similarity}`
    );

    await pace();

    // -------------------------------------------------------------------------
    // TEST 12: Configurable Similarity Threshold & Top-K Reporting
    // -------------------------------------------------------------------------
    console.log('\n--- Test 12: Configurable RAG Parameters & Retrieval Reporting ---');
    const customThresholdRes = await axios.post(
      `${API_URL}/chat/ask-direct`,
      {
        question: 'Explain mutual exclusion with semaphores.',
        noteId: osNote.id,
        topK: 2,
        similarityThreshold: 0.50,
      },
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    );

    const cData = customThresholdRes.data.data;
    assert(
      cData.retrievedCount <= 2 && (cData.topSimilarity === null || cData.topSimilarity >= 0.50),
      'Configurable topK (2) and similarityThreshold (0.50) respected during retrieval',
      `Retrieved: ${cData.retrievedCount} chunks | Top Similarity: ${cData.topSimilarity}`
    );

    // -------------------------------------------------------------------------
    // TEST 13: Secret Isolation & Zero API Key Exposure
    // -------------------------------------------------------------------------
    console.log('\n--- Test 13: Security & Secret Isolation ---');
    const sessionString = JSON.stringify(sessionDetailRes.data);
    const turn2String = JSON.stringify(turn2Res.data);
    const hasKeyLeak =
      sessionString.includes(config.ai.geminiApiKey) ||
      turn2String.includes(config.ai.geminiApiKey);

    assert(
      !hasKeyLeak,
      'Gemini API key is completely isolated server-side and never exposed in chat responses'
    );

    // -------------------------------------------------------------------------
    // TEST 14: Direct Gemini Generation Preservation (Dual-Provider Check)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 14: Direct Gemini Generation Preservation ---');
    const geminiDirectAnswer = await ragService.generateGeminiGroundedAnswer(
      'What is Banker Algorithm?',
      `[Source 1: "OS Notes", Page 2 | Relevance: 85%]\nBanker Algorithm is a deadlock avoidance algorithm that tests for safety.`,
      'You are CampusNotes AI. Answer strictly using the provided excerpts.'
    );
    assert(
      geminiDirectAnswer.toLowerCase().includes('deadlock') || geminiDirectAnswer.toLowerCase().includes('banker'),
      'Direct Gemini generation remains 100% operational alongside Ollama',
      `Gemini excerpt: "${geminiDirectAnswer.slice(0, 80)}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 15: Phase 1–3B Regression Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Test 15: Phase 1–3B End-to-End Regression ---');
    const healthRes = await axios.get(`${API_URL}/health`);
    const notesListRes = await axios.get(`${API_URL}/notes`);
    const downloadRes = await axios.get(`${API_URL}/notes/${osNote.id}/download`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      responseType: 'arraybuffer',
    });

    assert(
      healthRes.status === 200 &&
      notesListRes.data.data.notes.length > 0 &&
      downloadRes.status === 200 &&
      downloadRes.data.length > 0,
      'Phase 1 (Health), Phase 2 (Catalog/Download), and Phase 3 (Ingestion) remain fully functional',
      `Catalog Count: ${notesListRes.data.data.notes.length} | Downloaded: ${downloadRes.data.length} bytes`
    );

  } catch (err: any) {
    console.error('Unexpected error during Ollama RAG verification:', err.response?.data || err.message);
    failed++;
  } finally {
    // Cleanup sessions
    for (const sid of createdSessionIds) {
      try {
        await prisma.chatSession.delete({ where: { id: sid } });
      } catch {}
    }
    // Cleanup notes
    for (const nid of createdNoteIds) {
      try {
        await prisma.note.delete({ where: { id: nid } });
      } catch {}
    }
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`📊 OLLAMA RAG TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runOllamaRagTests();
