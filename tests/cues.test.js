const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { analyze } = require("../cues.js");

const samplesDir = path.join(__dirname, "..", "samples");

// 与 paralinguistic.py 相同的判定口径；这两个模块必须给出一致的结论，
// 否则手机（浏览器算）和电脑（Python 算）会说出两套结果。
function readPcm16(file) {
  const buffer = fs.readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  let channels = 1;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") channels = view.getUint16(offset + 8 + 2, true);
    if (id === "data") {
      dataOffset = offset + 8;
      dataLength = Math.min(size, buffer.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  assert.ok(dataOffset > 0, `${path.basename(file)} 里找不到 data 块`);
  const frames = dataLength / 2 / channels;
  const samples = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(dataOffset + (index * channels + channel) * 2, true) / 0x8000;
    }
    samples[index] = sum / channels;
  }
  return samples;
}

function analyzeSample(name) {
  const file = path.join(samplesDir, name);
  if (!fs.existsSync(file)) return null;
  return analyze(readPcm16(file));
}

test("合成的呼气样本在浏览器规则下也能判出叹气", () => {
  const result = analyzeSample("sample_sigh_cued.wav");
  assert.ok(result, "缺少 sample_sigh_cued.wav");
  assert.equal(result.sigh.detected, true, `叹气未触发，score=${result.sigh.score}`);
  assert.ok(result.edgeBreathSec >= 0.7, `边缘呼气应超过 0.7 秒，实际 ${result.edgeBreathSec}`);
  assert.equal(result.cry.detected, false);
});

test("合成的哭腔样本在浏览器规则下也能判出哭腔", () => {
  const result = analyzeSample("sample_cry_cued.wav");
  assert.ok(result, "缺少 sample_cry_cued.wav");
  assert.equal(result.cry.detected, true, `哭腔未触发，score=${result.cry.score}`);
  assert.ok(Math.abs(result.f0Jitter - 0.117) < 0.02, `抖动应接近 0.117，实际 ${result.f0Jitter}`);
  assert.equal(result.sigh.detected, false);
});

test("正常说话的样本在浏览器规则下同样不误报", () => {
  for (const name of ["sample_tired.wav", "sample_sigh.wav"]) {
    const result = analyzeSample(name);
    assert.ok(result, `缺少 ${name}`);
    assert.equal(result.cry.detected, false, `${name} 被误判为哭腔`);
    assert.equal(result.sigh.detected, false, `${name} 被误判为叹气`);
    assert.ok(result.f0Jitter < 0.05, `${name} 抖动应接近 0.015，实际 ${result.f0Jitter}`);
  }
});

test("太短的音频不判哭腔也不判叹气", () => {
  const result = analyze(new Float32Array(16000 * 0.02));
  assert.equal(result.cry.detected, false);
  assert.equal(result.sigh.detected, false);
  assert.equal(result.speechSegments, 0);
});
