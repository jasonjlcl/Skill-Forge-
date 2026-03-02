import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './db/index.js';
import { getHealthSnapshot } from './services/health.js';
import { initializeTelemetry, shutdownTelemetry } from './services/otel.js';
import { closeAllSseConnections, getSseConnectionCount } from './services/sseRegistry.js';

const app = createApp();
const server = createServer(app);

const verifyProductionDependencies = async (): Promise<void> => {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const snapshot = await getHealthSnapshot();
  if (snapshot.status !== 'ok') {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'dependency_check_failed',
        timestamp: new Date().toISOString(),
        dependencies: snapshot.dependencies,
      }),
    );
    throw new Error('Required production dependencies are unavailable');
  }
};

const bootstrap = async (): Promise<void> => {
  try {
    await initializeTelemetry();
    await verifyProductionDependencies();
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
  } catch (error) {
    await shutdownTelemetry();
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'server_start_failed',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown startup error',
      }),
    );
    process.exit(1);
  }
};

void bootstrap();

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
    await shutdownTelemetry();

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
    await shutdownTelemetry();
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
