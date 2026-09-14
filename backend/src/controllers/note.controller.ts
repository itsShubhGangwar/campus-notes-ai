import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.js';
import { storageService } from '../services/storage.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { Role } from '@prisma/client';

export const createNote = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required to upload notes', 401);
    }

    if (!req.file) {
      return sendError(res, 'Please upload a PDF file', 400);
    }

    const { title, description, collegeId, branchId, semester, subjectId, tags } = req.body;

    // 1. Verify academic curriculum foreign keys
    const college = await prisma.college.findUnique({ where: { id: collegeId } });
    if (!college) return sendError(res, 'Invalid college ID', 400);

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) return sendError(res, 'Invalid branch ID', 400);

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) return sendError(res, 'Invalid subject ID', 400);

    // 2. Upload file to Object Storage (S3 / Supabase / Local fallback)
    const uploadResult = await storageService.uploadFile(req.file, 'notes');

    // 3. Process tags if provided (e.g. "midterm, exam prep, algorithms")
    let tagConnectOrCreate: any[] = [];
    if (tags) {
      const tagList = Array.isArray(tags)
        ? tags
        : String(tags)
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t.length > 0);

      tagConnectOrCreate = tagList.map((tagName: string) => {
        const slug = tagName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        return {
          tag: {
            connectOrCreate: {
              where: { slug },
              create: { name: tagName, slug },
            },
          },
        };
      });
    }

    // 4. Create Note record in PostgreSQL
    const note = await prisma.note.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        uploaderId: req.user.id,
        collegeId,
        branchId,
        semester: Number(semester),
        subjectId,
        fileUrl: uploadResult.fileUrl,
        fileKey: uploadResult.fileKey,
        fileName: req.file.originalname,
        fileSize: uploadResult.fileSize,
        fileType: 'application/pdf',
        isPublished: req.body.isPublished !== undefined ? String(req.body.isPublished) === 'true' : true,
        processingStatus: 'PENDING',
        tags: {
          create: tagConnectOrCreate,
        },
      },
      include: {
        uploader: { select: { id: true, name: true, email: true, avatarUrl: true } },
        college: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        subject: { select: { id: true, name: true, code: true, semester: true } },
        tags: { include: { tag: true } },
      },
    });

    // 5. Asynchronous background text processing trigger (Phase 3A)
    // Designed so that a queue/worker (Redis BullMQ) can be plugged in seamlessly
    setImmediate(() => {
      import('../services/pdf-processor.service.js')
        .then(({ pdfProcessorService }) => pdfProcessorService.processNote(note.id))
        .catch((err) => console.error(`Failed to process note ${note.id}:`, err));
    });

    return sendSuccess(res, note, 'Note uploaded successfully and queued for text processing', 201);
  } catch (error) {
    return next(error);
  }
};

export const getNotes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      search,
      collegeId,
      branchId,
      semester,
      subjectId,
      tag,
      uploaderId,
      sort = 'recent',
      page = '1',
      limit = '12',
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 12));
    const skip = (pageNum - 1) * limitNum;

    // Build Prisma query filter
    const where: any = { isPublished: true };

    if (collegeId) where.collegeId = String(collegeId);
    if (branchId) where.branchId = String(branchId);
    if (semester) where.semester = Number(semester);
    if (subjectId) where.subjectId = String(subjectId);
    if (uploaderId) where.uploaderId = String(uploaderId);

    if (tag) {
      where.tags = {
        some: {
          tag: {
            slug: String(tag).toLowerCase(),
          },
        },
      };
    }

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { subject: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { subject: { code: { contains: searchTerm, mode: 'insensitive' } } },
      ];
    }

    // Build sorting order
    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'popular') orderBy = { viewsCount: 'desc' };
    if (sort === 'downloads') orderBy = { downloadsCount: 'desc' };
    if (sort === 'rating') orderBy = { averageRating: 'desc' };

    const [notes, total] = await Promise.all([
      prisma.note.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include: {
          uploader: { select: { id: true, name: true, avatarUrl: true } },
          college: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          subject: { select: { id: true, name: true, code: true, semester: true } },
          tags: { include: { tag: true } },
        },
      }),
      prisma.note.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return sendSuccess(
      res,
      {
        notes,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      },
      'Notes fetched successfully'
    );
  } catch (error) {
    return next(error);
  }
};

