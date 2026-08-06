"""ANPR OCR stage — reads the characters off a gated plate crop.

It is a SEPARATE, OPTIONAL stage. app/ai/plate.py localises + gates plate
regions and leaves plate_text=None; this fills it. If the OCR model or its
charset is missing, plates are still localised and CamAI keeps running — OCR
never crashes the engine and never invents a plate number.

Design, and why it is shaped this way
-------------------------------------
Benchmarking the shipped OpenCV-Zoo CRNN (docs/ANPR.md) established three
facts that drive every choice below:

1. The recogniser reads DICTIONARY WORDS almost perfectly ("hello", "traffic",
   "camera" at ~0.9-1.0 confidence) but mangles PLATE strings in the same font
   at the same size — it carries a word/language bias from its training set.
   Its errors are class errors, not shape errors: 0->O, 1->I/T, 8->B, 5->S,
   2->Z, 4->A, 6->G.
2. Because the errors are class errors, PREPROCESSING barely helps. A full
   grayscale/CLAHE/denoise/sharpen/threshold sweep moved exact matches from
   0.0% to ~1%. Preprocessing is retained (it genuinely rescues low-light,
   glare and noisy crops, and costs little given the early exit) but it is not
   where the accuracy comes from.
3. GRAMMAR helps a lot. Running the same probabilities through a CTC beam
   search constrained to the plate grammar took exact matches 1.0% -> 13.5%
   and character error 0.47 -> 0.37 on rendered plates.

So the accuracy strategy is: decode inside the grammar (`_beam_constrained`),
use preprocessing variants as a cheap best-of ensemble, and let the caller
(app/ai/plate_track.py) vote across frames. The recogniser stays PLUGGABLE —
`CAMAI_ANPR_OCR_MODEL` swaps in a plate-trained CRNN with no code change, and
`tools/anpr_bench.py` measures any candidate against the same fixtures.

Recogniser contract (auto-detected from the model's own I/O)
------------------------------------------------------------
Input : [1,C,H,W], C=1 grayscale or 3 BGR, H/W read from the model
        (OpenCV Zoo EN CRNN is [1,1,32,100]). blobFromImage scale 1/127.5,
        mean 127.5 -> [-1,1].
Output: [T,1,C] or [1,T,C] logits over C = len(charset)+1; class 0 is the CTC
        blank. Charset comes from a file, never hardcoded, so a model with a
        different alphabet works by shipping its own charset.
"""
from __future__ import annotations

import math
import os
import sys
import threading
import time
from collections import defaultdict
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from app import config
from app.ai import plate_format

try:
    import onnxruntime as ort
    HAS_ORT = True
except Exception:  # pragma: no cover
    HAS_ORT = False

_PROVIDER_PREF = ["CUDAExecutionProvider", "CPUExecutionProvider"]
_NEG = -1e30

# Failure reasons, reported verbatim in telemetry and the debug log so an
# operator can tell "the camera cannot see it" from "the model cannot read it".
FAIL_EMPTY_CROP = "empty_crop"
FAIL_TOO_SMALL = "plate_too_small"
FAIL_BLURRY = "blurry"
FAIL_NO_TEXT = "ocr_no_text"
FAIL_LOW_CONF = "ocr_low_confidence"
FAIL_INVALID = "invalid_format"
FAIL_MODEL = "ocr_model_error"


