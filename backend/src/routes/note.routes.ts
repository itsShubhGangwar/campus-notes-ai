import { Router, Response, NextFunction } from 'express';
import {
  createNote,
  getNotes,
  getNoteById,
  updateNote,
  deleteNote,
  downloadNote,
  viewNoteFile,
  processNoteHandler,
  getNoteProcessingStatus,
  getNoteChunks,
  likeNote,
  unlikeNote,
  bookmarkNote,
  removeBookmark,
} from '../controllers/note.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { uploadPdf } from '../middlewares/upload.middleware.js';
import { verifyToken } from '../utils/jwt.js';

const router = Router();

// Soft authenticate middleware (attaches req.user if token is present, but doesn't fail if anonymous)
const optionalAuth = (req: any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = verifyToken(token);
      req.user = { id: decoded.userId, role: decoded.role };
    } catch {
      // Ignore invalid token on optional routes
    }
  }
  next();
};

// 1. Upload note (Requires authentication + Multer PDF validation)
router.post('/', authenticate, uploadPdf, createNote);

// 2. Query / Search / Filter notes (Public with pagination)
router.get('/', getNotes);

// 3. View / Stream raw PDF file inline (for PDF.js or browser viewer)
router.get('/:id/file', viewNoteFile);

// 4. Download PDF file as attachment (increments download counter)
router.get('/:id/download', optionalAuth, downloadNote);

// 5. Get note details (increments views, returns metadata)
router.get('/:id', optionalAuth, getNoteById);

// 6. Update note metadata (Author or Admin only)
router.put('/:id', authenticate, updateNote);

// 7. Delete note & file (Author or Admin only)
router.delete('/:id', authenticate, deleteNote);

// 8. Phase 3A: Trigger / retry note text extraction & chunking
router.post('/:id/process', authenticate, processNoteHandler);

// 9. Phase 3A: Check note processing status
router.get('/:id/status', optionalAuth, getNoteProcessingStatus);

// 10. Phase 3A: Inspect extracted text chunks (Author or Admin only)
router.get('/:id/chunks', authenticate, getNoteChunks);

// 11. Phase 2 Step 2: Like & Unlike Note (Authenticated)
router.post('/:id/like', authenticate, likeNote);
router.delete('/:id/like', authenticate, unlikeNote);

// 12. Phase 2 Step 2: Bookmark & Remove Bookmark (Authenticated)
router.post('/:id/bookmark', authenticate, bookmarkNote);
router.delete('/:id/bookmark', authenticate, removeBookmark);

export default router;
