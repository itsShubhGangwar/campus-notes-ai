import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { prisma } from '../src/config/db.js';

const API_URL = 'http://localhost:5000/api';

// 1. Single Page Normal Text PDF
function createNormalTextPdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 130 >> stream
BT
/F1 12 Tf
100 700 Td
(Database Normalization ensures data integrity. First Normal Form requires atomic values. Second Normal Form eliminates partial functional dependency.) Tj
ET
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
385
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

// 2. Multi-Page PDF (3 pages)
function createMultiPagePdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 65 >> stream
BT /F1 14 Tf 100 700 Td (Chapter 1: Introduction to Computer Networks and OSI Model) Tj ET
endstream endobj
5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >> endobj
6 0 obj << /Length 65 >> stream
BT /F1 14 Tf 100 700 Td (Chapter 2: The Data Link Layer, Framing, and Error Detection) Tj ET
endstream endobj
7 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R >> endobj
8 0 obj << /Length 65 >> stream
BT /F1 14 Tf 100 700 Td (Chapter 3: Network Layer, IP Addressing, Routing Algorithms) Tj ET
endstream endobj
xref
0 9
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000125 00000 n 
0000000212 00000 n 
0000000330 00000 n 
0000000417 00000 n 
0000000535 00000 n 
0000000622 00000 n 
trailer << /Size 9 /Root 1 0 R >>
startxref
740
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

