"""下载 SenseVoiceSmall（sherpa-onnx 版）到 models/sensevoice，供本地转写使用。

为什么不用原来的 ModelScope 版 faster-whisper：
Windows 上 ctranslate2 的原生依赖容易崩，换成纯 ONNX Runtime 的 sherpa-onnx 更稳。

默认从 HuggingFace 镜像下载（GitHub 直连在国内常被重置）；
需要换源时设置环境变量 HF_ENDPOINT。

模型有 228MB，网络不稳时容易中断，所以这里做了两件事：
1. 断点续传——已下载部分留在 .part 文件里，重跑会从断点继续；
2. 被限流（HTTP 429）或连接中断时自动退避重试，而不是直接抛异常退出。
"""

from __future__ import annotations

import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

MIRROR = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com").rstrip("/")
REPO = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
FILES = ("model.int8.onnx", "tokens.txt")
ATTEMPTS = 4
USER_AGENT = "treehole-model-setup/1.0 (urllib)"

TARGET = Path(__file__).parent / "models" / "sensevoice"


def parse_total(content_range: str) -> int:
    """从 Content-Range（bytes 123-456/789）里取出文件总大小。"""
    if not content_range or "/" not in content_range:
        return 0
    tail = content_range.rsplit("/", 1)[-1].strip()
    return int(tail) if tail.isdigit() else 0


def download(name: str) -> None:
    destination = TARGET / name
    if destination.is_file() and destination.stat().st_size > 0:
        print(f"已存在，跳过：{name}")
        return

    part = destination.with_name(destination.name + ".part")
    url = f"{MIRROR}/{REPO}/resolve/main/{name}"

    for attempt in range(1, ATTEMPTS + 1):
        try:
            resume_from = part.stat().st_size if part.is_file() else 0
            headers = {"User-Agent": USER_AGENT}
            if resume_from:
                headers["Range"] = f"bytes={resume_from}-"
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=120) as response:
                # 服务器不认断点时会直接返回 200 全量，这时必须丢弃旧的部分重新写
                if resume_from and response.status != 206:
                    print(f"镜像不支持断点续传，{name} 将从零开始")
                    resume_from = 0
                    part.unlink(missing_ok=True)

                total = parse_total(response.headers.get("Content-Range", "")) or (
                    resume_from + int(response.headers.get("Content-Length") or 0)
                )
                label = f"（从 {resume_from // 1048576} MB 处续传）" if resume_from else ""
                print(f"下载 {name} ← {url}{label}")

                written = resume_from
                with part.open("ab" if resume_from else "wb") as handle:
                    while True:
                        chunk = response.read(1024 * 256)
                        if not chunk:
                            break
                        handle.write(chunk)
                        written += len(chunk)
                        if total:
                            print(f"\r  {written * 100 // total:3d}%  {written // 1048576} / {total // 1048576} MB", end="")
                print()

            part.replace(destination)
            return

        except urllib.error.HTTPError as error:
            if error.code in (403, 416) and (part.is_file() and part.stat().st_size > 0):
                # hf-mirror 的下载 CDN 有时直接拒掉带 Range 的请求，
                # 这时要丢掉半截文件重下，而不是把 403 抛给用户。
                print(f"\n镜像不接受断点续传（HTTP {error.code}），改为完整重新下载……")
                part.unlink(missing_ok=True)
                continue
            if error.code == 429:
                wait = 10 * attempt
                print(f"\n被镜像限流（HTTP 429），{wait} 秒后重试（第 {attempt}/{ATTEMPTS} 次）……")
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            wait = 5 * attempt
            print(f"\n网络中断（{error}），{wait} 秒后重试（第 {attempt}/{ATTEMPTS} 次）……")
            time.sleep(wait)

    raise RuntimeError(f"{name} 多次重试仍失败；已下载部分保留在 {part}，再次运行会从断点续传。")


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        download(name)
    for name in FILES:
        if not (TARGET / name).is_file():
            raise RuntimeError(f"下载后仍缺少 {name}")
    print(f"模型就绪：{TARGET.resolve()}")
    sys.exit(0)


if __name__ == "__main__":
    main()
