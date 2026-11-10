const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const venvPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const model = path.join(root, "models", "sensevoice", "model.int8.onnx");
const samples = path.join(root, "samples");

function needFixtures() {
  if (!fs.existsSync(venvPython)) return "没有 .venv，跳过副语言分析";
  if (!fs.existsSync(path.join(samples, "sample_sigh_cued.wav"))) return "没有合成样本，跳过";
  return null;
}

function runPython(script, audio) {
  const run = spawnSync(venvPython, [path.join(root, script), audio], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  assert.equal(run.status, 0, `${script} 退出码 ${run.status}：${run.stderr}`);
  // transcribe.py 输出单行 JSON，paralinguistic.py 为便于人工查看是缩进格式，
  // 所以这里整体解析，而不是只取最后一行。
  const raw = String(run.stdout).trim();
  return raw.startsWith("{") && script === "paralinguistic.py" ? JSON.parse(raw) : JSON.parse(raw.split(/\r?\n/).filter(Boolean).at(-1));
}

test("合成的呼气样本能触发叹气判定", (t) => {
  const skip = needFixtures();
  if (skip) return t.skip(skip);
  const result = runPython("paralinguistic.py", path.join(samples, "sample_sigh_cued.wav"));
  assert.equal(result.sigh.detected, true, `叹气未触发，score=${result.sigh.score}`);
  assert.ok(result.edgeBreathSec >= 0.7, `边缘呼气应超过 0.7 秒，实际 ${result.edgeBreathSec}`);
  assert.equal(result.cry.detected, false, "呼气不该被判成哭腔");
});

test("合成的哭腔样本能触发哭腔判定", (t) => {
  const skip = needFixtures();
  if (skip) return t.skip(skip);
  const result = runPython("paralinguistic.py", path.join(samples, "sample_cry_cued.wav"));
  assert.equal(result.cry.detected, true, `哭腔未触发，score=${result.cry.score}`);
  assert.ok(result.f0Jitter >= 0.1, `基频抖动应超过 0.1，实际 ${result.f0Jitter}`);
  assert.equal(result.sigh.detected, false, "哭腔不该被判成叹气");
});

test("正常说话不会被误判成哭腔或叹气", (t) => {
  if (!fs.existsSync(venvPython)) return t.skip("没有 .venv，跳过副语言分析");
  for (const name of ["sample_tired.wav", "sample_sigh.wav"]) {
    const file = path.join(samples, name);
    if (!fs.existsSync(file)) return t.skip("没有真实样本");
    const result = runPython("paralinguistic.py", file);
    assert.equal(result.cry.detected, false, `${name} 被误判为哭腔，score=${result.cry.score}`);
    assert.equal(result.sigh.detected, false, `${name} 被误判为叹气，score=${result.sigh.score}`);
  }
});

test("转写结果里带上副语言线索", (t) => {
  if (!fs.existsSync(venvPython)) return t.skip("没有 .venv，跳过");
  if (!fs.existsSync(model)) return t.skip("没有下载模型，跳过");
  const file = path.join(samples, "sample_tired.wav");
  if (!fs.existsSync(file)) return t.skip("没有真实样本");

  const result = runPython("transcribe.py", file);
  assert.match(result.text, /挺累的/);
  assert.ok(result.voiceCues && typeof result.voiceCues === "object", "响应里应含 voiceCues");
  assert.equal(result.voiceCues.cry, false);
  assert.equal(result.voiceCues.sigh, false);
  assert.ok(result.voiceCues.f0Jitter > 0, "应输出基频抖动值");
});
