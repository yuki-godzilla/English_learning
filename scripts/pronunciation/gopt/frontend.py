"""Local Windows Kaldi -> original GOPT experiment. No inference downloads."""

import json, os, re, socket, subprocess, time
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[3]
BASE = WORKSPACE / "tmp/pronunciation-comparison"
ASSETS = BASE / "gopt-assets"
KALDI = WORKSPACE / "tmp/gopt-kaldi/Library/bin"
AM = ASSETS / "librispeech-chain/exp/chain_cleaned/tdnn_1d_sp"
IE = ASSETS / "librispeech-extractor/exp/nnet3_cleaned/extractor"


def deny_network(*args, **kwargs):
    raise RuntimeError("Network disabled during local evaluation")


socket.create_connection = deny_network
socket.socket.connect = deny_network


def text(path, value):
    path.write_text(value, encoding="utf-8", newline="\n")


def normal_phone(ph):
    return re.sub(r"\d", "", ph)


def normalize_text(value):
    value = (
        value.replace("’", "'")
        .replace("GPT-6", "GPT six")
        .replace("#1", "number one")
        .replace("$2", "two dollars")
        .replace("$10", "ten dollars")
    )
    for before, after in [
        ("95%", "ninety five percent"),
        ("35%", "thirty five percent"),
        ("40 million", "forty million"),
        ("~6 million", "six million"),
        ("Gemini 4", "Gemini four"),
    ]:
        value = value.replace(before, after)
    if re.search(r"\d", value):
        raise ValueError(
            "Spell out unsupported numeric reference forms before alignment"
        )
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", value.upper())


