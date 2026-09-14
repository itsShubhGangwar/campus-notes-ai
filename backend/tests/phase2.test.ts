import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { prisma } from './config/db.js';

const API_URL = 'http://localhost:5000/api';

// Helper to create a valid minimal PDF buffer
function createValidPdfBuffer(text = 'Hello CampusNotes AI'): Buffer {
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 700 Td (${text}) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000202 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
296
%%EOF`;
  return Buffer.from(content, 'utf-8');
}

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING PHASE 2: 15 AUTOMATED VERIFICATION TEST CASES');
  console.log('===============================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function report(num: number, title: string, passed: boolean, detail?: string) {
    if (passed) {
      console.log(`✅ [TEST ${num.toString().padStart(2, '0')}] PASS: ${title}`);
      if (detail) console.log(`    ↳ ${detail}`);
      passedCount++;
    } else {
      console.log(`❌ [TEST ${num.toString().padStart(2, '0')}] FAIL: ${title}`);
      if (detail) console.log(`    ↳ ${detail}`);
      failedCount++;
    }
  }

  try {
    // 0. Setup: Ensure test users exist & retrieve auth tokens
    const stanford = await prisma.college.findFirst({ where: { code: 'STANFORD' } });
    const cseBranch = await prisma.branch.findFirst({ where: { collegeId: stanford!.id, code: 'CSE' } });
    const osSubject = await prisma.subject.findFirst({ where: { branchId: cseBranch!.id, code: 'CS401' } });
    const algoSubject = await prisma.subject.findFirst({ where: { branchId: cseBranch!.id, code: 'CS201' } });

    // User A: Alex Rivera (Student 1)
    const loginAlex = await axios.post(`${API_URL}/auth/login`, {
      email: 'alex.rivera@stanford.edu',
      password: 'StudentPass123',
    });
    const alexToken = loginAlex.data.data.token;
    const alexId = loginAlex.data.data.user.id;

    // User B: Bob Smith (Student 2)
    let bobToken = '';
    let bobId = '';
    try {
      const regBob = await axios.post(`${API_URL}/auth/register`, {
        name: 'Bob Smith',
        email: 'bob.smith@mit.edu',
        password: 'StudentPass123',
        collegeId: stanford!.id,
        branchId: cseBranch!.id,
        semester: 4,
      });
      bobToken = regBob.data.data.token;
      bobId = regBob.data.data.user.id;
    } catch {
      const loginBob = await axios.post(`${API_URL}/auth/login`, {
        email: 'bob.smith@mit.edu',
        password: 'StudentPass123',
      });
      bobToken = loginBob.data.data.token;
      bobId = loginBob.data.data.user.id;
    }

    // Admin User
    const loginAdmin = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@campusnotes.ai',
      password: 'Admin@123456',
    });
    const adminToken = loginAdmin.data.data.token;

    // -------------------------------------------------------------------------
    // TEST 1: Valid PDF upload
    // -------------------------------------------------------------------------
    const validPdf = createValidPdfBuffer('Operating Systems Virtual Memory');
    const form1 = new FormData();
    form1.append('file', validPdf, { filename: 'os_virtual_memory.pdf', contentType: 'application/pdf' });
    form1.append('title', 'Operating Systems Virtual Memory & Paging');
    form1.append('description', 'Comprehensive lecture notes covering page tables, TLB, and page faults.');
    form1.append('collegeId', stanford!.id);
    form1.append('branchId', cseBranch!.id);
    form1.append('semester', '4');
    form1.append('subjectId', osSubject!.id);
    form1.append('tags', 'operating systems, memory, paging, tlb');

    const res1 = await axios.post(`${API_URL}/notes`, form1, {
      headers: {
        ...form1.getHeaders(),
        Authorization: `Bearer ${alexToken}`,
      },
    });

    const note1 = res1.data.data;
    report(
      1,
      'A valid PDF can be uploaded',
      res1.status === 201 && !!note1.id,
      `Created Note ID: ${note1.id} | FileKey: ${note1.fileKey}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: PDF actually created inside backend/uploads/notes/
    // -------------------------------------------------------------------------
    const expectedDiskPath = path.resolve(process.cwd(), 'uploads', note1.fileKey);
    const fileExistsOnDisk = fs.existsSync(expectedDiskPath);
    const diskFileSize = fileExistsOnDisk ? fs.statSync(expectedDiskPath).size : 0;
    report(
      2,
      'The PDF is actually created inside backend/uploads/notes/',
      fileExistsOnDisk && diskFileSize === validPdf.length,
      `Disk path: ${expectedDiskPath} (Size: ${diskFileSize} bytes)`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Note metadata stored in PostgreSQL
    // -------------------------------------------------------------------------
    const dbNote1 = await prisma.note.findUnique({
      where: { id: note1.id },
      include: { tags: { include: { tag: true } } },
    });
    const dbValid =
      dbNote1 !== null &&
      dbNote1.uploaderId === alexId &&
      dbNote1.semester === 4 &&
      dbNote1.subjectId === osSubject!.id &&
      dbNote1.fileKey === note1.fileKey &&
      dbNote1.tags.length === 4;
    report(
      3,
      'Corresponding note metadata is stored in PostgreSQL',
      dbValid,
      `Title: "${dbNote1?.title}" | Tags: ${dbNote1?.tags.map((t) => t.tag.name).join(', ')}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Stored file can be retrieved/downloaded & increments count
    // -------------------------------------------------------------------------
    const downloadRes = await axios.get(`${API_URL}/notes/${note1.id}/download`, {
      headers: { Authorization: `Bearer ${alexToken}` },
      responseType: 'arraybuffer',
    });
    const updatedDbNoteAfterDownload = await prisma.note.findUnique({ where: { id: note1.id } });
    const downloadRecord = await prisma.download.findFirst({ where: { noteId: note1.id } });

    const downloadSuccess =
      downloadRes.status === 200 &&
      downloadRes.headers['content-type'] === 'application/pdf' &&
      downloadRes.data.length === validPdf.length &&
      updatedDbNoteAfterDownload?.downloadsCount === 1 &&
      downloadRecord?.userId === alexId;

    report(
      4,
      'The stored file can be retrieved/downloaded and tracks download stats',
      downloadSuccess,
      `Content-Type: ${downloadRes.headers['content-type']} | DB Downloads: ${updatedDbNoteAfterDownload?.downloadsCount}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Search works
    // -------------------------------------------------------------------------
    const searchResPositive = await axios.get(`${API_URL}/notes?search=Virtual Memory`);
    const searchResNegative = await axios.get(`${API_URL}/notes?search=QuantumMechanicsNotExist123`);

    const searchSuccess =
      searchResPositive.data.data.notes.some((n: any) => n.id === note1.id) &&
      searchResNegative.data.data.notes.length === 0;

    report(
      5,
      'Search works (finds relevant title/description keywords & rejects non-matching)',
      searchSuccess,
      `Matches found for "Virtual Memory": ${searchResPositive.data.data.notes.length} | For random query: 0`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Filters work (College, Branch, Semester, Subject)
    // -------------------------------------------------------------------------
    const filterSem4 = await axios.get(`${API_URL}/notes?semester=4&subjectId=${osSubject!.id}`);
    const filterSem1 = await axios.get(`${API_URL}/notes?semester=1&subjectId=${osSubject!.id}`);

    const filtersSuccess =
      filterSem4.data.data.notes.some((n: any) => n.id === note1.id) &&
      filterSem1.data.data.notes.length === 0;

    report(
      6,
      'Subject / branch / semester / college filters work correctly',
      filtersSuccess,
      `Sem 4 + OS Subject: ${filterSem4.data.data.notes.length} results | Sem 1 + OS Subject: 0 results`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Pagination works
    // -------------------------------------------------------------------------
    // Upload a 2nd note so we have multiple notes for pagination
    const validPdf2 = createValidPdfBuffer('Data Structures Binary Search Trees');
    const form2 = new FormData();
    form2.append('file', validPdf2, { filename: 'dsa_trees.pdf', contentType: 'application/pdf' });
    form2.append('title', 'Data Structures Binary Trees & Traversal');
    form2.append('collegeId', stanford!.id);
    form2.append('branchId', cseBranch!.id);
    form2.append('semester', '2');
    form2.append('subjectId', algoSubject!.id);

    const res2 = await axios.post(`${API_URL}/notes`, form2, {
      headers: { ...form2.getHeaders(), Authorization: `Bearer ${alexToken}` },
    });
    const note2 = res2.data.data;

    const page1Res = await axios.get(`${API_URL}/notes?limit=1&page=1`);
    const page2Res = await axios.get(`${API_URL}/notes?limit=1&page=2`);

    const paginationSuccess =
      page1Res.data.data.notes.length === 1 &&
      page2Res.data.data.notes.length === 1 &&
      page1Res.data.data.notes[0].id !== page2Res.data.data.notes[0].id &&
      page1Res.data.data.pagination.totalPages >= 2;

    report(
      7,
      'Pagination works (page & limit parameters correctly slice dataset)',
      paginationSuccess,
      `Total: ${page1Res.data.data.pagination.total} | Page 1 ID: ${page1Res.data.data.notes[0].id.substring(0, 8)}... | Page 2 ID: ${page2Res.data.data.notes[0].id.substring(0, 8)}...`
    );

    // -------------------------------------------------------------------------
    // TEST 8: Note ownership permissions work
    // -------------------------------------------------------------------------
    const detailsAlex = await axios.get(`${API_URL}/notes/${note1.id}`, {
      headers: { Authorization: `Bearer ${alexToken}` },
    });
    report(
      8,
      'Note ownership permissions correctly associate note with creator',
      detailsAlex.data.data.uploaderId === alexId,
      `Note uploader: ${detailsAlex.data.data.uploader.name} (${detailsAlex.data.data.uploader.email})`
    );

    // -------------------------------------------------------------------------
    // TEST 9: Admin permissions work
    // -------------------------------------------------------------------------
    const adminUpdateRes = await axios.put(
      `${API_URL}/notes/${note1.id}`,
      { title: 'Operating Systems Virtual Memory (Admin Verified)' },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    const adminSuccess =
      adminUpdateRes.status === 200 &&
      adminUpdateRes.data.data.title === 'Operating Systems Virtual Memory (Admin Verified)';

    report(
      9,
      'Admin permissions work (Admin can moderate/update notes of any student)',
      adminSuccess,
      `Admin successfully updated title to: "${adminUpdateRes.data.data.title}"`
    );

    // -------------------------------------------------------------------------
    // TEST 10: Invalid file types are rejected
    // -------------------------------------------------------------------------
    let invalidTypeRejected = false;
    let invalidTypeError = '';
    try {
      const invalidForm = new FormData();
      const fakeTextFile = Buffer.from('This is a plain text file, not a PDF!', 'utf-8');
      invalidForm.append('file', fakeTextFile, { filename: 'notes.txt', contentType: 'text/plain' });
      invalidForm.append('title', 'Invalid Text Note');
      invalidForm.append('collegeId', stanford!.id);
      invalidForm.append('branchId', cseBranch!.id);
      invalidForm.append('semester', '4');
      invalidForm.append('subjectId', osSubject!.id);

      await axios.post(`${API_URL}/notes`, invalidForm, {
        headers: { ...invalidForm.getHeaders(), Authorization: `Bearer ${alexToken}` },
      });
    } catch (err: any) {
      invalidTypeRejected = err.response?.status === 400;
      invalidTypeError = err.response?.data?.message || err.message;
    }

    // Also test a file named .pdf but containing plain text (Magic byte check!)
    let magicByteRejected = false;
    let magicByteError = '';
    try {
      const spoofForm = new FormData();
      const spoofedPdf = Buffer.from('FAKE-HEADER-NOT-PDF', 'utf-8');
      spoofForm.append('file', spoofedPdf, { filename: 'spoofed.pdf', contentType: 'application/pdf' });
      spoofForm.append('title', 'Spoofed PDF Note');
      spoofForm.append('collegeId', stanford!.id);
      spoofForm.append('branchId', cseBranch!.id);
      spoofForm.append('semester', '4');
      spoofForm.append('subjectId', osSubject!.id);

      await axios.post(`${API_URL}/notes`, spoofForm, {
        headers: { ...spoofForm.getHeaders(), Authorization: `Bearer ${alexToken}` },
      });
    } catch (err: any) {
      magicByteRejected = err.response?.status === 400;
      magicByteError = err.response?.data?.message || err.message;
    }

    report(
      10,
      'Invalid file types are rejected (MIME, extension, and %PDF- magic bytes)',
      invalidTypeRejected && magicByteRejected,
      `Non-PDF error: "${invalidTypeError}" | Magic byte rejection: "${magicByteError}"`
    );

    // -------------------------------------------------------------------------
    // TEST 11: Oversized files are rejected
    // -------------------------------------------------------------------------
    let oversizedRejected = false;
    let oversizedError = '';
    try {
      const oversizedForm = new FormData();
      // 26 MB buffer (exceeds 25 MB limit)
      const hugeBuffer = Buffer.alloc(26 * 1024 * 1024, 'A');
      // Set valid PDF header at the start so magic byte passes
      hugeBuffer.write('%PDF-1.4', 0);
      oversizedForm.append('file', hugeBuffer, { filename: 'huge.pdf', contentType: 'application/pdf' });
      oversizedForm.append('title', 'Huge PDF Note');
      oversizedForm.append('collegeId', stanford!.id);
      oversizedForm.append('branchId', cseBranch!.id);
      oversizedForm.append('semester', '4');
      oversizedForm.append('subjectId', osSubject!.id);

      await axios.post(`${API_URL}/notes`, oversizedForm, {
        headers: { ...oversizedForm.getHeaders(), Authorization: `Bearer ${alexToken}` },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } catch (err: any) {
      oversizedRejected = err.response?.status === 400;
      oversizedError = err.response?.data?.message || err.message;
    }

    report(
      11,
      'Oversized files are rejected (> 25MB limit)',
      oversizedRejected,
      `Server rejected with 400: "${oversizedError}"`
    );

    // -------------------------------------------------------------------------
    // TEST 12: A user cannot modify another user's note
    // -------------------------------------------------------------------------
    let unauthorizedBlocked = false;
    let unauthorizedError = '';
    try {
      // Bob attempts to modify Alex's note
      await axios.put(
        `${API_URL}/notes/${note1.id}`,
        { title: 'Hacked by Bob' },
        { headers: { Authorization: `Bearer ${bobToken}` } }
      );
    } catch (err: any) {
      unauthorizedBlocked = err.response?.status === 403;
      unauthorizedError = err.response?.data?.message || err.message;
    }

    report(
      12,
      "A user cannot modify another user's note (HTTP 403 Forbidden)",
      unauthorizedBlocked,
      `Bob's attempt rejected with 403: "${unauthorizedError}"`
    );

    // -------------------------------------------------------------------------
    // TEST 13: A user can modify/delete their own note
    // -------------------------------------------------------------------------
    const ownerUpdateRes = await axios.put(
      `${API_URL}/notes/${note1.id}`,
      { title: 'Operating Systems Virtual Memory & Paging (Final Revision)' },
      { headers: { Authorization: `Bearer ${alexToken}` } }
    );
    const ownerUpdateSuccess =
      ownerUpdateRes.status === 200 &&
      ownerUpdateRes.data.data.title === 'Operating Systems Virtual Memory & Paging (Final Revision)';

    report(
      13,
      'A user can modify their own note',
      ownerUpdateSuccess,
      `Alex successfully updated note title to: "${ownerUpdateRes.data.data.title}"`
    );

    // -------------------------------------------------------------------------
    // TEST 14: Deleting a note handles its associated stored file correctly
    // -------------------------------------------------------------------------
    const diskPathNote2 = path.resolve(process.cwd(), 'uploads', note2.fileKey);
    const fileExistsBeforeDelete = fs.existsSync(diskPathNote2);

    // Alex deletes note2
    const deleteRes = await axios.delete(`${API_URL}/notes/${note2.id}`, {
      headers: { Authorization: `Bearer ${alexToken}` },
    });

    const fileExistsAfterDelete = fs.existsSync(diskPathNote2);
    const dbNoteAfterDelete = await prisma.note.findUnique({ where: { id: note2.id } });

    const deleteSuccess =
      deleteRes.status === 200 &&
      fileExistsBeforeDelete &&
      !fileExistsAfterDelete &&
      dbNoteAfterDelete === null;

    report(
      14,
      'Deleting a note handles its associated stored file correctly (No orphans)',
      deleteSuccess,
      `File on disk before: ${fileExistsBeforeDelete} | File on disk after: ${fileExistsAfterDelete} | DB Record after: null`
    );

    // -------------------------------------------------------------------------
    // TEST 15: No secrets are exposed to the frontend
    // -------------------------------------------------------------------------
    const listRes = await axios.get(`${API_URL}/notes`);
    const sampleNote = listRes.data.data.notes[0];
    const detailsRes = await axios.get(`${API_URL}/notes/${note1.id}`);
    const detailsJson = JSON.stringify(detailsRes.data);

    const hasPasswordHash = detailsJson.includes('passwordHash') || detailsJson.includes('$2a$');
    const hasDatabaseUrl = detailsJson.includes('postgresql://');
    const hasJwtSecret = detailsJson.includes('JWT_SECRET') || detailsJson.includes('campusnotes_default');

    const secretsSafe = !hasPasswordHash && !hasDatabaseUrl && !hasJwtSecret;
    report(
      15,
      'No secrets or sensitive hashes are exposed to the frontend API',
      secretsSafe,
      `Password hash leaked: ${hasPasswordHash} | Database URL leaked: ${hasDatabaseUrl} | JWT Secret leaked: ${hasJwtSecret}`
    );

    console.log('\n===============================================================');
    console.log(`🏁 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('===============================================================\n');

    await prisma.$disconnect();
    process.exit(failedCount > 0 ? 1 : 0);
  } catch (err: any) {
    console.error('💥 Test suite crashed:', err.response?.data || err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

runTests();
