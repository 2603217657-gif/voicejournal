"""生成两段用于副语言判定的合成样本（一次性生成，产物随包分发）。

为什么不用真人录音当测试素材：
1. 手上没有可以公开分发的真人叹气/哭声录音；
2. 测试需要确定性——同一个文件每次必须给出一致的结论。

注意：合成信号的目的是验证"规则能不能被这种声学模式触发"，
它不代表判别在真人录音上的准确率。README 里如实标注了这一点。
"""

from __future__ import annotations

import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000
FRAME = int(0.02 * SAMPLE_RATE)


def voiced(
    duration: float,
    f0: float,
    amplitude: float,
    rng: np.random.Generator,
    wobble: float = 0.0,
    tremolo: float = 0.0,
) -> np.ndarray:
    """带谐波的浊音段。

    wobble 让基频逐帧抖动（近似哭腔里的发声不稳），
    tremolo 让音量周期性起伏（近似抽泣时的气息断续）。
    """
    count = int(duration * SAMPLE_RATE)
    frames = max(1, int(np.ceil(count / FRAME)))

    relative = 1.0 + (rng.normal(0, wobble, frames) if wobble else np.zeros(frames))
    relative = np.clip(relative, 0.6, 1.6)
    f0_track = np.repeat(f0 * relative, FRAME)[:count]
    if f0_track.size < count:
        f0_track = np.pad(f0_track, (0, count - f0_track.size), mode="edge")

    phase = 2 * np.pi * np.cumsum(f0_track) / SAMPLE_RATE
    harmonics = sum(np.sin(k * phase) / k for k in range(1, 4))
    envelope = np.hanning(count) ** 0.3
    if tremolo:
        envelope = envelope * (1.0 + tremolo * np.sin(2 * np.pi * 3.0 * np.arange(count) / SAMPLE_RATE))
    return (amplitude * harmonics * envelope).astype(np.float32)


def breath(duration: float, amplitude: float, rng: np.random.Generator) -> np.ndarray:
    """呼气：低通滤波的白噪声，听得见但没有浊音周期。"""
    raw = rng.normal(0, 1, int(duration * SAMPLE_RATE))
    smoothed = np.convolve(raw, np.ones(9) / 9.0, mode="same")
    envelope = np.hanning(smoothed.size) ** 0.5
    return (amplitude * smoothed * envelope).astype(np.float32)


def silence(duration: float) -> np.ndarray:
    return np.zeros(int(duration * SAMPLE_RATE), dtype=np.float32)


def sigh_fixture() -> np.ndarray:
    """说完一句话，然后长长呼出一口气。"""
    rng = np.random.default_rng(20261109)
    return np.concatenate([
        voiced(1.4, 165.0, 0.55, rng),
        silence(0.35),
        breath(1.4, 0.35, rng),
    ])


def cry_fixture() -> np.ndarray:
    """断续的哭腔：基频逐帧抖、音量忽高忽低、中间夹停顿。"""
    rng = np.random.default_rng(20261109)
    pitches = [250.0, 300.0, 265.0, 320.0, 240.0, 295.0]
    levels = [0.62, 0.2, 0.58, 0.18, 0.5, 0.24]
    parts = []
    for pitch, level in zip(pitches, levels):
        parts.append(voiced(0.45, pitch, level, rng, wobble=0.16, tremolo=0.35))
        parts.append(silence(0.3))
    return np.concatenate(parts)


def main() -> None:
    from pathlib import Path

    target = Path(__file__).resolve().parent.parent / "samples"
    target.mkdir(parents=True, exist_ok=True)
    for name, signal in (("sample_sigh_cued.wav", sigh_fixture()), ("sample_cry_cued.wav", cry_fixture())):
        path = target / name
        sf.write(str(path), signal, SAMPLE_RATE, subtype="PCM_16")
        print(f"{path}  {signal.size / SAMPLE_RATE:.2f}s")


if __name__ == "__main__":
    main()
