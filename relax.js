"use strict";
const activity = new URLSearchParams(location.search).get("activity");
const selected = ["music", "breathing", "grounding", "sleep"].includes(activity) ? activity : "music";
document.getElementById(selected).hidden = false;
document.querySelector(`[data-activity="${selected}"]`).setAttribute("aria-current", "page");

let audioContext = null;
let musicTimer = null;
let musicInterval = null;
let musicGain = null;
const musicButton = document.getElementById("music-toggle");
const musicStatus = document.getElementById("music-status");
const volume = document.getElementById("volume");

function stopMusic(message = "已停止。准备好时，可以再听一会儿。") {
  clearTimeout(musicTimer);
  clearInterval(musicInterval);
  if (audioContext) void audioContext.close().catch(() => {});
  audioContext = null;
  musicGain = null;
  musicButton.textContent = "播放舒缓音";
  musicButton.setAttribute("aria-pressed", "false");
  musicStatus.textContent = message;
}

musicButton.addEventListener("click", async () => {
  if (audioContext) { stopMusic(); return; }
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) { musicStatus.textContent = "此浏览器暂不支持合成音，可尝试下方的音乐平台链接。"; return; }
  try {
    const context = new AudioEngine();
    audioContext = context;
    await context.resume();
    // Stop may be clicked while the browser is resuming its audio engine.
    if (audioContext !== context) return;
    musicGain = context.createGain();
    musicGain.gain.value = Number(volume.value);
    musicGain.connect(context.destination);
    // Slowly overlapping notes with gentle attack/release, capped at 3 minutes.
    const chords = [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
    let chord = 0;
    function playChord() {
      const start = context.currentTime;
      for (const frequency of chords[chord++ % chords.length]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(0.18, start + 2);
        envelope.gain.linearRampToValueAtTime(0, start + 10);
        oscillator.connect(envelope);
        envelope.connect(musicGain);
        oscillator.start(start);
        oscillator.stop(start + 10);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      }
    }
    playChord();
    musicInterval = setInterval(playChord, 8000);
    musicTimer = setTimeout(() => stopMusic("3 分钟结束了。谢谢你给自己留了一点时间。"), 180000);
    musicButton.textContent = "停止播放";
    musicButton.setAttribute("aria-pressed", "true");
    musicStatus.textContent = "正在播放轻柔和声，3 分钟后自动停止。";
  } catch {
    stopMusic("音频暂时无法播放，可以重新尝试或选择下方的音乐平台链接。");
  }
});
volume.addEventListener("input", () => {
  if (musicGain && audioContext) musicGain.gain.setTargetAtTime(Number(volume.value), audioContext.currentTime, 0.15);
});

let breathInterval = null;
let breathStarted = 0;
const breathButton = document.getElementById("breath-toggle");
const breathPhase = document.getElementById("breath-phase");
const breathOrbit = document.getElementById("breath-orbit");
const breathStatus = document.getElementById("breath-status");
function stopBreathing(finished = false) {
  clearInterval(breathInterval);
  breathInterval = null;
  breathOrbit.classList.remove("is-breathing");
  breathPhase.textContent = finished ? "谢谢你照顾自己" : "按自己的节奏就好";
  breathButton.textContent = "重新开始练习";
  breathButton.setAttribute("aria-pressed", "false");
  breathStatus.textContent = finished ? "1 分钟结束了。慢慢恢复自然呼吸。" : "练习已停止，可以自然呼吸。";
}
breathButton.addEventListener("click", () => {
  if (breathInterval) { stopBreathing(); return; }
  breathStarted = Date.now();
  breathButton.textContent = "停止练习";
  breathButton.setAttribute("aria-pressed", "true");
  breathOrbit.classList.add("is-breathing");
  breathStatus.textContent = "跟着提示轻轻呼吸，不必勉强；不舒服时随时停止。";
  function tick() {
    const elapsed = (Date.now() - breathStarted) / 1000;
    if (elapsed >= 60) { stopBreathing(true); return; }
    breathPhase.textContent = `${elapsed % 10 < 4 ? "轻轻吸气" : "缓缓呼气"} · ${Math.ceil(60 - elapsed)} 秒`;
  }
  tick();
  breathInterval = setInterval(tick, 200);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (audioContext) stopMusic("已暂停播放，回来后可重新开始。");
    if (breathInterval) stopBreathing();
  }
});
window.addEventListener("pagehide", () => { stopMusic(); if (breathInterval) stopBreathing(); });
