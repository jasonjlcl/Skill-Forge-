import type { EnvConfig } from '../config/env.js';
import type { LlmClient } from '../services/gemini.js';
import type { VectorStore } from '../services/vectorStore.js';
import type { DataStore } from '../store/types.js';

export interface AppDeps {
  env: EnvConfig;
  store: DataStore;
  llm: LlmClient;
  vectorStore: VectorStore;
}
