const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, before } = require('node:test');
const ts = require('typescript');
const { validate } = require('jsonschema');

// Compile the real source in isolation: no app boot, real database, Redis or WhatsApp connection.
// Baileys protobuf and message generation remain real; only external effects are mocked.
const root = path.resolve(__dirname, '..');
const statusCodes = { OK: 200, CREATED: 201, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 };
const noOp = () => {};
const logger = { verbose: noOp, error: noOp, warn: noOp, log: noOp, info: noOp, debug: noOp, trace: noOp };
let baileys;

function loadSource(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${output}\n})`, { filename });
  wrapper((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'baileys') return baileys;
    if (name === 'uuid') return { v4: () => 'test-schema-id' };
    if (name === './index.router' || name === '@api/routes/index.router') return { HttpStatus: statusCodes };
    if (name === '@config/logger.config') return { Logger: class { error() {} } };
    if (name === '@exceptions') return exceptions;
    if (['express', 'express-async-errors', 'multer', 'jsonschema', 'class-validator', 'emoji-regex', 'long', 'crypto', 'path', 'os', 'stream', 'child_process'].includes(name)) return require(name);
    return {};
  }, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

let exceptions;
let Service;
let SendMessageController;
let schema;
let dto;
let events;

before(async () => {
  baileys = await import('baileys');
  exceptions = {
    ...loadSource('src/exceptions/400.exception.ts'),
    ...loadSource('src/exceptions/401.exception.ts'),
    ...loadSource('src/exceptions/403.exception.ts'),
    ...loadSource('src/exceptions/404.exception.ts'),
  };
  schema = loadSource('src/validate/message.schema.ts');
  dto = loadSource('src/api/dto/sendMessage.dto.ts');
  events = loadSource('src/api/types/wa.types.ts');
  class ChannelStartupService {
    get instanceId() { return this.instance.id; }
    get instanceName() { return this.instance.name; }
  }
  const CacheService = class {};
  const CacheEngine = class { getEngine() { return {}; } };
  ({ BaileysStartupService: Service } = loadSource('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts', {
    '@api/services/channel.service': { ChannelStartupService },
    '@api/services/cache.service': { CacheService },
    '@cache/cacheengine': { CacheEngine },
    '@config/env.config': { configService: { get: () => ({}) } },
    '@api/types/wa.types': events,
    '@api/dto/chat.dto': loadSource('src/api/dto/chat.dto.ts'),
    '@utils/createJid': loadSource('src/utils/createJid.ts'),
    '@utils/onWhatsappCache': { getOnWhatsappCache: async () => [], saveOnWhatsappCache: async () => {} },
    '@utils/renderStatus': loadSource('src/utils/renderStatus.ts'),
  }));
  ({ SendMessageController } = loadSource('src/api/controllers/sendMessage.controller.ts'));
});

function fixture(message = { conversation: 'Mensaje original' }, options = {}) {
  const instanceId = options.instanceId || 'test-instance-id';
  const saved = {
    key: { id: '3EB0ORIGINAL', remoteJid: '120363000000001@g.us', fromMe: true },
    message,
    contextInfo: options.contextInfo,
    instanceId: options.sourceInstanceId || instanceId,
  };
  const calls = { queries: [], sends: [], generated: [], saved: [], webhooks: [], groups: [] };
  const service = Object.create(Service.prototype);
  service.instance = { id: instanceId, name: 'forward-test', wuid: '5215555555555@s.whatsapp.net' };
  service.logger = logger;
  service.localChatwoot = { enabled: false };
  service.localWebhook = { enabled: false };
  service.configService = { get(name) {
    return {
      DATABASE: { SAVE_DATA: { NEW_MESSAGE: true } },
      CACHE: { REDIS: { ENABLED: false }, LOCAL: { ENABLED: false } },
      CHATWOOT: { ENABLED: false }, OPENAI: { ENABLED: false }, S3: { ENABLE: false },
    }[name] || {};
  } };
  service.prismaRepository = {
    async $queryRaw(strings, ...values) {
      calls.queries.push({ sql: strings.join('?'), values });
      return values[0] === saved.instanceId && values[1] === saved.key.id ? [saved] : [];
    },
    contact: { findMany: async () => [] },
    message: { async create({ data }) { calls.saved.push(data); return { id: 'database-forward-id', ...data }; } },
  };
  service.findGroup = async ({ groupJid }) => {
    calls.groups.push(groupJid);
    return options.missingGroup ? null : { id: groupJid, subject: 'Grupo de prueba', participants: [], ephemeralDuration: 0 };
  };
  service.sendDataWebhook = (event, payload) => { calls.webhooks.push({ event, payload }); };
  service.client = {
    onWhatsApp: async (...jids) => jids.map((jid) => ({ jid, exists: true })),
    async sendMessage(jid, content, sendOptions) {
      calls.sends.push({ jid, content, options: sendOptions });
      const generated = await baileys.generateWAMessageContent(content, { userJid: service.instance.wuid, logger });
      calls.generated.push(generated);
      return baileys.proto.WebMessageInfo.fromObject({
        key: { remoteJid: jid, fromMe: true, id: '3EB0FORWARDED' },
        message: generated,
        messageTimestamp: 1792674000,
        status: 1,
      });
    },
  };
  return { service, saved, calls };
}

const previewSidecar = '__evolutionForwardPreview';
const previewBytes = Buffer.from([255, 216, 255, 224, 12, 34, 56, 78]);
function originalLinkPreview(options = {}) {
  return {
    key: { id: '3EB0ORIGINAL', remoteJid: '120363000000001@g.us', fromMe: false },
    pushName: 'Preview test',
    messageTimestamp: 1792673000,
    status: 3,
    message: {
      extendedTextMessage: {
        text: 'Articulo https://example.test/noticia',
        matchedText: 'https://example.test/noticia',
        title: 'Titulo original de la tarjeta',
        description: 'Descripcion original de la tarjeta',
        previewType: 5,
        doNotPlayInline: true,
        jpegThumbnail: previewBytes,
        thumbnailDirectPath: '/test-preview-only',
        thumbnailSha256: previewBytes,
        thumbnailEncSha256: previewBytes,
        mediaKey: previewBytes,
        mediaKeyTimestamp: 1792672000,
        thumbnailWidth: 640,
        thumbnailHeight: 360,
        contextInfo: options.contextInfo || { isForwarded: true, forwardingScore: 3 },
      },
    },
  };
}

async function storeReceivedPreview(f, original = originalLinkPreview()) {
  const normalized = f.service.prepareMessage(original);
  const storage = f.service.prepareMessageForStorage(normalized, original);
  await f.service.prismaRepository.message.create({ data: storage });
  // Match the JSON representation obtained after a real Prisma JSONB round trip.
  Object.assign(f.saved, JSON.parse(JSON.stringify(storage)));
  return { original, normalized, storage };
}

async function editablePreviewFixture({ failUpdate = false } = {}) {
  const f = fixture();
  const original = originalLinkPreview();
  original.key.fromMe = true;
  await storeReceivedPreview(f, original);
  f.saved.id = 'stored-original-id';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  f.calls.updates = [];
  f.service.prismaRepository.$queryRaw = async (strings, ...values) => {
    f.calls.queries.push({ sql: strings.join('?'), values });
    return values[0] === f.saved.instanceId && values[1] === f.saved.key.id ? [clone(f.saved)] : [];
  };
  Object.assign(f.service.prismaRepository.message, {
    async findFirst({ where }) {
      return where.key?.equals === f.saved.key.id ? clone(f.saved) : null;
    },
    async update({ where, data }) {
      assert.equal(where.id, f.saved.id);
      f.calls.updates.push(clone(data));
      if (failUpdate) throw new Error('Test database update failure');
      Object.assign(f.saved, clone(data));
      return clone(f.saved);
    },
    async count({ where }) {
      assert.equal(where.instanceId, f.saved.instanceId);
      return 1;
    },
    async findMany({ where }) {
      assert.equal(where.instanceId, f.saved.instanceId);
      return [clone(f.saved)];
    },
  });
  return f;
}

function syntheticTransportMetadata() {
  const distribution = Buffer.concat([
    Buffer.from([0x33]),
    baileys.proto.SenderKeyDistributionMessage.encode({
      id: 101,
      iteration: 7,
      chainKey: Buffer.alloc(32, 0x41),
      signingKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 0x42)]),
    }).finish(),
  ]);
  return {
    senderKeyDistributionMessage: {
      groupId: '120363000000001@g.us',
      axolotlSenderKeyDistributionMessage: distribution,
    },
    fastRatchetKeySenderKeyDistributionMessage: {
      groupId: '120363000000001@g.us',
      axolotlSenderKeyDistributionMessage: distribution,
    },
    messageContextInfo: { messageSecret: Buffer.alloc(32, 0x43), deviceListMetadataVersion: 2 },
    mediaUrl: 'https://example.test/private-storage-object',
    base64: 'U1lOVEhFVElDX1NFQ1JFVA==',
    speechToText: 'Synthetic stored transcription',
  };
}

function assertPreviewMetadata(actual, expected) {
  for (const name of ['text', 'matchedText', 'title', 'description', 'previewType', 'doNotPlayInline', 'thumbnailDirectPath', 'thumbnailWidth', 'thumbnailHeight']) {
    assert.equal(actual[name], expected[name], name);
  }
  for (const name of ['jpegThumbnail', 'thumbnailSha256', 'thumbnailEncSha256', 'mediaKey']) {
    assert.deepEqual(Buffer.from(actual[name] || []), Buffer.from(expected[name]), name);
  }
  assert.equal(Number(actual.mediaKeyTimestamp), Number(expected.mediaKeyTimestamp));
}

test('schema accepts group JIDs, phone numbers and optional replacement text while rejecting extra instructions', () => {
  const valid = (body) => validate(Object.assign(new dto.ForwardMessageDto(), body), schema.forwardMessageSchema).valid;
  for (const number of ['120363000000002@g.us', '12345-67890@g.us', '5215555555555', '5215555555555@s.whatsapp.net']) {
    assert.equal(valid({ number, messageId: '3EB0ORIGINAL' }), true, number);
  }
  for (const text of ['Texto nuevo', '  Texto con espacios  ', 'Línea uno\nLínea dos', 'x'.repeat(65536)]) {
    assert.equal(valid({ number: '123@g.us', messageId: '3EB0ORIGINAL', text }), true);
  }
  for (const text of [null, 123, true, {}, [], '', '   ', '\r\n\t', 'x'.repeat(65537)]) {
    assert.equal(valid({ number: '123@g.us', messageId: '3EB0ORIGINAL', text }), false);
  }
  for (const body of [
    { number: '', messageId: 'id' }, { number: '120363000000002@g.us', messageId: '' },
    { number: '120363000000002@g.us', messageId: '   ' },
    { number: 'status@broadcast', messageId: 'id' }, { number: 'x@newsletter', messageId: 'id' },
    { number: '123@lid', messageId: 'id' }, { number: 'https://example.com', messageId: 'id' },
    { number: '123@g.us', messageId: 'id', instanceName: 'other' },
    { number: '123@g.us', messageId: 'id', message: { conversation: 'injected' } },
    { number: '123@g.us', messageId: 'x'.repeat(201) },
  ]) assert.equal(valid(body), false, JSON.stringify(body));
});

test('optional text changes only the forwarded copy of plain or extended text', async () => {
  const replacement = '  Mensaje personalizado\nhttps://example.test/nuevo  ';
  for (const message of [{ conversation: 'Mensaje original' }, { extendedTextMessage: { text: 'Mensaje original' } }]) {
    const f = fixture(message);
    const before = JSON.stringify(f.saved);
    const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: replacement });
    const forwarded = f.calls.sends[0].content.forward.message;
    assert.equal(forwarded.conversation ?? forwarded.extendedTextMessage?.text, replacement);
    assert.equal(result.message.conversation, replacement);
    assert.equal(result.contextInfo.forwardingScore, 1);
    assert.equal(result.contextInfo.isForwarded, true);
    assert.equal(f.calls.saved[0].message.conversation, replacement);
    assert.equal(f.calls.saved[0].message[previewSidecar], undefined);
    assert.equal(Object.hasOwn(f.calls.generated[0].extendedTextMessage, 'title'), false);
    assert.equal(JSON.stringify(f.saved), before);
  }
});

test('service rejects invalid replacement text before looking up or sending a message', async () => {
  for (const text of [null, 123, true, {}, [], '', '   ', '\r\n\t', 'x'.repeat(65537)]) {
    const f = fixture();
    const before = JSON.stringify(f.saved);
    await assert.rejects(f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text }),
      (error) => error.status === 400);
    assert.equal(f.calls.queries.length, 0);
    assert.equal(f.calls.sends.length, 0);
    assert.equal(f.calls.saved.length, 0);
    assert.equal(f.calls.webhooks.length, 0);
    assert.equal(JSON.stringify(f.saved), before);
  }
});

test('replacement text preserves the same stored URL card bytes and increments its forwarding score once', async () => {
  for (const storedForm of ['sidecar', 'extendedTextMessage']) {
    const original = originalLinkPreview();
    const f = fixture(storedForm === 'extendedTextMessage' ? original.message : undefined);
    if (storedForm === 'sidecar') await storeReceivedPreview(f, original);
    const before = JSON.stringify(f.saved);
    const originalBefore = JSON.stringify(original);
    const replacement = 'Oferta de hoy\nhttps://example.test/noticia\nConsulta los detalles';
    const result = await f.service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL', text: replacement });
    const expected = { ...original.message.extendedTextMessage, text: replacement };
    const forwarded = f.calls.sends[0].content.forward.message;
    assertPreviewMetadata(forwarded.extendedTextMessage, expected);
    assertPreviewMetadata(f.calls.generated[0].extendedTextMessage, expected);
    assert.equal(forwarded[previewSidecar], undefined);
    assert.equal(result.message[previewSidecar], undefined);
    assert.equal(result.message.conversation, replacement);
    assert.equal(result.contextInfo.forwardingScore, 4);
    assert.equal(result.contextInfo.isForwarded, true);
    const secondStorage = f.calls.saved.at(-1);
    assert.equal(secondStorage.message[previewSidecar].text, replacement);
    assert.equal(secondStorage.message[previewSidecar].fields.title, expected.title);
    assert.deepEqual(Buffer.from(Object.values(secondStorage.message[previewSidecar].fields.jpegThumbnail)), previewBytes);
    assert.equal(JSON.stringify(f.saved), before, storedForm);
    assert.equal(JSON.stringify(original), originalBefore, storedForm);
  }
});

test('replacement text preserves the visual externalAdReply while dropping quotes and tracking metadata', async () => {
  const url = 'https://example.test/contextual';
  const f = fixture({ conversation: `Original ${url}` }, { contextInfo: {
    forwardingScore: 8,
    quotedMessage: { conversation: 'Private quote' },
    externalAdReply: {
      sourceUrl: url,
      title: 'Tarjeta contextual',
      body: 'Descripcion contextual',
      thumbnail: previewBytes,
      mediaType: 1,
      renderLargerThumbnail: true,
      ctwaClid: 'PRIVATE_TRACKING',
    },
  } });
  const before = JSON.stringify(f.saved);
  const replacement = `Texto personalizado ${url}`;
  const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: replacement });
  assert.equal(result.message.conversation, replacement);
  assert.equal(result.contextInfo.forwardingScore, 9);
  assert.equal(result.contextInfo.externalAdReply.sourceUrl, url);
  assert.equal(result.contextInfo.externalAdReply.title, 'Tarjeta contextual');
  assert.equal(result.contextInfo.externalAdReply.body, 'Descripcion contextual');
  assert.deepEqual(Buffer.from(result.contextInfo.externalAdReply.thumbnail), previewBytes);
  assert.equal(result.contextInfo.quotedMessage, undefined);
  assert.equal(result.contextInfo.externalAdReply.ctwaClid, undefined);
  assert.deepEqual(Object.keys(f.calls.sends[0].content.contextInfo), ['externalAdReply']);
  assert.equal(JSON.stringify(f.saved), before);
});

test('card URL matching accepts whitespace boundaries without interpreting URL punctuation as a pattern', async () => {
  const url = 'https://example.test/path?x=1+2&y=a.b';
  for (const whitespace of ['\n', '\r\n', '\t', '\u00a0', '\u2003']) {
    const f = fixture({ extendedTextMessage: {
      text: `Original${whitespace}${url}${whitespace}detalle`,
      matchedText: url,
      title: 'Tarjeta conservada',
      jpegThumbnail: previewBytes,
    } });
    const replacement = `Nuevo${whitespace}${url}${whitespace}detalle nuevo`;
    const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: replacement });
    assert.equal(result.message.conversation, replacement);
    assert.equal(f.calls.generated[0].extendedTextMessage.matchedText, url);
    assert.equal(f.calls.generated[0].extendedTextMessage.title, 'Tarjeta conservada');
    assert.deepEqual(Buffer.from(f.calls.generated[0].extendedTextMessage.jpegThumbnail), previewBytes);
  }
});

test('when both kinds of URL card are present their distinct URLs must both survive replacement', async () => {
  const nativeUrl = 'https://example.test/noticia';
  const contextUrl = 'https://example.test/contextual';
  const message = { extendedTextMessage: {
    text: `Original ${nativeUrl} ${contextUrl}`,
    matchedText: nativeUrl,
    title: 'Tarjeta nativa',
    jpegThumbnail: previewBytes,
    contextInfo: {
      forwardingScore: 2,
      externalAdReply: { sourceUrl: contextUrl, title: 'Tarjeta contextual', thumbnail: previewBytes },
    },
  } };
  for (const replacement of [`Nuevo ${nativeUrl}`, `Nuevo ${contextUrl}`]) {
    const f = fixture(message);
    await assert.rejects(f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: replacement }),
      (error) => error.status === 400, replacement);
    assert.equal(f.calls.sends.length, 0);
    assert.equal(f.calls.saved.length, 0);
  }
  const f = fixture(message);
  const before = JSON.stringify(f.saved);
  const replacement = `Nuevo ${nativeUrl}\n${contextUrl}`;
  const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: replacement });
  assert.equal(result.message.conversation, replacement);
  assert.equal(f.calls.generated[0].extendedTextMessage.matchedText, nativeUrl);
  assert.equal(f.calls.generated[0].extendedTextMessage.title, 'Tarjeta nativa');
  assert.equal(result.contextInfo.externalAdReply.sourceUrl, contextUrl);
  assert.equal(result.contextInfo.externalAdReply.title, 'Tarjeta contextual');
  assert.equal(result.contextInfo.forwardingScore, 3);
  assert.equal(JSON.stringify(f.saved), before);
});

test('changing text rejects URL cards without an exact original URL token in both original and replacement text', async () => {
  const url = 'https://example.test/noticia';
  const cases = [
    { replacement: 'Texto sin enlace' },
    { replacement: 'Texto https://example.test/otra-noticia' },
    { replacement: `Texto ${url}/otra` },
    { replacement: `Texto ${url}?redirect=otro` },
    { replacement: `Texto ${url}#otra` },
    { replacement: `Texto https://evil.test/${url}` },
    { replacement: `Texto prefijo${url}` },
    { replacement: `Texto (${url})` },
    { replacement: `Texto ${url}.` },
    { originalText: 'Original sin enlace', replacement: `Nuevo ${url}` },
    { originalText: `Original ${url}/otra`, replacement: `Nuevo ${url}` },
    { cardUrl: '', replacement: `Nuevo ${url}` },
    { cardUrl: null, replacement: `Nuevo ${url}` },
  ];
  for (const previewType of ['ordinary', 'externalAdReply']) {
    for (const item of cases) {
      const cardUrl = Object.hasOwn(item, 'cardUrl') ? item.cardUrl : url;
      const sourceText = item.originalText || `Original ${url}`;
      const f = previewType === 'ordinary'
        ? fixture({ extendedTextMessage: { text: sourceText, matchedText: cardUrl, title: 'Original card', jpegThumbnail: previewBytes } })
        : fixture({ conversation: sourceText }, { contextInfo: { externalAdReply: { sourceUrl: cardUrl, title: 'Original card', thumbnail: previewBytes } } });
      const before = JSON.stringify(f.saved);
      await assert.rejects(f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: item.replacement }),
        (error) => error.status === 400, `${previewType}: ${JSON.stringify(item)}`);
      assert.equal(f.calls.sends.length, 0);
      assert.equal(f.calls.generated.length, 0);
      assert.equal(f.calls.saved.length, 0);
      assert.equal(f.calls.webhooks.length, 0);
      assert.equal(JSON.stringify(f.saved), before);
    }
  }
});

