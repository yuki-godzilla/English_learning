"""Download only the public local secondary model; never reads recordings."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[3]
REVISION = "c69750f5043e5e1f8a71ab95dd3b98338c280c92"
FILES = {
    "config.json": "428b7781d080ad9463dca0e17e5066073cb691bfc14a178a85e76ac79c1f4a0f",
    "vocab.json": "d732ab2456c0c017930001dc9af0b41b3b93d25b2eb9740bf9d925508d7d87d0",
    "onnx/model_int8.onnx": "74174710e34035bbb7f611601d016c32fc575de7a6f53b1078107dc10a84e7ae",
}
target = ROOT / "tmp/pronunciation-models/wav2vec2-phoneme-int8"
for name, digest in FILES.items():
    path = target / name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        hf_hub_download(
            "onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX",
            name,
            revision=REVISION,
            local_dir=target,
            token=False,
        )
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError("Secondary model asset checksum mismatch: " + name)
packages = ROOT / "tmp/pronunciation-experiment-packages"
if not (packages / "espeakng_loader").is_dir():
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--no-deps",
            "--target",
            str(packages),
            "espeakng-loader==0.2.4",
        ],
        check=True,
    )
sys.path.insert(0, str(packages))
import espeakng_loader

if not Path(espeakng_loader.get_library_path()).is_file():
    raise ValueError("Local phonemizer library is missing")
print(
    json.dumps(
        {
            "status": "local_secondary_phoneme_model_ready",
            "revision": REVISION,
            "public_assets_download_only": True,
            "recording_read_or_transmitted": False,
        }
    )
)
