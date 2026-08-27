from __future__ import annotations

import argparse
import json
from pathlib import Path

from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download


MODEL_SOURCES = {
    "tiny.en": {
        "repository": "Systran/faster-whisper-tiny.en",
        "revision": "0d3d19a32d3338f10357c0889762bd8d64bbdeba",
    },
    "base.en": {
        "repository": "Systran/faster-whisper-base.en",
        "revision": "3d3d5dee26484f91867d81cb899cfcf72b96be6c",
    },
    "small.en": {
        "repository": "Systran/faster-whisper-small.en",
        "revision": "d1d751a5f8271d482d14ca55d9e2deeebbae577f",
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download a pinned local faster-whisper model into the ignored project cache."
    )
    parser.add_argument("--model", choices=MODEL_SOURCES, default="small.en")
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()

    target = args.output_root.resolve() / f"faster-whisper-{args.model}"
    target.mkdir(parents=True, exist_ok=True)
    source = MODEL_SOURCES[args.model]
    snapshot_download(
        repo_id=source["repository"],
        revision=source["revision"],
        local_dir=target,
    )

    required = [target / "config.json", target / "model.bin", target / "tokenizer.json"]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"The model download is incomplete: {missing}")

    WhisperModel(str(target), device="cpu", compute_type="int8")

    result = {
        "status": "model_ready",
        "model": args.model,
        "repository": source["repository"],
        "revision": source["revision"],
        "path": str(target),
        "modelBytes": (target / "model.bin").stat().st_size,
        "runtimeLoadVerified": True,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
