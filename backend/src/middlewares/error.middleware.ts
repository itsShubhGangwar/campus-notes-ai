import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { config } from '../config/env.js';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  console.error('🔥 Unhandled Error:', err);

  // Prisma Unique Constraint Violation (P2002)
  if (err.code === 'P2002') {
    const fields = (err.meta?.target as string[]) || [];
    return sendError(
      res,
      `A record with this ${fields.join(', ')} already exists.`,
      409
    );
  }

  // Prisma Foreign Key Constraint Failure (P2003)
  if (err.code === 'P2003') {
    return sendError(res, 'Referenced record (such as College, Branch, or Subject) does not exist.', 400);
  }

  // Prisma Record Not Found (P2025)
  if (err.code === 'P2025') {
    return sendError(res, 'The requested record was not found.', 404);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  return sendError(
    res,
    message,
    statusCode,
    config.nodeEnv === 'development' ? err.stack : undefined
  );
};
