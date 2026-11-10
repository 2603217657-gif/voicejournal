// 与 functions/api/transcribe.js 配套的健康检查。
// 前端启动时会探测这个地址：只有它回 JSON 且 transcriptionConfigured 为 true，才会启用语音识别。
export async function onRequestGet({ env }) {
  const provider = env.AI ? "workers-ai" : env.GROQ_API_KEY ? "groq" : env.DASHSCOPE_API_KEY ? "dashscope" : null;
  return new Response(
    JSON.stringify({
      ok: true,
      transcriptionConfigured: Boolean(provider),
      transcriptionEngine: provider,
      emotionTags: provider === "dashscope",
      voiceCues: false,
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
