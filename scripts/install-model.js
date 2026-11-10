// 一键安装本地语音模型：找 Python、建 venv、装依赖、下模型、跑自检。
// 用 Node 执行而不是纯 batch，是因为要判断版本、拦截误操作、并把子进程输出原样透出来。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const venvPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const REQUIRED_FILES = ["requirements.txt", "prepare_model.py", "server.js", "transcribe.py"];

function say(message) {
  console.log(message);
}

function fail(message, hint) {
  console.error(`\n× ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

// 1) 先拦截最常见的误操作：在 Windows 压缩包预览里直接双击 cmd。
//    那种情况下只有被点开的那一个文件会被解到 %TEMP%，同目录的其他文件都不在。
const missing = REQUIRED_FILES.filter((name) => !fs.existsSync(path.join(root, name)));
const tempRoot = (process.env.TEMP || process.env.TMP || "").toLowerCase();
const inTemp = Boolean(tempRoot) && root.toLowerCase().startsWith(tempRoot);
if (missing.length) {
  fail(
    `当前目录不是完整的项目文件夹（缺少 ${missing.join("、")}）`,
    "你很可能是在压缩包里直接双击运行的。请先把整个 ZIP 解压到一个普通文件夹（例如 D:\\treehole），再进入解压出来的 ai-treehole 目录运行。"
  );
}
if (inTemp) {
  say("    提醒：当前目录在系统临时目录里，重启或清理后可能被删。建议解压到 D:\\treehole 这类普通文件夹再安装。");
}

// 2) 找可用的 Python。同一个 Windows 上，cmd 和 PowerShell 解析到的 python 常常不是同一个，
//    所以这里逐个试，按版本从高到低挑第一个能用的。
const CANDIDATES = [
  { exe: process.env.PYTHON_BIN, args: [] },
  { exe: "py", args: ["-3.13"] },
  { exe: "py", args: ["-3.12"] },
  { exe: "py", args: ["-3.11"] },
  { exe: "py", args: ["-3.10"] },
  { exe: "py", args: ["-3.9"] },
  { exe: "python3", args: [] },
  { exe: "python", args: [] },
].filter((candidate) => candidate.exe);

function probe(candidate) {
  const run = spawnSync(
    candidate.exe,
    [...candidate.args, "-c", "import sys;print('%d.%d' % (sys.version_info[0], sys.version_info[1]))"],
    { encoding: "utf8", windowsHide: true, timeout: 15000 }
  );
  if (run.error || run.status !== 0) return null;
  const version = String(run.stdout).trim().split(/\r?\n/).pop();
  const match = /^(\d+)\.(\d+)$/.exec(version || "");
  if (!match) return null;
  return { exe: candidate.exe, args: candidate.args, major: Number(match[1]), minor: Number(match[2]) };
}

say("[1/4] 查找 Python……");
let python = null;
for (const candidate of CANDIDATES) {
  const found = probe(candidate);
  if (!found) continue;
  if (found.major === 3 && found.minor >= 9) {
    python = found;
    break;
  }
  if (!python) python = found; // 记下来，后面好报版本不对
}
if (!python) {
  fail(
    "没有找到可用的 Python",
    "请安装 Python 3.9 或更高版本（建议 3.11/3.12），安装时勾选 Add python.exe to PATH，然后重新运行本脚本。"
  );
}
if (!(python.major === 3 && python.minor >= 9)) {
  fail(`找到的 Python 是 ${python.major}.${python.minor}，版本太低`, "本项目需要 Python 3.9 或更高版本。");
}
const pythonLabel = `${python.exe}${python.args.length ? " " + python.args.join(" ") : ""}（${python.major}.${python.minor}）`;
say(`    使用 ${pythonLabel}`);
if (python.minor < 11) say("    说明：这个版本能用，但 3.11 或 3.12 更省心。");

// 3) 建 venv 并装依赖。不强行升级 pip：老版本 pip 装 wheel 也够，少一步就少一个失败点。
say("[2/4] 准备虚拟环境 .venv ……");
if (fs.existsSync(venvPython)) {
  say("    已存在，跳过创建");
} else {
  const created = spawnSync(python.exe, [...python.args, "-m", "venv", path.join(root, ".venv")], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  if (created.status !== 0 || !fs.existsSync(venvPython)) {
    fail("创建虚拟环境失败", "常见原因是项目路径太长或没有写权限。可以把项目解压到较短的路径（如 D:\\treehole）后重试。");
  }
}

say("[3/4] 安装依赖 sherpa-onnx / numpy / soundfile / soxr ……");
const installed = spawnSync(venvPython, ["-m", "pip", "install", "-r", path.join(root, "requirements.txt")], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
});
if (installed.status !== 0) {
  fail("依赖安装失败", "如果是网络问题，可先设置国内镜像：.venv\\Scripts\\python -m pip install -r requirements.txt -i https://mirrors.huaweicloud.com/repository/pypi/simple");
}

// 4) 下载模型（约 240MB）。prepare_model.py 默认走 hf-mirror，可用 HF_ENDPOINT 换源。
say("[4/4] 下载 SenseVoice 模型（约 240MB，只需一次）……");
const prepared = spawnSync(venvPython, [path.join(root, "prepare_model.py")], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
});
if (prepared.status !== 0) {
  fail("模型下载失败", "若 hf-mirror 也不通，设置环境变量 HF_ENDPOINT 指向其他镜像后重试；已下载的部分会跳过。");
}

say("\n安装完成，正在用项目自带样本自检……\n");
const checked = spawnSync(process.execPath, [path.join(root, "scripts", "check-asr.js")], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  encoding: "utf8",
});
if (checked.status !== 0) {
  fail("自检没通过", "模型装好了但转写失败，请把上面输出的最后几行发出来排查。");
}

say("\n全部就绪。接着运行 npm start，或在浏览器打开 http://127.0.0.1:4173/");
