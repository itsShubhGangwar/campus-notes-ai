import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import academicRoutes from './academic.routes.js';
import noteRoutes from './note.routes.js';
import chatRoutes from './chat.routes.js';

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'CampusNotes AI Backend',
  });
});

// Mount modules
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/academic', academicRoutes);
router.use('/notes', noteRoutes);
router.use('/chat', chatRoutes);

export default router;