export const getNoteById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const note = await prisma.note.findUnique({
      where: { id },
      include: {
        uploader: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
        college: { select: { id: true, name: true, code: true, city: true } },
        branch: { select: { id: true, name: true, code: true } },
        subject: { select: { id: true, name: true, code: true, semester: true, description: true } },
        tags: { include: { tag: true } },
        _count: {
          select: {
            downloads: true,
            likes: true,
            bookmarks: true,
          },
        },
      },
    });

    if (!note) {
      return sendError(res, 'Note not found', 404);
    }

    // Increment view count asynchronously
    await prisma.note.update({
      where: { id },
      data: { viewsCount: { increment: 1 } },
    });

    // Check if authenticated user has liked or bookmarked
    let isLiked = false;
    let isBookmarked = false;

    if (req.user) {
      const [like, bookmark] = await Promise.all([
        prisma.like.findUnique({
          where: { userId_noteId: { userId: req.user.id, noteId: id } },
        }),
        prisma.bookmark.findUnique({
          where: { userId_noteId: { userId: req.user.id, noteId: id } },
        }),
      ]);
      isLiked = !!like;
      isBookmarked = !!bookmark;
    }

    return sendSuccess(
      res,
      {
        ...note,
        viewsCount: note.viewsCount + 1,
        isLiked,
        isBookmarked,
      },
      'Note details retrieved'
    );
  } catch (error) {
    return next(error);
  }
};

export const updateNote = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { id } = req.params;
    const { title, description, semester, subjectId, tags } = req.body;

    const existingNote = await prisma.note.findUnique({ where: { id } });
    if (!existingNote) {
      return sendError(res, 'Note not found', 404);
    }

    // Security check: Only author or ADMIN can update
    const isOwner = existingNote.uploaderId === req.user.id;
    const isAdmin = req.user.role === Role.ADMIN;

    if (!isOwner && !isAdmin) {
      return sendError(res, 'You do not have permission to modify this note', 403);
    }

    // Update tags if provided
    if (tags !== undefined) {
      // Clear existing tags
      await prisma.noteTag.deleteMany({ where: { noteId: id } });

      const tagList = Array.isArray(tags)
        ? tags
        : String(tags)
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t.length > 0);

      for (const tagName of tagList) {
        const slug = tagName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        await prisma.noteTag.create({
          data: {
            note: { connect: { id } },
            tag: {
              connectOrCreate: {
                where: { slug },
                create: { name: tagName, slug },
              },
            },
          },
        });
      }
    }

    const updatedNote = await prisma.note.update({
      where: { id },
      data: {
        ...(title ? { title: title.trim() } : {}),
        ...(description !== undefined ? { description: description.trim() } : {}),
        ...(semester ? { semester: Number(semester) } : {}),
        ...(subjectId ? { subjectId } : {}),
      },
      include: {
        uploader: { select: { id: true, name: true } },
        college: true,
        branch: true,
        subject: true,
        tags: { include: { tag: true } },
      },
    });

    return sendSuccess(res, updatedNote, 'Note updated successfully');
  } catch (error) {
    return next(error);
  }
};

export const deleteNote = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { id } = req.params;

    const existingNote = await prisma.note.findUnique({ where: { id } });
    if (!existingNote) {
      return sendError(res, 'Note not found', 404);
    }

    // Security check: Only author or ADMIN can delete
    const isOwner = existingNote.uploaderId === req.user.id;
    const isAdmin = req.user.role === Role.ADMIN;

    if (!isOwner && !isAdmin) {
      return sendError(res, 'You do not have permission to delete this note', 403);
    }

    // 1. Delete actual file from Object Storage
    if (existingNote.fileKey) {
      await storageService.deleteFile(existingNote.fileKey);
    }

    // 2. Delete Note record from PostgreSQL (cascades to NoteTag, Download, Like, Bookmark)
    await prisma.note.delete({ where: { id } });

    return sendSuccess(res, null, 'Note and associated file deleted successfully');
  } catch (error) {
    return next(error);
  }
};

