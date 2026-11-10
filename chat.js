const MAX_RECORDING_SECONDS = 120;
const SERVICE_CONFIG = window.TREEHOLE_CONFIG || {};
const SESSIONS_KEY = "treehole-demo-sessions-v1";
const ACTIVE_SESSION_KEY = "treehole-demo-active-session-v1";
const USER_KEY = "treehole-demo-user-v1";
const CONSENT_KEY = `treehole-audio-consent-v2-${SERVICE_CONFIG.asrMode || "none"}`;
const LISTENING_MODE_KEY = "treehole-demo-listening-mode-v1";
const SUPPORT_POPUP_KEY = "treehole-support-auto-popup-v1";
const supportPopupTimes = new Map();
let replyPending = false;
const LISTENING_MODE_HELP = {
  quiet: "像一面回音墙：少说、不追问、不评判。",
  warm: "先共情并复述感受，不急着讲道理。",
  observer: "用中性的语言帮你梳理感受，不作判断。",
  gentle: "只用一个开放式问题，陪你看见自己的想法。",
  "no-advice": "只回应与陪伴，不给建议或解决方案。",
};
const AUDIO_DB_NAME = "treehole-demo-audio";
const AUDIO_STORE = "recordings";

const elements = {
  pickAudioButton: document.querySelector("#pick-audio-button"),
  pickAudioInput: document.querySelector("#pick-audio-input"),
  recordButton: document.querySelector("#record-button"),
  recordLabel: document.querySelector("#record-label"),
  timer: document.querySelector("#timer"),
  messageForm: document.querySelector("#message-form"),
  userMessage: document.querySelector("#user-message"),
  charCount: document.querySelector("#char-count"),
  sendButton: document.querySelector("#send-button"),
  listeningMode: document.querySelector("#listening-mode"),
  listeningModeHelp: document.querySelector("#listening-mode-help"),
  messageList: document.querySelector("#message-list"),
  threadView: document.querySelector("#thread-view"),
  emptyConversation: document.querySelector("#empty-conversation"),
  conversationTitle: document.querySelector("#conversation-title"),
  conversationUpdated: document.querySelector("#conversation-updated"),
  transcriptionStatus: document.querySelector("#transcription-status"),
  replyStatus: document.querySelector("#reply-status"),
  toast: document.querySelector("#toast"),
  consentDialog: document.querySelector("#consent-dialog"),
  consentCheckbox: document.querySelector("#consent-checkbox"),
  consentConfirm: document.querySelector("#consent-confirm"),
  consentCancel: document.querySelector("#consent-cancel"),
  loginDialog: document.querySelector("#login-dialog"),
  loginForm: document.querySelector("#login-form"),
  loginError: document.querySelector("#login-error"),
  phoneInput: document.querySelector("#phone-input"),
  codeInput: document.querySelector("#code-input"),
  profileLabel: document.querySelector("#profile-label"),
  historyDialog: document.querySelector("#history-dialog"),
  historyList: document.querySelector("#history-list"),
  historyCount: document.querySelector("#history-count"),
  deleteAll: document.querySelector("#delete-all"),
  privacyDialog: document.querySelector("#privacy-dialog"),
  supportDialog: document.querySelector("#support-dialog"),
  supportCards: document.querySelector("#support-cards"),
  supportAutoPopup: document.querySelector("#support-auto-popup"),
};

let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let timerInterval = null;
let recordingTimeout = null;
let pendingAudioBlob = null;
let pendingVoiceHint = null;
let currentMode = "text";
let listeningMode = localStorage.getItem(LISTENING_MODE_KEY) || "warm";
if (!(listeningMode in LISTENING_MODE_HELP)) listeningMode = "warm";
let activeSessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
let toastTimeout = null;
let transcriptionConfigured = false;
let browserRecognition = null;
let browserTranscript = "";

let consentAction = "record";
let transcriptionPending = false;
let ASR_LABEL = SERVICE_CONFIG.asrMode === "cloud" ? "云端识别" : "本地模型";
function updateAudioPrivacy() {
  const mode = SERVICE_CONFIG.asrMode;
  const audio = mode === "cloud"
    ? "语音转写会将录音上传到配置的云端语音服务。数据处理与保留方式以服务商政策为准。"
    : mode === "local"
      ? "录音会发送到运行本站的电脑，由本地 SenseVoice 模型转写；手机访问时也由那台电脑处理。"
      : "当前未配置语音转写服务。若使用浏览器自带识别，语音可能由浏览器服务商处理。";
  document.querySelector("#consent-audio-line").textContent = audio;
  document.querySelector("#privacy-audio-line").textContent = audio + " 发送对话后，文字及近期上下文会交给配置的 AI 服务商；离线模式使用规则回复。会话历史保存在当前浏览器。";
}
updateAudioPrivacy();
elements.pickAudioButton.hidden = !SERVICE_CONFIG.transcriptionEndpoint;
const backendReady = SERVICE_CONFIG.healthEndpoint
  ? fetch(SERVICE_CONFIG.healthEndpoint, { signal: AbortSignal.timeout(8000) }).then((response) => {
      if (!response.ok) throw new Error("服务状态检查失败");
      return response.json();
    }).then((health) => {
      transcriptionConfigured = Boolean(health.transcriptionConfigured);
      if (transcriptionConfigured) {
        SERVICE_CONFIG.asrMode = health.transcriptionEngine === "sensevoice" ? "local" : "cloud";
        ASR_LABEL = SERVICE_CONFIG.asrMode === "cloud" ? "云端识别" : "本地模型";
        updateAudioPrivacy();
      }
    }).catch(() => {})
  : Promise.resolve();

function readSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function openAudioDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("本机存储不可用"));
      return;
    }
    const request = indexedDB.open(AUDIO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUDIO_STORE)) request.result.createObjectStore(AUDIO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本机存储"));
  });
}

async function putAudio(id, blob) {
  if (!blob) return;
  const database = await openAudioDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(AUDIO_STORE, "readwrite");
    transaction.objectStore(AUDIO_STORE).put(blob, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("录音保存失败"));
  });
  database.close();
}

async function fetchAudio(id) {
  const database = await openAudioDatabase();
  const blob = await new Promise((resolve, reject) => {
    const request = database.transaction(AUDIO_STORE, "readonly").objectStore(AUDIO_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("读取录音失败"));
  });
  database.close();
  return blob;
}

async function removeAudio(id) {
  const database = await openAudioDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(AUDIO_STORE, "readwrite");
    transaction.objectStore(AUDIO_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("录音删除失败"));
  });
  database.close();
}

async function clearAudio() {
  if (!("indexedDB" in window)) return;
  const database = await openAudioDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(AUDIO_STORE, "readwrite");
    transaction.objectStore(AUDIO_STORE).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("录音清理失败"));
  });
  database.close();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3000);
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function updateTimer() {
  const seconds = Math.min(Math.floor((Date.now() - recordingStartedAt) / 1000), MAX_RECORDING_SECONDS);
  elements.timer.innerHTML = `${formatTime(seconds)} <span>/ 02:00</span>`;
}

function updateUserState() {
  const user = localStorage.getItem(USER_KEY);
  elements.profileLabel.textContent = user ? `${user.slice(0, 3)}****${user.slice(-4)}` : "登录";
}

