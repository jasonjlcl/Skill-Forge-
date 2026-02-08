import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './db/index.js';
import { closeAllSseConnections, getSseConnectionCount } from './services/sseRegistry.js';

const app = createApp();
const server = createServer(app);

server.listen(env.PORT, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'server_started',
      timestamp: new Date().toISOString(),
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
    }),
  );
});

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'shutdown_started',
      signal,
      timestamp: new Date().toISOString(),
      activeSseConnections: getSseConnectionCount(),
    }),
  );

  const forceExitTimer = setTimeout(() => {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'shutdown_timeout',
        timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
        timestamp: new Date().toISOString(),
      }),
    );
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);

  try {
    closeAllSseConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await closeDatabase();

    clearTimeout(forceExitTimer);
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'shutdown_completed',
        timestamp: new Date().toISOString(),
      }),
    );
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'shutdown_failed',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown shutdown error',
      }),
    );
    process.exit(1);
  }
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
