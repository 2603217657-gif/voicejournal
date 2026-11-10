"""本地中文语音转写 worker（sherpa-onnx + SenseVoiceSmall）。

用法：python transcribe.py <音频文件路径>
输出：一行 JSON，含 text（转写文本）、emotion（情绪标签）、event（音频事件标签）。

设计说明：
- 只依赖 sherpa-onnx（ONNX Runtime），不依赖 ctranslate2/PyTorch，
  避开 Windows 上 faster-whisper 的原生崩溃问题。
- 输入统一处理成 16 kHz 单声道再送入模型；WebM/M4A 由前端先用
  AudioContext 解码成 16 kHz WAV 再上传，服务端只接 WAV。
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import sherpa_onnx
import soxr

import paralinguistic

SAMPLE_RATE = 16000


def resolve_model_dir() -> Path:
    """模型目录优先级：环境变量 > 项目内 models/sensevoice > models 下的唯一子目录。"""
    env_dir = os.environ.get("SHERPA_MODEL_DIR")
    if env_dir:
        return Path(env_dir)
    root = Path(__file__).parent / "models"
    preferred = root / "sensevoice"
    if (preferred / "model.int8.onnx").is_file() or (preferred / "model.onnx").is_file():
        return preferred
    for candidate in root.glob("*"):
        if candidate.is_dir() and (
            (candidate / "model.int8.onnx").is_file() or (candidate / "model.onnx").is_file()
        ):
            return candidate
    raise FileNotFoundError(f"未找到 SenseVoice 模型，请先运行 prepare_model.py（查找目录：{root}）")


def pick_weights(model_dir: Path) -> Path:
    int8 = model_dir / "model.int8.onnx"
    return int8 if int8.is_file() else model_dir / "model.onnx"


def load_audio(path: Path) -> np.ndarray:
    """读出音频并重采样为 16 kHz 单声道 float32。"""
    data, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    if sample_rate != SAMPLE_RATE:
        mono = soxr.resample(mono, sample_rate, SAMPLE_RATE, quality="HQ").astype(np.float32)
    return np.ascontiguousarray(mono, dtype=np.float32)


def build_recognizer(model_dir: Path) -> sherpa_onnx.OfflineRecognizer:
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(pick_weights(model_dir)),
        tokens=str(model_dir / "tokens.txt"),
        num_threads=max(1, min(4, os.cpu_count() or 1)),
        use_itn=True,  # 逆文本正则化，让数字/日期更像书面表达
        debug=False,
    )


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法：python transcribe.py <音频文件路径>")
    audio_path = Path(sys.argv[1])
    if not audio_path.is_file():
        raise FileNotFoundError("找不到音频文件")

    started = time.perf_counter()
    model_dir = resolve_model_dir()
    samples = load_audio(audio_path)
    if samples.size == 0:
        raise ValueError("音频内容为空")

    recognizer = build_recognizer(model_dir)
    stream = recognizer.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    recognizer.decode_stream(stream)
    result = stream.result

    # SenseVoice 会在文本里附带 <|zh|><|NEUTRAL|><|Speech|> 之类标签，
    # 这里取出结构化字段，文本只保留纯净的转写内容。
    def clean(value: str) -> str:
        return str(value or "").replace("<|", "").replace("|>", "").replace("|", "").strip()

    payload = {
        "text": (result.text or "").strip(),
        "emotion": clean(getattr(result, "emotion", "")),
        "event": clean(getattr(result, "event", "")),
        "lang": clean(getattr(result, "lang", "")),
        "duration": round(samples.size / SAMPLE_RATE, 2),
        "elapsed": round(time.perf_counter() - started, 2),
    }

    # 副语言：文字之外，声音本身还带着信息。叹气不在 SenseVoice 的事件标签里，
    # 所以这里补一组声学规则；哭腔则同时参考模型自带的 Cry 事件标签。
    cues = paralinguistic.analyze(samples)
    if payload["event"] == "Cry" and not cues["cry"]["detected"]:
        cues["cry"] = {
            "detected": True,
            "score": max(cues["cry"]["score"], 0.9),
            "reason": "模型事件标签为 Cry",
        }
    payload["voiceCues"] = {
        "cry": cues["cry"]["detected"],
        "sigh": cues["sigh"]["detected"],
        "cryScore": cues["cry"]["score"],
        "sighScore": cues["sigh"]["score"],
        "reasons": [reason for reason in (cues["cry"]["reason"], cues["sigh"]["reason"]) if reason],
        "f0Jitter": cues["f0Jitter"],
        "edgeBreathSec": cues["edgeBreathSec"],
    }
    payload["elapsed"] = round(time.perf_counter() - started, 2)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
