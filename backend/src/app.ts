import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import apiRouter from './routes/index.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { sendError } from './utils/response.js';

export const createApp = (): Express => {
  const app = express();

  // 1. Security Headers
  app.use(helmet());

  // 2. CORS Configuration
  app.use(
    cors({
      origin: [config.clientUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // 3. Request Logging
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

  // 4. Body & Cookie Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // 5. Global Rate Limiter
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again after 15 minutes.',
    },
  });
  app.use('/api', limiter);

  // 6. Mount API routes
  app.use('/api', apiRouter);

  // 7. 404 Not Found Handler
  app.use((req: Request, res: Response) => {
    return sendError(res, `Route ${req.method} ${req.originalUrl} not found`, 404);
  });

  // 8. Global Error Handler
  app.use(errorHandler);

  return app;
};