test('supplying unchanged text preserves R2 forwarding for cards that lack a URL', async () => {
  const text = 'Texto original sin URL visible';
  for (const message of [
    { extendedTextMessage: { text, title: 'Tarjeta sin matchedText', jpegThumbnail: previewBytes } },
    { conversation: text },
  ]) {
    const f = fixture(message, { contextInfo: { externalAdReply: { title: 'Tarjeta sin sourceUrl', thumbnail: previewBytes } } });
    const before = JSON.stringify(f.saved);
    const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text });
    assert.equal(result.message.conversation, text);
    assert.equal(f.calls.sends.length, 1);
    if (message.extendedTextMessage) {
      assert.equal(f.calls.generated[0].extendedTextMessage.title, message.extendedTextMessage.title);
      assert.deepEqual(Buffer.from(f.calls.generated[0].extendedTextMessage.jpegThumbnail), previewBytes);
    } else {
      assert.equal(result.contextInfo.externalAdReply.title, 'Tarjeta sin sourceUrl');
      assert.deepEqual(Buffer.from(result.contextInfo.externalAdReply.thumbnail), previewBytes);
    }
    assert.equal(JSON.stringify(f.saved), before);
  }
});

test('replacement text is rejected for every supported non-text content type before any send', async () => {
  const contents = {
    imageMessage: { caption: 'Imagen', mimetype: 'image/jpeg' },
    videoMessage: { caption: 'Video', mimetype: 'video/mp4' },
    audioMessage: { mimetype: 'audio/ogg' },
    ptvMessage: { mimetype: 'video/mp4' },
    documentMessage: { fileName: 'test.pdf', mimetype: 'application/pdf' },
    stickerMessage: { mimetype: 'image/webp' },
    contactMessage: { displayName: 'Test', vcard: 'BEGIN:VCARD\nFN:Test\nEND:VCARD' },
    contactsArrayMessage: { contacts: [] },
    locationMessage: { degreesLatitude: 19.4, degreesLongitude: -99.1 },
  };
  for (const [type, content] of Object.entries(contents)) {
    const f = fixture({ [type]: content });
    const before = JSON.stringify(f.saved);
    await assert.rejects(f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: 'No es un caption' }),
      (error) => error.status === 400, type);
    assert.equal(f.calls.sends.length, 0, type);
    assert.equal(f.calls.saved.length, 0, type);
    assert.equal(f.calls.webhooks.length, 0, type);
    assert.equal(JSON.stringify(f.saved), before, type);
  }
});

