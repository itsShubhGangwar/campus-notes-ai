import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/db.js';
import { signToken } from '../utils/jwt.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name, collegeId, branchId, semester } = req.body;

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return sendError(res, 'An account with this email already exists', 409);
    }

    // 2. Validate optional academic references if provided
    if (collegeId) {
      const collegeExists = await prisma.college.findUnique({ where: { id: collegeId } });
      if (!collegeExists) {
        return sendError(res, 'Selected college does not exist', 400);
      }
    }

    if (branchId) {
      const branchExists = await prisma.branch.findUnique({ where: { id: branchId } });
      if (!branchExists) {
        return sendError(res, 'Selected department/branch does not exist', 400);
      }
    }

    // 3. Hash password securely using bcrypt (10 rounds salt)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 4. Create user in database
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        name: name.trim(),
        collegeId: collegeId || null,
        branchId: branchId || null,
        semester: semester ? Number(semester) : null,
      },
      include: {
        college: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    // 5. Generate JWT token
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // 6. Set HTTP-Only Cookie for additional browser security
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // 7. Return sanitized user object (never return passwordHash)
    const sanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      college: user.college,
      branch: user.branch,
      semester: user.semester,
      createdAt: user.createdAt,
    };

    return sendSuccess(
      res,
      { user: sanitizedUser, token },
      'Account created successfully',
      201
    );
  } catch (error) {
    return next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    // 1. Lookup user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        college: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    if (!user) {
      return sendError(res, 'Invalid email or password', 401);
    }

    if (!user.isActive) {
      return sendError(res, 'This account has been suspended or deactivated', 403);
    }

    // 2. Compare password against stored bcrypt hash
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return sendError(res, 'Invalid email or password', 401);
    }

    // 3. Generate JWT
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // 4. Set Cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const sanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      college: user.college,
      branch: user.branch,
      semester: user.semester,
      createdAt: user.createdAt,
    };

    return sendSuccess(
      res,
      { user: sanitizedUser, token },
      'Logged in successfully',
      200
    );
  } catch (error) {
    return next(error);
  }
};

export const logout = async (req: Request, res: Response) => {
  res.clearCookie('token');
  return sendSuccess(res, null, 'Logged out successfully', 200);
};

export const getMe = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return sendError(res, 'Not authenticated', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        college: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    const sanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      college: user.college,
      branch: user.branch,
      semester: user.semester,
      createdAt: user.createdAt,
    };

    return sendSuccess(res, sanitizedUser, 'User profile retrieved');
  } catch (error) {
    return next(error);
  }
};