export const downloadNote = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) {
      return sendError(res, 'Note not found', 404);
    }

    // 1. Record Download in PostgreSQL
    await Promise.all([
      prisma.download.create({
        data: {
          noteId: id,
          userId: req.user ? req.user.id : null,
          ipAddress: req.ip || req.socket.remoteAddress,
        },
      }),
      prisma.note.update({
        where: { id },
        data: { downloadsCount: { increment: 1 } },
      }),
    ]);

    // 2. Stream file from Storage Service as attachment
    const { stream, contentType, contentLength } = await storageService.getFileStream(note.fileKey);

    res.setHeader('Content-Type', contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(note.fileName)}"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    stream.pipe(res);
  } catch (error) {
    return next(error);
  }
};

export const viewNoteFile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) {
      return sendError(res, 'Note not found', 404);
    }

    // Stream file inline for browser PDF viewer
    const { stream, contentType, contentLength } = await storageService.getFileStream(note.fileKey);

    res.setHeader('Content-Type', contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(note.fileName)}"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    stream.pipe(res);
  } catch (error) {
    return next(error);
  }
};

export const processNoteHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { id } = req.params;
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) {
      return sendError(res, 'Note not found', 404);
    }

    // Only owner or admin can trigger processing
    const isOwner = note.uploaderId === req.user.id;
    const isAdmin = req.user.role === Role.ADMIN;
    if (!isOwner && !isAdmin) {
      return sendError(res, 'Permission denied', 403);
    }

    const { pdfProcessorService } = await import('../services/pdf-processor.service.js');
    const result = await pdfProcessorService.processNote(id);

    return sendSuccess(res, result, 'Note processing completed');
  } catch (error) {
    return next(error);
  }
};

export const getNoteProcessingStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const note = await prisma.note.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        processingStatus: true,
        processingError: true,
        pageCount: true,
        _count: { select: { chunks: true } },
      },
    });

    if (!note) {
      return sendError(res, 'Note not found', 404);
    }

    let embeddedChunksCount = 0;
    if (note._count.chunks > 0) {
      const countRes = await prisma.$queryRawUnsafe<Array<{ count: string | number }>>(
        'SELECT COUNT(*) as count FROM note_chunks WHERE "noteId" = $1 AND embedding IS NOT NULL',
        note.id
      );
      embeddedChunksCount = Number(countRes[0]?.count || 0);
    }

    return sendSuccess(
      res,
      {
        id: note.id,
        title: note.title,
        status: note.processingStatus,
        error: note.processingError,
        pageCount: note.pageCount,
        chunksCount: note._count.chunks,
        embeddedChunksCount,
      },
      'Processing status retrieved'
    );
  } catch (error) {
    return next(error);
  }
};

export const getNoteChunks = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required to view extracted chunks', 401);
    }

    const { id } = req.params;
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) {
      return sendError(res, 'Note not found', 404);
    }

    const isOwner = note.uploaderId === req.user.id;
    const isAdmin = req.user.role === Role.ADMIN;
    if (!isOwner && !isAdmin) {
      return sendError(res, 'Only the note owner or an administrator can inspect raw chunks', 403);
    }

    const chunks = await prisma.$queryRawUnsafe<Array<{
      id: string;
      chunkIndex: number;
      pageNumber: number | null;
      content: string;
      tokenCount: number | null;
      createdAt: Date;
      hasEmbedding: boolean;
      embeddingDims: number | null;
    }>>(
      `SELECT id, "chunkIndex", "pageNumber", content, "tokenCount", "createdAt",
              (embedding IS NOT NULL) AS "hasEmbedding",
              CASE WHEN embedding IS NOT NULL THEN vector_dims(embedding) ELSE NULL END AS "embeddingDims"
       FROM note_chunks
       WHERE "noteId" = $1
       ORDER BY "chunkIndex" ASC`,
      id
    );

    return sendSuccess(
      res,
      {
        noteId: id,
        totalChunks: chunks.length,
        pageCount: note.pageCount,
        chunks,
      },
      'Extracted chunks retrieved'
    );
  } catch (error) {
    return next(error);
  }
};
