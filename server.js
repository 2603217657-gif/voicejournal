const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");
const support = require("./support.js");

const ROOT = __dirname;
const MAX_AUDIO_BYTES = 18 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);
const ALLOWED_FILES = new Map([
  ["/cat.js", ["cat.js", "text/javascript; charset=utf-8"]],
  ["/cat-assets.js", ["cat-assets.js", "text/javascript; charset=utf-8"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/chat.js", ["chat.js", "text/javascript; charset=utf-8"]],
  ["/config.js", ["config.js", "text/javascript; charset=utf-8"]],
  ["/support.js", ["support.js", "text/javascript; charset=utf-8"]],
  ["/wav.js", ["wav.js", "text/javascript; charset=utf-8"]],
  ["/relax.html", ["relax.html", "text/html; charset=utf-8"]],
  ["/relax.js", ["relax.js", "text/javascript; charset=utf-8"]],
]);
for (const pet of require('./cat-assets.js')) {
  for (const file of pet.frames) {
    if (!/^gif\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/.test(file) || file.split('/').includes('..')) throw new Error('Invalid pet frame path');
    const ext = path.extname(file).slice(1);
    ALLOWED_FILES.set('/' + file, [file, 'image/' + (ext === 'jpg' ? 'jpeg' : ext)]);
  }
}
const requestCounts = new Map();

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile();

const apiBaseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const apiKey = process.env.AI_API_KEY || "";
const chatModel = process.env.AI_CHAT_MODEL || "";
const transcriptionModel = process.env.AI_TRANSCRIPTION_MODEL || "";
const chatUrl = process.env.AI_CHAT_URL || `${apiBaseUrl}/chat/completions`;
const transcriptionUrl = process.env.AI_TRANSCRIPTION_URL || `${apiBaseUrl}/audio/transcriptions`;
// 优先使用项目内 .venv，避免依赖系统 Python 是否装过模型；没建 venv 时回落到 PATH 上的 python。
function defaultPythonBin() {
  const venvPython = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return fs.existsSync(venvPython) ? venvPython : "python";
}
const pythonBin = process.env.PYTHON_BIN || defaultPythonBin();
// 探活改成 sherpa-onnx：不再依赖 ctranslate2，Windows 上不会原生崩溃。
const localAsrAvailable = spawnSync(pythonBin, ["-c", "import sherpa_onnx,soundfile,soxr"], { timeout: 15_000, windowsHide: true }).status === 0;
const useLocalAsr = localAsrAvailable && process.env.ASR_PROVIDER !== "remote";

function jsonResponse(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(payload));
}

function appError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(appError(413, "PAYLOAD_TOO_LARGE", "请求内容超过大小限制。"));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", () => reject(appError(400, "REQUEST_READ_FAILED", "无法读取请求内容。")));
  });
}

async function readJson(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw appError(415, "UNSUPPORTED_CONTENT_TYPE", "请求必须使用 application/json。 ");
  }
  const rawBody = await readBody(request, MAX_JSON_BYTES);
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw appError(400, "INVALID_JSON", "请求内容不是有效 JSON。 ");
  }
}

function isRateLimited(request) {
  const address = request.socket.remoteAddress || "local";
  const now = Date.now();
  const previous = requestCounts.get(address);
  if (!previous || now - previous.startedAt >= 60_000) {
    requestCounts.set(address, { startedAt: now, count: 1 });
    return false;
  }
  previous.count += 1;
  return previous.count > 30;
}

function requireService(model, serviceName) {
  if (!apiKey || !model) {
    throw appError(503, "AI_NOT_CONFIGURED", `后端尚未配置${serviceName}服务，请补全 .env。`);
  }
}

async function callProvider(url, options) {
  let upstream;
  try {
    upstream = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error?.name === "TimeoutError") throw appError(504, "UPSTREAM_TIMEOUT", "AI 服务响应超时，请稍后重试。 ");
    throw appError(502, "UPSTREAM_UNAVAILABLE", "无法连接 AI 服务，请检查服务地址和网络。 ");
  }
  const responseText = await upstream.text();
  let payload;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!upstream.ok) {
    throw appError(502, "UPSTREAM_ERROR", `AI 服务请求失败（HTTP ${upstream.status}），请检查模型和服务商配置。`);
  }
  return payload;
}

function parseWorkerOutput(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // 模型加载时会有日志行，跳过它们继续往前找 JSON
    }
  }
  throw new Error("语音 worker 没有返回可解析的 JSON");
}

// SenseVoice 返回 <|SAD|> 这类标签，去掉符号后按原名交给前端，由前端决定怎么措辞。
function stripTag(value) {
  return typeof value === "string" ? value.replace(/[<>|]/g, "").trim() : "";
}

