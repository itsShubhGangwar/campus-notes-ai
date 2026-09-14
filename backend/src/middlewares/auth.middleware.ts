import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/jwt.js';
import { prisma } from '../config/db.js';
import { sendError } from '../utils/response.js';
import { Role } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: Role;
    collegeId: string | null;
    branchId: string | null;
    semester: number | null;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let token: string | undefined;

    // 1. Check Authorization Header (Bearer <token>)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      // 2. Fallback to HTTP-only cookie
      token = req.cookies.token;
    }

    if (!token) {
      return sendError(res, 'Authentication required. Please log in.', 401);
    }

    // 3. Verify JWT signature and expiration
    const decoded: TokenPayload = verifyToken(token);

    // 4. Check if user still exists in database and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        collegeId: true,
        branchId: true,
        semester: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return sendError(res, 'User session invalid or account deactivated', 401);
    }

    // 5. Attach user object to request
    req.user = user;
    return next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 'Session token expired. Please log in again.', 401);
    }
    return sendError(res, 'Invalid authentication token', 401);
  }
};

export const authorize = (...allowedRoles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendError(res, 'Unauthorized. Please log in.', 401);
    }

    if (!allowedRoles.includes(req.user.role)) {
      return sendError(
        res,
        `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]`,
        403
      );
    }

    return next();
  };
};
