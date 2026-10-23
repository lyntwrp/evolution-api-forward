const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const patch = fs.readFileSync(path.join(root, 'manager-customization/webhook-header-auth.patch'), 'utf8');
const helper = patch.split('diff --git ').find((section) => section.startsWith('a/src/pages/instance/Webhook/headers.ts '));
assert.ok(helper, 'the committed patch must contain the tested source');
const source = helper.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)).join('\n');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, moduleUnderTest, moduleUnderTest.exports);
const { headersToRows, rowsToHeaders } = moduleUnderTest.exports;

test('Manager round trip preserves existing headers and exact token bytes', () => {
  const original = { Authorization: 'Bearer local-test-token', 'X-Custom': ' exact-value ' };
  assert.deepEqual(rowsToHeaders(headersToRows(original)), original);
  assert.deepEqual(rowsToHeaders([]), {});
  assert.deepEqual(headersToRows(null), []);
});

test('Manager rejects ambiguous header names, empty credentials and injected header lines', () => {
  for (const name of ['', 'x token', 'X:Token', '__proto__', 'constructor', 'prototype', 'X\r\nInjected']) {
    assert.throws(() => rowsToHeaders([{ name, value: 'test' }]));
  }
  for (const value of ['', 'test\r\nInjected: yes', 'test\n', 'test\0', 123]) {
    assert.throws(() => rowsToHeaders([{ name: 'X-Token', value }]));
  }
  assert.throws(() => rowsToHeaders([{ name: 'X-Token', value: 'one' }, { name: 'x-token', value: 'two' }]));
});
