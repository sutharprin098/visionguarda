"""ANPR accuracy bench — measures the OCR stage against ground truth.

This exists because ANPR accuracy is a property of the RECOGNITION MODEL far
more than of the surrounding code, and the recogniser is pluggable
(`CAMAI_ANPR_OCR_MODEL`). Before trusting any model — the one shipped today or
a plate-trained replacement — run this and read the numbers.

Two sources of ground truth:

  synthetic  Renders plates of known text with real system fonts, then degrades
             them (small / night / glare / motion blur / defocus / tilt / noise
             / two-row). No download, runs anywhere, and covers the conditions
             the spec asks about. It is a LOWER bound: rendered glyphs are
             cleaner than a real plate but also lack the font a plate actually
             uses.

  folder     A directory of real plate crops named `<PLATE>.jpg`, e.g.
             `MH12AB1234.jpg`. This is the number that actually matters; the
             synthetic run is what you use when you have no labelled footage.

Usage
-----
    python anpr_bench.py                      # synthetic, all conditions
    python anpr_bench.py --n 40               # more samples per condition
    python anpr_bench.py --folder path/to/crops
    python anpr_bench.py --compare-greedy     # show what the grammar buys

Reported per condition: exact-match rate, mean character error rate (CER),
mean confidence, and the distribution of failure reasons — a low exact-match
with everything failing on `blurry` is a very different problem from one where
reads are confident and wrong.
"""
from __future__ import annotations

import argparse
import os
import random
import string
import sys
from collections import Counter
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import config                                    # noqa: E402
from app.ai import plate_format, plate_ocr                # noqa: E402

_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\ariblk.ttf",
    r"C:\Windows\Fonts\courbd.ttf", r"C:\Windows\Fonts\impact.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]

STATES = ["MH", "DL", "KA", "TN", "GJ", "UP", "RJ", "WB", "AP", "HR"]


def plate_text() -> str:
    return (f"{random.choice(STATES)}{random.randint(1, 49):02d}"
            f"{random.choice(string.ascii_uppercase)}"
            f"{random.choice(string.ascii_uppercase)}"
            f"{random.randint(1, 9999):04d}")


def _fonts() -> List[str]:
    got = [p for p in _FONT_CANDIDATES if os.path.exists(p)]
    if not got:
        print("[bench] no TrueType font found — falling back to a stroke font; "
              "results will be pessimistic.")
    return got


