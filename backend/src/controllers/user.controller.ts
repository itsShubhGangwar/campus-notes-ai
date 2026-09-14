import { Response, NextFunction } from 'express';
import { prisma } from '../config/db.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';

export const updateProfile = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return sendError(res, 'Not authenticated', 401);
    }

    const { name, bio, semester, collegeId, branchId } = req.body;

    // Validate college if provided
    if (collegeId) {
      const exists = await prisma.college.findUnique({ where: { id: collegeId } });
      if (!exists) return sendError(res, 'Invalid college ID', 400);
    }

    // Validate branch if provided
    if (branchId) {
      const exists = await prisma.branch.findUnique({ where: { id: branchId } });
      if (!exists) return sendError(res, 'Invalid branch ID', 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name ? { name: name.trim() } : {}),
        ...(bio !== undefined ? { bio: bio.trim() } : {}),
        ...(semester !== undefined ? { semester: Number(semester) } : {}),
        ...(collegeId !== undefined ? { collegeId: collegeId || null } : {}),
        ...(branchId !== undefined ? { branchId: branchId || null } : {}),
      },
      include: {
        college: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    const sanitizedUser = {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      avatarUrl: updatedUser.avatarUrl,
      bio: updatedUser.bio,
      college: updatedUser.college,
      branch: updatedUser.branch,
      semester: updatedUser.semester,
      createdAt: updatedUser.createdAt,
    };

    return sendSuccess(res, sanitizedUser, 'Profile updated successfully');
  } catch (error) {
    return next(error);
  }
};