async function transcribe(request, response) {
  if (!useLocalAsr && !(apiKey && transcriptionModel)) {
    throw appError(503, "ASR_NOT_READY", "语音模型尚未安装，请先安装 requirements.txt 中的依赖。 ");
  }
  const contentType = (request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    throw appError(415, "UNSUPPORTED_AUDIO_TYPE", "请上传浏览器录制的音频文件。 ");
  }
  const isWav = ["audio/wav", "audio/x-wav", "audio/wave"].includes(contentType);
  // 本地模型只吃 WAV，浏览器 MediaRecorder 给的是 WebM，所以前端必须先解码成 16 kHz WAV。
  if (useLocalAsr && !isWav && contentType !== "application/octet-stream") {
    throw appError(415, "LOCAL_ASR_NEEDS_WAV", "本地语音识别只接受 16 kHz WAV，请在前端先把录音转码。 ");
  }
  const audio = await readBody(request, MAX_AUDIO_BYTES);
  if (!audio.length) throw appError(400, "EMPTY_AUDIO", "没有收到录音内容。 ");

  const extension = isWav ? "wav" : contentType.includes("mp4") || contentType.includes("m4a") ? "m4a" : "webm";
  if (useLocalAsr) {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "treehole-asr-"));
    const audioPath = path.join(directory, `recording.${extension}`);
    try {
      await fs.promises.writeFile(audioPath, audio);
      const { stdout } = await execFileAsync(pythonBin, [path.join(ROOT, "transcribe.py"), audioPath], {
        timeout: 180_000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      const result = parseWorkerOutput(stdout);
      const cues = result.voiceCues && typeof result.voiceCues === "object" ? result.voiceCues : null;
      const heardCue = Boolean(cues && (cues.cry || cues.sigh));
      let text = typeof result.text === "string" ? result.text.trim() : "";
      // 纯噪声时模型常吐出一个句点，别把它当成"听清了"。
      if (!/\p{L}|\p{N}/u.test(text)) text = "";
      // 只有一声叹气、没说字的时候不该按失败处理——那正是这个功能想听见的东西。
      if (!text && !heardCue) {
        throw appError(422, "EMPTY_TRANSCRIPTION", "没有识别到清晰的语音，请重试或输入文字。 ");
      }
      jsonResponse(response, 200, {
        text,
        emotion: stripTag(result.emotion),
        event: stripTag(result.event),
        duration: typeof result.duration === "number" ? result.duration : null,
        engine: "sensevoice",
        voiceCues: cues
          ? {
              cry: Boolean(cues.cry),
              sigh: Boolean(cues.sigh),
              cryScore: typeof cues.cryScore === "number" ? cues.cryScore : null,
              sighScore: typeof cues.sighScore === "number" ? cues.sighScore : null,
              reasons: Array.isArray(cues.reasons) ? cues.reasons.slice(0, 2).map(String) : [],
            }
          : null,
      });
      return;
    } catch (error) {
      if (Number.isInteger(error.status)) throw error;
      const detail = `${error.message || ""} ${error.stderr || ""}`;
      console.error("本地语音转写失败：", error.message);
      if (detail.includes("未找到 SenseVoice 模型")) {
        throw appError(503, "LOCAL_ASR_MODEL_MISSING", "本地模型文件缺失，请先运行 python prepare_model.py。 ");
      }
      throw appError(502, "LOCAL_ASR_FAILED", "本地语音转写失败，请检查模型下载和音频格式。 ");
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  }
  requireService(transcriptionModel, "语音识别");
  const form = new FormData();
  form.append("model", transcriptionModel);
  form.append("file", new File([audio], `recording.${extension}`, { type: contentType || "application/octet-stream" }));
  const payload = await callProvider(transcriptionUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (typeof payload.text !== "string" || !payload.text.trim()) {
    throw appError(502, "TRANSCRIPTION_EMPTY", "语音服务没有返回转写文本。 ");
  }
  jsonResponse(response, 200, { text: payload.text.trim() });
}

async function chat(request, response) {
  const payload = await readJson(request);
  const mode = payload.mode || "warm";
  const modePrompts = {
    quiet: "安静倾听模式：只给一句非常简短的回应，不追问、不评价、不分析、不提建议，像安静的回音墙。",
    warm: "温和共情模式：先共情并复述用户的情绪，不说教、不强行开导、不连续追问。",
    observer: "旁观者视角模式：用中性语言整理用户提到的事实与感受，不作价值判断，不替用户下结论。",
    gentle: "轻轻提问模式：先简短回应，再提出至多一个开放式问题，帮助用户自己看见感受，不审问、不建议。",
    "no-advice": "禁止开导模式：硬性规则：不提出建议、行动步骤、解决方案或说教；只做简短回应和陪伴。",
  };
  if (!Object.hasOwn(modePrompts, mode)) throw appError(400, "INVALID_MODE", "无效的倾听模式。 ");
  if (!Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 50) {
    throw appError(400, "INVALID_MESSAGES", "消息数量必须在 1 到 50 条之间。 ");
  }
  const messages = payload.messages.map((message) => {
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw appError(400, "INVALID_MESSAGE", "消息格式无效。 ");
    }
    const content = message.content.trim();
    if (!content || content.length > 4000) throw appError(400, "INVALID_MESSAGE_LENGTH", "单条消息不能为空或超过 4000 字。 ");
    return { role: message.role, content };
  });

  const latestUserText = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const state = support.analyze(latestUserText);
  const crisis = state.crisis;
  const resourceIds = support.recommend(latestUserText, mode);
  if (crisis) {
    jsonResponse(response, 200, {
      text: "谢谢你愿意告诉我这些。听起来你现在很痛苦，我会认真对待。请先联系一位你信任的人，让对方现在陪着你；如果你可能马上伤害自己，请立即联系当地紧急服务。你现在身边有可以联系的人吗？",
      crisis: true,
      resourceIds: [],
      demo: !Boolean(apiKey && chatModel),
    });
    return;
  }
  if (!apiKey || !chatModel) {
    const negative = state.distressed;
    const positive = !negative && /开心|快乐|高兴|成功|惊喜|幸福|喜欢/.test(latestUserText);
    const replies = {
      quiet: positive ? "听见你的开心了。我在这里。" : "我听见了。你可以慢慢说。",
      warm: positive ? "听到这件事让你开心，我也感受到你对这一刻的珍惜。" : negative ? "听起来这件事让你很不好受。你已经承受了不少，谢谢你愿意说给我听。" : "谢谢你把这些告诉我。我听见你正在认真感受这件事。",
      observer: positive ? "你提到一件让你感到开心的事，也在记录它对你的意义。" : negative ? "你提到了压力和不舒服的感受。我们可以先把这些感受放在这里。" : "你正在描述这件事和自己的感受。我会保持中立地听你说。",
      gentle: positive ? "听起来这是一个开心的时刻。你最想记住其中的什么？" : "我在听。此刻这件事里，哪一部分最想被你自己看见？",
      "no-advice": positive ? "我听到了你的开心。这里可以只为这一刻留一点空间。" : "谢谢你说出来。我会在这里听着，不急着分析，也不替你决定该怎么办。",
    };
    jsonResponse(response, 200, { text: replies[mode], mode, crisis: false, resourceIds, demo: true });
    return;
  }

  const resourcePrompt = resourceIds.length ? "先接住用户此刻的感受，再用一句可自由选择的话说明下方有放松练习可以看看；不承诺疗效，不要求用户必须去做。界面会提供经过筛选的资源链接，请勿自行生成网址。" : "";
  const systemPrompt = `你是一个中文情绪陪伴树洞。用自然、简洁的中文回应，不诊断、不治疗、不声称替代专业帮助。${modePrompts[mode]}${resourcePrompt}如果用户表达自伤或轻生风险，安全支持优先于倾听模式。`;
  const result = await callProvider(chatUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7,
    }),
  });
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw appError(502, "EMPTY_AI_REPLY", "AI 服务没有返回文字回复。 ");
  jsonResponse(response, 200, { text: text.trim(), mode, crisis: false, resourceIds, demo: false });
}

