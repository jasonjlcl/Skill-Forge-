#!/usr/bin/env node

const inputBase = process.argv[2] || 'https://skillforge.it.com';
const baseUrl = inputBase.replace(/\/+$/, '');
const ts = Date.now();
const email = `smoke+${ts}@example.com`;
const password = 'Test1234!';

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

const assertStatus = (label, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
};

const run = async () => {
  console.log(`[auth-smoke] base=${baseUrl}`);
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
  assertStatus('register', register.status, 201);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  console.log(`[auth-smoke] login status=${login.status}`);
  assertStatus('login', login.status, 200);

  const me = await request('/api/auth/me', { withCookie: true });
  console.log(`[auth-smoke] me status=${me.status}`);
  assertStatus('me', me.status, 200);

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: `${password}-wrong` },
  });
  console.log(`[auth-smoke] wrong-password status=${badLogin.status}`);
  assertStatus('wrong-password', badLogin.status, 401);

  console.log('[auth-smoke] PASS');
};

run().catch((error) => {
  console.error('[auth-smoke] FAIL', error.message);
  process.exit(1);
});