class OCRResult:
    """One read attempt, including why it failed when it did.

    `text` is empty unless the read passed every gate, so callers can keep the
    old `if text:` idiom; `raw_text` always carries what the recogniser said,
    which is what makes the debug log useful.
    """

    __slots__ = ("text", "confidence", "raw_text", "reason", "variant",
                 "valid", "corrections", "elapsed_ms")

    def __init__(self, text: str = "", confidence: float = 0.0, raw_text: str = "",
                 reason: Optional[str] = None, variant: str = "",
                 valid: bool = False, corrections: int = 0, elapsed_ms: float = 0.0):
        self.text = text
        self.confidence = confidence
        self.raw_text = raw_text
        self.reason = reason
        self.variant = variant
        self.valid = valid
        self.corrections = corrections
        self.elapsed_ms = elapsed_ms

    def __bool__(self) -> bool:
        return bool(self.text)

    def as_dict(self) -> Dict[str, object]:
        return {"text": self.text, "confidence": round(self.confidence, 4),
                "raw_text": self.raw_text, "reason": self.reason,
                "variant": self.variant, "valid": self.valid,
                "corrections": self.corrections,
                "elapsed_ms": round(self.elapsed_ms, 2)}


# --------------------------------------------------------------------------
# model discovery (unchanged behaviour — kept so existing installs keep working)
# --------------------------------------------------------------------------
def _select_providers() -> List[str]:
    avail = set(ort.get_available_providers()) if HAS_ORT else set()
    chosen = [p for p in _PROVIDER_PREF if p in avail]
    if "CPUExecutionProvider" not in chosen:
        chosen.append("CPUExecutionProvider")
    return chosen


def _candidate_dirs() -> List[str]:
    dirs: List[str] = [str(config.ANPR_MODEL_DIR)]
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        dirs += [os.path.join(exe_dir, "plate"), exe_dir, os.path.join(exe_dir, "_internal")]
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            dirs.append(os.path.join(meipass, "plate"))
    here = os.path.dirname(os.path.abspath(__file__))
    dirs += [os.path.join(here, "..", "..", "models", "plate")]
    return [os.path.normpath(d) for d in dirs]


def _resolve(name: str) -> Optional[str]:
    if os.path.isabs(name) and os.path.exists(name):
        return name
    for d in _candidate_dirs():
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None


def _load_charset(path: str) -> str:
    """Charset from a file — one char per line, OR a single line holding the
    whole charset. Never hardcoded, so a model with a different alphabet just
    works by shipping its own charset file."""
    with open(path, "r", encoding="utf-8") as fh:
        lines = [ln.rstrip("\n") for ln in fh]
    lines = [ln for ln in lines if ln != ""]
    if len(lines) == 1 and len(lines[0]) > 1:
        return lines[0]
    return "".join(lines)


# --------------------------------------------------------------------------
# image preparation
# --------------------------------------------------------------------------
def blur_score(gray: np.ndarray) -> float:
    """Variance of the Laplacian — the standard focus measure. Low means the
    crop carries no high-frequency detail, i.e. motion blur or defocus, and the
    read is not worth attempting."""
    if gray.size == 0:
        return 0.0
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def deskew(gray: np.ndarray, max_angle: float = 20.0) -> np.ndarray:
    """Rotate a tilted plate flat.

    The angle comes from the minimum-area rectangle around the ink pixels,
    which is robust on plates because the characters form one dominant
    horizontal band. Rotations beyond `max_angle` are ignored: past that the
    estimate is more likely to be a mis-fit on background clutter than a real
    tilt, and over-rotating destroys a readable crop.
    """
    if gray.size == 0:
        return gray
    try:
        th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
        pts = cv2.findNonZero(th)
        if pts is None or len(pts) < 20:
            return gray
        angle = cv2.minAreaRect(pts)[-1]
        if angle < -45:
            angle += 90
        elif angle > 45:
            angle -= 90
        if abs(angle) < 1.0 or abs(angle) > max_angle:
            return gray
        h, w = gray.shape[:2]
        m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
        return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC,
                              borderMode=cv2.BORDER_REPLICATE)
    except cv2.error:
        return gray