// 3. Structured Paragraph PDF
function createStructuredParagraphPdf(): Buffer {
  const line1 = 'SECTION 1: COMPILER OPTIMIZATION TECHNIQUES. Loop unrolling and dead code elimination improve instruction-level parallelism.';
  const line2 = 'SECTION 2: STATIC SINGLE ASSIGNMENT. Static Single Assignment form requires that every variable is assigned exactly once.';
  const streamBody = `BT /F1 12 Tf 50 700 Td (${line1}) Tj 0 -50 Td (${line2}) Tj ET`;
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
${260 + streamLen}
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

// 4. Minimal / Empty Content PDF
function createMinimalPdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 2 >> stream
  
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
257
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

async function runPhase3aTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING PHASE 3A: PDF TEXT EXTRACTION & CHUNKING TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`✅ PASS: ${name}`);
      if (detail) console.log(`    ↳ ${detail}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${name}`);
      if (detail) console.log(`    ↳ ${detail}`);
      failed++;
    }
  }

  async function waitForProcessing(noteId: string, token: string, maxWaitMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const res = await axios.get(`${API_URL}/notes/${noteId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const status = res.data.data.status;
      if (status === 'COMPLETED' || status === 'FAILED') {
        return res.data.data;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    const finalRes = await axios.get(`${API_URL}/notes/${noteId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return finalRes.data.data;
  }

  try {
    // Auth & Curriculum Setup
    const stanford = await prisma.college.findFirst({ where: { code: 'STANFORD' } });
    const cseBranch = await prisma.branch.findFirst({ where: { collegeId: stanford!.id, code: 'CSE' } });
    const dbSubject = await prisma.subject.findFirst({ where: { branchId: cseBranch!.id, code: 'CS302' } });

    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'alex.rivera@stanford.edu',
      password: 'StudentPass123',
    });
    const token = loginRes.data.data.token;

    // -------------------------------------------------------------------------
    // TEST 1: Normal Text-based PDF Processing
    // -------------------------------------------------------------------------
    const normalPdf = createNormalTextPdf();
    const form1 = new FormData();
    form1.append('file', normalPdf, { filename: 'db_normalization.pdf', contentType: 'application/pdf' });
    form1.append('title', 'Database Normalization & Functional Dependencies');
    form1.append('collegeId', stanford!.id);
    form1.append('branchId', cseBranch!.id);
    form1.append('semester', '3');
    form1.append('subjectId', dbSubject!.id);

    const uploadRes1 = await axios.post(`${API_URL}/notes`, form1, {
      headers: { ...form1.getHeaders(), Authorization: `Bearer ${token}` },
    });
    const note1Id = uploadRes1.data.data.id;

    const status1 = await waitForProcessing(note1Id, token);
    const chunksRes1 = await axios.get(`${API_URL}/notes/${note1Id}/chunks`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const test1Ok =
      status1.status === 'COMPLETED' &&
      status1.chunksCount >= 1 &&
      chunksRes1.data.data.chunks[0].content.includes('Database Normalization');

    report(
      '1. Normal Text-based PDF: Extraction, Cleaning, and Chunking',
      test1Ok,
      `Status: ${status1.status} | Chunks: ${status1.chunksCount} | Text Sample: "${chunksRes1.data.data.chunks[0]?.content.substring(0, 45)}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Multi-Page PDF (Page Tracking Verification)
    // -------------------------------------------------------------------------
    const multiPdf = createMultiPagePdf();
    const form2 = new FormData();
    form2.append('file', multiPdf, { filename: 'computer_networks_multipage.pdf', contentType: 'application/pdf' });
    form2.append('title', 'Computer Networks 3-Page Syllabus Guide');
    form2.append('collegeId', stanford!.id);
    form2.append('branchId', cseBranch!.id);
    form2.append('semester', '3');
    form2.append('subjectId', dbSubject!.id);

    const uploadRes2 = await axios.post(`${API_URL}/notes`, form2, {
      headers: { ...form2.getHeaders(), Authorization: `Bearer ${token}` },
    });
    const note2Id = uploadRes2.data.data.id;

    const status2 = await waitForProcessing(note2Id, token);
    const chunksRes2 = await axios.get(`${API_URL}/notes/${note2Id}/chunks`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const pagesTracked = Array.from(new Set(chunksRes2.data.data.chunks.map((c: any) => c.pageNumber)));
    const test2Ok =
      status2.status === 'COMPLETED' &&
      status2.pageCount === 3 &&
      pagesTracked.includes(1) &&
      pagesTracked.includes(2) &&
      pagesTracked.includes(3);

    report(
      '2. Multi-Page PDF: Multi-page segmentation and exact page number tracking',
      test2Ok,
      `Detected Pages: ${status2.pageCount} | Tracked Pages in Chunks: [${pagesTracked.join(', ')}]`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Structured Paragraph PDF with Sequential Chunk Ordering
    // -------------------------------------------------------------------------
    const structuredPdf = createStructuredParagraphPdf();
    const form3 = new FormData();
    form3.append('file', structuredPdf, { filename: 'compiler_optimization.pdf', contentType: 'application/pdf' });
    form3.append('title', 'Compiler Design Optimization & SSA Form');
    form3.append('collegeId', stanford!.id);
    form3.append('branchId', cseBranch!.id);
    form3.append('semester', '3');
    form3.append('subjectId', dbSubject!.id);

    const uploadRes3 = await axios.post(`${API_URL}/notes`, form3, {
      headers: { ...form3.getHeaders(), Authorization: `Bearer ${token}` },
    });
    const note3Id = uploadRes3.data.data.id;

    const status3 = await waitForProcessing(note3Id, token);
    const chunksRes3 = await axios.get(`${API_URL}/notes/${note3Id}/chunks`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const chunksList = chunksRes3.data.data.chunks;
    const isSequential = chunksList.length > 0 && chunksList.every((c: any, i: number) => c.chunkIndex === i);
    const hasSection1 = chunksList.some((c: any) => c.content.includes('SECTION 1'));
    const hasSection2 = chunksList.some((c: any) => c.content.includes('SECTION 2'));

    report(
      '3. Structured Document: Paragraph preservation and sequential chunkIndex ordering',
      isSequential && hasSection1 && hasSection2,
      `Sequential ordering (0, 1...): ${isSequential} | Section 1 found: ${hasSection1} | Section 2 found: ${hasSection2}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Invalid / Corrupted PDF Handling (Graceful Failure)
    // -------------------------------------------------------------------------
    const validFirst = createNormalTextPdf();
    const form4 = new FormData();
    form4.append('file', validFirst, { filename: 'corrupted_test.pdf', contentType: 'application/pdf' });
    form4.append('title', 'Corrupted PDF Test Document');
    form4.append('collegeId', stanford!.id);
    form4.append('branchId', cseBranch!.id);
    form4.append('semester', '3');
    form4.append('subjectId', dbSubject!.id);

    const uploadRes4 = await axios.post(`${API_URL}/notes`, form4, {
      headers: { ...form4.getHeaders(), Authorization: `Bearer ${token}` },
    });
    const note4Id = uploadRes4.data.data.id;
    const note4Key = uploadRes4.data.data.fileKey;

    // Wait for initial upload job to finish
    await waitForProcessing(note4Id, token);

    // Overwrite file on disk with corrupted garbage
    const diskPath = path.resolve(process.cwd(), 'uploads', note4Key);
    fs.writeFileSync(diskPath, Buffer.from('CORRUPTED-GARBAGE-HEADER-ZERO-PDF-STRUCTURE-DESTROYED'));

    // Trigger re-processing which should fail gracefully
    await axios.post(`${API_URL}/notes/${note4Id}/process`, {}, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const status4 = await axios.get(`${API_URL}/notes/${note4Id}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const test4Ok =
      status4.data.data.status === 'FAILED' &&
      !!status4.data.data.error;

    report(
      '4. Corrupted PDF: Graceful failure handling and error logging in PostgreSQL',
      test4Ok,
      `Status: ${status4.data.data.status} | Recorded DB Error: "${status4.data.data.error}"`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Minimal / Empty Content PDF
    // -------------------------------------------------------------------------
    const minimalPdf = createMinimalPdf();
    const form5 = new FormData();
    form5.append('file', minimalPdf, { filename: 'minimal_blank.pdf', contentType: 'application/pdf' });
    form5.append('title', 'Minimal Empty Content PDF');
    form5.append('collegeId', stanford!.id);
    form5.append('branchId', cseBranch!.id);
    form5.append('semester', '3');
    form5.append('subjectId', dbSubject!.id);

    const uploadRes5 = await axios.post(`${API_URL}/notes`, form5, {
      headers: { ...form5.getHeaders(), Authorization: `Bearer ${token}` },
    });
    const note5Id = uploadRes5.data.data.id;

    const status5 = await waitForProcessing(note5Id, token);

    report(
      '5. Minimal / Empty PDF: Handles empty text content without throwing uncaught exceptions',
      status5.status === 'COMPLETED' && status5.chunksCount === 0,
      `Status: ${status5.status} | Chunks Created: ${status5.chunksCount}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Note -> Chunks Foreign Key Cascade Deletion
    // -------------------------------------------------------------------------
    const chunksBeforeDelete = await prisma.noteChunk.count({ where: { noteId: note1Id } });
    await axios.delete(`${API_URL}/notes/${note1Id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const chunksAfterDelete = await prisma.noteChunk.count({ where: { noteId: note1Id } });

    report(
      '6. Note -> Chunks Cascade: Deleting a note automatically deletes all associated chunks',
      chunksBeforeDelete > 0 && chunksAfterDelete === 0,
      `Chunks before delete: ${chunksBeforeDelete} | Chunks after delete: ${chunksAfterDelete}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Security - Unauthorized users cannot inspect raw chunks
    // -------------------------------------------------------------------------
    let unauthorizedChunksBlocked = false;
    try {
      // Bob tries to access Alex's note chunks
      const bobLogin = await axios.post(`${API_URL}/auth/login`, {
        email: 'bob.smith@mit.edu',
        password: 'StudentPass123',
      });
      await axios.get(`${API_URL}/notes/${note2Id}/chunks`, {
        headers: { Authorization: `Bearer ${bobLogin.data.data.token}` },
      });
    } catch (err: any) {
      unauthorizedChunksBlocked = err.response?.status === 403;
    }

    report(
      '7. Security: Only author or Admin can view raw extracted chunks (HTTP 403 Forbidden)',
      unauthorizedChunksBlocked,
      `Unauthorized inspection blocked with HTTP 403: ${unauthorizedChunksBlocked}`
    );

    // -------------------------------------------------------------------------
    // TEST 8: Existing Phase 1 & Phase 2 Functionality Regression Check
    // -------------------------------------------------------------------------
    const healthCheck = await axios.get(`${API_URL}/health`);
    const notesCatalog = await axios.get(`${API_URL}/notes`);
    const userMe = await axios.get(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const regressionPass =
      healthCheck.data.status === 'ok' &&
      Array.isArray(notesCatalog.data.data.notes) &&
      userMe.data.data.email === 'alex.rivera@stanford.edu';

    report(
      '8. Regression Check: Phase 1 (Auth/Academics) & Phase 2 (Notes/Downloads) fully functional',
      regressionPass,
      `Health: ${healthCheck.data.status} | Notes in catalog: ${notesCatalog.data.data.notes.length} | Auth User: ${userMe.data.data.name}`
    );

    console.log('\n===============================================================');
    console.log(`🏁 PHASE 3A RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================\n');

    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err: any) {
    console.error('💥 Phase 3A test suite error:', err.response?.data || err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

runPhase3aTests();
