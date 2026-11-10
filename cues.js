// 浏览器端的副语言分析：哭腔、叹气。
// 和 paralinguistic.py 是同一套规则（40ms 窗 / 20ms 步进、自相关求基频、段内 jitter），
// 移植原因：手机走云端转写时，服务端拿不到音频，声音线索只能在浏览器里算。
// 规则口径保持一致：宁可漏，不可误。

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TreeholeCues = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SAMPLE_RATE = 16000;
  const WIN = Math.round(0.04 * SAMPLE_RATE); // 40 ms 分析窗
  const HOP = Math.round(0.02 * SAMPLE_RATE); // 20 ms 步进
  const F0_MIN = 60;
  const F0_MAX = 400;
  const VOICING_MIN = 0.3;
  const MIN_VOICED_FRAMES = 3;
  const REL_FLOOR_DB = 30;

  const WINDOW = (function () {
    const w = new Float32Array(WIN);
    for (let i = 0; i < WIN; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
    return w;
  })();

  function percentile95(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const position = 0.95 * (sorted.length - 1);
    const low = Math.floor(position);
    const high = Math.min(sorted.length - 1, Math.ceil(position));
    const weight = position - low;
    return sorted[low] * (1 - weight) + sorted[high] * weight;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function std(values) {
    if (!values.length) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  // 逐帧能量、基频、浊音判定。
  function frameFeatures(samples) {
    if (samples.length < WIN) return null;
    const count = 1 + Math.floor((samples.length - WIN) / HOP);
    const lagMin = Math.max(2, Math.round(SAMPLE_RATE / F0_MAX));
    const lagMax = Math.min(Math.round(SAMPLE_RATE / F0_MIN), WIN - 1);

    const energyDb = new Float32Array(count);
    const f0 = new Float32Array(count);
    const voicing = new Float32Array(count);

    for (let frame = 0; frame < count; frame += 1) {
      const offset = frame * HOP;
      let energy = 0;
      for (let i = 0; i < WIN; i += 1) {
        const value = samples[offset + i] * WINDOW[i];
        energy += value * value;
      }
      energyDb[frame] = 20 * Math.log10(Math.sqrt(energy / WIN + 1e-12) + 1e-9);

      // 线性自相关，只在 60–400 Hz 对应的滞后区间里找峰（等价于 Python 里的 FFT 版本）
      let bestLag = lagMin;
      let bestValue = -Infinity;
      for (let lag = lagMin; lag < lagMax; lag += 1) {
        let sum = 0;
        for (let i = 0; i + lag < WIN; i += 1) sum += samples[offset + i] * WINDOW[i] * samples[offset + i + lag] * WINDOW[i + lag];
        const normalized = sum / (energy + 1e-9);
        if (normalized > bestValue) {
          bestValue = normalized;
          bestLag = lag;
        }
      }
      voicing[frame] = bestValue;
      f0[frame] = SAMPLE_RATE / bestLag;
    }
    return { count, energyDb, f0, voicing };
  }

  function analyze(samples) {
    const duration = Math.round((samples.length / SAMPLE_RATE) * 100) / 100;
    const empty = {
      duration,
      voicedFrames: 0,
      voicedRatio: 0,
      pauseRatio: 1,
      f0Mean: 0,
      f0Jitter: 0,
      f0RunVariation: 0,
      energySwingDb: 0,
      longestBreathSec: 0,
      edgeBreathSec: 0,
      speechSegments: 0,
      cry: { detected: false, score: 0, reason: "音频太短，无法分析" },
      sigh: { detected: false, score: 0, reason: "" },
    };

    const features = frameFeatures(samples);
    if (!features) return empty;

    const { count, energyDb, f0, voicing } = features;
    const peakDb = percentile95(energyDb);
    const floorDb = peakDb - REL_FLOOR_DB;
    const frameRate = SAMPLE_RATE / HOP;

    let voiced = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      voiced[i] = energyDb[i] > floorDb && voicing[i] >= VOICING_MIN && voicing[i] < 1 ? 1 : 0;
    }

    // 短于 3 帧的"浊音"只是噪声里的偶发峰值，会切断它后面的长呼气，先清掉。
    let cleaned = new Uint8Array(count);
    let runBegin = -1;
    for (let i = 0; i < count; i += 1) {
      if (voiced[i] && runBegin < 0) runBegin = i;
      else if (!voiced[i] && runBegin >= 0) {
        if (i - runBegin >= MIN_VOICED_FRAMES) for (let k = runBegin; k < i; k += 1) cleaned[k] = 1;
        runBegin = -1;
      }
    }
    if (runBegin >= 0 && count - runBegin >= MIN_VOICED_FRAMES) {
      for (let k = runBegin; k < count; k += 1) cleaned[k] = 1;
    }
    voiced = cleaned;
    cleaned = null;

    const runs = [];
    let start = -1;
    for (let i = 0; i < count; i += 1) {
      if (voiced[i] && start < 0) start = i;
      else if (!voiced[i] && start >= 0) {
        runs.push([start, i]);
        start = -1;
      }
    }
    if (start >= 0) runs.push([start, count]);

    // 基频抖动只在同一段浊音内部比较相邻帧，跨过静默的两帧不能算抖动。
    const jitterSteps = [];
    for (const [runStart, runEnd] of runs) {
      for (let i = runStart + 1; i < runEnd; i += 1) {
        jitterSteps.push(Math.abs(f0[i] - f0[i - 1]) / (f0[i - 1] + 1e-9));
      }
    }
    const jitter = jitterSteps.length ? median(jitterSteps) : 0;

    const voicedF0 = [];
    const voicedDb = [];
    for (let i = 0; i < count; i += 1) {
      if (voiced[i]) {
        voicedF0.push(f0[i]);
        voicedDb.push(energyDb[i]);
      }
    }
    const f0Mean = mean(voicedF0);
    const energySwing = std(voicedDb);

    const runMeans = runs.filter(([a, b]) => b - a >= 3).map(([a, b]) => mean(Array.from(f0.slice(a, b))));
    const f0RunVariation = runMeans.length >= 2 ? std(runMeans) / (mean(runMeans) + 1e-9) : 0;

    // 呼吸段：听得见、但没有浊音周期，且持续够久（叹气、深呼吸都落在这里）。
    const breathRuns = [];
    const minBreathFrames = Math.round(0.4 * frameRate);
    start = -1;
    for (let i = 0; i < count; i += 1) {
      const breathLike = !voiced[i] && energyDb[i] > floorDb && energyDb[i] < floorDb + 22;
      if (breathLike && start < 0) start = i;
      else if (!breathLike && start >= 0) {
        if (i - start >= minBreathFrames) breathRuns.push([start, i]);
        start = -1;
      }
    }
    if (start >= 0 && count - start >= minBreathFrames) breathRuns.push([start, count]);

    const longestBreath = breathRuns.reduce((max, [a, b]) => Math.max(max, (b - a) / frameRate), 0);
    const edgeLimit = Math.round(0.5 * frameRate);
    let edgeBreath = 0;
    for (const [a, b] of breathRuns) {
      const seconds = (b - a) / frameRate;
      const touchesEdge = a <= edgeLimit || b >= count - edgeLimit;
      if (touchesEdge && seconds > edgeBreath) edgeBreath = seconds;
    }

    const voicedCount = voiced.reduce((sum, value) => sum + value, 0);
    const pauseRatio = count ? 1 - voicedCount / count : 1;

    // 叹气：句首或句尾有一段够长、听得见、但没有浊音的呼气。
    let sighScore = 0;
    if (edgeBreath >= 0.7) sighScore += 0.6;
    else if (edgeBreath >= 0.45) sighScore += 0.3;
    if (voicedF0.length && f0Mean < 210) sighScore += 0.15;
    if (!runs.length) sighScore = 0; // 全程没人声，更像环境噪声，不判
    const sigh = {
      detected: sighScore >= 0.6,
      score: Math.round(Math.min(sighScore, 1) * 100) / 100,
      reason: sighScore >= 0.6 ? `句尾/句首有一口气约 ${edgeBreath.toFixed(1)} 秒` : "",
    };

    // 哭腔：判别依据是浊音段内部基频不稳（jitter）。正常说话约 0.03，哭腔通常高于 0.10。
    let cryScore = 0;
    if (jitter >= 0.1) cryScore += 0.5;
    if (jitter >= 0.16) cryScore += 0.2;
    if (f0Mean >= 220) cryScore += 0.1;
    if (voicedF0.length < 0.5 * frameRate) cryScore = 0;
    const cry = {
      detected: cryScore >= 0.6,
      score: Math.round(Math.min(cryScore, 1) * 100) / 100,
      reason: cryScore >= 0.6 ? `浊音段基频抖动 ${jitter.toFixed(2)}（正常说话约 0.03）` : "",
    };

    return {
      duration,
      voicedFrames: voicedCount,
      voicedRatio: count ? Math.round((voicedCount / count) * 1000) / 1000 : 0,
      pauseRatio: Math.round(pauseRatio * 1000) / 1000,
      f0Mean: Math.round(f0Mean * 10) / 10,
      f0Jitter: Math.round(jitter * 1000) / 1000,
      f0RunVariation: Math.round(f0RunVariation * 1000) / 1000,
      energySwingDb: Math.round(energySwing * 10) / 10,
      longestBreathSec: Math.round(longestBreath * 100) / 100,
      edgeBreathSec: Math.round(edgeBreath * 100) / 100,
      speechSegments: runs.length,
      cry,
      sigh,
    };
  }

  return { analyze, SAMPLE_RATE };
});
