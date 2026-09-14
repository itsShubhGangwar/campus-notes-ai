import { Router } from 'express';
import {
  createSession,
  listSessions,
  getSession,
  deleteSession,
  sendMessage,
  askDirect,
} from '../controllers/chat.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

// All chat routes require valid JWT authentication
router.use(authenticate);

// Session endpoints
router.post('/sessions', createSession);
router.get('/sessions', listSessions);
router.get('/sessions/:id', getSession);
router.delete('/sessions/:id', deleteSession);

// Messaging endpoint
router.post('/sessions/:id/messages', sendMessage);

// Stateless direct Q&A endpoint
router.post('/ask-direct', askDirect);

export default router;
