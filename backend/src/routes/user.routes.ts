import { Router } from 'express';
import { z } from 'zod';
import { updateProfile } from '../controllers/user.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';

const router = Router();

const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters long').optional(),
    bio: z.string().max(500, 'Bio cannot exceed 500 characters').optional(),
    collegeId: z.string().uuid().optional().nullable(),
    branchId: z.string().uuid().optional().nullable(),
    semester: z.number().int().min(1).max(8).optional().nullable(),
  }),
});

router.put('/profile', authenticate, validate(updateProfileSchema), updateProfile);

export default router;
