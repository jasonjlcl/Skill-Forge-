import 'dotenv/config';
import { env } from '../src/config/env.js';
import { createStore } from '../src/store/index.js';

interface CliArgs {
  days?: number;
  userId?: string;
}

const parseNumberArg = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid numeric argument: "${value}"`);
  }
  return parsed;
};

const parseArgs = (): CliArgs => {
  const args = process.argv.slice(2);
  const parsed: CliArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === '--days') {
      parsed.days = parseNumberArg(args[index + 1]);
      index += 1;
      continue;
    }
    if (current.startsWith('--days=')) {
      parsed.days = parseNumberArg(current.split('=')[1]);
      continue;
    }
    if (current === '--user-id') {
      parsed.userId = args[index + 1];
      index += 1;
      continue;
    }
    if (current.startsWith('--user-id=')) {
      parsed.userId = current.split('=')[1];
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return parsed;
};

const main = async (): Promise<void> => {
  const cli = parseArgs();
  const retentionDays = cli.days ?? env.dataRetentionDays;
  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const store = createStore();

  const result = await store.purgeRetainedData({
    cutoff,
    userId: cli.userId,
    now,
  });

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'retention_purge_completed',
      timestamp: now.toISOString(),
      cutoff: cutoff.toISOString(),
      retentionDays,
      scope: cli.userId ? 'single_user' : 'global',
      userId: cli.userId,
      result,
    }),
  );
};

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'retention_purge_failed',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