test('replacement text cannot resurrect a stale storage preview by matching its previous text', async () => {
  const f = fixture();
  await storeReceivedPreview(f);
  const obsoleteText = f.saved.message.conversation;
  f.saved.message.conversation = 'Texto actual https://example.test/otra-noticia';
  const before = JSON.stringify(f.saved);
  const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL', text: obsoleteText });
  const forwarded = f.calls.sends[0].content.forward.message;
  assert.equal(result.message.conversation, obsoleteText);
  assert.equal(forwarded[previewSidecar], undefined);
  assert.equal(forwarded.extendedTextMessage?.title == null, true);
  assert.equal(forwarded.extendedTextMessage?.jpegThumbnail?.length ?? 0, 0);
  assert.equal(f.calls.saved.at(-1).message[previewSidecar], undefined);
  assert.equal(JSON.stringify(f.saved), before);
});

test('a failed modified forward leaves the stored original card and text untouched', async () => {
  const f = fixture();
  await storeReceivedPreview(f);
  const before = JSON.stringify(f.saved);
  f.service.client.sendMessage = async () => { throw new Error('Modified forward transport failure'); };
  await assert.rejects(f.service.forwardMessage({
    number: '14155550002', messageId: '3EB0ORIGINAL', text: 'Nuevo texto https://example.test/noticia',
  }), (error) => error.status === 400 && JSON.stringify(error).includes('Modified forward transport failure'));
  assert.equal(f.calls.saved.length, 1);
  assert.equal(f.calls.webhooks.length, 0);
  assert.equal(JSON.stringify(f.saved), before);
});

