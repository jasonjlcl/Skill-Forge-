import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import fg from 'fast-glob';
import pdfParse from 'pdf-parse';
import { getVectorStore, type TrainingChunk } from '../server/src/services/vectorStore.js';

dotenv.config();

interface CliArgs {
  path: string;
  module?: string;
}

const parseArgs = (): CliArgs => {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (!current.startsWith('--')) {
      continue;
    }

    const key = current.replace(/^--/, '');
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = 'true';
    }
  }

  if (!parsed.path) {
    throw new Error('Missing required argument: --path <folder_or_file>');
  }

  return {
    path: parsed.path,
    module: parsed.module,
  };
};

const chunkText = (text: string, chunkSize = 700, overlap = 120): string[] => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) {
      break;
    }
    start = Math.max(0, end - overlap);
  }

  return chunks;
};

const readFileText = async (filePath: string): Promise<string> => {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.pdf') {
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  return fs.readFile(filePath, 'utf8');
};

const inferModule = (filePath: string, override?: string): string => {
  if (override) {
    return override;
  }

  const parentFolder = path.basename(path.dirname(filePath));
  return parentFolder || 'General Onboarding';
};

const run = async (): Promise<void> => {
  const args = parseArgs();
  const absolutePath = path.resolve(process.cwd(), args.path);

  const stats = await fs.stat(absolutePath);
  const files = stats.isDirectory()
    ? await fg(['**/*.md', '**/*.markdown', '**/*.txt', '**/*.pdf'], {
        cwd: absolutePath,
        absolute: true,
      })
    : [absolutePath];

  if (files.length === 0) {
    throw new Error('No ingestible files found. Supported: .md, .markdown, .txt, .pdf');
  }

  const chunks: TrainingChunk[] = [];

  for (const file of files) {
    const text = await readFileText(file);
    const docChunks = chunkText(text);

    for (const chunk of docChunks) {
      chunks.push({
        id: randomUUID(),
        module: inferModule(file, args.module),
        source: path.relative(process.cwd(), file),
        text: chunk,
      });
    }
  }

  const vectorStore = getVectorStore();
  await vectorStore.upsert(chunks);

  console.log(`Ingested ${chunks.length} chunks from ${files.length} file(s).`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
