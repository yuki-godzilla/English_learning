"""Offline acoustic tools and exploratory GOP-SA; no human-grade calibration."""

import ctypes
import itertools
import json
import math
import socket
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from faster_whisper.audio import decode_audio

PROJECT = Path(__file__).resolve().parents[3]
BASE = PROJECT / "tmp/pronunciation-comparison"
sys.path.insert(0, str(PROJECT / "tmp/pronunciation-experiment-packages"))
import espeakng_loader


def disable_network():
    def blocked(*args, **kwargs):
        raise RuntimeError("Network disabled while processing audio.")

    socket.create_connection = blocked
    socket.socket.connect = blocked


class PhoneBackend:
    def __init__(self):
        assets = PROJECT / "tmp/pronunciation-models/wav2vec2-phoneme-int8"
        self.config = json.loads((assets / "config.json").read_text(encoding="utf-8"))
        self.vocab = json.loads((assets / "vocab.json").read_text(encoding="utf-8"))
        self.inverse = {v: k for k, v in self.vocab.items()}
        self.blank = self.config["pad_token_id"]
        self.special = {self.vocab.get(x) for x in ("<s>", "</s>", "<unk>", "<pad>")}
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 8
        opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(assets / "onnx/model_int8.onnx"),
            sess_options=opts,
            providers=["CPUExecutionProvider"],
        )
        self.stride, self.receptive = 1, 1
        for kernel, stride in zip(
            self.config["conv_kernel"], self.config["conv_stride"]
        ):
            self.receptive += (kernel - 1) * self.stride
            self.stride *= stride
        self.library = ctypes.CDLL(espeakng_loader.get_library_path())
        self.library.espeak_Initialize.argtypes = [
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
        ]
        self.library.espeak_SetVoiceByName.argtypes = [ctypes.c_char_p]
        self.library.espeak_TextToPhonemes.argtypes = [
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.c_int,
            ctypes.c_int,
        ]
        self.library.espeak_TextToPhonemes.restype = ctypes.c_char_p
        data_parent = str(Path(espeakng_loader.get_data_path()).parent).encode("utf-8")
        assert self.library.espeak_Initialize(2, 0, data_parent, 0x8000) > 0
        assert self.library.espeak_SetVoiceByName(b"en-us") == 0

    def phonemize(self, text):
        buffer = ctypes.create_string_buffer(text.encode("utf-8"))
        pointer = ctypes.c_void_p(ctypes.addressof(buffer))
        output = []
        while pointer.value:
            before = pointer.value
            result = self.library.espeak_TextToPhonemes(
                ctypes.byref(pointer), 1, 2 | (ord("|") << 8)
            )
            if result:
                output.append(result.decode("utf-8"))
            if pointer.value == before:
                raise RuntimeError("Phonemizer did not advance.")
        raw = "|".join(output)
        phones = []
        for token in (
            raw.replace("ˈ", "").replace("ˌ", "").replace("\u200d", "").split("|")
        ):
            phones.extend(x for x in token.split() if x)
        unknown = [x for x in phones if x not in self.vocab]
        if unknown:
            raise ValueError(
                "Reference has unsupported phones: " + repr(sorted(set(unknown)))
            )
        return phones, np.array([self.vocab[x] for x in phones], dtype=np.int64)

    def logits(self, audio):
        values = np.asarray(audio, dtype=np.float32)
        normalized = (values - values.mean()) / math.sqrt(float(values.var()) + 1e-7)
        feed = {"input_values": normalized[None, :]}
        logits = self.session.run(None, feed)[0][0]
        assert (
            logits.ndim == 2
            and logits.shape[1] == len(self.vocab)
            and np.isfinite(logits).all()
        )
        logits = logits.astype(np.float64)
        largest = logits.max(axis=-1, keepdims=True)
        return (
            logits
            - largest
            - np.log(np.exp(logits - largest).sum(axis=-1, keepdims=True))
        )

    def greedy(self, logp):
        result, previous = [], None
        for token in logp.argmax(axis=-1).tolist():
            if token != previous and token not in self.special:
                result.append(self.inverse[token])
            previous = token
        return result


