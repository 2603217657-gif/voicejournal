"""在转写之外看声音本身：哭腔、叹气这类不靠文字表达的信息。

为什么单独做一个模块：
SenseVoice 已经会输出 Cry / Laughter 这类音频事件标签，但"叹气"不在它的标签集里，
而叹气往往正是"话没说出口"的那部分。这里用纯 numpy 做几组可解释的声学特征，
再按规则判断，不引入 librosa / opensmile 这些额外依赖。

判断口径刻意保守：宁可漏，不可误。误标"检测到哭腔"对一个来倾诉的人伤害很大，
所以只有在规则和模型事件都指向同一结论时才置 true。

用法（人工排查用）：
    python paralinguistic.py <音频文件>     # 打印特征与判定
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
WIN = int(0.04 * SAMPLE_RATE)   # 40 ms 分析窗
HOP = int(0.02 * SAMPLE_RATE)   # 20 ms 步进
F0_MIN, F0_MAX = 60.0, 400.0    # 人声基频范围（Hz）
VOICING_MIN = 0.30              # 归一化自相关峰值下限，低于它不算浊音
MIN_VOICED_FRAMES = 3           # 短于 60 ms 的浊音段当作噪声峰值丢掉
REL_FLOOR_DB = 30.0             # 比最响帧低 30 dB 以下视为静默


def frames(samples: np.ndarray) -> np.ndarray:
    if samples.size < WIN:
        return np.zeros((0, WIN), dtype=np.float32)
    count = 1 + (samples.size - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(count)[:, None]
    return samples[idx]


def analyze(samples: np.ndarray) -> dict:
    block = frames(samples)
    if block.shape[0] == 0:
        return {
            "duration": round(float(samples.size) / SAMPLE_RATE, 2),
            "voicedFrames": 0,
            "reason": "音频太短，无法分析",
            "cry": {"detected": False, "score": 0.0},
            "sigh": {"detected": False, "score": 0.0},
        }

    window = np.hanning(WIN).astype(np.float32)
    shaped = block * window
    rms = np.sqrt(np.mean(shaped ** 2, axis=1) + 1e-12)
    energy_db = 20.0 * np.log10(rms + 1e-9)
    peak_db = float(np.percentile(energy_db, 95))
    floor_db = peak_db - REL_FLOOR_DB
    audible = energy_db > floor_db

    # F0：对每一帧做 FFT 自相关，在 60–400 Hz 的滞后区间里找峰值
    size = 1 << int(np.ceil(np.log2(2 * WIN)))
    spectrum = np.fft.rfft(shaped, n=size, axis=1)
    autocorr = np.fft.irfft(np.abs(spectrum) ** 2, n=size, axis=1)
    autocorr = autocorr / (autocorr[:, :1] + 1e-9)
    lag_min = int(SAMPLE_RATE / F0_MAX)
    lag_max = min(int(SAMPLE_RATE / F0_MIN), size // 2)
    band = autocorr[:, lag_min:lag_max]
    best_lag = np.argmax(band, axis=1) + lag_min
    voicing = band.max(axis=1)
    f0 = SAMPLE_RATE / best_lag

    voiced = audible & (voicing >= VOICING_MIN) & (voicing < 1.0)
    frame_rate = SAMPLE_RATE / HOP

    # 短于 3 帧（60 ms）的"浊音"只是噪声里的偶发峰值，会把它后面的长呼气切断，
    # 所以先按连续段过滤一遍，后面的统计都基于过滤后的掩码。
    cleaned = np.zeros_like(voiced)
    run_begin = None
    for i, flag in enumerate(voiced):
        if flag and run_begin is None:
            run_begin = i
        elif not flag and run_begin is not None:
            if i - run_begin >= MIN_VOICED_FRAMES:
                cleaned[run_begin:i] = True
            run_begin = None
    if run_begin is not None and voiced.size - run_begin >= MIN_VOICED_FRAMES:
        cleaned[run_begin:] = True
    voiced = cleaned

    # 先切出连续浊音段，再做统计：跨过静默的两帧不能算"基频变化"，
    # 否则句子之间的换气会被误当成抖动。
    runs = []
    start = None
    for i, flag in enumerate(voiced):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, voiced.size))

    # 基频抖动：只在同一段浊音内部比较相邻帧，最接近声学里的 jitter
    jitter_steps = []
    for run_start, run_end in runs:
        piece = f0[run_start:run_end]
        if piece.size >= 2:
            jitter_steps.extend((np.abs(np.diff(piece)) / (piece[:-1] + 1e-9)).tolist())
    jitter = float(np.median(jitter_steps)) if jitter_steps else 0.0

    voiced_f0 = f0[voiced]
    voiced_db = energy_db[voiced]
    f0_mean = float(np.mean(voiced_f0)) if voiced_f0.size else 0.0
    energy_swing = float(np.std(voiced_db)) if voiced_db.size else 0.0

    # 段间基频起伏：叹气式/抽泣式说话的语调跨度，只作为参考特征输出
    run_means = [float(np.mean(f0[a:b])) for a, b in runs if b - a >= 3]
    f0_run_variation = float(np.std(run_means) / (np.mean(run_means) + 1e-9)) if len(run_means) >= 2 else 0.0

    # 呼吸段：听得见但不构成浊音、持续够久的区间（叹气、深呼吸都落在这里）
    breath_runs = []
    run_start = None
    for i in range(voiced.size):
        breath_like = (not voiced[i]) and audible[i] and energy_db[i] < floor_db + 22.0
        if breath_like and run_start is None:
            run_start = i
        elif not breath_like and run_start is not None:
            if i - run_start >= int(0.4 * frame_rate):
                breath_runs.append((run_start, i))
            run_start = None
    if run_start is not None and voiced.size - run_start >= int(0.4 * frame_rate):
        breath_runs.append((run_start, voiced.size))

    longest_breath = max(((end - start) / frame_rate for start, end in breath_runs), default=0.0)
    if os.environ.get("PARA_DEBUG"):
        print(
            f"[para] frames={voiced.size} frameRate={frame_rate:.0f} floorDb={floor_db:.1f} "
            f"breathRuns={breath_runs} voicedRuns={runs}",
            file=sys.stderr,
        )
    # 呼气更可能是"说完之后"或"开口之前"发生的，句中被切碎的长段往往只是停顿
    edge_breath = 0.0
    for start, end in breath_runs:
        seconds = (end - start) / frame_rate
        touches_edge = start <= int(0.5 * frame_rate) or end >= voiced.size - int(0.5 * frame_rate)
        if touches_edge and seconds > edge_breath:
            edge_breath = seconds

    pause_ratio = float(1.0 - voiced.mean()) if voiced.size else 1.0

    features = {
        "duration": round(float(samples.size) / SAMPLE_RATE, 2),
        "voicedFrames": int(voiced.sum()),
        "voicedRatio": round(float(voiced.mean()), 3),
        "pauseRatio": round(pause_ratio, 3),
        "f0Mean": round(f0_mean, 1),
        "f0Jitter": round(jitter, 3),
        "f0RunVariation": round(f0_run_variation, 3),
        "energySwingDb": round(energy_swing, 1),
        "longestBreathSec": round(longest_breath, 2),
        "edgeBreathSec": round(edge_breath, 2),
        "speechSegments": len(runs),
    }

    # 叹气：句首或句尾有一段够长、听得见、但没有浊音的呼气
    sigh_score = 0.0
    if edge_breath >= 0.7:
        sigh_score += 0.6
    elif edge_breath >= 0.45:
        sigh_score += 0.3
    if voiced_f0.size and f0_mean < 210.0:
        sigh_score += 0.15   # 叹气多发生在低音区
    if not runs:
        sigh_score = 0.0     # 全程没人声，更像环境噪声，不判
    sigh = {
        "detected": sigh_score >= 0.6,
        "score": round(min(sigh_score, 1.0), 2),
        "reason": f"句尾/句首有一口气约 {edge_breath:.1f} 秒" if sigh_score >= 0.6 else "",
    }

    # 哭腔：真正的判别依据是"浊音段内部基频不稳"（jitter）。
    # 正常说话 jitter 在 0.03 上下，哭腔通常高于 0.10；能量起伏和停顿在正常
    # 言语里也很大，容易误判，所以只作为特征输出，不参与判定。
    cry_score = 0.0
    if jitter >= 0.10:
        cry_score += 0.5
    if jitter >= 0.16:
        cry_score += 0.2
    if f0_mean >= 220.0:
        cry_score += 0.1
    if voiced_f0.size < int(0.5 * frame_rate):
        cry_score = 0.0      # 声音太少，不足以判断
    cry = {
        "detected": cry_score >= 0.6,
        "score": round(min(cry_score, 1.0), 2),
        "reason": f"浊音段基频抖动 {jitter:.2f}（正常说话约 0.03）" if cry_score >= 0.6 else "",
    }

    return {**features, "cry": cry, "sigh": sigh}


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法：python paralinguistic.py <音频文件>")
    import soundfile as sf
    import soxr

    data, rate = sf.read(sys.argv[1], dtype="float32", always_2d=True)
    mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    if rate != SAMPLE_RATE:
        mono = soxr.resample(mono, rate, SAMPLE_RATE, quality="HQ").astype(np.float32)
    print(json.dumps(analyze(np.ascontiguousarray(mono, dtype=np.float32)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
