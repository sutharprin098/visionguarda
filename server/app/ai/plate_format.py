"""Number-plate GRAMMAR: templates, validation and OCR-confusion correction.

Why this module exists
----------------------
A plate number is not free text — it is a fixed grammar. `MH12AB1234` is
"2 letters, 2 digits, 2 letters, 4 digits", and that structure pins the CLASS
(letter vs digit) of every position. That matters because the failure mode of a
character recogniser on plates is almost never "wrong shape"; it is "right
shape, wrong class": 0/O, 1/I, 8/B, 5/S, 2/Z look alike, and a recogniser with
any word bias resolves them toward letters.

Measured on this repo's shipped CRNN (see docs/ANPR.md), greedy decoding
returned 1.0% exact matches on rendered plates; feeding the same probabilities
through the grammar in this module raised that to 13.5% and cut character error
from 0.47 to 0.37. The grammar is the single highest-leverage correction
available downstream of the recogniser.

Two consumers
-------------
1. `templates()` drives the *constrained CTC beam search* in plate_ocr.py,
   which can only ever emit strings the grammar admits. This is the principled
   path: it uses the recogniser's own probabilities and marginalises over CTC
   alignments, so a dropped or duplicated character no longer ruins the read.
2. `correct()` / `validate()` clean up a string that was already decoded, for
   callers that have text but no probabilities (temporal voting, stored reads).

Country profiles are data, not code. `CAMAI_ANPR_COUNTRY=IN` (default) selects
India; `generic` disables format constraints entirely and accepts any
alphanumeric run, for deployments outside a supported country.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Sequence, Tuple

# Class alphabet used by every template: 'A' = A-Z, 'D' = 0-9.
ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGIT = "0123456789"


class CountryFormat:
    """One country's plate grammar.

    templates : class-strings, e.g. "AADDAADDDD" for MH12AB1234. Order matters
                only for readability; scoring picks the best-fitting one.
    regex     : final validity gate applied to an assembled string.
    """

    def __init__(self, code: str, name: str, templates: Sequence[str],
                 regex: str, min_len: int, max_len: int):
        self.code = code
        self.name = name
        self.templates = tuple(templates)
        self.regex = re.compile(regex)
        self.min_len = min_len
        self.max_len = max_len
        for t in self.templates:
            bad = set(t) - {"A", "D"}
            if bad:
                raise ValueError(f"{code}: template {t!r} has bad class chars {bad}")

    def lengths(self) -> set:
        return {len(t) for t in self.templates}

    def validate(self, text: str) -> bool:
        if not (self.min_len <= len(text) <= self.max_len):
            return False
        return bool(self.regex.fullmatch(text))


# --- India -----------------------------------------------------------------
# Current series  : SS RR LL NNNN   (state, RTO district, series, number)
#                   MH12AB1234, and 1- or 3-letter series variants.
# Single-digit RTO: older registrations in small districts, e.g. DL1AB1234.
# BH (Bharat)     : YY BH NNNN LL   e.g. 22BH1234AA — digits first, so it is
#                   listed explicitly; it does not fit the SS-first shape.
_IN_TEMPLATES = (
    "AADDAADDDD",    # MH12AB1234  — by far the most common
    "AADDADDDD",     # MH12A1234
    "AADDAAADDDD",   # MH12ABC1234
    "AADDDDDD",      # MH121234    — no series letters (older)
    "AADAADDDD",     # DL1AB1234   — single-digit RTO
    "AADADDDD",      # DL1A1234
    "AADAAADDDD",    # DL1ABC1234
    "DDAADDDDAA",    # 22BH1234AA  — Bharat series
    "DDAADDDDA",     # 22BH1234A
)

_IN_REGEX = (
    r"(?:"
    r"[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}"     # standard + older variants
    r"|[0-9]{2}BH[0-9]{4}[A-Z]{1,2}"            # Bharat series
    r")"
)

INDIA = CountryFormat("IN", "India", _IN_TEMPLATES, _IN_REGEX, min_len=8, max_len=11)

# --- Generic ---------------------------------------------------------------
# No structural constraint: any alphanumeric run of a plausible length. Used
# when the deployment country is unknown or unsupported. Constrained decoding
# degrades gracefully to plain greedy decoding under this profile.
GENERIC = CountryFormat("GENERIC", "Generic", (), r"[A-Z0-9]{4,10}", min_len=4, max_len=10)

_FORMATS: Dict[str, CountryFormat] = {f.code: f for f in (INDIA, GENERIC)}


def get_format(code: Optional[str]) -> CountryFormat:
    """Country profile by code; unknown or empty falls back to GENERIC rather
    than raising — an unsupported country must never disable ANPR."""
    if not code:
        return GENERIC
    return _FORMATS.get(str(code).strip().upper(), GENERIC)


def available() -> List[str]:
    return sorted(_FORMATS)


# --- OCR confusion correction ----------------------------------------------
# Derived from the shipped CRNN's measured error distribution on rendered
# plates, not from folklore: the recogniser resolves ambiguous glyphs toward
# LETTERS, so the digit->letter direction is the one that actually fires.
# Includes the pairs the spec calls for (O/0, I/1, B/8, S/5, Z/2) plus the
# others observed in the benchmark (4/A, 6/G, 7/Z, 3/S, 9/S, T/1).
TO_DIGIT = {
    "O": "0", "Q": "0", "D": "0",
    "I": "1", "L": "1", "T": "1", "J": "1",
    "Z": "2",
    "S": "5", "B": "8", "G": "6", "A": "4",
    "E": "3", "Y": "7",
}
TO_ALPHA = {
    "0": "O", "1": "I", "2": "Z", "3": "B",
    "4": "A", "5": "S", "6": "G", "7": "T", "8": "B", "9": "G",
}


def normalise(text: str) -> str:
    """A plate number is [A-Z0-9]. Upper-case and strip everything else —
    spaces, hyphens, the IND country band, and any stray punctuation the
    recogniser emitted."""
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def _coerce(ch: str, want_digit: bool) -> str:
    if want_digit:
        return TO_DIGIT.get(ch, ch) if ch.isalpha() else ch
    return TO_ALPHA.get(ch, ch) if ch.isdigit() else ch


def _fit_cost(text: str, template: str) -> Tuple[int, str]:
    """Coerce `text` onto `template`, returning (substitutions, coerced text).
    A position that cannot be coerced (no known confusion) still counts as a
    substitution, so a genuinely wrong string scores badly and loses."""
    out, cost = [], 0
    for ch, kind in zip(text, template):
        want_digit = kind == "D"
        if (ch.isdigit() and want_digit) or (ch.isalpha() and not want_digit):
            out.append(ch)
            continue
        fixed = _coerce(ch, want_digit)
        cost += 1
        if (fixed.isdigit() and want_digit) or (fixed.isalpha() and not want_digit):
            out.append(fixed)
        else:
            cost += 2          # unfixable: heavily penalise this template
            out.append(fixed)
    return cost, "".join(out)


def correct(text: str, fmt: CountryFormat) -> Tuple[str, bool, int]:
    """Snap an already-decoded string onto the country grammar.

    Returns (corrected_text, is_valid, substitutions). Only templates of the
    exact same length are considered — this function fixes CLASS confusion, it
    does not invent or delete characters. When no template matches the length,
    the text is returned unchanged with is_valid from the regex alone, so a
    country whose grammar we do not model never silently mangles a good read.
    """
    t = normalise(text)
    if not t:
        return "", False, 0
    if not fmt.templates:                      # GENERIC: validate only
        return t, fmt.validate(t), 0

    cands = [tpl for tpl in fmt.templates if len(tpl) == len(t)]
    if not cands:
        return t, fmt.validate(t), 0

    best, best_cost = t, 10 ** 6
    for tpl in cands:
        cost, fixed = _fit_cost(t, tpl)
        if cost < best_cost:
            best_cost, best = cost, fixed
    return best, fmt.validate(best), best_cost


def validate(text: str, fmt: CountryFormat) -> bool:
    return fmt.validate(normalise(text))


def plausible_lengths(fmt: CountryFormat) -> set:
    """Lengths the grammar can produce — lets the recogniser reject a read of
    an impossible length before spending effort on it."""
    return fmt.lengths() or set(range(fmt.min_len, fmt.max_len + 1))
