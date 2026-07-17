"""Zone profile behaviour — the contract the engine has to keep.

These pin the three things that were actually broken, each of which shipped for
a long time looking fine:

  1. the profile filter never reached the client. CameraAnalytics.update()
     rebound its local `detections` name, which never mutated the caller's list,
     and pipeline.py builds client_dets AFTER that call — so a traffic camera
     still sent person and handbag boxes to the overlay while analytics quietly
     ignored them.
  2. feature toggles did nothing. person_detection / vehicle_detection /
     worker_detection appeared nowhere in the engine at all, so turning Vehicle
     Detection off left every car boxed.
  3. profiles listed classes nothing could produce (fire, smoke, helmet), which
     is how the UI came to advertise detectors that did not exist.

So the assertions here are mostly "this class does NOT come out" — absence is
the whole point, and absence is what silently regresses.
"""
import pytest

from app.ai.backend import COCO_CLASS_MAP
from app.analytics import (
    FEATURE_CLASSES,
    PROFILE_CLASSES,
    filter_by_features,
    filter_by_profile,
)


def det(cls, conf=0.9):
    return {"class": cls, "confidence": conf, "bbox": {"x1": 10, "y1": 10, "x2": 50, "y2": 90}}


SCENE = [det("person"), det("car"), det("bus"), det("handbag"), det("face")]


def classes_of(dets):
    return sorted({d["class"] for d in dets})


# --------------------------------------------------------------------------
# 1. Profiles narrow what the camera reports
# --------------------------------------------------------------------------

def test_traffic_reports_vehicles_and_drops_people():
    out = classes_of(filter_by_profile(SCENE, "traffic"))
    assert "bus" in out and "car" in out
    assert "person" not in out, "a traffic camera must not report people"
    assert "handbag" not in out
    assert "face" not in out


def test_security_reports_people_and_drops_vehicles():
    out = classes_of(filter_by_profile(SCENE, "security"))
    assert "person" in out and "handbag" in out and "face" in out
    assert "car" not in out and "bus" not in out


def test_factory_reports_only_people_and_faces():
    assert classes_of(filter_by_profile(SCENE, "factory")) == ["face", "person"]


@pytest.mark.parametrize("profile", ["custom", None])
def test_custom_and_unset_do_not_narrow(profile):
    assert classes_of(filter_by_profile(SCENE, profile)) == classes_of(SCENE)


# --------------------------------------------------------------------------
# 2. Every class a profile promises must be producible
#
# This is the guard against the UI advertising a detector that does not exist.
# "fire"/"smoke"/"helmet" were once listed here while nothing could emit them.
# --------------------------------------------------------------------------

def test_profiles_only_promise_classes_something_can_produce():
    producible = set(COCO_CLASS_MAP.values()) | {"face"}  # face comes from YuNet
    for profile, allowed in PROFILE_CLASSES.items():
        unproducible = set(allowed) - producible
        assert not unproducible, (
            f"profile {profile!r} lists {sorted(unproducible)}, which no model emits — "
            "the camera would advertise a capability that can never appear"
        )


def test_feature_class_map_only_references_producible_classes():
    producible = set(COCO_CLASS_MAP.values()) | {"face"}
    for feature, owned in FEATURE_CLASSES.items():
        unproducible = set(owned) - producible
        assert not unproducible, f"feature {feature!r} claims {sorted(unproducible)}"


# --------------------------------------------------------------------------
# 3. Feature toggles actually gate output
# --------------------------------------------------------------------------

def on(*keys):
    return {k: {"enabled": True} for k in keys}


def off(*keys):
    return {k: {"enabled": False} for k in keys}


def test_no_config_drops_nothing():
    assert classes_of(filter_by_features(SCENE, {})) == classes_of(SCENE)


def test_vehicle_detection_off_removes_vehicles_only():
    out = classes_of(filter_by_features(SCENE, off("vehicle_detection")))
    assert "car" not in out and "bus" not in out
    assert "person" in out and "handbag" in out and "face" in out


def test_person_detection_off_removes_people_only():
    out = classes_of(filter_by_features(SCENE, off("person_detection")))
    assert "person" not in out
    assert "car" in out and "bus" in out


def test_a_class_survives_if_any_owning_feature_is_on():
    """vehicle_detection and vehicle_classification both own the vehicle
    classes. Turning classification off must not blind the camera to cars —
    a naive "any owner off => drop" rule would do exactly that."""
    out = classes_of(filter_by_features(SCENE, {**on("vehicle_detection"), **off("vehicle_classification")}))
    assert "car" in out and "bus" in out


def test_profile_and_features_both_apply():
    feats = off("vehicle_detection")
    out = classes_of(filter_by_profile(filter_by_features(SCENE, feats), "security"))
    assert out == ["face", "handbag", "person"]


# --------------------------------------------------------------------------
# 4. Robustness — malformed input must not take the pipeline down
# --------------------------------------------------------------------------

def test_filters_tolerate_missing_and_odd_values():
    junk = [{"class": "person"}, {}, {"class": None}, {"class": "car"}]
    # Neither filter may raise; unknown/None classes simply don't match.
    assert classes_of(filter_by_profile(junk, "traffic")) == ["car"]
    assert filter_by_features(junk, off("person_detection")) is not None
    assert filter_by_features(junk, None) == junk
    assert filter_by_profile([], "traffic") == []
