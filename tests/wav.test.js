const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { wavBytes } = require("../wav.js");

const root = path.join(__dirname, "..");
const venvPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const model = path.join(root, "models", "sensevoice", "model.int8.onnx");
const sample = path.join(root, "samples", "sample_tired.wav");

// 解析 16-bit PCM 单声道 WAV，取出 float32 采样点。
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
  assert.ok(dataOffset > 0, "样本里找不到 data 块");
  const frames = dataLength / 2;
  const samples = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 0x8000;
  }
  return { samples, channels };
}

test("wav 编码器写出合法的 16-bit PCM 单声道文件", () => {
  const rate = 16000;
  const samples = new Float32Array(rate / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 440 * index) / rate) * 0.5;
  }
  const buffer = wavBytes(samples, rate);
  const view = new DataView(buffer);
  assert.equal(buffer.byteLength, 44 + samples.length * 2);
  assert.equal(String.fromCharCode(...new Uint8Array(buffer, 0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...new Uint8Array(buffer, 8, 4)), "WAVE");
  assert.equal(view.getUint16(20, true), 1, "格式应为 PCM");
  assert.equal(view.getUint16(22, true), 1, "应为单声道");
  assert.equal(view.getUint32(24, true), rate);
  assert.equal(view.getUint16(34, true), 16, "应为 16 bit");
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(view.getInt16(44, true), 0);
  // 幅值应被裁剪到 [-1, 1] 内
  const clipped = wavBytes(Float32Array.of(2, -2), rate);
  assert.equal(new DataView(clipped).getInt16(44, true), 32767);
  assert.equal(new DataView(clipped).getInt16(46, true), -32768);
});

test("前端编码出的 WAV 能被本地模型直接转写", (t) => {
  if (!fs.existsSync(venvPython)) return t.skip("没有 .venv，跳过真实模型联调");
  if (!fs.existsSync(model)) return t.skip("没有下载模型，跳过真实模型联调");
  if (!fs.existsSync(sample)) return t.skip("没有测试样本");

  const { samples, channels } = readPcm16(sample);
  assert.equal(channels, 1);
  const wav = wavBytes(samples, 16000);
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "treehole-wav-")), "encoded.wav");
  fs.writeFileSync(target, Buffer.from(wav));

  const run = spawnSync(venvPython, [path.join(root, "transcribe.py"), target], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  fs.rmSync(path.dirname(target), { recursive: true, force: true });
  assert.equal(run.status, 0, `transcribe.py 退出码 ${run.status}`);

  const lines = String(run.stdout).trim().split(/\r?\n/).filter(Boolean);
  const result = JSON.parse(lines.at(-1));
  assert.match(result.text, /挺累的/, `实际转写：${result.text}`);
  assert.equal(result.emotion, "SAD");
  assert.ok(result.duration > 8.5 && result.duration < 9.5, `时长应约为 9 秒，实际 ${result.duration}`);
});