class Frontend:
    def __init__(self, run_dir, dither=1):
        self.dir = run_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.env = os.environ.copy()
        self.env["PATH"] = str(KALDI) + os.pathsep + self.env["PATH"]
        self.env["OPENBLAS_NUM_THREADS"] = "8"
        self.env["OMP_NUM_THREADS"] = "8"
        self.commands = []
        self.dither = dither

    def rel(self, path):
        return Path(os.path.relpath(path, self.dir)).as_posix()

    def run(self, binary, *args):
        start = time.perf_counter()
        with (self.dir / (binary + ".log")).open("w", encoding="utf-8") as log:
            result = subprocess.run(
                [str(KALDI / (binary + ".exe")), *args],
                cwd=self.dir,
                env=self.env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        self.commands.append(
            {
                "binary": binary,
                "seconds": time.perf_counter() - start,
                "exit_code": result.returncode,
                "args": list(args),
            }
        )
        text(self.dir / "commands.json", json.dumps(self.commands, indent=2))
        if result.returncode:
            raise RuntimeError(
                (self.dir / (binary + ".log")).read_text(
                    encoding="utf-8", errors="replace"
                )[-5000:]
            )
        print(binary, round(self.commands[-1]["seconds"], 3), "seconds", flush=True)

    def execute(self, cases, prepare_only=False):
        phonetable = {
            s: int(i)
            for s, i in (
                l.split() for l in (AM / "phones.txt").read_text().splitlines()
            )
        }
        pure = {}
        oldmap = {}
        for sym, i in sorted(phonetable.items(), key=lambda p: p[1]):
            if "#" in sym:
                continue
            p = normal_phone(re.sub(r"_[BIES]$", "", sym))
            if p not in pure:
                pure[p] = len(pure)
            oldmap[i] = pure[p]
        assert len(pure) == 42, pure
        text(
            self.dir / "phone-map.int",
            "".join(f"{i} {j}\n" for i, j in oldmap.items() if i > 0),
        )
        text(self.dir / "phones-pure.json", json.dumps(pure, indent=2))
        lex = {}
        for line in (ASSETS / "librispeech-lexicon.txt").read_text().splitlines():
            row = line.split()
            lex.setdefault(row[0], [normal_phone(p) for p in row[1:]])
        for line in (ASSETS / "cmudict.dict").read_text().splitlines():
            if line.startswith(";;;"):
                continue
            row = line.split(" #")[0].split()
            if row:
                lex.setdefault(
                    re.sub(r"\(\d+\)$", "", row[0]).upper(),
                    [normal_phone(p) for p in row[1:]],
                )
        # Explicit canonical proposals for out-of-vocabulary article terminology.
        custom = {
            "GPT": ["JH", "IY", "P", "IY", "T", "IY"],
            "PASSKEYS": ["P", "AE", "S", "K", "IY", "Z"],
            "MEETUPS": ["M", "IY", "T", "AH", "P", "S"],
            "AI": ["EY", "AY"],
            "API": ["EY", "P", "IY", "AY"],
            "AGENTIC": ["EY", "JH", "EH", "N", "T", "IH", "K"],
            "REFACTOR": ["R", "IY", "F", "AE", "K", "T", "ER"],
            "REFACTORING": ["R", "IY", "F", "AE", "K", "T", "ER", "IH", "NG"],
            "CODEBASE": ["K", "OW", "D", "B", "EY", "S"],
            "WEBPAGE": ["W", "EH", "B", "P", "EY", "JH"],
            "WEBPAGES": ["W", "EH", "B", "P", "EY", "JH", "IH", "Z"],
            "CYBERSECURITY": [
                "S",
                "AY",
                "B",
                "ER",
                "S",
                "IH",
                "K",
                "Y",
                "UH",
                "R",
                "AH",
                "T",
                "IY",
            ],
            "ROLLBACKS": ["R", "OW", "L", "B", "AE", "K", "S"],
            "VALS": ["V", "AE", "L", "Z"],
            "CHROMIUM'S": ["K", "R", "OW", "M", "IY", "AH", "M", "Z"],
            "FLUIDLY": ["F", "L", "UW", "IH", "D", "L", "IY"],
            "OPTIMIZATIONS": [
                "AA",
                "P",
                "T",
                "AH",
                "M",
                "AH",
                "Z",
                "EY",
                "SH",
                "AH",
                "N",
                "Z",
            ],
        }
        lex.update(custom)
        wavscp = []
        spk2utt = []
        words_int = []
        phones_int = []
        expected = {}
        oov = set()
        worddict = {}
        for c in cases:
            utt = c["id"]
            words = normalize_text(c["text"])
            expected[utt] = []
            wavscp.append(f"{utt} {self.rel(c['wav'])}\n")
            spk2utt.append(f"{utt} {utt}\n")
            ids = []
            for j, word in enumerate(words):
                if "phone_words" not in c and word not in lex:
                    oov.add(word)
                    continue
                if word not in worddict:
                    worddict[word] = len(worddict) + 1
                ids.append(worddict[word])
                phs = (
                    [normal_phone(p) for p in c["phone_words"][j]]
                    if "phone_words" in c
                    else lex[word]
                )
                marked = [
                    p
                    + (
                        "_S"
                        if len(phs) == 1
                        else "_B"
                        if k == 0
                        else "_E"
                        if k == len(phs) - 1
                        else "_I"
                    )
                    for k, p in enumerate(phs)
                ]
                phones_int.append(
                    f"{utt}.{j} " + " ".join(str(phonetable[p]) for p in marked) + "\n"
                )
                expected[utt].extend(
                    [
                        {"phone": p, "pure_id": pure[p], "word": word, "word_index": j}
                        for p in phs
                    ]
                )
            words_int.append(f"{utt} " + " ".join(map(str, ids)) + "\n")
        if oov:
            raise ValueError("OOV needs explicit review: " + str(sorted(oov)))
        text(self.dir / "expected-phones.json", json.dumps(expected, indent=2))
        text(self.dir / "wav.scp", "".join(wavscp))
        text(self.dir / "spk2utt", "".join(spk2utt))
        text(self.dir / "text.int", "".join(words_int))
        text(self.dir / "text-phone.int", "".join(phones_int))
        text(
            self.dir / "cases.json",
            json.dumps([{**c, "wav": str(c["wav"])} for c in cases], indent=2),
        )
        text(
            self.dir / "disambig.int",
            "".join(f"{i}\n" for sym, i in phonetable.items() if "#" in sym),
        )
        if prepare_only:
            return expected
        # All paths in Kaldi table files are relative to this working directory (spaces safe).
        self.run(
            "compute-mfcc-feats",
            "--dither=" + str(self.dither),
            "--allow-downsample=true",
            "--config=" + self.rel(ASSETS / "mfcc_hires.conf"),
            "scp:wav.scp",
            "ark:mfcc.ark",
        )
        text(self.dir / "splice.conf", "--left-context=3\n--right-context=3\n")
        text(self.dir / "online_cmvn.conf", (IE / "online_cmvn.conf").read_text())
        conf = {
            "cmvn-config": "online_cmvn.conf",
            "ivector-period": "10",
            "splice-config": "splice.conf",
            "lda-matrix": self.rel(IE / "final.mat"),
            "global-cmvn-stats": self.rel(IE / "global_cmvn.stats"),
            "diag-ubm": self.rel(IE / "final.dubm"),
            "ivector-extractor": self.rel(IE / "final.ie"),
            "num-gselect": "5",
            "min-post": "0.025",
            "posterior-scale": "0.1",
            "max-remembered-frames": "1000",
            "max-count": "0",
        }
        text(
            self.dir / "ivector.conf", "".join(f"--{k}={v}\n" for k, v in conf.items())
        )
        self.run(
            "ivector-extract-online2",
            "--config=ivector.conf",
            "ark:spk2utt",
            "ark:mfcc.ark",
            "ark:ivector.ark",
        )
        # cmvn_opts explicitly disables mean and variance normalization for the network.
        assert (
            AM / "cmvn_opts"
        ).read_text().strip() == "--norm-means=false --norm-vars=false"
        self.run(
            "nnet3-compute",
            "--use-gpu=no",
            "--online-ivectors=ark:ivector.ark",
            "--online-ivector-period=10",
            "--frames-per-chunk=50",
            self.rel(AM / "final.mdl"),
            "ark:mfcc.ark",
            "ark:output.ark",
        )
        self.run(
            "compile-train-graphs-without-lexicon",
            "--read-disambig-syms=disambig.int",
            self.rel(AM / "tree"),
            self.rel(AM / "final.mdl"),
            "ark,t:text.int",
            "ark,t:text-phone.int",
            "ark:graphs.ark",
        )
        self.run(
            "align-compiled-mapped",
            "--transition-scale=1.0",
            "--acoustic-scale=0.1",
            "--self-loop-scale=0.1",
            "--beam=10",
            "--retry-beam=40",
            self.rel(AM / "final.mdl"),
            "ark:graphs.ark",
            "ark:output.ark",
            "ark,t:ali.txt",
        )
        self.run(
            "ali-to-phones",
            "--per-frame=true",
            self.rel(AM / "final.mdl"),
            "ark,t:ali.txt",
            "ark,t:phone-ali.txt",
        )
        self.run(
            "compute-gop",
            "--phone-map=phone-map.int",
            "--skip-phones-string=0:1:2",
            self.rel(AM / "final.mdl"),
            "ark,t:ali.txt",
            "ark,t:phone-ali.txt",
            "ark:output.ark",
            "ark,t:gop.txt",
            "ark,t:features.txt",
        )
        self.run(
            "ali-to-phones",
            "--ctm-output=true",
            self.rel(AM / "final.mdl"),
            "ark,t:ali.txt",
            "ctm.txt",
        )
        return expected
