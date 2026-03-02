#!/usr/bin/env node

const inputBase = process.argv[2] || 'https://skillforge.it.com';
const baseUrl = inputBase.replace(/\/+$/, '');
const password = 'Test1234!';
const retryableStatuses = new Set([502, 503, 504]);
const retryBaseMsRaw = Number.parseInt(process.env.AUTH_SMOKE_RETRY_BASE_MS ?? '1000', 10);
const retryBaseMs = Number.isFinite(retryBaseMsRaw) ? Math.max(100, retryBaseMsRaw) : 1000;
const retryMaxMsRaw = Number.parseInt(process.env.AUTH_SMOKE_RETRY_MAX_MS ?? '8000', 10);
const retryMaxMs = Number.isFinite(retryMaxMsRaw) ? Math.max(retryBaseMs, retryMaxMsRaw) : 8000;
const maxAttemptsRaw = Number.parseInt(process.env.AUTH_SMOKE_MAX_ATTEMPTS ?? '8', 10);
const maxAttempts = Number.isFinite(maxAttemptsRaw) ? Math.max(1, maxAttemptsRaw) : 8;

const cookieJar = new Map();

const getSetCookieHeader = (headers) => {
  if (typeof headers.getSetCookie === 'function') {
    const values = headers.getSetCookie();
    if (Array.isArray(values) && values.length > 0) {
      return values.join('\n');
    }
  }

  return headers.get('set-cookie') || '';
};

const absorbCookie = (headers) => {
  const raw = getSetCookieHeader(headers);
  const match = raw.match(/auth_token=([^;]+)/);
  if (match?.[1]) {
    cookieJar.set('auth_token', match[1]);
  }
};

const cookieHeader = () => {
  if (cookieJar.size === 0) {
    return '';
  }

  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
};

const request = async (path, { method = 'GET', body, withCookie = false } = {}) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (withCookie && cookieJar.size > 0) {
    headers.Cookie = cookieHeader();
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  absorbCookie(response.headers);

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    status: response.status,
    text,
    json,
  };
};

const toBodyPreview = (text) => {
  if (!text || text.trim().length === 0) {
    return '<empty>';
  }

  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
};

const assertStatus = (label, response, expected) => {
  if (response.status !== expected) {
    const error = new Error(
      `${label} expected ${expected}, got ${response.status}; body=${toBodyPreview(response.text)}`,
    );
    error.status = response.status;
    error.label = label;
    throw error;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runAttempt = async (attemptNumber) => {
  cookieJar.clear();
  const email = `smoke+${Date.now()}-${attemptNumber}@example.com`;
  console.log(`[auth-smoke] attempt=${attemptNumber}/${maxAttempts}`);
  console.log(`[auth-smoke] email=${email}`);

  const register = await request('/api/auth/register', {
    method: 'POST',
    body: {
      email,
      password,
      language: 'en',
      skillLevel: 'beginner',
    },
  });
  console.log(`[auth-smoke] register status=${register.status}`);
  assertStatus('register', register, 201);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  console.log(`[auth-smoke] login status=${login.status}`);
  assertStatus('login', login, 200);

  const me = await request('/api/auth/me', { withCookie: true });
  console.log(`[auth-smoke] me status=${me.status}`);
  assertStatus('me', me, 200);

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: `${password}-wrong` },
  });
  console.log(`[auth-smoke] wrong-password status=${badLogin.status}`);
  assertStatus('wrong-password', badLogin, 401);
};

const run = async () => {
  console.log(`[auth-smoke] base=${baseUrl}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runAttempt(attempt);
      console.log('[auth-smoke] PASS');
      return;
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : null;
      if (!status || !retryableStatuses.has(status) || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(retryMaxMs, retryBaseMs * Math.max(1, 2 ** (attempt - 1)));
      const step = typeof error?.label === 'string' ? error.label : 'request';
      console.log(
        `[auth-smoke] transient ${step} status=${status}; retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }
};

run()
  .catch((error) => {
    console.error('[auth-smoke] FAIL', error.message);
    process.exit(1);
  });