def ctc_forward(logp, labels, blank=0):
    extended = np.full(len(labels) * 2 + 1, blank, dtype=np.int64)
    extended[1::2] = labels
    alpha = np.full(len(extended), -np.inf)
    alpha[0] = logp[0, blank]
    if len(labels):
        alpha[1] = logp[0, labels[0]]
    skip = extended != blank
    skip[:2] = False
    skip[2:] &= extended[2:] != extended[:-2]
    for frame in logp[1:]:
        one = np.r_[-np.inf, alpha[:-1]]
        two = (
            np.r_[-np.inf, -np.inf, alpha[:-2]]
            if len(alpha) > 1
            else np.array([-np.inf])
        )
        alpha = (
            np.logaddexp(np.logaddexp(alpha, one), np.where(skip, two, -np.inf))
            + frame[extended]
        )
    return float(np.logaddexp(alpha[-1], alpha[-2])) if len(labels) else float(alpha[0])


def gop_sa(logp, labels, blank=0):
    """CTC Viterbi self alignment then Eq. 3 mean log posterior.

    Adaptation of GOP-SA, not GOPT or the published benchmark model.
    These activation spans are not actual phoneme boundaries.
    """
    if len(labels) == 0:
        return {"status": "no_reference_phones"}
    extended = np.full(len(labels) * 2 + 1, blank, dtype=np.int64)
    extended[1::2] = labels
    count, frames = len(extended), len(logp)
    score = np.full(count, -np.inf)
    score[0], score[1] = logp[0, blank], logp[0, labels[0]]
    back = np.zeros((frames, count), dtype=np.int8)
    can_skip = extended != blank
    can_skip[:2] = False
    can_skip[2:] &= extended[2:] != extended[:-2]
    for t in range(1, frames):
        one = np.r_[-np.inf, score[:-1]]
        two = np.r_[-np.inf, -np.inf, score[:-2]]
        choices = np.stack([score, one, np.where(can_skip, two, -np.inf)])
        best = choices.argmax(axis=0)
        score = choices[best, np.arange(count)] + logp[t, extended]
        back[t] = best
    state = count - 1 if score[-1] >= score[-2] else count - 2
    if not np.isfinite(score[state]):
        return {"status": "reference_cannot_be_aligned"}
    path = np.empty(frames, dtype=np.int32)
    path[-1] = state
    for t in range(frames - 1, 0, -1):
        state -= int(back[t, state])
        path[t - 1] = state
    scored = []
    for index, token in enumerate(labels):
        positions = np.flatnonzero(path == 2 * index + 1)
        assert len(positions) > 0
        values = logp[positions, token]
        scored.append(
            {
                "phone_index": index,
                "token": int(token),
                "activation_first_frame": int(positions[0]),
                "activation_last_frame": int(positions[-1]),
                "gop_sa_mean_log_posterior": float(values.mean()),
                "activation_frame_count": len(positions),
            }
        )
    return {
        "status": "exploratory_acoustic_likelihoods_not_error_labels",
        "reference_ctc_log_likelihood": ctc_forward(logp, labels, blank),
        "phones": scored,
    }


def independent_math_checks():
    probability = np.array([[0.6, 0.3, 0.1], [0.2, 0.4, 0.4], [0.5, 0.2, 0.3]])
    for target in ([], [1], [2], [1, 2], [1, 1]):
        total = 0.0
        for path in itertools.product(range(3), repeat=3):
            collapsed = [p for p, _ in itertools.groupby(path) if p != 0]
            if collapsed == target:
                total += float(np.prod([probability[t, p] for t, p in enumerate(path)]))
        actual = ctc_forward(np.log(probability), np.array(target, dtype=np.int64))
        assert np.isclose(math.exp(actual), total, atol=1e-12), (target, actual, total)
    logits = np.log(np.array([[0.1, 0.85, 0.05], [0.1, 0.05, 0.85], [0.9, 0.05, 0.05]]))
    check = gop_sa(logits, np.array([1, 2]))
    assert all(
        np.isclose(x["gop_sa_mean_log_posterior"], math.log(0.85))
        for x in check["phones"]
    )
    return {"ctc_forward_exhaustive_cases": 5, "known_alignment_case": True}


if __name__ == "__main__":
    disable_network()
    backend = PhoneBackend()
    print(
        json.dumps(
            {
                "math_checks": independent_math_checks(),
                "phone_examples": {
                    x: backend.phonemize(x)[0]
                    for x in ("thin", "tin", "I said ship.", "I said sheep.")
                },
            },
            ensure_ascii=True,
        )
    )