def rectify(bgr: np.ndarray) -> Optional[np.ndarray]:
    """Perspective-correct a plate photographed from an angle.

    Finds the largest 4-corner contour that plausibly IS the plate (convex,
    covers most of the crop, roughly plate-shaped) and warps it to a frontal
    rectangle. Returns None — not a guess — when no such quad is found, because
    warping to a wrong quad is far worse than not warping at all.
    """
    if bgr is None or bgr.size == 0:
        return None
    h, w = bgr.shape[:2]
    if w < 24 or h < 12:
        return None
    try:
        g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
        g = cv2.bilateralFilter(g, 5, 40, 40)
        edges = cv2.Canny(g, 40, 140)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
        cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return None
        area_crop = float(w * h)
        for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:5]:
            a = cv2.contourArea(c)
            if a < area_crop * 0.35:
                break
            approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
            if len(approx) != 4 or not cv2.isContourConvex(approx):
                continue
            q = approx.reshape(4, 2).astype(np.float32)
            s, d = q.sum(1), np.diff(q, axis=1).ravel()
            src = np.array([q[np.argmin(s)], q[np.argmin(d)],
                            q[np.argmax(s)], q[np.argmax(d)]], np.float32)
            wa = max(np.linalg.norm(src[0] - src[1]), np.linalg.norm(src[3] - src[2]))
            ha = max(np.linalg.norm(src[0] - src[3]), np.linalg.norm(src[1] - src[2]))
            if wa < 20 or ha < 8 or not (1.0 <= wa / ha <= 8.0):
                continue
            dst = np.array([[0, 0], [wa - 1, 0], [wa - 1, ha - 1], [0, ha - 1]], np.float32)
            return cv2.warpPerspective(bgr, cv2.getPerspectiveTransform(src, dst),
                                       (int(wa), int(ha)))
    except cv2.error:
        return None
    return None


def split_rows(bgr: np.ndarray) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """Split a two-row plate into its two lines.

    Indian two-wheeler and many commercial plates stack the registration over
    two rows. A single-line recogniser reads straight across both and returns
    nonsense (measured: 'TN46AX4749' -> 'LX474H'), so the rows must be read
    separately and concatenated. The cut is the darkest valley of the ink
    row-profile in the middle third of the crop; None when no clean valley
    exists, which is the common single-row case.
    """
    if bgr is None or bgr.size == 0:
        return None
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
    h = g.shape[0]
    if h < 20:
        return None
    try:
        g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(g)
        ink = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY_INV, 15, 9)
    except cv2.error:
        return None
    proj = ink.sum(axis=1).astype(np.float32)
    lo, hi = int(h * 0.32), int(h * 0.68)
    if hi - lo < 2:
        return None
    cut = lo + int(np.argmin(proj[lo:hi]))
    # A real inter-row gap is much emptier than the rows around it. Without this
    # check every single-row plate would be sliced through its characters.
    band = float(np.mean(proj)) or 1.0
    if proj[cut] > band * 0.45:
        return None
    if cut < 8 or h - cut < 8:
        return None
    return bgr[:cut], bgr[cut:]


class _Variants:
    """Preprocessing ladder, cheapest and most-likely-to-work first.

    Ordering matters because `read()` stops at the first variant that clears
    the early-exit confidence — on an easy daytime plate only one inference
    runs, which is what keeps the multi-variant ensemble affordable in the
    real-time loop.
    """

    @staticmethod
    def raw(g: np.ndarray) -> np.ndarray:
        return g

    @staticmethod
    def clahe(g: np.ndarray) -> np.ndarray:
        return cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4)).apply(g)

    @staticmethod
    def clahe_sharp(g: np.ndarray) -> np.ndarray:
        c = _Variants.clahe(g)
        return cv2.addWeighted(c, 1.7, cv2.GaussianBlur(c, (0, 0), 1.2), -0.7, 0)

    @staticmethod
    def denoise_clahe_sharp(g: np.ndarray) -> np.ndarray:
        return _Variants.clahe_sharp(cv2.bilateralFilter(g, 5, 40, 40))

    @staticmethod
    def adaptive(g: np.ndarray) -> np.ndarray:
        return cv2.adaptiveThreshold(_Variants.clahe(g), 255,
                                     cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                     cv2.THRESH_BINARY, 15, 9)

    @staticmethod
    def invert(g: np.ndarray) -> np.ndarray:
        # Commercial plates in India are black-on-yellow and many night crops
        # come out light-on-dark; the recogniser expects dark ink on light.
        return 255 - _Variants.clahe(g)

    @staticmethod
    def equalize(g: np.ndarray) -> np.ndarray:
        return cv2.equalizeHist(g)


