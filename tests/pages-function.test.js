const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Pages Function 是给 Cloudflare 用的 ESM 文件，这里把 export 去掉后在本地跑，
// 用假的 env.AI / fetch 验证解析与防护，不需要真实凭证。
function loadPagesFunction(relative, names) {
  const source = fs.readFileSync(path.join(__dirname, "..", "functions", "api", relative), "utf8");
  const body = source.replace(/export /g, "");
  const factory = new Function(
    "module",
    "exports",
    "btoa",
    `${body}\nmodule.exports = { ${names.join(", ")} };`,
  );
  const module = { exports: {} };
  factory(module, module.exports, btoa);
  return module.exports;
}

const transcribe = loadPagesFunction("transcribe.js", ["onRequestPost", "onRequestOptions"]);
const health = loadPagesFunction("health.js", ["onRequestGet"]);

function audioRequest(bytes = 1600) {
  return new Request("https://voicejournal.example.com/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: new Uint8Array(bytes),
  });
}

function fakeAi(text) {
  return {
    async run() {
      return { text };
    },
  };
}

test("Pages 版转写：有 Workers AI 绑定时返回文字", async () => {
  const response = await transcribe.onRequestPost({ request: audioRequest(), env: { AI: fakeAi("我今天有点累，不太想说话。") } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.text, "我今天有点累，不太想说话。");
  assert.equal(body.provider, "workers-ai");
  assert.equal(body.voiceCues, null, "线索交给浏览器算，这里必须留空");
});

test("Pages 版转写：没有凭证时说明怎么配，且不请求上游", async () => {
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await transcribe.onRequestPost({ request: audioRequest(), env: {} });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /Workers AI/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Pages 版转写：非音频与超大音频被挡住", async () => {
  const wrong = new Request("https://x/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const big = new Request("https://x/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Uint8Array(13 * 1024 * 1024) });
  const a = await transcribe.onRequestPost({ request: wrong, env: { AI: fakeAi("x") } });
  const b = await transcribe.onRequestPost({ request: big, env: { AI: fakeAi("x") } });
  assert.equal(a.status, 415);
  assert.equal(b.status, 413);
});

test("Pages 版健康检查：如实报告后端与情感标签能力", async () => {
  const withAi = await health.onRequestGet({ env: { AI: fakeAi("x") } });
  const body = await withAi.json();
  assert.equal(body.transcriptionConfigured, true);
  assert.equal(body.transcriptionEngine, "workers-ai");
  assert.equal(body.emotionTags, false, "Whisper 没有情感标签");

  const noCreds = await health.onRequestGet({ env: {} });
  const none = await noCreds.json();
  assert.equal(none.transcriptionConfigured, false);
  assert.equal(none.transcriptionEngine, null);
});