test('group forwarding uses the instance-scoped parameterized lookup and normal persistence/webhook', async () => {
  const { service, calls } = fixture();
  const result = await service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
  assert.equal(calls.queries.length, 1);
  assert.match(calls.queries[0].sql, /WHERE "instanceId" = \?/);
  assert.match(calls.queries[0].sql, /"key"->>'id' = \?/);
  assert.deepEqual(calls.queries[0].values, ['test-instance-id', '3EB0ORIGINAL']);
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.sends[0].jid, '120363000000002@g.us');
  assert.equal(calls.sends[0].content.force, true);
  assert.equal(calls.sends[0].options.useCachedGroupMetadata, true);
  assert.equal(calls.sends[0].content.forward.message.conversation, 'Mensaje original');
  assert.ok(calls.groups.length >= 1);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].instanceId, 'test-instance-id');
  assert.equal(result.key.id, '3EB0FORWARDED');
  assert.equal(result.key.remoteJid, '120363000000002@g.us');
  assert.equal(result.contextInfo.isForwarded, true);
  assert.equal(result.contextInfo.forwardingScore, 1);
  assert.equal(calls.webhooks.length, 1);
  assert.equal(calls.webhooks[0].event, events.Events.SEND_MESSAGE);
  assert.equal(calls.webhooks[0].payload, result);
});

test('an existing forwarding score survives stored text normalization and increases once', async () => {
  const { service } = fixture({ conversation: 'Ya reenviado' }, { contextInfo: { isForwarded: true, forwardingScore: 3 } });
  const result = await service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
  assert.equal(result.message.conversation, 'Ya reenviado');
  assert.equal(result.contextInfo.forwardingScore, 4);
});

