"""Run original GOPT with strict weights and original feature normalization."""

import hashlib, importlib.util, json, re, socket, time
from pathlib import Path
import numpy as np
import torch

BASE = Path(__file__).resolve().parents[3] / "tmp/pronunciation-comparison"
ASSETS = BASE / "gopt-assets"


def no_network(*a, **k):
    raise RuntimeError("Network is disabled for inference")


socket.create_connection = no_network
socket.socket.connect = no_network


def load_vectors(path):
    rows = {}
    for key, vals in re.findall(
        r"(\S+)\s+\[([^\]]*)\]", path.read_text(encoding="utf-8")
    ):
        rows[key] = np.fromstring(vals, sep=" ", dtype=np.float32)
    return rows


def predict(run_dir, limit=50):
    if not 1 <= limit <= 50:
        raise ValueError("Phone limit must be between 1 and 50")
    torch.set_num_threads(8)
    start = time.perf_counter()
    spec = importlib.util.spec_from_file_location(
        "original_gopt", ASSETS / "gopt-model.py"
    )
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    model = m.GOPT(embed_dim=24, num_heads=1, depth=3, input_dim=84).float().eval()
    state = torch.load(
        ASSETS / "gopt-librispeech.pth", map_location="cpu", weights_only=True
    )
    model.load_state_dict(
        {k.removeprefix("module."): v for k, v in state.items()}, strict=True
    )
    mapping = json.loads((ASSETS / "phoneme-map.json").read_text())["mapping"]
    pure = json.loads((run_dir / "phones-pure.json").read_text())
    reverse = {v: k for k, v in pure.items()}
    expected = json.loads((run_dir / "expected-phones.json").read_text())
    vectors = load_vectors(run_dir / "features.txt")
    chunks = []
    case_meta = {}
    for utt, phones in expected.items():
        vs = [
            v
            for k, v in sorted(
                vectors.items(), key=lambda kv: int(kv[0].rsplit(".", 1)[1])
            )
            if k.rsplit(".", 1)[0] == utt
        ]
        if len(vs) != len(phones):
            raise ValueError(
                f"{utt}: {len(vs)} aligned phones != {len(phones)} expected; no truncation allowed"
            )
        assert all(v.shape == (85,) for v in vs)
        assert all(reverse[int(v[0])] == p["phone"] for v, p in zip(vs, phones)), utt
        assert np.isfinite(vs).all(), utt
        case_meta[utt] = {
            "phone_count": len(phones),
            "all_phones_accounted_for": True,
            "feature_mean": float(np.mean(np.array(vs)[:, 1:])),
            "feature_std": float(np.std(np.array(vs)[:, 1:])),
            "chunks": [],
        }
        # Preserve word boundaries and cover every phone; always pad to the trained size 50.
        first = 0
        while first < len(phones):
            last = min(first + limit, len(phones))
            while (
                last < len(phones)
                and phones[last - 1]["word_index"] == phones[last]["word_index"]
            ):
                last -= 1
            if last == first:
                raise ValueError("Single word exceeds requested phone limit")
            feat = np.zeros((50, 84), dtype=np.float32)
            phn = np.full(50, -1, dtype=np.int64)
            raw = np.array(vs[first:last])[:, 1:]
            # Replicate upstream norm_valid including the first-feature sentinel.
            valid = next((i for i, v in enumerate(raw) if v[0] == 0), len(raw))
            if valid != len(raw):
                raise ValueError(
                    "Upstream zero sentinel encountered inside a valid sequence"
                )
            feat[: last - first] = (raw - 3.203) / 4.045
            phn[: last - first] = [mapping[p["phone"]] for p in phones[first:last]]
            chunks.append(
                {
                    "utt": utt,
                    "start": first,
                    "end": last,
                    "features": feat,
                    "phones": phn,
                }
            )
            first = last
    infer_start = time.perf_counter()
    with torch.inference_mode():
        outputs = model(
            torch.from_numpy(np.stack([c["features"] for c in chunks])),
            torch.from_numpy(np.stack([c["phones"] for c in chunks])),
        )
    infer_seconds = time.perf_counter() - infer_start
    ut = np.stack([x.numpy().reshape(-1) for x in outputs[:5]], axis=1)
    phone_scores = outputs[5].numpy()[:, :, 0]
    word_scores = [x.numpy()[:, :, 0] for x in outputs[6:]]
    for n, c in enumerate(chunks):
        count = c["end"] - c["start"]
        utt = c["utt"]
        case_meta[utt]["chunks"].append(
            {
                "phone_start": c["start"],
                "phone_end": c["end"],
                "phone_count": count,
                "utterance_predictions_raw_0_to_2_training_scale": dict(
                    zip(
                        ["accuracy", "completeness", "fluency", "prosody", "total"],
                        map(float, ut[n]),
                    )
                ),
                "phone_accuracy": phone_scores[n, :count].astype(float).tolist(),
                "word_predictions_per_phone": {
                    name: arr[n, :count].astype(float).tolist()
                    for name, arr in zip(["accuracy", "stress", "total"], word_scores)
                },
            }
        )
    for utt, d in case_meta.items():
        ps = [p for c in d["chunks"] for p in c["phone_accuracy"]]
        d["mean_phone_prediction_raw"] = float(np.mean(ps))
        d["phone_prediction_min"] = float(min(ps))
        d["phone_prediction_max"] = float(max(ps))
        weights = np.array([c["phone_count"] for c in d["chunks"]])
        d["phone_weighted_chunk_predictions_0_to_10"] = {
            name: float(
                np.average(
                    [
                        c["utterance_predictions_raw_0_to_2_training_scale"][name] * 5
                        for c in d["chunks"]
                    ],
                    weights=weights,
                )
            )
            for name in ["accuracy", "completeness", "fluency", "prosody", "total"]
        }
        d["chunk_count"] = len(d["chunks"])
        d["outside_phone_training_range_count"] = sum(p < 0 or p > 2 for p in ps)
    return {
        "status": "actual_original_gopt_inference_completed_experimental_not_a_learning_grade",
        "external_audio_transfer": False,
        "network_disabled_in_python": True,
        "model": "original GOPT Librispeech embed24 heads1 depth3 input84",
        "weights_sha256": hashlib.sha256(
            (ASSETS / "gopt-librispeech.pth").read_bytes()
        ).hexdigest(),
        "torch_version": torch.__version__,
        "chunk_phone_limit": limit,
        "fixed_padded_length": 50,
        "normalization_mean": 3.203,
        "normalization_std": 4.045,
        "model_forward_seconds": infer_seconds,
        "load_preparation_and_forward_seconds": time.perf_counter() - start,
        "cases": case_meta,
        "frontend_deviations": [
            "MFCC dither=0 for repeatable same-audio reference contrasts; upstream default is 1.",
            "Current Kaldi preserves adjacent identical phone boundaries; original 2021 compute-gop could merge these.",
        ],
        "interpretation": [
            "Raw model predictions are not calibrated Yuki pronunciation grades or L1-L5.",
            "Long audio uses word-boundary chunks; weighted chunk means are descriptive, not a validated full-recording utterance score.",
            "Official recommended M13 TDNN-F frontend is used; a complete reproduction of the original published benchmark has not been established.",
            "Unbounded regressions are retained without silent clipping.",
        ],
    }
