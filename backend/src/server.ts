import { createApp } from './app.js';
import { config } from './config/env.js';
import { prisma } from './config/db.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`
  ======================================================
  🚀 CampusNotes AI Backend Server Running
  📡 Local:   http://localhost:${config.port}
  🌍 Health:  http://localhost:${config.port}/api/health
  ⚙️  Env:     ${config.nodeEnv}
  ======================================================
  `);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    console.log('🔒 HTTP server closed.');
    await prisma.$disconnect();
    console.log('📦 Database connections closed.');
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
