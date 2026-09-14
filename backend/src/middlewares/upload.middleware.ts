import multer, { FileFilterCallback } from 'multer';
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

// Max file size: 25MB
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  // 1. Check MIME type
  if (file.mimetype !== 'application/pdf') {
    return cb(new Error('Only PDF documents are allowed.'));
  }

  // 2. Check file extension
  if (!file.originalname.toLowerCase().endsWith('.pdf')) {
    return cb(new Error('File must have a .pdf extension.'));
  }

  return cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1, // Only 1 file per upload
  },
  fileFilter,
});

export const uploadPdf = (req: Request, res: Response, next: NextFunction) => {
  const uploadSingle = upload.single('file');

  uploadSingle(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 'File too large. Maximum allowed size is 25MB.', 400);
      }
      return sendError(res, `Upload error: ${err.message}`, 400);
    } else if (err) {
      return sendError(res, err.message || 'File upload failed', 400);
    }

    if (!req.file) {
      return sendError(res, 'Please provide a PDF file to upload.', 400);
    }

    // 3. Deep Magic Number Validation: First 5 bytes must be '%PDF-'
    // PDF Magic Number in ASCII: %PDF- (hex: 25 50 44 46 2D)
    const buffer = req.file.buffer;
    if (buffer.length < 5) {
      return sendError(res, 'Invalid or corrupted PDF file.', 400);
    }

    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      return sendError(
        res,
        'File failed security validation: Not a genuine PDF document.',
        400
      );
    }

    return next();
  });
};