def render(text: str, font_path: Optional[str], two_row: bool = False,
           w: int = 440, h: int = 110) -> np.ndarray:
    """White plate, black characters, sized to fill the plate like a real one."""
    if font_path is None:
        img = np.full((h, w), 245, np.uint8)
        f = cv2.FONT_HERSHEY_DUPLEX
        base = cv2.getTextSize(text, f, 1.0, 2)[0]
        k = (w * 0.88) / max(1, base[0])
        sz = cv2.getTextSize(text, f, k, max(1, int(2 * k)))[0]
        cv2.putText(img, text, ((w - sz[0]) // 2, (h + sz[1]) // 2), f, k, (15,),
                    max(1, int(2 * k)), cv2.LINE_AA)
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    from PIL import Image, ImageDraw, ImageFont
    rows = [text[:4], text[4:]] if two_row else [text]
    img = Image.new("L", (w, h), 245)
    d = ImageDraw.Draw(img)
    band = h / len(rows)
    for i, line in enumerate(rows):
        size = 10
        while size < 250:
            f = ImageFont.truetype(font_path, size)
            bb = d.textbbox((0, 0), line, font=f)
            if bb[2] - bb[0] > w * 0.88 or bb[3] - bb[1] > band * 0.74:
                break
            size += 2
        f = ImageFont.truetype(font_path, size)
        bb = d.textbbox((0, 0), line, font=f)
        d.text(((w - (bb[2] - bb[0])) / 2 - bb[0],
                band * i + (band - (bb[3] - bb[1])) / 2 - bb[1]),
               line, fill=15, font=f)
    return cv2.cvtColor(np.array(img), cv2.COLOR_GRAY2BGR)


def degrade(bgr: np.ndarray, plate_w: int, cond: Dict) -> np.ndarray:
    h, w = bgr.shape[:2]
    p = cv2.resize(bgr, (plate_w, max(6, int(h * plate_w / w))),
                   interpolation=cv2.INTER_AREA)
    if cond.get("tilt"):
        hh, ww = p.shape[:2]
        m = cv2.getRotationMatrix2D((ww / 2, hh / 2), cond["tilt"], 1.0)
        p = cv2.warpAffine(p, m, (ww, hh), borderValue=(200, 200, 200))
    if cond.get("dark"):
        p = np.clip(p.astype(np.float32) * cond["dark"], 0, 255).astype(np.uint8)
    if cond.get("motion"):
        k = cond["motion"] | 1
        ker = np.zeros((k, k), np.float32); ker[k // 2, :] = 1.0 / k
        p = cv2.filter2D(p, -1, ker)
    if cond.get("blur"):
        k = cond["blur"] | 1
        p = cv2.GaussianBlur(p, (k, k), 0)
    if cond.get("glare"):
        ov = p.copy()
        cv2.circle(ov, (p.shape[1] // 2, p.shape[0] // 2),
                   int(p.shape[1] * 0.35), (255, 255, 255), -1)
        p = cv2.addWeighted(p, 1 - cond["glare"], ov, cond["glare"], 0)
    if cond.get("noise"):
        p = np.clip(p.astype(np.int16) +
                    np.random.normal(0, cond["noise"], p.shape).astype(np.int16),
                    0, 255).astype(np.uint8)
    return p


CONDITIONS: List[Tuple[str, int, Dict]] = [
    ("clean_240px",  240, {}),
    ("clean_140px",  140, {}),
    ("small_80px",    80, {}),
    ("night",        160, {"dark": 0.35, "noise": 8}),
    ("glare",        160, {"glare": 0.45}),
    ("motion_blur",  160, {"motion": 7}),
    ("defocus",      160, {"blur": 5}),
    ("tilt_8deg",    160, {"tilt": 8}),
    ("rain_noise",   160, {"noise": 18, "dark": 0.6}),
    ("two_row",      160, {"two_row": True}),
]


def cer(got: str, want: str) -> float:
    """Levenshtein distance normalised by the reference length."""
    if not want:
        return 1.0
    prev = list(range(len(want) + 1))
    for i, a in enumerate(got, 1):
        cur = [i] + [0] * len(want)
        for j, b in enumerate(want, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a != b))
        prev = cur
    return prev[len(want)] / len(want)


def _run_case(rec, crop: np.ndarray, want: str, greedy_too: bool
              ) -> Tuple[bool, float, float, Optional[str], Optional[bool]]:
    res = rec.read_detailed(crop)
    got = res.text
    ok = (got == want)
    g_ok = None
    if greedy_too:
        try:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
            p = rec._probs(rec._letterbox(gray))
            raw, _c = rec._greedy(p)
            g_ok = (plate_format.normalise(raw) == want)
        except Exception:
            g_ok = False
    return ok, cer(got, want), res.confidence, res.reason, g_ok


def bench_synthetic(rec, n: int, greedy_too: bool) -> None:
    fonts = _fonts()
    hdr = (f"{'condition':<14}{'exact':>12}{'CER':>7}{'conf':>7}"
           f"{'  greedy' if greedy_too else ''}   top failure reasons")
    print(hdr)
    print("-" * len(hdr))
    tot_ok = tot_n = 0
    tot_cer = 0.0
    tot_g = 0
    for name, pw, cond in CONDITIONS:
        ok = g = 0
        cers: List[float] = []
        confs: List[float] = []
        reasons: Counter = Counter()
        for _ in range(n):
            want = plate_text()
            img = render(want, random.choice(fonts) if fonts else None,
                         two_row=cond.get("two_row", False))
            crop = degrade(img, pw, cond)
            hit, c, conf, reason, ghit = _run_case(rec, crop, want, greedy_too)
            ok += hit; cers.append(c); confs.append(conf)
            if reason:
                reasons[reason] += 1
            if ghit:
                g += 1
        tot_ok += ok; tot_n += n; tot_cer += sum(cers); tot_g += g
        rs = ", ".join(f"{k}={v}" for k, v in reasons.most_common(3)) or "-"
        line = (f"{name:<14}{ok:>7}/{n:<4}{np.mean(cers):>7.2f}{np.mean(confs):>7.2f}")
        if greedy_too:
            line += f"{g:>5}/{n:<3}"
        print(f"{line}   {rs}")
    print("-" * len(hdr))
    line = (f"{'TOTAL':<14}{tot_ok:>7}/{tot_n:<4}{tot_cer/max(1,tot_n):>7.2f}"
            f"{'':>7}")
    if greedy_too:
        line += f"{tot_g:>5}/{tot_n:<3}"
    print(line)
    print(f"\nexact match : {100*tot_ok/max(1,tot_n):.1f}%"
          + (f"   (plain greedy decoding: {100*tot_g/max(1,tot_n):.1f}%)" if greedy_too else ""))
    print(f"mean CER    : {tot_cer/max(1,tot_n):.3f}")


def bench_folder(rec, folder: str) -> None:
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    files = [f for f in sorted(os.listdir(folder))
             if os.path.splitext(f)[1].lower() in exts]
    if not files:
        print(f"[bench] no images in {folder}")
        return
    ok = 0
    cers: List[float] = []
    reasons: Counter = Counter()
    print(f"{'file':<28}{'want':<13}{'got':<13}{'conf':>6}  reason")
    print("-" * 76)
    for f in files:
        want = plate_format.normalise(os.path.splitext(f)[0].split("_")[0])
        img = cv2.imread(os.path.join(folder, f))
        if img is None:
            continue
        res = rec.read_detailed(img)
        hit = (res.text == want)
        ok += hit
        cers.append(cer(res.text, want))
        if res.reason:
            reasons[res.reason] += 1
        print(f"{f[:27]:<28}{want:<13}{res.text or '-':<13}"
              f"{res.confidence:>6.2f}  {res.reason or ('OK' if hit else 'MISMATCH')}")
    n = len(cers)
    print("-" * 76)
    print(f"exact match : {ok}/{n} = {100*ok/max(1,n):.1f}%")
    print(f"mean CER    : {np.mean(cers) if cers else 1.0:.3f}")
    if reasons:
        print("failures    : " + ", ".join(f"{k}={v}" for k, v in reasons.most_common()))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=25, help="samples per condition")
    ap.add_argument("--folder", help="directory of real crops named <PLATE>.jpg")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--compare-greedy", action="store_true",
                    help="also report plain greedy decoding, to show what the "
                         "plate grammar contributes")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)

    rec = plate_ocr.get_recognizer()
    if rec is None:
        print("[bench] no OCR model available — check CAMAI_ANPR_OCR_MODEL and "
              f"{config.ANPR_MODEL_DIR}")
        return 2
    print(f"model    : {config.ANPR_OCR_MODEL}")
    print(f"country  : {rec.fmt.code} ({rec.fmt.name})")
    print(f"min conf : {config.ANPR_OCR_MIN_CONF}   "
          f"require-valid-format: {config.ANPR_REQUIRE_VALID_FORMAT}\n")

    if args.folder:
        bench_folder(rec, args.folder)
    else:
        bench_synthetic(rec, args.n, args.compare_greedy)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
