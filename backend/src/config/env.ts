import dotenv from 'dotenv';
import path from 'path';

// Load .env file from backend directory or workspace root
const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL || '',
  jwt: {
    secret: process.env.JWT_SECRET || 'campusnotes_default_jwt_secret_dev_only_32_chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER || 'local') as 's3' | 'local',
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET || 'campus-notes',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      publicUrl: process.env.S3_PUBLIC_URL || '',
    },
    localUploadDir: path.resolve(process.cwd(), 'uploads'),
  },
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'models/gemini-embedding-001',
    embeddingDimension: 768,
    chatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-3.6-flash',
  },
  rag: {
    topK: parseInt(process.env.RAG_TOP_K || '5', 10),
    similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.45'),
  },
};
