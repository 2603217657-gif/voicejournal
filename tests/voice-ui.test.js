const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../chat.js'), 'utf8');

test('first file-upload consent opens the file picker, not the microphone; selected file is retained', () => {
  const handlers = {};
  const element = (name) => ({ addEventListener(event, fn) { handlers[`${name}:${event}`] = fn; } });
  let picked = 0, recorded = 0, shown = 0, transcribed;
  const elements = {
    recordButton: element('record'), pickAudioButton: element('pick'),
    pickAudioInput: { ...element('file'), click() { picked++; } },
    consentCheckbox: element('check'), consentConfirm: element('confirm'),
    consentCancel: element('cancel'),
    consentDialog: { showModal() { shown++; }, close() {} },
  };
  const storage = new Map();
  const ctx = vm.createContext({ elements, mediaRecorder: null, transcriptionPending: false,
    consentAction: 'record', CONSENT_KEY: 'test-consent', pendingAudioBlob: null,
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    beginRecording() { recorded++; }, stopRecording() {}, backendReady: Promise.resolve(),
    transcribeBlob(blob) { transcribed = blob; }, showToast() {},
  });
  vm.runInContext(source.slice(source.indexOf('elements.recordButton.addEventListener("click"'), source.indexOf('elements.loginForm.addEventListener')), ctx);
  handlers['pick:click']();
  assert.equal(shown, 1);
  elements.consentCheckbox.checked = true;
  handlers['confirm:click']();
  assert.equal(picked, 1);
  assert.equal(recorded, 0);
  const file = { size: 1024, type: 'audio/mp4' };
  elements.pickAudioInput.files = [file];
  handlers['file:change']();
  assert.equal(ctx.pendingAudioBlob, file);
  assert.equal(transcribed, file);
});

test('transcription sends converted WAV and fills browser cues when the cloud omits them', async () => {
  let sent;
  const ctx = vm.createContext({ SERVICE_CONFIG: { transcriptionEndpoint: '/api/transcribe' },
    window: { TreeholeCues: { analyze: () => ({ cry: { detected: true }, sigh: { detected: false } }) } },
    toWav16k: async () => ({ blob: 'converted-wav', samples: new Float32Array(100) }),
    fetch: async (url, options) => { sent = { url, options }; return Response.json({ text: ' 今天很累 ', voiceCues: null }); },
  });
  vm.runInContext(source.slice(source.indexOf('function summarizeCues('), source.indexOf('function describeVoice(')), ctx);
  const result = await ctx.transcribeAudio('original');
  assert.equal(sent.url, '/api/transcribe');
  assert.equal(sent.options.body, 'converted-wav');
  assert.equal(sent.options.headers['Content-Type'], 'audio/wav');
  assert.equal(result.text, '今天很累');
  assert.equal(result.voiceCues.cry, true);
  assert.equal(result.voiceCues.sigh, false);
});

test('frontend displays both Pages string errors and local object errors', async () => {
  const ctx = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('async function getApiError('), source.indexOf('// SenseVoice')), ctx);
  assert.equal(await ctx.getApiError(Response.json({ error: '请配置 AI 绑定' }), 'fallback'), '请配置 AI 绑定');
  assert.equal(await ctx.getApiError(Response.json({ error: { message: '本地模型未安装' } }), 'fallback'), '本地模型未安装');
});
