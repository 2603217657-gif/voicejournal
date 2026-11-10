// 端到端自检：直接用本地模型转写 samples 目录里的录音，确认整条链路可用。
// 用法：npm run check:asr                 （跑 samples 下所有 wav）
//      npm run check:asr -- 某个录音.wav   （跑指定文件）
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const venvPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = fs.existsSync(venvPython) ? venvPython : process.env.PYTHON_BIN || "python";

const args = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const files = args.length
  ? args.map((file) => path.resolve(file))
  : fs.existsSync(path.join(root, "samples"))
    ? fs.readdirSync(path.join(root, "samples")).filter((name) => name.endsWith(".wav")).map((name) => path.join(root, "samples", name))
    : [];

if (!files.length) {
  console.error("没有可转写的 wav：先录一段放进 samples/，或直接指定文件路径。");
  process.exit(1);
}

const parseJson = (stdout) => {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // 模型加载日志，跳过
    }
  }
  return null;
};

let failed = false;
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`× 文件不存在：${file}`);
    failed = true;
    continue;
  }
  const started = Date.now();
  const run = spawnSync(python, [path.join(root, "transcribe.py"), file], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  const wall = (Date.now() - started) / 1000;
  if (run.error) {
    console.error(`× ${path.basename(file)} 启动 Python 失败：${run.error.message}`);
    console.error("  先建 venv 并装依赖：见「安装语音模型.cmd」或 README。");
    failed = true;
    continue;
  }
  const result = parseJson(run.stdout);
  const cues = result && result.voiceCues;
  const hasCue = Boolean(cues && (cues.cry || cues.sigh));
  if (!result || (!result.text && !hasCue)) {
    console.error(`× ${path.basename(file)} 转写失败`);
    if (run.stderr) console.error(String(run.stderr).trim().split("\n").slice(-3).join("\n"));
    failed = true;
    continue;
  }
  const rtf = result.duration ? (result.elapsed / result.duration).toFixed(2) : "—";
  console.log(`✓ ${path.basename(file)}`);
  console.log(`  文本：${result.text || "（没有识别到说话内容）"}`);
  console.log(`  情绪：${result.emotion || "—"}｜事件：${result.event || "—"}｜语言：${result.lang || "—"}`);
  if (cues) {
    const labels = [];
    if (cues.cry) labels.push("哭腔");
    if (cues.sigh) labels.push("叹气");
    const detail = Array.isArray(cues.reasons) && cues.reasons.length ? `（${cues.reasons.join("；")}）` : "";
    console.log(`  声音线索：${labels.length ? labels.join("、") + detail : "未发现哭腔或叹气"}`);
  }
  console.log(`  音频 ${result.duration}s｜模型 ${result.elapsed}s｜实时率 ${rtf}｜进程总耗时 ${wall.toFixed(2)}s`);
}

process.exit(failed ? 1 : 0);
