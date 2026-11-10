import support from '../support.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const error = (message, status) => json({error:{message}}, status);
export async function handleChat(request, env, providerFetch = fetch) {
  if (request.method !== 'POST') return error('请使用 POST 请求。', 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return error('不允许此来源访问。',403);
  if (!request.headers.get('Content-Type')?.includes('application/json')) return error('请求必须是 JSON。',415);
  let payload;
  try {
    const reader = request.body?.getReader();
    if (!reader) return error('消息不能为空。',400);
    const chunks=[]; let size=0;
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.byteLength;
      if(size>100000) { await reader.cancel(); return error('消息内容过长。',413); }
      chunks.push(value);
    }
    const bytes=new Uint8Array(size); let offset=0;
    for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
    payload=JSON.parse(new TextDecoder().decode(bytes));
  } catch { return error('请求格式无效。',400); }
  const mode = payload?.mode || 'warm';
  const modePrompts = {
    quiet: "安静倾听模式：只给一句非常简短的回应，不追问、不评价、不分析、不提建议，像安静的回音墙。",
    warm: "温和共情模式：先共情并复述用户的情绪，不说教、不强行开导、不连续追问。",
    observer: "旁观者视角模式：用中性语言整理用户提到的事实与感受，不作价值判断，不替用户下结论。",
    gentle: "轻轻提问模式：先简短回应，再提出至多一个开放式问题，帮助用户自己看见感受，不审问、不建议。",
    "no-advice": "禁止开导模式：硬性规则：不提出建议、行动步骤、解决方案或说教；只做简短回应和陪伴。",
  };

  if (!Object.hasOwn(modePrompts,mode)) return error('无效的倾听模式。',400);
  const messages=payload?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length>50 || messages.some(m=>!m || !['user','assistant'].includes(m.role) || typeof m.content!=='string' || !m.content.trim() || m.content.length>4000)) return error('消息格式或长度无效。',400);
  const latest=[...messages].reverse().find(m=>m.role==='user')?.content;
  if (!latest) return error('缺少用户消息。',400);
  if (support.analyze(latest).crisis) return json({text:'谢谢你愿意告诉我这些。我会认真对待你的感受。请联系一位信任的人陪着你；如果你可能马上伤害自己，请立即联系当地紧急服务。你现在身边有可以联系的人吗？',crisis:true,resourceIds:[],demo:false});
  if (!env.AI_API_KEY || !env.AI_CHAT_MODEL) return error('尚未配置 AI，请在 Cloudflare 设置 AI_API_KEY 和 AI_CHAT_MODEL 后重新部署。',503);
  const resourceIds=support.recommend(latest,mode);
  const system='你是中文情绪陪伴树洞。用自然、简洁的中文回应，不诊断、不治疗、不声称替代专业帮助。不自行生成资源网址。'+modePrompts[mode];
  try {
    const base=new URL(env.AI_BASE_URL || 'https://api.deepseek.com');
    if(base.protocol!=='https:' || base.username || base.password) return error('AI 服务地址配置无效。',503);
    const response=await providerFetch(base.href.replace(/\/$/,'')+'/chat/completions',{
      method:'POST', headers:{Authorization:`Bearer ${env.AI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:env.AI_CHAT_MODEL,messages:[{role:'system',content:system},...messages.map(({role,content})=>({role,content}))],max_tokens:800,stream:false}),
      signal:AbortSignal.timeout(45000),
    });
    if(!response.ok) return error(response.status===401?'AI 密钥无效，请检查 Cloudflare 配置。':response.status===402?'AI 账户余额不足，请检查服务商账户。':response.status===429?'AI 请求过于频繁，请稍后再试。':`AI 服务请求失败（${response.status}），请检查模型配置。`,502);
    const result=await response.json(); const text=result.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim()) return error('AI 未返回回复文字，请稍后重试。',502);
    return json({text:text.trim(),crisis:false,resourceIds,demo:false});
  } catch { return error('AI 服务连接失败或超时，请稍后重试。',502); }
}