test('a received URL card survives normalizing, storing, lookup, forwarding and a second persistence', async () => {
  const f = fixture();
  const { original, normalized, storage } = await storeReceivedPreview(f);
  assert.equal(normalized.message.conversation, original.message.extendedTextMessage.text);
  assert.equal(normalized.message.extendedTextMessage, undefined);
  assert.equal(normalized.message[previewSidecar], undefined);
  assert.ok(storage.message[previewSidecar]);
  assert.equal(storage.message[previewSidecar].version, 1);
  assert.equal(storage.message[previewSidecar].text, original.message.extendedTextMessage.text);
  const result = await f.service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
  assert.equal(f.calls.queries.length, 1);
  assert.deepEqual(f.calls.queries[0].values, ['test-instance-id', '3EB0ORIGINAL']);
  const forwarded = f.calls.sends[0].content.forward.message;
  assert.equal(forwarded.conversation == null, true);
  assert.equal(forwarded[previewSidecar], undefined);
  assertPreviewMetadata(forwarded.extendedTextMessage, original.message.extendedTextMessage);
  assert.equal(result.contextInfo.isForwarded, true);
  assert.equal(result.contextInfo.forwardingScore, 4);
  assert.equal(f.calls.saved.length, 2);
  const secondStorage = f.calls.saved[1];
  assert.ok(secondStorage.message[previewSidecar]);
  assert.equal(secondStorage.message[previewSidecar].fields.title, original.message.extendedTextMessage.title);
  assert.deepEqual(Buffer.from(Object.values(secondStorage.message[previewSidecar].fields.jpegThumbnail)), previewBytes);
  assert.equal(result.message[previewSidecar], undefined);
  assert.equal(f.calls.webhooks.length, 1);
  assert.equal(f.calls.webhooks[0].payload.message[previewSidecar], undefined);
});

test('preview persistence does not mutate the normalized output or the original message', () => {
  const f = fixture();
  const original = originalLinkPreview();
  const originalBefore = JSON.stringify(original);
  const normalized = f.service.prepareMessage(original);
  const normalizedBefore = JSON.stringify(normalized);
  const storage = f.service.prepareMessageForStorage(normalized, original);
  assert.equal(JSON.stringify(original), originalBefore);
  assert.equal(JSON.stringify(normalized), normalizedBefore);
  assert.notEqual(storage, normalized);
  assert.notEqual(storage.message, normalized.message);
  assert.ok(storage.message[previewSidecar]);
});

test('received group transport keys are dropped while the original URL card and forwarding score survive', async () => {
  const f = fixture();
  const original = originalLinkPreview();
  Object.assign(original.message, syntheticTransportMetadata());
  const { storage } = await storeReceivedPreview(f, original);
  for (const field of Object.keys(syntheticTransportMetadata())) assert.ok(storage.message[field], field);
  const storedBefore = JSON.stringify(f.saved.message);

  const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL' });
  const forwarded = f.calls.sends[0].content.forward.message;
  const generated = f.calls.generated[0];
  assert.deepEqual(Object.keys(forwarded), ['extendedTextMessage']);
  assert.deepEqual(Object.keys(generated), ['extendedTextMessage']);
  assertPreviewMetadata(generated.extendedTextMessage, original.message.extendedTextMessage);
  assert.equal(generated.extendedTextMessage.contextInfo.forwardingScore, 4);
  assert.equal(generated.extendedTextMessage.contextInfo.isForwarded, true);
  assert.equal(result.key.remoteJid, '14155550002@s.whatsapp.net');
  for (const field of Object.keys(syntheticTransportMetadata())) {
    assert.equal(Object.hasOwn(forwarded, field), false, field);
    assert.equal(Object.hasOwn(generated, field), false, field);
    assert.equal(Object.hasOwn(result.message, field), false, field);
    assert.equal(Object.hasOwn(f.calls.saved[1].message, field), false, field);
  }
  assert.equal(JSON.stringify(f.saved.message), storedBefore);
  assert.ok(f.calls.saved[1].message[previewSidecar]);
});