function createSession() {
  const now = new Date().toISOString();
  const session = {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: "新的对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  const sessions = readSessions();
  sessions.unshift(session);
  saveSessions(sessions);
  activeSessionId = session.id;
  localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
  renderActiveSession();
  elements.userMessage.focus();
  return session;
}

function getActiveSession() {
  return readSessions().find((session) => session.id === activeSessionId && !session.sealedAt) || null;
}

function renderActiveSession() {
  const session = getActiveSession();
  elements.conversationTitle.textContent = session?.title || "新的对话";
  elements.conversationUpdated.textContent = session?.messages.length
    ? `共 ${session.messages.length} 条消息 · ${formatDate(session.updatedAt)}`
    : "内容会连续保留在这里";
  elements.messageList.replaceChildren();
  elements.emptyConversation.hidden = Boolean(session?.messages.length);
  if (!session) return;
  for (const message of session.messages) {
    elements.messageList.append(createMessageElement(message));
  }
  elements.threadView.scrollTop = elements.threadView.scrollHeight;
}

function createMessageElement(message) {
  const row = document.createElement("article");
  row.className = `message-row ${message.role === "user" ? "user" : "assistant"}`;

  if (message.role === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "树";
    row.append(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";
  const role = document.createElement("p");
  role.className = "message-role";
  role.textContent = message.role === "user" ? (message.source === "voice" ? "你 · 语音转写" : "你") : "树洞";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = message.text;
  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = message.createdAt;
  time.textContent = formatClock(message.createdAt);
  content.append(role, bubble, time);

  if (message.voiceHint) {
    const hint = document.createElement("small");
    hint.className = "message-voice-hint";
    hint.textContent = `声音参考 · ${message.voiceHint}`;
    content.append(hint);
  }

  if (message.audioId) {
    void fetchAudio(message.audioId).then((blob) => {
      if (!blob) return;
      const player = document.createElement("audio");
      player.className = "message-audio";
      player.controls = true;
      player.src = URL.createObjectURL(blob);
      content.append(player);
    }).catch(() => {});
  }

  if (message.role === "assistant" && message.mode === "voice") {
    const playButton = document.createElement("button");
    playButton.className = "message-listen";
    playButton.type = "button";
    playButton.innerHTML = '<span class="play-triangle" aria-hidden="true"></span> 再听一次';
    playButton.addEventListener("click", () => speak(message.text));
    content.append(playButton);
  }

  if (message.role === "assistant" && message.crisis) content.append(createSafetyPanel());
  if (message.role === "assistant" && !message.crisis) {
    const ids = TreeholeSupport.validIds(message.resourceIds);
    if (ids.length) {
      const help = document.createElement("button");
      help.type = "button";
      help.className = "message-support";
      help.textContent = `给自己一点缓冲 · 查看 ${ids.length} 个实操链接 ↗`;
      help.addEventListener("click", () => openSupportDialog(ids));
      content.append(help);
    }
  }
  row.append(content);
  return row;
}

function createSafetyPanel() {
  const panel = document.createElement("div");
  panel.className = "message-safety";
  const support = document.createElement("p");
  support.textContent = "谢谢你愿意说出来。此刻请尽量不要独自面对，可以马上联系一位你信任的人，告诉对方你需要陪伴。";
  const note = document.createElement("small");
  note.className = "message-safety-note";
  note.textContent = "如你正处于紧急危险中，请立即联系当地紧急服务，并让身边可信任的人陪伴你。";
  panel.append(support, note);
  return panel;
}

function openSupportDialog(resourceIds) {
  const ids = TreeholeSupport.validIds(resourceIds);
  if (!ids.length || document.querySelector("dialog[open]")) return;
  elements.supportCards.replaceChildren();
  for (const id of ids) {
    const resource = TreeholeSupport.resources[id];
    const card = document.createElement("article");
    card.className = "support-card";
    const duration = document.createElement("small");
    duration.textContent = resource.duration;
    const title = document.createElement("h3");
    title.textContent = resource.title;
    const description = document.createElement("p");
    description.textContent = resource.description;
    const link = document.createElement("a");
    link.className = "resource-link";
    link.href = resource.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${resource.action} ↗`;
    link.setAttribute("aria-label", `${resource.action}（在新标签页打开）`);
    card.append(duration, title, description, link);
    elements.supportCards.append(card);
  }
  elements.supportAutoPopup.checked = localStorage.getItem(SUPPORT_POPUP_KEY) !== "off";
  elements.supportDialog.showModal();
  document.querySelector("#support-title").focus();
}

function maybeOpenSupport(message, sessionId) {
  if (!message.resourceIds.length || message.crisis || activeSessionId !== sessionId) return;
  if (localStorage.getItem(SUPPORT_POPUP_KEY) === "off" || document.querySelector("dialog[open]")) return;
  if (Date.now() - (supportPopupTimes.get(sessionId) || 0) < 5 * 60 * 1000) return;
  supportPopupTimes.set(sessionId, Date.now());
  openSupportDialog(message.resourceIds);
}

function chooseReply(message, mode = "warm") {
  const state = TreeholeSupport.analyze(message);
  if (state.crisis) {
    return {
      crisis: true,
      text: "谢谢你愿意把这些告诉我。我听见你现在承受着很重的痛苦，你不需要独自扛着。此刻能不能先联系一个你信任的人，让对方陪在你身边？如果你感觉自己可能马上会受伤，请尽快联系当地紧急服务。",
    };
  }
  const negative = state.distressed;
  const positive = !negative && /开心|快乐|高兴|成功|完成|喜欢|惊喜|幸福|激动|拿到|分享/.test(message);
  if (mode === "quiet") return { crisis: false, text: positive ? "听见你的开心了。我在这里。" : "我听见了。你可以慢慢说。" };
  if (mode === "observer") return { crisis: false, text: positive ? "你提到一件让你感到开心的事，也在记录它对你的意义。" : negative ? "你提到了压力和不舒服的感受。我们可以先把这些感受放在这里。" : "你正在描述这件事和自己的感受。我会保持中立地听你说。" };
  if (mode === "gentle") return { crisis: false, text: positive ? "听起来这是一个开心的时刻。你最想记住其中的什么？" : "我在听。此刻这件事里，哪一部分最想被你自己看见？" };
  if (mode === "no-advice") return { crisis: false, text: positive ? "我听到了你的开心。这里可以只为这一刻留一点空间。" : "谢谢你说出来。我会在这里听着，不急着分析，也不替你决定该怎么办。" };
  if (mode === "warm") return { crisis: false, text: positive ? "听到这件事让你开心，我也感受到你对这一刻的珍惜。" : negative ? "听起来这件事让你很不好受。你已经承受了不少，谢谢你愿意说给我听。" : "谢谢你把这些告诉我。我听见你正在认真感受这件事。" };
  if (/开心|快乐|高兴|成功|完成|喜欢|惊喜|幸福|激动|拿到|分享/.test(message)) {
    return { crisis: false, text: "听到你这么开心，我也替你高兴。这个时刻一定很值得记住。愿意多和我讲讲，最让你开心的部分是什么吗？" };
  }
  if (/累|疲惫|烦|无奈|无助|压力|难过|委屈|焦虑|撑不住|叹气|哭/.test(message)) {
    return { crisis: false, text: "听起来你这阵子真的承受了不少。谢谢你愿意在这里说出来，我会先陪你待一会儿，不急着给你建议。最近哪件事最让你觉得累？" };
  }
  return { crisis: false, text: "谢谢你把这段话交给我。我在听。你现在最希望有人理解的，是这件事里的哪一部分？" };
}

async function getApiError(response, fallback) {
  try {
    const result = await response.json();
    return (typeof result.error === "string" ? result.error : result.error?.message) || fallback;
  } catch {
    return fallback;
  }
}

// SenseVoice 只认 16 kHz WAV，而浏览器录音是 WebM，所以先在本机解码 + 重采样再上传。
// 统一为单声道 16 kHz WAV，兼容本地模型和云端转写接口。
const EMOTION_HINTS = {
  SAD: "声音偏低落",
  HAPPY: "声音偏轻快",
  ANGRY: "声音偏急",
  NEUTRAL: "声音比较平稳",
  FEARFUL: "声音有点紧",
  DISGUSTED: "",
  SURPRISED: "声音有点起伏",
  OTHER: "",
};

function encodeWav16(samples, sampleRate) {
  return window.TreeholeWav.encodeWav16(samples, sampleRate);
}

async function toWav16k(blob) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context || !window.OfflineAudioContext) throw new Error("当前浏览器无法解码录音");
  const context = new Context();
  try {
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (audioBuffer.duration > MAX_RECORDING_SECONDS + 1) throw new Error("录音请控制在 2 分钟以内。");
    const frames = Math.max(1, Math.ceil(audioBuffer.duration * 16000));
    const offline = new OfflineAudioContext(1, frames, 16000);
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    // 返回采样数据，供浏览器补充声音特征分析。
    return { blob: encodeWav16(samples, 16000), samples };
  } finally {
    context.close?.();
  }
}

// 把服务端和浏览器端两套线索统一成界面用的形状。
function summarizeCues(cues) {
  if (!cues) return null;
  const cry = cues.cry && typeof cues.cry === "object" ? cues.cry : { detected: Boolean(cues.cry) };
  const sigh = cues.sigh && typeof cues.sigh === "object" ? cues.sigh : { detected: Boolean(cues.sigh) };
  const reasons = [cry.reason, sigh.reason].filter(Boolean).slice(0, 2);
  return {
    cry: Boolean(cry.detected),
    sigh: Boolean(sigh.detected),
    cryScore: typeof cues.cryScore === "number" ? cues.cryScore : cry.score ?? null,
    sighScore: typeof cues.sighScore === "number" ? cues.sighScore : sigh.score ?? null,
    reasons,
  };
}

async function transcribeAudio(blob) {
  if (!SERVICE_CONFIG.transcriptionEndpoint) throw new Error("语音识别服务尚未配置");
  let wav;
  let samples = null;
  try {
    const converted = await toWav16k(blob);
    wav = converted.blob;
    samples = converted.samples;
  } catch (error) {
    throw new Error(error.message.includes("2 分钟") ? error.message : "本机无法解码这段录音，请换用 WAV、MP3 或手动输入内容。");
  }
  const response = await fetch(SERVICE_CONFIG.transcriptionEndpoint, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });
  if (!response.ok) throw new Error(await getApiError(response, "语音识别请求失败"));
  const result = await response.json();
  const text = typeof result.text === "string" ? result.text.trim() : "";
  // 本地服务会带 voiceCues；云端只回文字和情感，所以这两类线索在浏览器里补算。
  let voiceCues = summarizeCues(result.voiceCues);
  if (!voiceCues && samples && window.TreeholeCues) {
    voiceCues = summarizeCues(window.TreeholeCues.analyze(samples));
  }
  return {
    text,
    emotion: typeof result.emotion === "string" ? result.emotion.toUpperCase() : "",
    event: result.event || "",
    voiceCues,
  };
}

function describeVoice(emotion, event, cues) {
  const parts = [];
  if (cues && cues.cry) parts.push("听到哭腔");
  else if (event === "Cry") parts.push("听到哭声");
  if (cues && cues.sigh) parts.push("听到一声叹气");
  if (event === "Laughter") parts.push("听到笑声");
  if (EMOTION_HINTS[emotion]) parts.push(EMOTION_HINTS[emotion]);
  return parts.join(" · ");
}

// 录音和"选一段已有录音文件"走的是同一条转写与回填流程，避免两处判断渐渐跑偏。
function applyTranscribed(result) {
  const hint = describeVoice(result.emotion, result.event, result.voiceCues);
  if (!result.text) {
    // 只听到了一声叹气 / 哭腔，没有字：不当作失败，也不清空输入框。
    elements.transcriptionStatus.textContent = `没有听清说话内容${hint ? `，但${hint}` : ""}。可以直接打字，或再说一遍。`;
    elements.transcriptionStatus.hidden = false;
    elements.userMessage.focus();
    return;
  }
  elements.userMessage.value = result.text;
  updateComposer();
  pendingVoiceHint = hint;
  elements.transcriptionStatus.textContent = hint
    ? `语音已转成文字（${ASR_LABEL} · ${hint}），请检查或编辑后发送。`
    : `语音已转成文字（${ASR_LABEL}），请检查或编辑后发送。`;
  elements.userMessage.focus();
}

function transcribeBlob(blob) {
  if (transcriptionPending) return;
  transcriptionPending = true;
  pendingVoiceHint = null;
  elements.recordButton.disabled = true;
  elements.pickAudioButton.disabled = true;
  updateComposer();
  elements.transcriptionStatus.textContent = "正在识别语音……";
  elements.transcriptionStatus.hidden = false;
  void transcribeAudio(blob)
    .then(applyTranscribed)
    .catch((error) => {
      elements.transcriptionStatus.textContent = `${error.message || "语音识别暂不可用。"} 录音仍暂存在本页；请手动输入你说的话后发送。`;
      elements.transcriptionStatus.hidden = false;
      elements.userMessage.focus();
    }).finally(() => {
      transcriptionPending = false;
      elements.recordButton.disabled = false;
      elements.pickAudioButton.disabled = false;
      updateComposer();
    });
}

async function requestAssistantReply(messages, mode) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.text || "";
  if (!SERVICE_CONFIG.chatEndpoint || TreeholeSupport.analyze(latestUserMessage).crisis) return chooseReply(latestUserMessage, mode);
  const response = await fetch(SERVICE_CONFIG.chatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, messages: messages.slice(-30).map(({ role, text }) => ({ role, content: text })) }),
  });
  if (!response.ok) throw new Error(await getApiError(response, "AI 回复请求失败"));
  const result = await response.json();
  if (typeof result.text !== "string" || !result.text.trim()) throw new Error("AI 服务没有返回回复文本");
  return {
    text: result.text.trim(),
    crisis: Boolean(result.crisis) || TreeholeSupport.analyze(latestUserMessage).crisis,
  };
}

function updateComposer() {
  const length = elements.userMessage.value.length;
  elements.charCount.textContent = `${length} / 1200`;
  elements.sendButton.disabled = transcriptionPending || replyPending || !elements.userMessage.value.trim();
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    showToast("当前浏览器暂不支持语音朗读，请切换为文字回复。");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = /难过|痛苦|累|委屈|陪着你|我在听/.test(text) ? 0.82 : 0.96;
  window.speechSynthesis.speak(utterance);
}

function saveSession(session, activate = true) {
  const sessions = readSessions();
  const index = sessions.findIndex((entry) => entry.id === session.id);
  if (index >= 0) sessions[index] = session;
  else sessions.unshift(session);
  sessions.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  saveSessions(sessions);
  if (activate) {
    localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
    activeSessionId = session.id;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const text = elements.userMessage.value.trim();
  if (!text || replyPending) return;
  replyPending = true;
  const selectedListeningMode = listeningMode;

  let session = getActiveSession();
  if (!session) session = createSession();
  const createdAt = new Date().toISOString();
  const userMessage = {
    id: crypto.randomUUID?.() || `${Date.now()}-user`,
    role: "user",
    text,
    source: pendingAudioBlob ? "voice" : "text",
    voiceHint: pendingAudioBlob ? pendingVoiceHint : null,
    createdAt,
    audioId: pendingAudioBlob ? crypto.randomUUID?.() || `${Date.now()}-audio` : null,
  };
  session.messages.push(userMessage);
  session.updatedAt = createdAt;
  if (session.messages.filter((message) => message.role === "user").length === 1) session.title = text.slice(0, 24);

  try {
    saveSession(session);
    if (pendingAudioBlob && userMessage.audioId) await putAudio(userMessage.audioId, pendingAudioBlob);
  } catch {
    showToast("本机存储失败，当前消息暂时无法可靠保存。");
  }

  pendingAudioBlob = null;
  pendingVoiceHint = null;
  elements.userMessage.value = "";
  elements.transcriptionStatus.hidden = true;
  updateComposer();
  renderActiveSession();
  elements.sendButton.disabled = true;
  elements.replyStatus.textContent = "树洞正在回应这段对话……";
  elements.replyStatus.hidden = false;
  try {
    const response = await requestAssistantReply(session.messages, selectedListeningMode);
    const assistantMessage = {
      id: crypto.randomUUID?.() || `${Date.now()}-assistant`,
      role: "assistant",
      text: response.text,
      crisis: response.crisis,
      mode: currentMode,
      listeningMode: selectedListeningMode,
      resourceIds: response.crisis ? [] : TreeholeSupport.recommend(text, selectedListeningMode),
      createdAt: new Date().toISOString(),
    };
    session.messages.push(assistantMessage);
    session.updatedAt = assistantMessage.createdAt;
    saveSession(session, false);
    elements.replyStatus.hidden = true;
    renderActiveSession();
    if (activeSessionId === session.id) {
      if (currentMode === "voice") speak(assistantMessage.text);
      maybeOpenSupport(assistantMessage, session.id);
    }
  } catch (error) {
    elements.replyStatus.textContent = error.message || "这条消息已经保留，但暂时没有收到回应。";
    showToast("你的消息已保留；" + (error.message || "AI 服务暂不可用。"));
  }
  replyPending = false;
  updateComposer();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatClock(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function openSession(session) {
  session = readSessions().find((entry) => entry.id === session.id);
  if (!session || session.sealedAt) return;
  activeSessionId = session.id;
  localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
  renderActiveSession();
  elements.historyDialog.close();
  elements.threadView.scrollTop = elements.threadView.scrollHeight;
}

function renderHistory() {
  const sessions = readSessions().filter((session) => session.messages?.length);
  elements.historyCount.textContent = `${sessions.length} 个对话`;
  elements.deleteAll.hidden = sessions.length === 0;
  elements.historyList.replaceChildren();
  if (sessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "这里还很安静。准备好时，来和树洞说说话。";
    elements.historyList.append(empty);
    return;
  }

  for (const session of sessions) {
    const item = document.createElement("article");
    item.className = "history-item session-item";
    const main = document.createElement("button");
    main.className = "history-item-main history-session-button";
    main.type = "button";
    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = formatDate(session.sealedAt || session.updatedAt);
    const preview = document.createElement("span");
    preview.className = "history-preview";
    preview.textContent = session.sealedAt ? "一段已安放的心事" : session.title || session.messages.find((message) => message.role === "user")?.text || "新的对话";
    const meta = document.createElement("span");
    meta.className = "history-session-meta";
    meta.textContent = session.sealedAt ? "已封存 · 让它在这里休息" : `${session.messages.length} 条消息`;
    main.disabled = Boolean(session.sealedAt);
    main.append(date, preview, meta);
    main.addEventListener("click", () => openSession(session));

    const continueButton = document.createElement("button");
    continueButton.className = "history-continue";
    continueButton.type = "button";
    continueButton.textContent = "继续";
    continueButton.hidden = Boolean(session.sealedAt);
    continueButton.addEventListener("click", () => openSession(session));

    const removeButton = document.createElement("button");
    removeButton.className = "history-delete";
    removeButton.type = "button";
    removeButton.textContent = "删除";
    removeButton.addEventListener("click", async () => {
      const audioIds = session.messages.map((message) => message.audioId).filter(Boolean);
      saveSessions(readSessions().filter((entry) => entry.id !== session.id));
      for (const id of audioIds) await removeAudio(id).catch(() => {});
      if (activeSessionId === session.id) {
        activeSessionId = null;
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        renderActiveSession();
      }
      renderHistory();
      showToast("该对话已从当前浏览器删除。");
    });
    item.append(main, continueButton, removeButton);
    elements.historyList.append(item);
  }
}

function beginRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("当前浏览器暂不支持网页录音，请使用较新的手机浏览器。");
    return;
  }
  void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then((stream) => {
    browserTranscript = "";
    if (!transcriptionConfigured) {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (Recognition) {
        browserRecognition = new Recognition();
        browserRecognition.lang = "zh-CN";
        browserRecognition.continuous = true;
        browserRecognition.interimResults = true;
        browserRecognition.onresult = (event) => {
          browserTranscript = Array.from(event.results).map((result) => result[0]?.transcript || "").join("").trim();
          if (browserTranscript) {
            elements.userMessage.value = browserTranscript;
            updateComposer();
            elements.transcriptionStatus.textContent = "浏览器识别结果可编辑，确认后发送。";
            elements.transcriptionStatus.hidden = false;
          }
        };
        browserRecognition.onerror = () => {
          elements.transcriptionStatus.textContent = "浏览器语音识别不可用；录音会保留，请手动输入内容后发送。";
          elements.transcriptionStatus.hidden = false;
        };
        try { browserRecognition.start(); } catch { browserRecognition = null; }
      }
    }
    recordingStream = stream;
    recordingChunks = [];
    const preferredMime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported?.(type));
    mediaRecorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      pendingAudioBlob = new Blob(recordingChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
      if (!transcriptionConfigured) {
        elements.transcriptionStatus.textContent = browserTranscript
          ? "语音已识别，请检查或编辑后发送。"
          : "录音已保留；当前浏览器未返回识别文字，请手动输入后发送。";
        elements.transcriptionStatus.hidden = false;
        return;
      }
      transcribeBlob(pendingAudioBlob);
    }, { once: true });
    mediaRecorder.start();
    recordingStartedAt = Date.now();
    document.body.classList.add("is-recording");
    elements.recordButton.setAttribute("aria-label", "结束录音");
    elements.recordLabel.textContent = "结束录音";
    elements.recordButton.querySelector(".mic-icon").setAttribute("aria-hidden", "true");
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 250);
    recordingTimeout = window.setTimeout(() => {
      if (mediaRecorder?.state === "recording") {
        stopRecording();
        showToast("已达到 2 分钟录音上限，录音已自动结束。");
      }
    }, MAX_RECORDING_SECONDS * 1000);
  }).catch((error) => {
    showToast(error?.name === "NotAllowedError" ? "请在浏览器设置中允许麦克风权限后重试。" : "暂时无法访问麦克风，请检查设备设置后重试。");
  });
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  if (browserRecognition) {
    try { browserRecognition.stop(); } catch {}
    browserRecognition = null;
  }
  window.clearInterval(timerInterval);
  window.clearTimeout(recordingTimeout);
  document.body.classList.remove("is-recording");
  elements.recordButton.setAttribute("aria-label", "开始录音");
  elements.recordLabel.textContent = "语音输入";
  if (recordingStream) recordingStream.getTracks().forEach((track) => track.stop());
  elements.timer.innerHTML = "00:00 <span>/ 02:00</span>";
}

elements.recordButton.addEventListener("click", async () => {
  if (mediaRecorder?.state === "recording") {
    stopRecording();
    return;
  }
  await backendReady;
  consentAction = "record";
  if (localStorage.getItem(CONSENT_KEY) !== "accepted-v1") {
    elements.consentCheckbox.checked = false;
    elements.consentConfirm.disabled = true;
    elements.consentDialog.showModal();
    return;
  }
  beginRecording();
});

elements.pickAudioButton.addEventListener("click", () => {
  if (transcriptionPending || mediaRecorder?.state === "recording") return;
  consentAction = "file";
  if (localStorage.getItem(CONSENT_KEY) !== "accepted-v1") {
    elements.consentCheckbox.checked = false;
    elements.consentConfirm.disabled = true;
    elements.consentDialog.showModal();
    return;
  }
  elements.pickAudioInput.click();
});
elements.pickAudioInput.addEventListener("change", () => {
  const file = elements.pickAudioInput.files?.[0];
  elements.pickAudioInput.value = "";
  if (!file || transcriptionPending || mediaRecorder?.state === "recording") return;
  if (file.size > 24 * 1024 * 1024) {
    showToast("录音文件过大，请选择 2 分钟以内、24 MB 以下的音频。");
    return;
  }
  pendingAudioBlob = file;
  transcribeBlob(file);
});

elements.consentCheckbox.addEventListener("change", () => {
  elements.consentConfirm.disabled = !elements.consentCheckbox.checked;
});
elements.consentConfirm.addEventListener("click", () => {
  if (!elements.consentCheckbox.checked) return;
  localStorage.setItem(CONSENT_KEY, "accepted-v1");
  elements.consentDialog.close();
  if (consentAction === "file") elements.pickAudioInput.click();
  else beginRecording();
});
elements.consentCancel.addEventListener("click", () => elements.consentDialog.close());

elements.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const phone = elements.phoneInput.value.trim();
  if (!/^1\d{10}$/.test(phone)) {
    elements.loginError.textContent = "请输入有效的中国大陆手机号。";
    return;
  }
  if (elements.codeInput.value.trim() !== "246810") {
    elements.loginError.textContent = "请输入演示验证码 246810。";
    return;
  }
  localStorage.setItem(USER_KEY, phone);
  updateUserState();
  elements.loginDialog.close();
  showToast("演示登录成功。正式验证码服务尚未接入。");
});

document.querySelector("#profile-open").addEventListener("click", () => {
  if (!localStorage.getItem(USER_KEY)) {
    elements.loginError.textContent = "";
    elements.loginDialog.showModal();
    return;
  }
  if (window.confirm("退出当前演示账号？本机历史记录会保留。")) {
    localStorage.removeItem(USER_KEY);
    updateUserState();
    showToast("已退出演示账号。");
  }
});

elements.messageForm.addEventListener("submit", sendMessage);
elements.userMessage.addEventListener("input", updateComposer);
elements.listeningMode.value = listeningMode;
elements.listeningModeHelp.textContent = LISTENING_MODE_HELP[listeningMode];
elements.listeningMode.addEventListener("change", () => {
  listeningMode = elements.listeningMode.value;
  if (!(listeningMode in LISTENING_MODE_HELP)) listeningMode = "warm";
  elements.listeningModeHelp.textContent = LISTENING_MODE_HELP[listeningMode];
  localStorage.setItem(LISTENING_MODE_KEY, listeningMode);
});
elements.userMessage.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") elements.messageForm.requestSubmit();
});

document.querySelectorAll(".reply-option").forEach((button) => {
  button.addEventListener("click", () => {
    currentMode = button.dataset.mode;
    document.querySelectorAll(".reply-option").forEach((option) => {
      const selected = option === button;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
  });
});

document.querySelector("#new-conversation").addEventListener("click", () => {
  pendingAudioBlob = null;
  pendingVoiceHint = null;
  elements.userMessage.value = "";
  elements.transcriptionStatus.hidden = true;
  updateComposer();
  createSession();
  showToast("已开启新对话；之前的内容已保留在历史中。");
});

function openHistory() {
  renderHistory();
  elements.historyDialog.showModal();
}
document.querySelector("#history-open").addEventListener("click", openHistory);
document.querySelector("#memory-history-open").addEventListener("click", openHistory);
document.querySelector("#history-close").addEventListener("click", () => elements.historyDialog.close());

elements.deleteAll.addEventListener("click", async () => {
  if (!window.confirm("确定清空此浏览器中的全部演示对话吗？此操作无法撤销。")) return;
  saveSessions([]);
  await clearAudio().catch(() => {});
  activeSessionId = null;
  localStorage.removeItem(ACTIVE_SESSION_KEY);
  renderActiveSession();
  renderHistory();
  showToast("本机演示历史已清空。");
});

function openPrivacyDialog() {
  elements.privacyDialog.showModal();
}
document.querySelector("#privacy-open").addEventListener("click", openPrivacyDialog);
document.querySelector("#footer-privacy").addEventListener("click", openPrivacyDialog);
document.querySelector("#privacy-close").addEventListener("click", () => elements.privacyDialog.close());

elements.supportAutoPopup.addEventListener("change", () => {
  localStorage.setItem(SUPPORT_POPUP_KEY, elements.supportAutoPopup.checked ? "on" : "off");
});

for (const dialog of [elements.consentDialog, elements.loginDialog, elements.historyDialog, elements.privacyDialog, elements.supportDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

document.querySelector("#new-conversation").addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mediaRecorder?.state === "recording") stopRecording();
});

updateUserState();
renderActiveSession();

// Sealing is a local interface lock, not encryption or deletion.
const sealDialog = document.querySelector("#seal-dialog");
const sealConfirm = document.querySelector("#seal-confirm");
const sealCancel = document.querySelector("#seal-cancel");
const sealDone = document.querySelector("#seal-done");
let sealTarget = null;
let sealing = false;
function sealBlocked() {
  return replyPending || mediaRecorder?.state === "recording" || pendingAudioBlob || elements.userMessage.value.trim();
}
document.querySelector("#seal-open").addEventListener("click", () => {
  const session = getActiveSession();
  if (!session?.messages.length) return showToast("先写下一段心事，再把它安放在这里。");
  if (sealBlocked()) return showToast("请等回复或录音结束，并先发送或清空输入框中的内容。");
  sealTarget = session.id;
  sealDialog.classList.remove("is-sealing");
  document.querySelector("#seal-title").textContent = "让这段心事，在这里休息。";
  document.querySelector("#seal-description").textContent = "封存当前整段对话后，历史中只留下封存日期，不再提供查看或继续入口。";
  sealConfirm.hidden = sealCancel.hidden = false;
  sealConfirm.disabled = false;
  sealDone.hidden = true;
  sealDialog.showModal();
  sealCancel.focus();
});
sealCancel.addEventListener("click", () => sealDialog.close());
sealDialog.addEventListener("cancel", (event) => { if (sealing) event.preventDefault(); });
sealDone.addEventListener("click", () => { sealDialog.close(); elements.userMessage.focus(); });
sealConfirm.addEventListener("click", () => {
  if (sealing) return;
  const session = getActiveSession();
  if (!session || session.id !== sealTarget || sealBlocked()) {
    sealDialog.close(); return showToast("对话状态已变化，请稍后重新封存。");
  }
  try {
    session.sealedAt = new Date().toISOString();
    saveSession(session, false);
  } catch {
    return showToast("本机保存失败，心事尚未封存，请重试。");
  }
  window.speechSynthesis?.cancel();
  activeSessionId = null;
  try { localStorage.removeItem(ACTIVE_SESSION_KEY); } catch {}
  renderActiveSession();
  sealing = true;
  sealConfirm.hidden = sealCancel.hidden = true;
  sealDialog.classList.add("is-sealing");
  document.querySelector("#seal-description").textContent = "轻轻收好，交给时间。";
  setTimeout(() => {
    sealing = false;
    document.querySelector("#seal-title").textContent = "心事已安放，你可以向前走了。";
    document.querySelector("#seal-description").textContent = "不必急着释怀。今天，就先到这里。";
    sealDone.hidden = false;
    sealDone.focus();
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 2800);
});
