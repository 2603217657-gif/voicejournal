// Cloudflare Pages Function：给静态站点补一个语音识别后端。
// 放在仓库的 functions/api/ 下，Pages 会自动把这个路径变成 POST /api/transcribe。
// 使用 Pages 项目的 Workers AI 绑定（变量名 AI）；配额与费用以 Cloudflare 为准。
// 如果你更想用 Groq 或阿里云百炼，加对应环境变量即可，代码会按下面的顺序挑。

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const EMOTIONS = new Set(["surprised", "neutral", "happy", "sad", "disgusted", "angry", "fearful"]);

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function providerOf(env) {
  if (env.AI) return "workers-ai";
  if (env.GROQ_API_KEY) return "groq";
  if (env.DASHSCOPE_API_KEY) return "dashscope";
  return "";
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function viaWorkersAi(audio, env) {
  const result = await env.AI.run(env.ASR_MODEL || "@cf/openai/whisper-large-v3-turbo", {
    audio: toBase64(new Uint8Array(audio)),
  });
  const text = String(result?.text || result?.transcription || "").trim();
  if (!text) return { error: "没有识别到语音内容", code: "EMPTY_TRANSCRIPTION", status: 422 };
  return { text, emotion: "", engine: "whisper-workers-ai" };
}

async function viaGroq(audio, contentType, env) {
  const form = new FormData();
  form.append("model", env.ASR_MODEL || "whisper-large-v3-turbo");
  if (env.ASR_LANGUAGE) form.append("language", env.ASR_LANGUAGE);
  form.append("response_format", "json");
  form.append("file", new File([audio], "recording.wav", { type: contentType }));
  const upstream = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
  });
  const raw = await upstream.text();
  if (!upstream.ok) return { error: `语音服务返回 ${upstream.status}`, detail: raw.slice(0, 400), status: 502 };
  const parsed = safeJson(raw);
  if (!parsed) return { error: "语音服务返回的不是 JSON", detail: raw.slice(0, 200), status: 502 };
  const text = String(parsed.text || "").trim();
  if (!text) return { error: "没有识别到语音内容", code: "EMPTY_TRANSCRIPTION", status: 422 };
  return { text, emotion: "", engine: "whisper-groq" };
}

async function viaDashScope(audio, contentType, env) {
  const base = (env.DASHSCOPE_BASE || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
  const payload = {
    model: env.ASR_MODEL || "qwen3-asr-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: `data:${contentType || "audio/wav"};base64,${toBase64(new Uint8Array(audio))}` } },
        ],
      },
    ],
    asr_options: { enable_itn: true },
  };
  if (env.ASR_LANGUAGE) payload.asr_options.language = env.ASR_LANGUAGE;
  const upstream = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DASHSCOPE_API_KEY}` },
    body: JSON.stringify(payload),
  });
  const raw = await upstream.text();
  if (!upstream.ok) return { error: `语音服务返回 ${upstream.status}`, detail: raw.slice(0, 400), status: 502 };
  const parsed = safeJson(raw);
  if (!parsed) return { error: "语音服务返回的不是 JSON", detail: raw.slice(0, 200), status: 502 };
  const message = parsed?.choices?.[0]?.message || {};
  const content = message.content;
  const text = (typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part?.text || "").join("") : "").trim();
  const annotation = (message.annotations || [])[0] || {};
  const emotion = typeof annotation.emotion === "string" ? annotation.emotion.toLowerCase() : "";
  if (!text) return { error: "没有识别到语音内容", code: "EMPTY_TRANSCRIPTION", status: 422 };
  return { text, emotion: EMOTIONS.has(emotion) ? emotion.toUpperCase() : "", engine: "qwen-asr" };
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function onRequestPost({ request, env }) {
  const provider = providerOf(env);
  if (!provider) {
    return json(
      { error: "服务端还没配置语音后端：在 Pages 项目里加 Workers AI 绑定（变量名 AI），或填 GROQ_API_KEY / DASHSCOPE_API_KEY", code: "NO_PROVIDER" },
      503,
    );
  }
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/")) return json({ error: "请以 audio/wav 上传录音", code: "BAD_CONTENT_TYPE" }, 415);
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: "没有收到音频", code: "EMPTY_AUDIO" }, 400);
  if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: "录音太长，请控制在 2 分钟以内", code: "AUDIO_TOO_LARGE" }, 413);

  try {
    const result =
      provider === "workers-ai"
        ? await viaWorkersAi(audio, env)
        : provider === "groq"
          ? await viaGroq(audio, contentType, env)
          : await viaDashScope(audio, contentType, env);
    if (result.error) return json({ ...result, provider }, result.status || 502);
    // voiceCues 留空：哭腔/叹气由浏览器里的 cues.js 算，前端会自己补。
    return json({ ...result, voiceCues: null, provider }, 200);
  } catch (error) {
    return json({ error: "后端出错", detail: String(error?.message || error), code: "FUNCTION_ERROR" }, 502);
  }
}