_VARIANT_ORDER: Tuple[Tuple[str, object], ...] = (
    ("clahe_sharp", _Variants.clahe_sharp),
    ("raw", _Variants.raw),
    ("clahe", _Variants.clahe),
    ("denoise_clahe_sharp", _Variants.denoise_clahe_sharp),
    ("adaptive", _Variants.adaptive),
    ("equalize", _Variants.equalize),
    ("invert", _Variants.invert),
)


class PlateOCR:
    def __init__(self, model_path: str, charset_path: str):
        if not HAS_ORT:
            raise RuntimeError("onnxruntime unavailable; cannot run OCR model")
        self.charset = _load_charset(charset_path)
        if not self.charset:
            raise ValueError(f"empty charset in {charset_path}")
        self.charset_u = self.charset.upper()
        self.last_error: Optional[str] = None
        self.last_infer_ms: float = 0.0
        self._lock = threading.Lock()
        self.stats: Dict[str, int] = defaultdict(int)

        t0 = time.time()
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = max(1, min(2, (os.cpu_count() or 2)))
        so.log_severity_level = 3
        self.providers = _select_providers()
        self.session = ort.InferenceSession(model_path, sess_options=so, providers=self.providers)
        self.active_provider = self.session.get_providers()[0]
        try:
            from app.ai.accelerator import guard_cpu_fallback
            guard_cpu_fallback("ANPR OCR", self.active_provider)
        except RuntimeError:
            raise
        except Exception:
            pass

        inp = self.session.get_inputs()[0]
        self._in_name = inp.name
        shp = inp.shape
        self._channels = 3 if (isinstance(shp[1], int) and shp[1] == 3) else 1
        # Read the geometry from the model instead of assuming 100x32, so a
        # wider plate-trained recogniser drops in without touching this file.
        self._in_h = shp[2] if isinstance(shp[2], int) else 32
        self._in_w = shp[3] if isinstance(shp[3], int) else 100

        # Grammar: index the charset once so the beam search can look up a
        # class index per character without a scan.
        self.fmt = plate_format.get_format(config.ANPR_COUNTRY)
        self._cidx = {c: i + 1 for i, c in enumerate(self.charset_u)}
        self._alpha_idx = [(c, i + 1) for i, c in enumerate(self.charset_u) if c.isalpha()]
        self._digit_idx = [(c, i + 1) for i, c in enumerate(self.charset_u) if c.isdigit()]

        print(f"[anpr-ocr] CRNN loaded from {model_path} in {(time.time()-t0)*1000:.0f}ms "
              f"| provider={self.active_provider} | charset={len(self.charset)} "
              f"| input={self._in_w}x{self._in_h}x{self._channels} "
              f"| country={self.fmt.code}", flush=True)

    # -- tensor prep --------------------------------------------------------
    def _letterbox(self, g: np.ndarray) -> np.ndarray:
        """Resize into the model's input WITHOUT destroying the aspect ratio.

        The previous implementation hard-resized, squashing a 4.5:1 plate into
        a 3.1:1 tensor and horizontally compressing every glyph. Padding with
        the crop's own median keeps the border from reading as ink.
        """
        h, w = g.shape[:2]
        if h == 0 or w == 0:
            return np.zeros((self._in_h, self._in_w), np.uint8)
        s = min(self._in_w / w, self._in_h / h)
        nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
        interp = cv2.INTER_CUBIC if s > 1.0 else cv2.INTER_AREA
        r = cv2.resize(g, (nw, nh), interpolation=interp)
        canvas = np.full((self._in_h, self._in_w), int(np.median(r)), np.uint8)
        y0, x0 = (self._in_h - nh) // 2, (self._in_w - nw) // 2
        canvas[y0:y0 + nh, x0:x0 + nw] = r
        return canvas

    def _blob(self, g: np.ndarray) -> np.ndarray:
        img = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR) if self._channels == 3 else g
        return cv2.dnn.blobFromImage(img, scalefactor=1 / 127.5,
                                     size=(self._in_w, self._in_h), mean=127.5)

    def _probs(self, g: np.ndarray) -> np.ndarray:
        """[T,C] softmax over the recogniser's timesteps."""
        blob = self._blob(g)
        with self._lock:
            t0 = time.time()
            out = self.session.run(None, {self._in_name: blob})[0]
            self.last_infer_ms = (time.time() - t0) * 1000
        arr = np.asarray(out, dtype=np.float32)
        if arr.ndim == 3:
            arr = arr[:, 0, :] if arr.shape[1] == 1 else arr[0]
        if arr.ndim != 2:
            raise ValueError(f"unexpected OCR output shape {np.asarray(out).shape}")
        z = arr - arr.max(axis=1, keepdims=True)
        p = np.exp(z)
        p /= np.maximum(p.sum(axis=1, keepdims=True), 1e-12)
        return p

    # -- decoding -----------------------------------------------------------
    def _greedy(self, p: np.ndarray) -> Tuple[str, float]:
        """Plain CTC greedy: argmax per timestep, collapse repeats, drop blanks."""
        idx = p.argmax(axis=1)
        conf_t = p[np.arange(len(idx)), idx]
        chars: List[str] = []
        confs: List[float] = []
        prev = -1
        for t, i in enumerate(idx):
            if i != prev and i != 0:
                ci = int(i) - 1
                if 0 <= ci < len(self.charset_u):
                    chars.append(self.charset_u[ci])
                    confs.append(float(conf_t[t]))
            prev = int(i)
        if not chars:
            return "", 0.0
        return "".join(chars), float(np.mean(confs))

    def _beam_constrained(self, p: np.ndarray, beam_width: int) -> Tuple[str, float]:
        """CTC prefix beam search restricted to the country's plate grammar.

        Standard prefix beam search, with one addition: a beam entry carries the
        set of grammar templates still consistent with its prefix, and may only
        be extended by a character whose CLASS the grammar allows next. The
        search therefore cannot emit a string the grammar rejects, and because
        it marginalises over CTC alignments it tolerates the recogniser dropping
        or duplicating a character — which plain greedy decoding does not.

        Returns ("", 0.0) when no beam reaches a complete template, so the
        caller can fall back to greedy rather than accept a truncated read.
        """
        templates = self.fmt.templates
        if not templates:
            return "", 0.0
        T = p.shape[0]
        lp = np.log(np.maximum(p, 1e-12))
        all_tpl = frozenset(range(len(templates)))
        # key -> [log P(prefix, ends in blank), log P(prefix, ends in symbol)]
        beams: Dict[Tuple[str, frozenset], List[float]] = {("", all_tpl): [0.0, _NEG]}

        for t in range(T):
            nxt: Dict[Tuple[str, frozenset], List[float]] = {}

            def bump(key, slot, val):
                e = nxt.get(key)
                if e is None:
                    e = [_NEG, _NEG]
                    nxt[key] = e
                a = e[slot]
                if val > a:
                    e[slot] = val + math.log1p(math.exp(a - val)) if a > _NEG else val
                elif a > _NEG:
                    e[slot] = a + math.log1p(math.exp(val - a))

            ranked = sorted(beams.items(),
                            key=lambda kv: -max(kv[1][0], kv[1][1]))[:beam_width]
            for (pref, alive), (pb, pnb) in ranked:
                tot = pb if pnb == _NEG else (pnb if pb == _NEG else
                                              max(pb, pnb) + math.log1p(
                                                  math.exp(-abs(pb - pnb))))
                bump((pref, alive), 0, tot + lp[t, 0])
                if pref:
                    bump((pref, alive), 1, pnb + lp[t, self._cidx[pref[-1]]])

                pos = len(pref)
                want = {templates[i][pos] for i in alive if pos < len(templates[i])}
                if not want:
                    continue
                pool: List[Tuple[str, int]] = []
                if "A" in want:
                    pool += self._alpha_idx
                if "D" in want:
                    pool += self._digit_idx
                for ch, ci in pool:
                    kind = "D" if ch.isdigit() else "A"
                    na = frozenset(i for i in alive
                                   if pos < len(templates[i]) and templates[i][pos] == kind)
                    if not na:
                        continue
                    src = pb if (pref and ch == pref[-1]) else tot
                    if src <= _NEG:
                        continue
                    bump((pref + ch, na), 1, src + lp[t, ci])

            if not nxt:
                break
            beams = nxt

        best, best_score = "", _NEG
        for (pref, alive), (pb, pnb) in beams.items():
            if not any(len(templates[i]) == len(pref) for i in alive):
                continue
            s = max(pb, pnb)
            if s > best_score:
                best_score, best = s, pref
        if not best:
            return "", 0.0
        # Per-character geometric mean, so short and long plates compare fairly.
        return best, float(math.exp(best_score / max(1, len(best))))

    def _decode(self, p: np.ndarray, beam_width: int) -> Tuple[str, float, bool, int]:
        """(text, confidence, valid, corrections) — grammar beam first, greedy
        plus confusion-correction as the fallback."""
        text, conf = self._beam_constrained(p, beam_width)
        if text:
            fixed, valid, subs = plate_format.correct(text, self.fmt)
            return fixed, conf, valid, subs
        raw, conf = self._greedy(p)
        if not raw:
            return "", 0.0, False, 0
        fixed, valid, subs = plate_format.correct(raw, self.fmt)
        return fixed, conf, valid, subs

    # -- public read --------------------------------------------------------
    def read_detailed(self, plate_bgr: np.ndarray,
                      debug_sink: Optional[Dict[str, np.ndarray]] = None) -> OCRResult:
        """Read one plate crop. Never raises.

        Tries preprocessing variants in order and keeps the best-scoring read,
        stopping early once a variant produces a grammar-valid read above
        `ANPR_OCR_EARLY_EXIT_CONF` — the common case, and the reason the
        ensemble is affordable inside the real-time loop.

        `debug_sink`, when given, collects the intermediate images so the caller
        can persist them without this function knowing anything about the disk.
        """
        t_start = time.time()
        if plate_bgr is None or plate_bgr.size == 0:
            return OCRResult(reason=FAIL_EMPTY_CROP)
        h, w = plate_bgr.shape[:2]
        if w < config.ANPR_OCR_MIN_CROP_W or h < config.ANPR_OCR_MIN_CROP_H:
            self.stats["too_small"] += 1
            return OCRResult(reason=FAIL_TOO_SMALL)

        try:
            work = plate_bgr
            # Perspective first: every later step assumes a frontal plate.
            rect = rectify(work) if config.ANPR_OCR_RECTIFY else None
            if rect is not None and rect.size:
                work = rect
                if debug_sink is not None:
                    debug_sink["rectified"] = rect.copy()

            gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY) if work.ndim == 3 else work
            sharp = blur_score(gray)
            if sharp < config.ANPR_BLUR_MIN:
                self.stats["blurry"] += 1
                return OCRResult(reason=FAIL_BLURRY,
                                 elapsed_ms=(time.time() - t_start) * 1000)
            if config.ANPR_OCR_DESKEW:
                gray = deskew(gray)

            candidates: List[Tuple[float, str, str, bool, int]] = []
            beam_w = int(config.ANPR_OCR_BEAM_WIDTH)
            max_variants = max(1, int(config.ANPR_OCR_MAX_VARIANTS))
            early = float(config.ANPR_OCR_EARLY_EXIT_CONF)

            for vi, (vname, fn) in enumerate(_VARIANT_ORDER):
                if vi >= max_variants:
                    break
                try:
                    proc = fn(gray)
                except cv2.error:
                    continue
                tensor = self._letterbox(proc)
                if debug_sink is not None:
                    debug_sink[f"variant_{vname}"] = tensor.copy()
                p = self._probs(tensor)
                text, conf, valid, subs = self._decode(p, beam_w)
                if text:
                    # A grammar-valid read is worth more than a higher raw
                    # confidence on an impossible string — the recogniser is
                    # confidently wrong often enough that confidence alone is
                    # not a safe ranking key (measured ~0.89 on wrong reads).
                    score = conf + (0.25 if valid else 0.0) - 0.01 * subs
                    candidates.append((score, text, vname, valid, subs))
                    if valid and conf >= early:
                        break
                self.stats[f"variant_{vname}"] += 1

            # Two-row plates: a single-line recogniser reads straight across
            # both rows. Try a split whenever the crop is too tall to be a
            # one-row plate, and let it compete on score.
            aspect = w / max(1, h)
            if config.ANPR_OCR_TWO_ROW and aspect < config.ANPR_TWO_ROW_ASPECT:
                rows = split_rows(work)
                if rows:
                    parts, confs, ok = [], [], True
                    for r in rows:
                        rg = cv2.cvtColor(r, cv2.COLOR_BGR2GRAY) if r.ndim == 3 else r
                        if rg.shape[0] < 8:
                            ok = False
                            break
                        rp = self._probs(self._letterbox(_Variants.clahe_sharp(rg)))
                        rt, rc = self._greedy(rp)
                        parts.append(plate_format.normalise(rt))
                        confs.append(rc)
                    if ok and parts:
                        joined = "".join(parts)
                        fixed, valid, subs = plate_format.correct(joined, self.fmt)
                        c = float(np.mean(confs)) if confs else 0.0
                        if fixed:
                            candidates.append((c + (0.25 if valid else 0.0) - 0.01 * subs,
                                               fixed, "two_row", valid, subs))
                        if debug_sink is not None:
                            debug_sink["two_row_top"] = rows[0].copy()
                            debug_sink["two_row_bottom"] = rows[1].copy()

            elapsed = (time.time() - t_start) * 1000
            if not candidates:
                self.stats["no_text"] += 1
                return OCRResult(reason=FAIL_NO_TEXT, elapsed_ms=elapsed)

            candidates.sort(key=lambda c: c[0], reverse=True)
            score, text, vname, valid, subs = candidates[0]
            # Recover the plain confidence from the ranking score.
            conf = score - (0.25 if valid else 0.0) + 0.01 * subs

            if len(text) < config.ANPR_OCR_MIN_LEN:
                self.stats["too_short"] += 1
                return OCRResult(raw_text=text, confidence=conf, variant=vname,
                                 reason=FAIL_NO_TEXT, elapsed_ms=elapsed)
            if conf < config.ANPR_OCR_MIN_CONF:
                self.stats["low_conf"] += 1
                return OCRResult(raw_text=text, confidence=conf, variant=vname,
                                 valid=valid, corrections=subs,
                                 reason=FAIL_LOW_CONF, elapsed_ms=elapsed)
            if config.ANPR_REQUIRE_VALID_FORMAT and not valid:
                self.stats["invalid_format"] += 1
                return OCRResult(raw_text=text, confidence=conf, variant=vname,
                                 valid=False, corrections=subs,
                                 reason=FAIL_INVALID, elapsed_ms=elapsed)

            self.stats["ok"] += 1
            return OCRResult(text=text, confidence=conf, raw_text=text, variant=vname,
                             valid=valid, corrections=subs, elapsed_ms=elapsed)

        except Exception as e:                       # fail-safe: never break the pipeline
            self.last_error = str(e)
            self.stats["error"] += 1
            return OCRResult(reason=FAIL_MODEL, elapsed_ms=(time.time() - t_start) * 1000)

    def read(self, plate_bgr: np.ndarray) -> Tuple[str, float]:
        """(plate_text, confidence). Backwards-compatible wrapper — returns
        ('', 0.0) on any failure, exactly as before."""
        r = self.read_detailed(plate_bgr)
        return r.text, r.confidence


