"""Per-vehicle-track plate aggregation: vote across frames, publish once.

Why voting rather than trusting a frame
---------------------------------------
A vehicle is in view for tens of frames, and the recogniser's errors are not
correlated across them — a glyph misread under one blur/glare condition is
usually read correctly two frames later. Single-frame reads on the shipped
recogniser are wrong far more often than they are right (docs/ANPR.md), but the
CORRECT string is still the most frequent single answer across a track. Voting
converts that into a usable read, and nothing else in this pipeline gives a
comparable accuracy gain for free.

It also solves three requirements at once:
  * no duplicate entries — a track publishes its winner once, and re-publishes
    only if the winner actually changes;
  * no wasted OCR — once a track is SETTLED (enough agreeing votes at enough
    confidence) OCR is skipped for that vehicle entirely, which is the main
    reason ANPR stays affordable on a busy road;
  * "read the same plate only once unless it changes" — exactly `publish()`.

Votes are confidence-weighted and near-duplicate candidates are merged at edit
distance 1, so 'MH12AB1234' and 'MH12AB1284' reinforce one entry instead of
splitting the vote between two.
"""
from __future__ import annotations

import threading
import time
from typing import Dict, List, Optional, Tuple

from app import config
from app.ai import plate_format


def edit_distance(a: str, b: str, cap: int = 3) -> int:
    """Levenshtein with an early bail — we only ever care whether two reads are
    within a character or two of each other."""
    if a == b:
        return 0
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        best = cur[0]
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            best = min(best, cur[j])
        if best > cap:
            return cap + 1
        prev = cur
    return prev[len(b)]


class _TrackState:
    __slots__ = ("votes", "conf_sum", "best_conf", "reads", "first_seen",
                 "last_seen", "published", "published_at", "last_fail")

    def __init__(self, now: float):
        self.votes: Dict[str, float] = {}       # text -> confidence-weighted score
        self.conf_sum: Dict[str, float] = {}
        self.best_conf: Dict[str, float] = {}
        self.reads: int = 0
        self.first_seen: float = now
        self.last_seen: float = now
        self.published: Optional[str] = None
        self.published_at: float = 0.0
        self.last_fail: Optional[str] = None

    def winner(self) -> Optional[Tuple[str, float, float]]:
        """(text, score, best_confidence_seen) of the leading candidate."""
        if not self.votes:
            return None
        t = max(self.votes, key=lambda k: self.votes[k])
        return t, self.votes[t], self.best_conf.get(t, 0.0)


