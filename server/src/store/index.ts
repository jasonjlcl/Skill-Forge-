import { env } from '../config/env.js';
import { getDb } from '../db/index.js';
import { createInMemoryStore } from './inMemoryStore.js';
import { createPostgresStore } from './postgresStore.js';
import type { DataStore } from './types.js';

let activeStore: DataStore | null = null;

export const createStore = (): DataStore => {
  if (env.DATABASE_URL && getDb()) {
    return createPostgresStore();
  }

  return createInMemoryStore();
};

export const getStore = (): DataStore => {
  if (!activeStore) {
    activeStore = createStore();
  }
  return activeStore;
};

export const setStore = (store: DataStore): void => {
  activeStore = store;
};

export type { DataStore } from './types.js';
