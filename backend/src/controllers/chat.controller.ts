import { Response, NextFunction } from 'express';
import { prisma } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { ragService, ConversationTurn } from '../services/rag.service.js';
import { MessageRole, Role } from '@prisma/client';

export const createSession = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { title, noteId, subjectId, semester } = req.body;

    // Validate noteId if provided
    if (noteId) {
      const note = await prisma.note.findUnique({
        where: { id: noteId },
        select: { id: true, title: true, isPublished: true, uploaderId: true },
      });

      if (!note) {
        return sendError(res, 'Selected note does not exist', 404);
      }

      if (!note.isPublished && note.uploaderId !== req.user.id && req.user.role !== Role.ADMIN) {
        return sendError(res, 'You do not have access to this private note', 403);
      }
    }

    const defaultTitle = title?.trim() || (noteId ? 'Note Study Session' : 'Campus AI Study Session');

    const session = await prisma.chatSession.create({
      data: {
        userId: req.user.id,
        title: defaultTitle,
        noteId: noteId || null,
        subjectId: subjectId || null,
        semester: semester ? Number(semester) : null,
      },
      include: {
        note: { select: { id: true, title: true, fileName: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
    });

    return sendSuccess(res, session, 'Chat session created successfully', 201);
  } catch (error) {
    return next(error);
  }
};

export const listSessions = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        note: { select: { id: true, title: true } },
        subject: { select: { id: true, name: true, code: true } },
        _count: { select: { messages: true } },
      },
    });

    return sendSuccess(res, sessions, 'Chat sessions retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

export const getSession = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { id } = req.params;

    const session = await prisma.chatSession.findUnique({
      where: { id },
      include: {
        note: { select: { id: true, title: true, fileName: true } },
        subject: { select: { id: true, name: true, code: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) {
      return sendError(res, 'Chat session not found', 404);
    }

    if (session.userId !== req.user.id && req.user.role !== Role.ADMIN) {
      return sendError(res, 'You do not have permission to view this chat session', 403);
    }

    return sendSuccess(res, session, 'Chat session retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

export const deleteSession = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { id } = req.params;

    const session = await prisma.chatSession.findUnique({ where: { id } });
    if (!session) {
      return sendError(res, 'Chat session not found', 404);
    }

    if (session.userId !== req.user.id && req.user.role !== Role.ADMIN) {
      return sendError(res, 'You do not have permission to delete this session', 403);
    }

    await prisma.chatSession.delete({ where: { id } });

    return sendSuccess(res, { id }, 'Chat session deleted successfully');
  } catch (error) {
    return next(error);
  }
};

export const sendMessage = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { id } = req.params;
    const { content, topK, similarityThreshold } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return sendError(res, 'Message content cannot be empty', 400);
    }

    const session = await prisma.chatSession.findUnique({ where: { id } });
    if (!session) {
      return sendError(res, 'Chat session not found', 404);
    }

    if (session.userId !== req.user.id && req.user.role !== Role.ADMIN) {
      return sendError(res, 'You do not have permission to message in this session', 403);
    }

    // 1. Fetch recent message turns for bounded conversational history
    const recentMessages = await prisma.chatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });

    const history: ConversationTurn[] = recentMessages.reverse().map((m) => ({
      role: m.role === MessageRole.USER ? 'user' : 'model',
      content: m.content,
    }));

    // 2. Persist the User's message
    const userMessage = await prisma.chatMessage.create({
      data: {
        sessionId: id,
        role: MessageRole.USER,
        content: content.trim(),
      },
    });

    // 3. Execute RAG pipeline
    const ragResult = await ragService.executeRagQuery(
      content.trim(),
      {
        noteId: session.noteId || undefined,
        subjectId: session.subjectId || undefined,
        semester: session.semester || undefined,
        topK: topK ? Number(topK) : undefined,
        similarityThreshold: similarityThreshold ? Number(similarityThreshold) : undefined,
      },
      {
        id: req.user.id,
        role: req.user.role,
        collegeId: req.user.collegeId,
        branchId: req.user.branchId,
      },
      history
    );

    // 4. Persist the Assistant's message with structured sources
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: id,
        role: MessageRole.ASSISTANT,
        content: ragResult.answer,
        sources: ragResult.sources as any,
      },
    });

    // 5. Update session's updatedAt timestamp
    await prisma.chatSession.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return sendSuccess(
      res,
      {
        userMessage,
        assistantMessage: {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          sources: assistantMessage.sources,
          createdAt: assistantMessage.createdAt,
        },
        meta: {
          retrievedCount: ragResult.retrievedCount,
          topSimilarity: ragResult.topSimilarity,
          wasShortCircuited: ragResult.wasShortCircuited,
          modelUsed: ragResult.modelUsed,
        },
      },
      'Message processed successfully'
    );
  } catch (error) {
    return next(error);
  }
};

export const askDirect = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }

    const { question, noteId, subjectId, semester, topK, similarityThreshold } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return sendError(res, 'Question cannot be empty', 400);
    }

    // Validate noteId authorization if provided
    if (noteId) {
      const note = await prisma.note.findUnique({
        where: { id: noteId },
        select: { id: true, title: true, isPublished: true, uploaderId: true },
      });

      if (!note) {
        return sendError(res, 'Selected note does not exist', 404);
      }

      if (!note.isPublished && note.uploaderId !== req.user.id && req.user.role !== Role.ADMIN) {
        return sendError(res, 'You do not have permission to query this private note', 403);
      }
    }

    // Execute direct RAG query without creating a persistent session
    const result = await ragService.executeRagQuery(
      question.trim(),
      {
        noteId,
        subjectId,
        semester: semester ? Number(semester) : undefined,
        topK: topK ? Number(topK) : undefined,
        similarityThreshold: similarityThreshold ? Number(similarityThreshold) : undefined,
      },
      {
        id: req.user.id,
        role: req.user.role,
        collegeId: req.user.collegeId,
        branchId: req.user.branchId,
      }
    );

    return sendSuccess(
      res,
      {
        answer: result.answer,
        sources: result.sources,
        retrievedCount: result.retrievedCount,
        topSimilarity: result.topSimilarity,
        wasShortCircuited: result.wasShortCircuited,
        modelUsed: result.modelUsed,
      },
      'RAG query processed successfully'
    );
  } catch (error) {
    return next(error);
  }
};