function serveFile(urlPath, response) {
  const entry = ALLOWED_FILES.get(urlPath);
  if (!entry) {
    jsonResponse(response, 404, { error: { code: "NOT_FOUND", message: "找不到此页面。" } });
    return;
  }
  const [fileName, contentType] = entry;
  const filePath = path.join(ROOT, fileName);
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      jsonResponse(response, 500, { error: { code: "STATIC_FILE_ERROR", message: "无法读取页面文件。" } });
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    response.end(contents);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/health") {
    jsonResponse(response, 200, {
      ok: true,
      chatConfigured: Boolean(apiKey && chatModel),
      transcriptionConfigured: useLocalAsr || Boolean(apiKey && transcriptionModel),
      transcriptionEngine: useLocalAsr ? "sensevoice" : apiKey && transcriptionModel ? "remote" : null,
      emotionTags: useLocalAsr,
      voiceCues: useLocalAsr,
      demoMode: !Boolean(apiKey && chatModel),
    });
    return;
  }
  if (request.method === "POST" && (url.pathname === "/api/chat" || url.pathname === "/api/transcribe")) {
    if (isRateLimited(request)) {
      jsonResponse(response, 429, { error: { code: "RATE_LIMITED", message: "请求太频繁，请稍后再试。" } });
      return;
    }
    try {
      if (url.pathname === "/api/chat") await chat(request, response);
      else await transcribe(request, response);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      jsonResponse(response, status, {
        error: {
          code: error.code || "INTERNAL_ERROR",
          message: error.message || "服务暂时出错，请稍后重试。",
        },
      });
    }
    return;
  }
  if (request.method === "GET") {
    serveFile(url.pathname, response);
    return;
  }
  jsonResponse(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "不支持此请求方法。" } });
});

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
server.listen(port, host, () => {
  console.log(`AI 树洞后端已启动：http://${host}:${port}`);
  console.log(`聊天服务：${apiKey && chatModel ? "已配置" : "待配置 .env"}；语音识别：${useLocalAsr ? "本地 SenseVoice（sherpa-onnx）" : apiKey && transcriptionModel ? "远程接口" : "未就绪（先建 venv 并下载模型）"}`);
});
