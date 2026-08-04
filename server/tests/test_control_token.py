"""Brute-force lockout on the X-CamAI-Token check (server/app/main.py).

The token check itself was already constant-time (hmac.compare_digest), but
nothing stopped a local process from simply guessing tokens in a loop — the
check allowed unlimited attempts. require_control_token now trips a short
lockout after too many wrong tokens in a window, throttling a guessing loop
without affecting the desktop app (which sends the right token on every call
and never approaches the threshold).
"""
import pytest
from fastapi import HTTPException

from app import main


@pytest.fixture(autouse=True)
def _isolated_lockout_state(monkeypatch):
    """Each test gets a fresh failure window/lockout and a real token set."""
    monkeypatch.setattr(main, "API_TOKEN", "s3cr3t-token")
    monkeypatch.setattr(main, "_token_lockout_until", 0.0)
    main._token_fail_times.clear()
    yield
    main._token_fail_times.clear()


def test_correct_token_passes():
    main.require_control_token(x_camai_token="s3cr3t-token")


def test_wrong_token_is_rejected_with_403():
    with pytest.raises(HTTPException) as exc:
        main.require_control_token(x_camai_token="guess")
    assert exc.value.status_code == 403


def test_unset_token_disables_the_check(monkeypatch):
    monkeypatch.setattr(main, "API_TOKEN", "")
    main.require_control_token(x_camai_token="anything")  # must not raise


def test_repeated_wrong_tokens_trip_a_lockout():
    for _ in range(main._TOKEN_FAIL_MAX - 1):
        with pytest.raises(HTTPException) as exc:
            main.require_control_token(x_camai_token="guess")
        assert exc.value.status_code == 403

    # The Nth failure trips the lockout (still reported as a wrong-token 403).
    with pytest.raises(HTTPException) as exc:
        main.require_control_token(x_camai_token="guess")
    assert exc.value.status_code == 403

    # Now even the CORRECT token is rejected until the lockout expires.
    with pytest.raises(HTTPException) as exc:
        main.require_control_token(x_camai_token="s3cr3t-token")
    assert exc.value.status_code == 429


def test_lockout_expires_and_normal_service_resumes(monkeypatch):
    monkeypatch.setattr(main, "_token_lockout_until", 0.0)
    for _ in range(main._TOKEN_FAIL_MAX):
        with pytest.raises(HTTPException):
            main.require_control_token(x_camai_token="guess")
    assert main._token_lockout_until > 0.0

    # Simulate the lockout window having already passed.
    monkeypatch.setattr(main, "_token_lockout_until", 0.0)
    main.require_control_token(x_camai_token="s3cr3t-token")  # must not raise


def test_failure_window_forgets_old_attempts(monkeypatch):
    """Old failures outside the window must not count toward the threshold -
    otherwise a handful of stray bad calls days apart would eventually lock
    out a perfectly healthy engine."""
    real_time = main.time.time
    t = [1_000_000.0]
    monkeypatch.setattr(main.time, "time", lambda: t[0])

    for _ in range(main._TOKEN_FAIL_MAX - 1):
        with pytest.raises(HTTPException):
            main.require_control_token(x_camai_token="guess")

    # Jump well past the failure window - the old attempts should age out.
    t[0] += main._TOKEN_FAIL_WINDOW_S + 1.0
    with pytest.raises(HTTPException) as exc:
        main.require_control_token(x_camai_token="guess")
    assert exc.value.status_code == 403  # not 429 - lockout must not have tripped
