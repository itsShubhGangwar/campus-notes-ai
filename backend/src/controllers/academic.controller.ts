import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.js';
import { sendSuccess } from '../utils/response.js';

export const getColleges = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const colleges = await prisma.college.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        state: true,
        _count: { select: { branches: true } },
      },
    });

    return sendSuccess(res, colleges, 'Colleges retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

export const getBranchesByCollege = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { collegeId } = req.params;

    const branches = await prisma.branch.findMany({
      where: { collegeId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        collegeId: true,
      },
    });

    return sendSuccess(res, branches, 'Branches retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

export const getSubjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { branchId, semester } = req.query;

    const where: any = {};
    if (branchId) where.branchId = String(branchId);
    if (semester) where.semester = Number(semester);

    const subjects = await prisma.subject.findMany({
      where,
      orderBy: [{ semester: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        semester: true,
        branchId: true,
        description: true,
      },
    });

    return sendSuccess(res, subjects, 'Subjects retrieved successfully');
  } catch (error) {
    return next(error);
  }
};