class PlateTracker:
    """Thread-safe. One instance per camera pipeline."""

    def __init__(self) -> None:
        self._tracks: Dict[int, _TrackState] = {}
        self._lock = threading.Lock()
        self.fmt = plate_format.get_format(config.ANPR_COUNTRY)

    # -- observation --------------------------------------------------------
    def observe(self, track_id: int, text: str, confidence: float,
                valid: bool, now: Optional[float] = None) -> None:
        """Record one read for a vehicle track.

        A grammar-valid read counts for more than an invalid one of the same
        confidence — the recogniser is confidently wrong often enough that
        confidence alone is not a safe weight.
        """
        if track_id is None or not text:
            return
        now = time.time() if now is None else now
        weight = max(0.05, float(confidence)) * (1.6 if valid else 1.0)
        with self._lock:
            st = self._tracks.get(track_id)
            if st is None:
                st = self._tracks[track_id] = _TrackState(now)
            st.last_seen = now
            st.reads += 1
            # Merge into an existing near-identical candidate so one plate does
            # not split its vote across two spellings.
            key = text
            for cand in st.votes:
                if edit_distance(cand, text, cap=1) <= 1:
                    key = cand if st.votes[cand] >= weight else text
                    if key != cand:                       # promote the new spelling
                        st.votes[key] = st.votes.pop(cand)
                        st.conf_sum[key] = st.conf_sum.pop(cand, 0.0)
                        st.best_conf[key] = st.best_conf.pop(cand, 0.0)
                    break
            st.votes[key] = st.votes.get(key, 0.0) + weight
            st.conf_sum[key] = st.conf_sum.get(key, 0.0) + float(confidence)
            st.best_conf[key] = max(st.best_conf.get(key, 0.0), float(confidence))

    def observe_failure(self, track_id: int, reason: str,
                        now: Optional[float] = None) -> None:
        """Record that a track was looked at but produced no usable read, so
        telemetry can say WHY a visible vehicle has no plate."""
        if track_id is None:
            return
        now = time.time() if now is None else now
        with self._lock:
            st = self._tracks.get(track_id)
            if st is None:
                st = self._tracks[track_id] = _TrackState(now)
            st.last_seen = now
            st.last_fail = reason

    def touch(self, track_id: int, now: Optional[float] = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            st = self._tracks.get(track_id)
            if st is not None:
                st.last_seen = now

    # -- queries ------------------------------------------------------------
    def is_settled(self, track_id: int) -> bool:
        """True when this track's plate is decided and OCR can be skipped.

        This is the cache the spec asks for: a settled vehicle is never OCR'd
        again while it stays in view.
        """
        with self._lock:
            st = self._tracks.get(track_id)
            if st is None:
                return False
            w = st.winner()
            if w is None:
                return False
            _text, score, best_conf = w
            return (score >= config.ANPR_TRACK_SETTLE_VOTES * 0.5
                    and best_conf >= config.ANPR_TRACK_SETTLE_CONF)

    def best(self, track_id: int) -> Optional[Tuple[str, float, int]]:
        """(text, confidence, reads) for a track, or None. Confidence reported
        is the best single-frame confidence behind the winning candidate."""
        with self._lock:
            st = self._tracks.get(track_id)
            if st is None:
                return None
            w = st.winner()
            if w is None:
                return None
            text, _score, best_conf = w
            return text, best_conf, st.reads

    def last_failure(self, track_id: int) -> Optional[str]:
        with self._lock:
            st = self._tracks.get(track_id)
            return st.last_fail if st else None

    # -- publication --------------------------------------------------------
    def publish(self, track_id: int) -> Optional[Tuple[str, float]]:
        """Return the plate to emit as an EVENT for this track, or None.

        Returns a value only the first time a track's winner becomes reliable,
        and again only if the winner subsequently CHANGES. That is what keeps
        the event log free of duplicates without relying on a time cooldown.
        """
        with self._lock:
            st = self._tracks.get(track_id)
            if st is None:
                return None
            w = st.winner()
            if w is None:
                return None
            text, score, best_conf = w
            if st.reads < config.ANPR_TRACK_MIN_READS:
                return None
            if best_conf < config.ANPR_OCR_MIN_CONF:
                return None
            if st.published == text:
                return None
            st.published = text
            st.published_at = time.time()
            return text, best_conf

    # -- housekeeping -------------------------------------------------------
    def prune(self, now: Optional[float] = None) -> int:
        """Drop tracks not seen for ANPR_TRACK_TTL_S. Called from the ANPR pass;
        without it a long-running camera accumulates one entry per vehicle that
        ever drove past."""
        now = time.time() if now is None else now
        ttl = float(config.ANPR_TRACK_TTL_S)
        with self._lock:
            dead = [k for k, st in self._tracks.items() if now - st.last_seen > ttl]
            for k in dead:
                del self._tracks[k]
        return len(dead)

    def snapshot(self) -> List[Dict[str, object]]:
        """Current per-track state, for telemetry and debugging."""
        with self._lock:
            out = []
            for tid, st in self._tracks.items():
                w = st.winner()
                out.append({
                    "track_id": tid,
                    "plate": w[0] if w else None,
                    "confidence": round(w[2], 3) if w else 0.0,
                    "reads": st.reads,
                    "candidates": len(st.votes),
                    "published": st.published,
                    "last_failure": st.last_fail,
                })
            return out

    def stats(self) -> Dict[str, int]:
        with self._lock:
            settled = 0
            for st in self._tracks.values():
                w = st.winner()
                if w and w[1] >= config.ANPR_TRACK_SETTLE_VOTES * 0.5 \
                        and w[2] >= config.ANPR_TRACK_SETTLE_CONF:
                    settled += 1
            return {"tracks": len(self._tracks), "settled": settled,
                    "published": sum(1 for s in self._tracks.values() if s.published)}
