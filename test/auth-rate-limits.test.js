const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const authRoutes = require('../backend/routes/auth');

test('login attempts remain rate-limited without throttling ordinary session reads', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(response.status, 401);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 400);
  }

  const limited = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('retry-after') || '', /^\d+$/);
  assert.match((await limited.json()).error, /Quá nhiều lần thử/);
});
