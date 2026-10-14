"""Install native CPU Kaldi and public GOPT assets. No recordings are read."""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[3]
BASE = WORKSPACE / "tmp/pronunciation-comparison"
ASSETS = BASE / "gopt-assets"
RUNTIME = BASE / "gopt-runtime"
MAMBA_SHA256 = "a6d804394b2418991c4e29562853eaace2f2ce9d9da661a98e74e02e8dbb44b0"


def download(url, path, digest):
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == digest:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    with (
        urllib.request.urlopen(url, timeout=60) as response,
        partial.open("wb") as target,
    ):
        shutil.copyfileobj(response, target)
    if hashlib.sha256(partial.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Public asset digest mismatch: {path.name}")
    partial.replace(path)


def extract(path, directory):
    directory.mkdir(parents=True, exist_ok=True)
    root = directory.resolve()
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        links = []
        for member in members:
            target = (root / member.name).resolve()
            if not target.is_relative_to(root):
                raise ValueError("Archive path leaves its destination")
            if member.issym() or member.islnk():
                linked = (
                    (target.parent / member.linkname)
                    if member.issym()
                    else root / member.linkname
                ).resolve()
                if not linked.is_relative_to(root):
                    raise ValueError("Archive link leaves its destination")
                links.append((target, linked))
        archive.extractall(
            root,
            members=[m for m in members if not m.issym() and not m.islnk()],
            filter="data",
        )
        for target, linked in links:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(linked, target)


def checked(*command, env=None):
    result = subprocess.run(
        list(map(str, command)),
        cwd=WORKSPACE,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    with (BASE / "gopt-setup.log").open("a", encoding="utf-8") as log:
        log.write(result.stdout)
    if result.returncode:
        raise RuntimeError(result.stdout[-5000:])


def main():
    if os.name != "nt" or sys.version_info[:2] != (3, 12):
        raise RuntimeError(
            "This reproducible setup targets Windows x64 and Python 3.12"
        )
    RUNTIME.mkdir(parents=True, exist_ok=True)
    mamba = RUNTIME / "micromamba.exe"
    if (
        not mamba.exists()
        or hashlib.sha256(mamba.read_bytes()).hexdigest() != MAMBA_SHA256
    ):
        archive = RUNTIME / "micromamba-2.9.0-win64.tar.bz2"
        download(
            "https://micro.mamba.pm/api/micromamba/win-64/2.9.0",
            archive,
            "97a336f4ab794bd96a6a4da5e6ed63e75a1d31830414a182419b23d3b36f3fe0",
        )
        with tarfile.open(archive, "r:bz2") as handle:
            mamba.write_bytes(handle.extractfile("Library/bin/micromamba.exe").read())
    if hashlib.sha256(mamba.read_bytes()).hexdigest() != MAMBA_SHA256:
        raise ValueError("Micromamba executable digest mismatch")
    lockfile = WORKSPACE / "requirements/gopt-kaldi-win64.explicit.txt"
    pinned = {
        line.strip()
        for line in lockfile.read_text().splitlines()
        if line.startswith("https://")
    }
    installed = set()
    metadata = WORKSPACE / "tmp/gopt-kaldi/conda-meta"
    for record in metadata.glob("*.json"):
        info = json.loads(record.read_text())
        installed.add(info["url"] + "#" + info["sha256"])
    if not pinned.issubset(installed):
        verb = "install" if metadata.is_dir() else "create"
        checked(
            mamba,
            "--no-rc",
            "-r",
            WORKSPACE / "tmp/gopt-mamba",
            verb,
            "-p",
            WORKSPACE / "tmp/gopt-kaldi",
            "-y",
            "--file",
            lockfile,
        )
    kaldi_bin = WORKSPACE / "tmp/gopt-kaldi/Library/bin"
    kaldi_env = os.environ.copy()
    kaldi_env["PATH"] = str(kaldi_bin) + os.pathsep + kaldi_env["PATH"]
    checked(kaldi_bin / "compute-gop.exe", "--help", env=kaldi_env)
    checked(kaldi_bin / "nnet3-compute.exe", "--help", env=kaldi_env)
    checked(
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--index-url",
        "https://download.pytorch.org/whl/cpu",
        "--requirement",
        WORKSPACE / "requirements/gopt-cpu.lock.txt",
    )
    manifest = json.loads((Path(__file__).parent / "assets.json").read_text())
    for entry in manifest:
        path = ASSETS / entry["filename"]
        download(entry["url"], path, entry["sha256"])
        if entry.get("extract_to"):
            extract(path, ASSETS / entry["extract_to"])
        print("Verified", entry["filename"], flush=True)
    train_ids = [
        line.split()[0] for line in (ASSETS / "so-train-text").read_text().splitlines()
    ]
    phone_words = {
        row[0]: row[1:]
        for row in (
            line.split() for line in (ASSETS / "so-text-phone").read_text().splitlines()
        )
    }
    mapping = {}
    for utterance in train_ids:
        i = 0
        while f"{utterance}.{i}" in phone_words:
            for phone in phone_words[f"{utterance}.{i}"]:
                phone = re.sub(r"\d", "", re.sub(r"_[BIES]$", "", phone))
                mapping.setdefault(phone, len(mapping))
            i += 1
    expected = [
        "W",
        "IY",
        "K",
        "AO",
        "L",
        "IH",
        "T",
        "B",
        "EH",
        "R",
        "Z",
        "OW",
        "TH",
        "F",
        "AY",
        "V",
        "AH",
        "N",
        "UW",
        "S",
        "G",
        "AA",
        "M",
        "P",
        "NG",
        "HH",
        "EY",
        "SH",
        "AE",
        "D",
        "UH",
        "AW",
        "DH",
        "ER",
        "Y",
        "JH",
        "CH",
        "OY",
        "ZH",
    ]
    if list(mapping) != expected:
        raise ValueError("Recovered training vocabulary changed")
    (ASSETS / "phoneme-map.json").write_text(
        json.dumps(
            {
                "mapping": mapping,
                "method": "First occurrence in pinned official training utterance/word/phone order; original GOPT gen_phn_dict; original silence exclusion.",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    import torch
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "original_gopt", ASSETS / "gopt-model.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    model = module.GOPT(embed_dim=24, num_heads=1, depth=3, input_dim=84)
    state = torch.load(
        ASSETS / "gopt-librispeech.pth", map_location="cpu", weights_only=True
    )
    model.load_state_dict(
        {k.removeprefix("module."): v for k, v in state.items()}, strict=True
    )
    result = {
        "status": "native_kaldi_and_original_gopt_ready",
        "torch": torch.__version__,
        "kaldi": "5.5.1172 cpu_hf03c2bf_5",
        "model_state_keys": len(state),
        "phone_vocabulary_size": len(mapping),
        "external_inference": False,
        "audio_read_or_transmitted_during_setup": False,
        "assets": manifest,
        "model_loading": "strict, CPU, weights_only=True",
        "shell_initialization_modified": False,
    }
    (BASE / "gopt-environment.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: v for k, v in result.items() if k != "assets"}, indent=2))


if __name__ == "__main__":
    main()
