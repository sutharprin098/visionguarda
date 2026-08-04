"""ANPR OCR stage (server/app/ai/plate_ocr.py).

No CRNN weights ship, so we unit-test the risky logic: CTC greedy decode,
charset loading, plate normalisation, and read() end-to-end against a fake ORT
session (min-length rejection). Real OCR accuracy needs the CRNN model.
"""
import numpy as np
import pytest

from app.ai import plate_ocr as O

CHARSET = "0123456789abcdefghijklmnopqrstuvwxyz"   # EN_36, class = index+1 (0=blank)
C = len(CHARSET) + 1


def cls(ch):
    return CHARSET.index(ch) + 1


def out_from(idxs):
    """[T,1,C] logits that argmax to the given class indices per timestep."""
    o = np.full((len(idxs), 1, C), -10.0, np.float32)
    for t, idx in enumerate(idxs):
        o[t, 0, idx] = 10.0
    return o


def test_ctc_decode_basic_string():
    idxs = [cls("m"), cls("m"), 0, cls("h"), cls("1"), cls("2"), 0]  # m,m,blank,h,1,2
    text, conf = O.ctc_greedy_decode(out_from(idxs), CHARSET)
    assert text == "mh12"          # adjacent m collapsed, blanks dropped
    assert conf > 0.9              # chosen logits are dominant


def test_ctc_blank_separates_double_letter():
    # 'a', blank, 'a' must decode to "aa" (blank resets the collapse).
    text, _ = O.ctc_greedy_decode(out_from([cls("a"), 0, cls("a")]), CHARSET)
    assert text == "aa"


def test_ctc_all_blank_is_empty():
    text, conf = O.ctc_greedy_decode(out_from([0, 0, 0]), CHARSET)
    assert text == "" and conf == 0.0


def test_ctc_handles_2d_and_batched_shapes():
    idxs = [cls("k"), cls("a")]
    base = out_from(idxs)
    assert O.ctc_greedy_decode(base[:, 0, :], CHARSET)[0] == "ka"          # [T,C]
    assert O.ctc_greedy_decode(base.transpose(1, 0, 2), CHARSET)[0] == "ka"  # [1,T,C]


def test_normalise_plate_uppercases_and_strips():
    assert O.normalise_plate("mh-12 ab#1234") == "MH12AB1234"
    assert O.normalise_plate("dl!3c@a1") == "DL3CA1"


def test_load_charset_single_line(tmp_path):
    f = tmp_path / "charset.txt"
    f.write_text(CHARSET + "\n")
    assert O._load_charset(str(f)) == CHARSET


def test_load_charset_one_char_per_line(tmp_path):
    f = tmp_path / "charset.txt"
    f.write_text("\n".join(CHARSET) + "\n")
    assert O._load_charset(str(f)) == CHARSET


class _FakeSession:
    def __init__(self, output, in_name="input", channels=1):
        self._output = output
        self._in_name = in_name
        self._channels = channels

    def get_inputs(self):
        class _I:
            name = "input"
            shape = [1, 1, 32, 100]
        return [_I()]

    def run(self, _outnames, _feed):
        return [self._output]


def _ocr_with(output, min_len=4):
    """A PlateOCR wired to a fake session (no real model)."""
    o = O.PlateOCR.__new__(O.PlateOCR)
    o.charset = CHARSET
    o.charset_u = CHARSET.upper()
    o.last_error = None
    o.last_infer_ms = 0.0
    import threading
    from collections import defaultdict
    o._lock = threading.Lock()
    o.stats = defaultdict(int)
    o.session = _FakeSession(output)
    o._in_name = "input"
    o._channels = 1
    o._in_h = 32
    o._in_w = 100
    o.fmt = O.plate_format.get_format(O.config.ANPR_COUNTRY)
    o._cidx = {c: i + 1 for i, c in enumerate(o.charset_u)}
    o._alpha_idx = [(c, i + 1) for i, c in enumerate(o.charset_u) if c.isalpha()]
    o._digit_idx = [(c, i + 1) for i, c in enumerate(o.charset_u) if c.isdigit()]
    return o


def test_read_returns_normalised_plate(monkeypatch):
    monkeypatch.setattr(O.config, "ANPR_OCR_MIN_LEN", 4)
    # A synthetic all-black crop has zero edge content, i.e. it is "blurry" by
    # the Laplacian-variance blur gate - irrelevant to what this test is
    # actually exercising (the CTC-decode -> normalise pipeline), so disable
    # that gate here rather than fabricate texture in the test image.
    monkeypatch.setattr(O.config, "ANPR_BLUR_MIN", -1.0)
    # "mh12ab" isn't a grammar-valid plate for any configured country format
    # (real plates are longer) - this test is exercising CTC-decode ->
    # normalise, not country-grammar validation, so don't gate on it here.
    monkeypatch.setattr(O.config, "ANPR_REQUIRE_VALID_FORMAT", False)
    idxs = [cls("m"), cls("h"), cls("1"), cls("2"), cls("a"), cls("b")]
    ocr = _ocr_with(out_from(idxs))
    plate = np.zeros((30, 90, 3), np.uint8)
    text, conf = ocr.read(plate)
    assert text == "MH12AB" and conf > 0.9


def test_read_rejects_too_short(monkeypatch):
    monkeypatch.setattr(O.config, "ANPR_OCR_MIN_LEN", 4)
    ocr = _ocr_with(out_from([cls("a"), cls("b")]))   # only 2 chars
    text, conf = ocr.read(np.zeros((30, 90, 3), np.uint8))
    assert text == "" and conf == 0.0


def test_read_tolerates_empty_crop():
    ocr = _ocr_with(out_from([cls("a")]))
    assert ocr.read(np.zeros((0, 0, 3), np.uint8)) == ("", 0.0)
