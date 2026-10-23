const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const axios = require('axios');
const { validate } = require('jsonschema');

// Execute the real controllers and schema without starting Evolution, Prisma or WhatsApp.
// HTTP tests use only loopback receivers and synthetic credentials; no external request is allowed.
const root = path.resolve(__dirname, '..');
function loadSource(relative, dependencies = {}) {
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename });
  wrapper((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'uuid') return { v4: () => 'webhook-test-schema' };
    if (name === 'jsonwebtoken') return require(name);
    throw new Error(`Unexpected dependency in isolated webhook test: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const eventModule = loadSource('src/api/integrations/event/event.controller.ts');
const { webhookSchema } = loadSource('src/api/integrations/event/webhook/webhook.schema.ts', {
  '../event.controller': eventModule,
});
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture({ globalUrl } = {}) {
  const rows = new Map();
  const calls = { saved: [], reads: [], httpOptions: [], logs: [] };
  const prisma = { webhook: {
    async upsert({ where, create, update }) {
      const changes = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
      const row = rows.has(where.instanceId) ? { ...rows.get(where.instanceId), ...changes } : create;
      rows.set(where.instanceId, clone(row));
      calls.saved.push({ instanceId: where.instanceId, row: clone(row) });
      return clone(row);
    },
    async findUnique({ where }) {
      calls.reads.push(where.instanceId);
      return rows.has(where.instanceId) ? clone(rows.get(where.instanceId)) : null;
    },
  } };
  const monitor = { waInstances: { Test: { instanceId: 'test-instance' }, Other: { instanceId: 'other-instance' } } };
  const configService = { get(name) {
    if (name === 'LOG') return { LEVEL: ['WEBHOOKS'] };
    if (name === 'WEBHOOK') return {
      GLOBAL: { ENABLED: !!globalUrl, URL: globalUrl || '', WEBHOOK_BY_EVENTS: false },
      EVENTS: { MESSAGES_UPSERT: true },
      REQUEST: { TIMEOUT_MS: 2000 },
      RETRY: { MAX_ATTEMPTS: 1, INITIAL_DELAY_SECONDS: 0, NON_RETRYABLE_STATUS_CODES: [400, 401, 403, 404, 422] },
    };
    throw new Error(`Unexpected config section ${name}`);
  } };
  const { WebhookController } = loadSource('src/api/integrations/event/webhook/webhook.controller.ts', {
    '../event.controller': eventModule,
    '@config/env.config': { configService },
    '@config/logger.config': { Logger: class {
      log(value) { calls.logs.push({ level: 'log', value }); }
      error(value) { calls.logs.push({ level: 'error', value }); }
    } },
    axios: { create(options) {
      assert.equal(new URL(options.baseURL).hostname, '127.0.0.1', 'Test HTTP must stay on loopback');
      calls.httpOptions.push(options);
      // Ignore host proxy settings so synthetic test credentials never leave this machine.
      return axios.create({ ...options, proxy: false });
    } },
  });
  return { controller: new WebhookController(prisma, monitor), calls, rows };
}

const sampleEvent = {
  instanceName: 'Test', origin: 'test', event: 'messages.upsert',
  data: { key: { id: 'SYNTHETIC_MESSAGE', fromMe: false }, message: { conversation: 'Synthetic test event' } },
  serverUrl: 'https://example.test', dateTime: '2026-10-23T00:00:00.000Z',
  sender: '14155550000@s.whatsapp.net', local: true,
};
const webhookData = (url, headers) => ({ webhook: {
  enabled: true, url, ...(headers === undefined ? {} : { headers }),
  events: ['MESSAGES_UPSERT'], byEvents: false, base64: false,
} });

async function receiver(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const record = { path: req.url, method: req.method, headers: req.headers, raw, body: raw ? JSON.parse(raw) : undefined };
    requests.push(record);
    const result = handler(record) || { status: 200 };
    record.responseStatus = result.status;
    res.writeHead(result.status, { 'Content-Type': 'application/json', ...result.headers });
    res.end(JSON.stringify({ status: result.status }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('existing webhook schema and controller persist, read, update and clear static headers per instance', async () => {
  const f = fixture();
  const headers = { Authorization: 'Bearer synthetic-authorization', 'X-Evolution-Webhook-Token': 'synthetic-custom-token' };
  const data = webhookData('http://127.0.0.1:1/not-called', headers);
  assert.equal(validate(data, webhookSchema).valid, true);
  assert.equal(validate(webhookData(data.webhook.url, 'invalid'), webhookSchema).valid, false);
  await f.controller.set('Test', data);
  assert.deepEqual((await f.controller.get('Test')).headers, headers);
  assert.equal(await f.controller.get('Other'), null);
  assert.equal(await f.controller.get('Missing'), null);
  await f.controller.set('Test', webhookData(data.webhook.url, { Authorization: 'Bearer replacement-synthetic' }));
  assert.deepEqual((await f.controller.get('Test')).headers, { Authorization: 'Bearer replacement-synthetic' });
  await f.controller.set('Test', webhookData(data.webhook.url, {}));
  assert.deepEqual((await f.controller.get('Test')).headers, {});
  assert.deepEqual(f.calls.saved.map((entry) => entry.instanceId), ['test-instance', 'test-instance', 'test-instance']);
});

test('static Authorization and custom token reach HTTP headers without appearing in the webhook JSON or logs', async () => {
  const authorization = 'Bearer test-only-static-authorization';
  const customToken = 'test-only-custom-webhook-token';
  const target = await receiver((request) => ({ status: request.headers.authorization === authorization && request.headers['x-evolution-webhook-token'] === customToken ? 200 : 401 }));
  try {
    const f = fixture();
    await f.controller.set('Test', webhookData(target.url + '/protected', { Authorization: authorization, 'X-Evolution-Webhook-Token': customToken }));
    await f.controller.emit(sampleEvent);
    assert.equal(target.requests.length, 1);
    const request = target.requests[0];
    assert.equal(request.responseStatus, 200);
    assert.equal(request.headers.authorization, authorization);
    assert.equal(request.headers['x-evolution-webhook-token'], customToken);
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body.data, sampleEvent.data);
    assert.equal(request.body.event, 'messages.upsert');
    assert.equal(Object.hasOwn(request.body, 'headers'), false);
    for (const secret of [authorization, customToken]) {
      assert.equal(request.raw.includes(secret), false);
      assert.equal(JSON.stringify(f.calls.logs).includes(secret), false);
    }
  } finally { await target.close(); }
});

test('a simulated n8n Header Auth receiver rejects missing and wrong tokens with 401 and accepts the configured token', async () => {
  const expected = 'test-only-n8n-header-auth';
  const target = await receiver((request) => ({ status: request.headers['x-evolution-webhook-token'] === expected ? 200 : 401 }));
  try {
    for (const [headers, status] of [[undefined, 401], [{ 'X-Evolution-Webhook-Token': 'wrong-test-value' }, 401], [{ 'X-Evolution-Webhook-Token': expected }, 200]]) {
      const f = fixture();
      await f.controller.set('Test', webhookData(target.url, headers));
      await f.controller.emit(sampleEvent);
      assert.equal(target.requests.at(-1).responseStatus, status);
      if (status === 401) assert.ok(f.calls.logs.some((entry) => entry.value.statusCode === 401));
      else assert.equal(f.calls.logs.some((entry) => entry.level === 'error'), false);
      assert.equal(JSON.stringify(f.calls.logs).includes(expected), false);
    }
    assert.equal(target.requests.length, 3, 'Authentication failures are not retried');
  } finally { await target.close(); }
});

test('ordinary webhooks without configured headers continue to deliver JSON', async () => {
  const target = await receiver(() => ({ status: 200 }));
  try {
    const f = fixture();
    await f.controller.set('Test', webhookData(target.url));
    await f.controller.emit(sampleEvent);
    assert.equal(target.requests.length, 1);
    assert.equal(target.requests[0].responseStatus, 200);
    assert.equal(target.requests[0].headers.authorization, undefined);
    assert.equal(target.requests[0].headers['x-evolution-webhook-token'], undefined);
    assert.deepEqual(target.requests[0].body.data, sampleEvent.data);
  } finally { await target.close(); }
});

test('redirects cannot carry configured webhook credentials to another endpoint', async () => {
  const target = await receiver(() => ({ status: 200 }));
  const redirect = await receiver((request) => ({ status: Number(request.path.slice(1)), headers: { Location: target.url + '/must-not-receive-secret' } }));
  try {
    for (const status of [302, 307]) {
      for (const headers of [{ Authorization: 'Bearer redirect-test-only' }, { 'X-Evolution-Webhook-Token': 'redirect-test-only' }]) {
        const f = fixture();
        await f.controller.set('Test', webhookData(redirect.url + '/' + status, headers));
        await f.controller.emit(sampleEvent);
        assert.equal(f.calls.httpOptions[0].maxRedirects, 0);
        assert.ok(f.calls.logs.some((entry) => entry.value.statusCode === status));
        assert.equal(target.requests.length, 0, 'Redirect target must never receive the token');
      }
    }
    assert.equal(redirect.requests.length, 4);
  } finally { await Promise.all([redirect.close(), target.close()]); }
});

test('webhooks without authentication headers retain existing redirect behavior', async () => {
  const target = await receiver(() => ({ status: 200 }));
  const redirect = await receiver(() => ({ status: 302, headers: { Location: target.url + '/ordinary-redirect' } }));
  try {
    for (const headers of [undefined, {}]) {
      const f = fixture();
      await f.controller.set('Test', webhookData(redirect.url, headers));
      await f.controller.emit(sampleEvent);
      assert.notEqual(f.calls.httpOptions[0].maxRedirects, 0);
      assert.equal(f.calls.logs.some((entry) => entry.level === 'error'), false);
    }
    assert.equal(redirect.requests.length, 2);
    assert.equal(target.requests.length, 2);
  } finally { await Promise.all([redirect.close(), target.close()]); }
});

test('instance webhook authentication headers are not reused by the global webhook', async () => {
  const target = await receiver(() => ({ status: 200 }));
  try {
    const token = 'test-only-local-token';
    const f = fixture({ globalUrl: target.url + '/global' });
    await f.controller.set('Test', webhookData(target.url + '/local', { 'X-Evolution-Webhook-Token': token }));
    await f.controller.emit(sampleEvent);
    assert.equal(target.requests.length, 2);
    assert.equal(target.requests[0].path, '/local');
    assert.equal(target.requests[0].headers['x-evolution-webhook-token'], token);
    assert.equal(target.requests[1].path, '/global');
    assert.equal(target.requests[1].headers['x-evolution-webhook-token'], undefined);
    assert.equal(target.requests[1].raw.includes(token), false);
  } finally { await target.close(); }
});