test('each supported content forwards alone without carrying transport roots or secondary quotes', async () => {
  const allowed = {
    conversation: 'Texto permitido',
    extendedTextMessage: { text: 'Texto extendido' },
    imageMessage: { caption: 'Imagen', mimetype: 'image/jpeg', mediaKey: previewBytes },
    videoMessage: { caption: 'Video', mimetype: 'video/mp4', mediaKey: previewBytes },
    audioMessage: { mimetype: 'audio/ogg', mediaKey: previewBytes },
    ptvMessage: { mimetype: 'video/mp4', mediaKey: previewBytes },
    documentMessage: { fileName: 'test.pdf', mimetype: 'application/pdf', mediaKey: previewBytes },
    stickerMessage: { mimetype: 'image/webp', mediaKey: previewBytes },
    contactMessage: { displayName: 'Contacto de prueba', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Test\nEND:VCARD' },
    contactsArrayMessage: { contacts: [{
      displayName: 'Test',
      vcard: 'BEGIN:VCARD\nFN:Test\nEND:VCARD',
      contextInfo: {
        quotedMessage: { conversation: 'Nested private quote' },
        participant: '14155550099@s.whatsapp.net',
        mentionedJid: ['14155550098@s.whatsapp.net'],
        forwardingScore: 17,
      },
    }] },
    locationMessage: { degreesLatitude: 19.4, degreesLongitude: -99.1, name: 'Test location' },
  };
  for (const [type, content] of Object.entries(allowed)) {
    const contextInfo = { forwardingScore: 2, quotedMessage: { conversation: 'Private source quote' } };
    if (typeof content === 'object') content.contextInfo = contextInfo;
    const f = fixture({ [type]: content, ...syntheticTransportMetadata() }, { contextInfo });
    await f.service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
    const expectedType = type === 'conversation' ? 'extendedTextMessage' : type;
    const generated = f.calls.generated[0];
    assert.deepEqual(Object.keys(generated), [expectedType], type);
    assert.equal(generated[expectedType].contextInfo.forwardingScore, 3, type);
    assert.equal(generated[expectedType].contextInfo.quotedMessage, undefined, type);
    if (content.mediaKey) assert.deepEqual(Buffer.from(generated[expectedType].mediaKey), previewBytes, type);
    if (content.vcard) assert.equal(generated[expectedType].vcard, content.vcard, type);
    if (content.contacts) {
      assert.equal(generated[expectedType].contacts[0].vcard, content.contacts[0].vcard, type);
      assert.equal(generated[expectedType].contacts[0].displayName, content.contacts[0].displayName, type);
      assert.equal(Object.hasOwn(generated[expectedType].contacts[0], 'contextInfo'), false, type);
    }
    assert.equal(f.calls.saved.length, 1, type);
  }
});

test('mixed, unknown and control content cannot accompany a permitted message during forwarding', async () => {
  const messages = [
    { conversation: 'Señuelo', imageMessage: { caption: 'Second payload', contextInfo: { quotedMessage: { conversation: 'Private quote' } } } },
    { imageMessage: { caption: 'First' }, conversation: 'Second' },
    { extendedTextMessage: { text: 'First' }, contactMessage: { vcard: 'Private contact' } },
    { conversation: 'First', extendedTextMessage: { text: 'Second' } },
    { conversation: 'Señuelo', pollCreationMessage: { name: 'Hidden poll' } },
    { conversation: 'Señuelo', groupInviteMessage: { groupJid: '123@g.us', inviteCode: 'synthetic' } },
    { conversation: 'Señuelo', newsletterAdminInviteMessage: { newsletterJid: '123@newsletter' } },
    { conversation: 'Señuelo', unknownFutureMessage: { arbitrary: true } },
    { unknownFutureMessage: { arbitrary: true } },
    { ...syntheticTransportMetadata() },
  ];
  for (const message of messages) {
    const f = fixture(message);
    await assert.rejects(f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL' }),
      (error) => error.status === 400, JSON.stringify(message));
    assert.equal(f.calls.sends.length, 0);
    assert.equal(f.calls.generated.length, 0);
    assert.equal(f.calls.saved.length, 0);
    assert.equal(f.calls.webhooks.length, 0);
  }
});

test('legacy stored text forwards without manufacturing preview metadata or changing response shape', async () => {
  const f = fixture({ conversation: 'https://example.test/legacy' });
  const result = await f.service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
  assert.equal(f.calls.sends[0].content.forward.message[previewSidecar], undefined);
  assert.equal(f.calls.sends[0].content.forward.message.extendedTextMessage?.title, undefined);
  assert.equal(result.message.conversation, 'https://example.test/legacy');
  assert.equal(result.message[previewSidecar], undefined);
  assert.equal(f.calls.saved[0].message[previewSidecar], undefined);
});

test('already stored full extended text keeps its preview and no sidecar is sent to WhatsApp', async () => {
  const original = originalLinkPreview();
  const f = fixture(original.message);
  await f.service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
  assertPreviewMetadata(f.calls.sends[0].content.forward.message.extendedTextMessage, original.message.extendedTextMessage);
  assert.equal(f.calls.sends[0].content.forward.message[previewSidecar], undefined);
});

test('stored preview byte fields support indexed JSON, base64 and legacy Buffer representations', async () => {
  const forms = [{ ...previewBytes }, previewBytes.toString('base64'), previewBytes.toJSON(), { type: 'Buffer', data: previewBytes.toString('base64') }];
  for (const serialized of forms) {
    const f = fixture();
    await storeReceivedPreview(f);
    for (const name of ['jpegThumbnail', 'thumbnailSha256', 'thumbnailEncSha256', 'mediaKey']) {
      f.saved.message[previewSidecar].fields[name] = serialized;
    }
    await f.service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
    const message = f.calls.sends[0].content.forward.message.extendedTextMessage;
    for (const name of ['jpegThumbnail', 'thumbnailSha256', 'thumbnailEncSha256', 'mediaKey']) {
      assert.deepEqual(Buffer.from(message[name] || []), previewBytes, `${name}: ${JSON.stringify(serialized)}`);
    }
  }
});

test('an edited stored text cannot reuse the previous URL card or forward its storage sidecar', async () => {
  const f = fixture();
  await storeReceivedPreview(f);
  f.saved.message.conversation = 'Texto editado https://example.test/otra-noticia';
  await f.service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
  const forwarded = f.calls.sends[0].content.forward.message;
  assert.equal(forwarded[previewSidecar], undefined);
  assert.equal(forwarded.extendedTextMessage?.title == null, true);
  assert.equal(forwarded.extendedTextMessage?.jpegThumbnail?.length ?? 0, 0);
  assert.equal(forwarded.extendedTextMessage?.text || forwarded.conversation, f.saved.message.conversation);
  assert.equal(f.calls.saved[1].message[previewSidecar], undefined);
});

test('a successful API text edit removes the obsolete stored URL card before a later fetch or forward', async () => {
  const f = await editablePreviewFixture();
  const before = await f.service.fetchMessages({ where: { key: { id: f.saved.key.id } } });
  assert.ok(before.messages.records[0].message[previewSidecar]);
  const editedText = 'Texto nuevo sin la tarjeta anterior';
  const result = await f.service.updateMessage({ number: f.saved.key.remoteJid, key: f.saved.key, text: editedText });
  assert.equal(result.message.protocolMessage.editedMessage.extendedTextMessage.text, editedText);
  assert.equal(f.calls.updates.length, 1);
  assert.equal(f.calls.updates[0].message[previewSidecar], undefined);
  assert.equal(f.saved.message[previewSidecar], undefined);
  assert.equal(f.saved.message.conversation, editedText);
  assert.equal(f.saved.status, 'EDITED');

  const fetched = await f.service.fetchMessages({ where: { key: { id: f.saved.key.id } } });
  assert.equal(fetched.messages.records[0].message.conversation, editedText);
  assert.equal(fetched.messages.records[0].message[previewSidecar], undefined);
  await f.service.forwardMessage({ number: '14155550002', messageId: f.saved.key.id });
  const generated = f.calls.generated.at(-1).extendedTextMessage;
  assert.equal(generated.text, editedText);
  assert.equal(Object.hasOwn(generated, 'title'), false);
  assert.equal(Object.hasOwn(generated, 'jpegThumbnail'), false);
});

test('an unedited stored URL card remains available for fetching and forwarding', async () => {
  const f = await editablePreviewFixture();
  const before = JSON.stringify(f.saved);
  const fetched = await f.service.fetchMessages({ where: { key: { id: f.saved.key.id } } });
  assert.ok(fetched.messages.records[0].message[previewSidecar]);
  await f.service.forwardMessage({ number: '14155550002', messageId: f.saved.key.id });
  assertPreviewMetadata(f.calls.generated[0].extendedTextMessage, originalLinkPreview().message.extendedTextMessage);
  assert.equal(JSON.stringify(f.saved), before);
  assert.equal(f.calls.updates.length, 0);
});

test('a failed API edit does not remove a previously stored URL card', async () => {
  for (const failure of ['transport', 'database']) {
    const f = await editablePreviewFixture({ failUpdate: failure === 'database' });
    const before = JSON.stringify(f.saved);
    if (failure === 'transport') {
      f.service.client.sendMessage = async () => { throw new Error('Test edit transport failure'); };
    }
    await assert.rejects(f.service.updateMessage({
      number: f.saved.key.remoteJid,
      key: f.saved.key,
      text: 'Edit which cannot be completed',
    }), /Test (edit transport|database update) failure/);
    assert.equal(JSON.stringify(f.saved), before, failure);
    const fetched = await f.service.fetchMessages({ where: { key: { id: f.saved.key.id } } });
    assert.ok(fetched.messages.records[0].message[previewSidecar], failure);
    assert.equal(fetched.messages.records[0].message.conversation, originalLinkPreview().message.extendedTextMessage.text, failure);
    if (failure === 'transport') assert.equal(f.calls.updates.length, 0);
  }
});

test('preview persistence whitelists visual metadata and keeps plain normalization unchanged', () => {
  const f = fixture();
  const original = originalLinkPreview();
  original.message.extendedTextMessage.unexpectedProperty = 'must not be stored';
  original.message.extendedTextMessage.viewOnce = true;
  const normalized = f.service.prepareMessage(original);
  const storage = f.service.prepareMessageForStorage(normalized, original);
  assert.equal(storage.message[previewSidecar].fields.unexpectedProperty, undefined);
  assert.equal(storage.message[previewSidecar].fields.viewOnce, undefined);
  assert.equal(storage.message[previewSidecar].fields.contextInfo, undefined);
  assert.equal(storage.message[previewSidecar].fields.text, undefined);
  const rawPlain = { ...original, message: { conversation: 'Texto sin tarjeta' } };
  const normalizedPlain = f.service.prepareMessage(rawPlain);
  assert.equal(f.service.prepareMessageForStorage(normalizedPlain, rawPlain), normalizedPlain);
});

test('externalAdReply preview is preserved without restoring quotes, mentions or an old forwarding score', async () => {
  const contextInfo = {
    forwardingScore: 3,
    isForwarded: true,
    quotedMessage: { conversation: 'Quoted text should not reappear' },
    stanzaId: 'OLD_QUOTED_ID',
    participant: '14155550000@s.whatsapp.net',
    mentionedJid: ['14155550001@s.whatsapp.net'],
    externalAdReply: {
      title: 'Titulo de la tarjeta contextual',
      body: 'Descripcion contextual',
      sourceUrl: 'https://example.test/contextual',
      mediaType: 1,
      thumbnail: previewBytes,
      renderLargerThumbnail: true,
      showAdAttribution: true,
      ctwaClid: 'TRACKING_MUST_NOT_BE_FORWARDED',
      sourceId: 'SOURCE_ID_MUST_NOT_BE_FORWARDED',
      ctaPayload: 'CTA_MUST_NOT_BE_FORWARDED',
      ref: 'REF_MUST_NOT_BE_FORWARDED',
    },
  };
  const f = fixture({ conversation: 'https://example.test/contextual' }, { contextInfo });
  const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL' });
  assert.deepEqual(Object.keys(f.calls.sends[0].content.contextInfo), ['externalAdReply']);
  assert.equal(result.contextInfo.externalAdReply.title, contextInfo.externalAdReply.title);
  assert.deepEqual(Buffer.from(result.contextInfo.externalAdReply.thumbnail), previewBytes);
  assert.equal(result.contextInfo.isForwarded, true);
  assert.equal(result.contextInfo.forwardingScore, 4);
  for (const name of ['quotedMessage', 'stanzaId', 'participant']) assert.equal(result.contextInfo[name], undefined, name);
  for (const name of ['ctwaClid', 'sourceId', 'ctaPayload', 'ref']) {
    assert.equal(Object.hasOwn(f.calls.sends[0].content.contextInfo.externalAdReply, name), false, name);
    assert.equal(result.contextInfo.externalAdReply[name], undefined, name);
  }
  assert.deepEqual(result.contextInfo.mentionedJid ?? [], []);
});

test('an edited message cannot restore an obsolete externalAdReply card from its previous context', async () => {
  const contextInfo = {
    isForwarded: true,
    forwardingScore: 3,
    externalAdReply: {
      title: 'Tarjeta anterior a la edicion',
      sourceUrl: 'https://example.test/old-preview',
      mediaType: 1,
      thumbnail: previewBytes,
    },
  };
  const f = fixture({ conversation: 'Texto editado https://example.test/nuevo' }, { contextInfo });
  f.saved.status = 'EDITED';
  const result = await f.service.forwardMessage({ number: '14155550002', messageId: '3EB0ORIGINAL' });
  assert.equal(f.calls.sends[0].content.contextInfo, undefined);
  assert.equal(result.message.conversation, f.saved.message.conversation);
  assert.equal(result.contextInfo.externalAdReply, undefined);
  assert.equal(result.contextInfo.isForwarded, true);
  assert.equal(result.contextInfo.forwardingScore, 4);
  assert.equal(f.saved.contextInfo.externalAdReply.title, contextInfo.externalAdReply.title);
});

test('media byte fields are restored from Prisma indexed JSON, base64, and legacy Buffer JSON', async () => {
  const bytes = Buffer.from([1, 2, 3, 4, 240, 255]);
  for (const serialized of [{ ...bytes }, bytes.toString('base64'), { type: 'Buffer', data: bytes.toString('base64') }, bytes.toJSON()]) {
    const { service, calls } = fixture({ imageMessage: {
      url: 'https://mmg.whatsapp.net/test-only', mimetype: 'image/jpeg', caption: 'Foto de prueba',
      mediaKey: serialized, fileSha256: serialized, fileEncSha256: serialized,
      directPath: '/test-only', fileLength: 6,
    } });
    const result = await service.forwardMessage({ number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' });
    const image = calls.sends[0].content.forward.message.imageMessage;
    for (const field of ['mediaKey', 'fileSha256', 'fileEncSha256']) {
      assert.ok(image[field], `${field}: ${JSON.stringify(serialized)}`);
      assert.deepEqual(Buffer.from(image[field]), bytes);
      assert.deepEqual(Buffer.from(result.message.imageMessage[field]), bytes);
    }
    assert.equal(result.message.imageMessage.caption, 'Foto de prueba');
    assert.equal(calls.saved.length, 1);
  }
});

test('a missing message or one stored in another instance causes no send or persistence', async () => {
  for (const options of [{}, { sourceInstanceId: 'another-instance' }]) {
    const { service, calls } = fixture(undefined, options);
    await assert.rejects(service.forwardMessage({ number: '123@g.us', messageId: options.sourceInstanceId ? '3EB0ORIGINAL' : 'unknown' }),
      (error) => error.status === 400 && JSON.stringify(error).includes('Message not found'));
    assert.equal(calls.sends.length, 0);
    assert.equal(calls.saved.length, 0);
    assert.equal(calls.webhooks.length, 0);
  }
});

test('a nonexistent group fails before sending', async () => {
  const { service, calls } = fixture(undefined, { missingGroup: true });
  await assert.rejects(service.forwardMessage({ number: '123@g.us', messageId: '3EB0ORIGINAL' }));
  assert.equal(calls.sends.length, 0);
});

test('view-once, ephemeral and control-message sources are rejected before side effects', async () => {
  for (const message of [
    { viewOnceMessage: { message: { imageMessage: { caption: 'Una sola vez' } } } },
    { viewOnceMessageV2: { message: { imageMessage: { caption: 'Una sola vez' } } } },
    { viewOnceMessageV2Extension: { message: { imageMessage: { caption: 'Una sola vez' } } } },
    { conversation: 'Texto señuelo', viewOnceMessage: { message: { imageMessage: { caption: 'Una sola vez' } } } },
    { ephemeralMessage: { message: { conversation: 'Temporal' } } },
    { protocolMessage: { type: 0, key: { id: 'revoke-target' } } },
    { reactionMessage: { text: 'x', key: { id: 'reaction-target' } } },
    { pollCreationMessage: { name: 'Encuesta', options: [{ optionName: 'A' }] } },
  ]) {
    const { service, calls } = fixture(message);
    await assert.rejects(service.forwardMessage({ number: '123@g.us', messageId: '3EB0ORIGINAL' }),
      (error) => error.status === 400, JSON.stringify(message));
    assert.equal(calls.sends.length, 0);
    assert.equal(calls.saved.length, 0);
    assert.equal(calls.webhooks.length, 0);
  }
});

test('phone forwarding uses normal number resolution and produces a new message ID', async () => {
  const { service, calls } = fixture();
  const result = await service.forwardMessage({ number: '14155552671', messageId: '3EB0ORIGINAL' });
  assert.equal(calls.sends[0].jid, '14155552671@s.whatsapp.net');
  assert.equal(result.key.remoteJid, '14155552671@s.whatsapp.net');
  assert.notEqual(result.key.id, '3EB0ORIGINAL');
  assert.equal(result.contextInfo.isForwarded, true);
});

test('WhatsApp send failure is reported and does not persist or emit a success event', async () => {
  const { service, calls } = fixture();
  service.client.sendMessage = async () => { throw new Error('Test transport failure'); };
  await assert.rejects(service.forwardMessage({ number: '123@g.us', messageId: '3EB0ORIGINAL' }),
    (error) => error.status === 400 && JSON.stringify(error).includes('Test transport failure'));
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.webhooks.length, 0);
});

test('normal text sending keeps its previous content and normal send effects', async () => {
  const { service, calls } = fixture();
  const result = await service.textMessage({ number: '120363000000002@g.us', text: 'Texto normal' });
  assert.equal(calls.sends[0].content.text, 'Texto normal');
  assert.equal(calls.sends[0].content.forward, undefined);
  assert.equal(result.message.conversation, 'Texto normal');
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.webhooks[0].event, events.Events.SEND_MESSAGE);
});

test('controller rejects unsupported or unloaded channels with a controlled response', async () => {
  const controller = new SendMessageController({ waInstances: { business: { integration: 'WHATSAPP-BUSINESS' } } });
  for (const instanceName of ['business', 'missing']) {
    await assert.rejects(controller.forwardMessage({ instanceName }, { number: '123@g.us', messageId: 'id' }),
      (error) => error.status === 400 && JSON.stringify(error).includes('WHATSAPP-BAILEYS'));
  }
});

test('HTTP route enforces API-key auth, strict schema, and blocks query retargeting', async () => {
  const express = require('express');
  const calls = [];
  const testInstance = { forwardMessage: async (data) => { calls.push(data); return { key: { id: 'forwarded' } }; } };
  const monitor = { waInstances: { allowed: testInstance, other: testInstance } };
  const configService = { get(name) {
    return name === 'AUTHENTICATION' ? { API_KEY: { KEY: 'test-global-key' } } : { SAVE_DATA: { INSTANCE: true } };
  } };
  const serverModule = {
    waMonitor: monitor,
    prismaRepository: { instance: { findUnique: async ({ where }) => ({ token: `${where.name}-test-token` }) } },
    sendMessageController: new SendMessageController(monitor),
  };
  const { authGuard } = loadSource('src/api/guards/auth.guard.ts', {
    '@api/server.module': serverModule, '@config/env.config': { configService },
  });
  const { RouterBroker } = loadSource('src/api/abstract/abstract.router.ts');
  const { MessageRouter } = loadSource('src/api/routes/sendMessage.router.ts', {
    '@api/abstract/abstract.router': { RouterBroker }, '@api/dto/sendMessage.dto': dto,
    '@api/server.module': serverModule, '@validate/validate.schema': schema,
  });
  const app = express();
  app.use(express.json());
  app.use('/message', new MessageRouter(authGuard.apikey).router);
  app.use((error, req, res, next) => res.status(error.status || 500).json(error));
  const server = require('node:http').createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/message/forwardMessage/allowed`;
  const body = { number: '120363000000002@g.us', messageId: '3EB0ORIGINAL' };
  const request = async (suffix, key, payload = body) => fetch(url + suffix, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key } : {}) }, body: JSON.stringify(payload),
  });
  try {
    assert.equal((await request('', null)).status, 401);
    assert.equal((await request('', 'wrong-test-token')).status, 401);
    assert.equal((await request('', 'other-test-token')).status, 401);
    assert.equal((await request('?instanceName=other', 'allowed-test-token')).status, 400);
    assert.equal((await request('?instanceId=other', 'allowed-test-token')).status, 400);
    assert.equal((await request('', 'allowed-test-token', { ...body, caption: 'extra' })).status, 400);
    assert.equal((await request('', 'allowed-test-token', { ...body, number: 'status@broadcast' })).status, 400);
    for (const text of [null, 123, true, {}, [], '', ' \n\t ', 'x'.repeat(65537)]) {
      assert.equal((await request('', 'allowed-test-token', { ...body, text })).status, 400);
    }
    assert.equal(calls.length, 0);
    const response = await request('', 'allowed-test-token');
    assert.equal(response.status, 201);
    assert.equal((await response.json()).key.id, 'forwarded');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].number, body.number);
    assert.equal(calls[0].messageId, body.messageId);
    assert.equal(calls[0].text, undefined);
    const replacement = 'Texto nuevo https://example.test/noticia';
    const modified = await request('', 'allowed-test-token', { ...body, text: replacement });
    assert.equal(modified.status, 201);
    assert.equal((await modified.json()).key.id, 'forwarded');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].number, body.number);
    assert.equal(calls[1].messageId, body.messageId);
    assert.equal(calls[1].text, replacement);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