_INSTANCE: Optional[PlateOCR] = None
_LOAD_FAILED = False
_LOAD_LOCK = threading.Lock()


def is_loaded() -> bool:
    return _INSTANCE is not None


def unload() -> bool:
    global _INSTANCE, _LOAD_FAILED
    with _LOAD_LOCK:
        if _INSTANCE is None:
            return False
        _INSTANCE = None
        _LOAD_FAILED = False
    print("[anpr-ocr] CRNN unloaded", flush=True)
    return True


def get_recognizer() -> Optional[PlateOCR]:
    """Process-wide singleton, or None (once, loudly) if OCR is disabled or the
    model/charset is missing — plate localisation then runs without text."""
    global _INSTANCE, _LOAD_FAILED
    if not (config.ANPR_ENABLED and config.ANPR_OCR_ENABLED):
        return None
    with _LOAD_LOCK:
        if _INSTANCE is not None:
            return _INSTANCE
        if _LOAD_FAILED:
            return None
        model = _resolve(config.ANPR_OCR_MODEL)
        charset = _resolve(config.ANPR_OCR_CHARSET)
        if not model or not charset:
            _LOAD_FAILED = True
            missing = "model" if not model else "charset"
            print(f"[anpr-ocr] {config.ANPR_OCR_MODEL if not model else config.ANPR_OCR_CHARSET} "
                  f"({missing}) not found in {_candidate_dirs()} — plates are "
                  "localised but not read. OCR disabled; CamAI continues.", flush=True)
            return None
        try:
            _INSTANCE = PlateOCR(model, charset)
            return _INSTANCE
        except Exception as e:
            _LOAD_FAILED = True
            print(f"[anpr-ocr] failed to load CRNN: {e} — OCR disabled, CamAI continues.",
                  flush=True)
            return None


# Kept for callers that imported these before the rewrite.
def normalise_plate(text: str) -> str:
    return plate_format.normalise(text)


def ctc_greedy_decode(output: np.ndarray, charset: str) -> Tuple[str, float]:
    """Standalone greedy CTC decode over a [T,1,C]/[1,T,C]/[T,C] tensor.
    Retained as a module-level helper for tests and tooling."""
    arr = np.asarray(output, dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[:, 0, :] if arr.shape[1] == 1 else arr[0]
    if arr.ndim != 2:
        return "", 0.0
    z = arr - arr.max(axis=1, keepdims=True)
    probs = np.exp(z)
    probs /= np.maximum(probs.sum(axis=1, keepdims=True), 1e-12)
    idxs = probs.argmax(axis=1)
    conf_per_t = probs[np.arange(len(idxs)), idxs]
    chars: List[str] = []
    confs: List[float] = []
    prev = -1
    for t, idx in enumerate(idxs):
        if idx != prev and idx != 0:
            ci = int(idx) - 1
            if 0 <= ci < len(charset):
                chars.append(charset[ci])
                confs.append(float(conf_per_t[t]))
        prev = int(idx)
    if not chars:
        return "", 0.0
    return "".join(chars), float(np.mean(confs))
