import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent

# Load server/.env into the process environment (no python-dotenv dependency;
# real environment variables win over file values).
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _key, _, _value = _line.partition("=")
        os.environ.setdefault(_key.strip(), _value.strip().strip('"').strip("'"))
# Support custom writable directory on the user's PC (e.g. AppData on Windows)
history_env = os.getenv("CAMAI_HISTORY_DIR")
if history_env:
    HISTORY_DIR = Path(history_env)
else:
    appdata = os.getenv("APPDATA")
    if appdata:
        HISTORY_DIR = Path(appdata) / "CamAI" / "history"
    else:
        # Fallback to home directory or base dir
        home = os.getenv("USERPROFILE") or os.getenv("HOME")
        if home:
            HISTORY_DIR = Path(home) / ".camai" / "history"
        else:
            HISTORY_DIR = BASE_DIR / "history"

RECORDINGS_DIR = HISTORY_DIR / "recordings"
DB_PATH = HISTORY_DIR / "db.sqlite"
UPLOADS_DIR = HISTORY_DIR / "uploads"
MODELS_DIR = HISTORY_DIR.parent / "models"

# Ensure directories exist
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# YOLO Settings
YOLO_MODEL = "yolox_tiny"
CONFIDENCE_THRESHOLD = 0.3
IOU_THRESHOLD = 0.5
INFERENCE_SIZE = 320  # Fast inference size

# --- Intel integrated-GPU static-shape pin ---------------------------------
# On an Intel iGPU (UHD/Iris) OpenVINO recompiles GPU kernels PER input shape,
# each compile costing 9-16s and emitting Intel-Graphics-Compiler ("CISA")
# kernel errors on some shapes. The engine's adaptive imgsz (320/640/960) and
# the multi-resolution tile ladder therefore triggered a continuous runtime
# compile storm: each new shape stalled the AI thread past the 20s watchdog,
# which restarted the pipeline, which recompiled — a self-inflicted crash loop
# (observed as "Engine crash looping / auto-restart paused").
#
# The fix is to compile ONE static input shape [1,3,S,S] on the iGPU: it
# compiles once, is disk-cached, runs faster than a dynamic-shape kernel, and
# never recompiles at runtime. This value is that S (must be a multiple of 32
# for the YOLOX head). 416 balances speed (~25ms) and recall on UHD-class
# hardware; drop to 320 (~15ms) for max FPS or raise to 512/640 for recall.
# Applies ONLY to OpenVINO GPU devices — CPU, CUDA and TensorRT keep dynamic
# shapes (they either compile per-shape cheaply or cache per-shape engines).
# (Parsed inline: the _env_int helper is defined further down this file.)
try:
    IGPU_STATIC_IMGSZ = int(os.getenv("CAMAI_IGPU_STATIC_IMGSZ", "416"))
except ValueError:
    IGPU_STATIC_IMGSZ = 416

# Background model benchmark: "auto" | "on" | "off".
#
# Three minutes after startup the engine compiles yolox_tiny/s/m as three
# additional backends on whatever device the live pipeline is already using, to
# produce an advisory "recommended model" readout. On a shared-silicon Intel
# iGPU those compiles contend directly with live camera inference. Measured on
# this machine (UHD-class iGPU, OpenVINO GPU, 8 camera threads), per-frame
# inference went from ~40ms to 87-116ms for the duration of the benchmark —
# a 2-3x latency hit on every camera, i.e. visibly worse tracking and FPS for
# several minutes on exactly the hardware that has the least headroom to spare.
# The engine's own comment below already noted 600-1700ms spikes from this.
#
# Nothing consumes the result to switch models — it is displayed in /api/status
# and never acted on — so on an iGPU this is paying a real recurring cost for a
# number no code reads. "auto" (default) therefore runs the benchmark everywhere
# EXCEPT a static-shape iGPU. Set "on" to force it (a dGPU/CPU box with headroom,
# where you want the numbers), "off" to disable it everywhere.
MODEL_BENCHMARK_MODE = os.getenv("CAMAI_MODEL_BENCHMARK", "auto").strip().lower()
if MODEL_BENCHMARK_MODE not in ("auto", "on", "off"):
    MODEL_BENCHMARK_MODE = "auto"

# --- GPU acceleration policy -----------------------------------------------
# When True, the engine REFUSES to start if a model silently falls back to CPU
# while the machine actually has a usable accelerator — it fails loud instead
# of degrading to a CPU-only pipeline (the "UI says GPU, util is 0%" failure
# mode). Default False so Intel/AMD boxes that accelerate via OpenVINO-GPU or
# DirectML (not CUDA) still boot normally; set CAMAI_REQUIRE_GPU=1 on an NVIDIA
# deployment to guarantee the CUDA/TensorRT path is genuinely in use.
REQUIRE_GPU = os.getenv("CAMAI_REQUIRE_GPU", "").strip().lower() in ("1", "true", "yes", "on")

# --- MJPEG preview -----------------------------------------------------------
# The preview JPEG encode is the single most expensive thing the pipeline does
# outside inference: profiled at 25% of total engine CPU (cv2.imencode in
# _decode_loop), versus 12% for inference itself, because it ran on every
# decoded frame at full camera FPS for every camera — whether or not a single
# client had ever opened that camera's /stream.
#
# Two bounds now apply, and both matter:
#   * Nobody watching -> no encode at all (viewer ref-count, see
#     PipelineCoordinator.mjpeg_viewer_attached). This is where essentially all
#     of the saving comes from, and it costs the operator nothing.
#   * Somebody watching -> encode at most MJPEG_MAX_FPS.
#
# The cap is deliberately set ABOVE normal camera rates rather than below them.
# It was briefly 15, which is a real saving on paper and visibly choppy in
# practice: a fullscreen live view of moving traffic at 15fps reads as lag, and
# "the preview is not real time" is a worse bug than "the preview costs CPU".
# So this now only bounds pathological sources (50/60fps cameras) and leaves
# every ordinary 25/30fps camera untouched.
#
# Set CAMAI_MJPEG_MAX_FPS=0 to disable the cap entirely, or lower it on a
# machine running many cameras where preview smoothness matters less than CPU.
MJPEG_MAX_FPS = float(os.getenv("CAMAI_MJPEG_MAX_FPS", "30"))

# Recording settings
RECORDING_FPS = 10
RECORDING_WIDTH = 640
RECORDING_HEIGHT = 480
SEGMENT_DURATION_SECS = 600  # 10 minute segments for continuous recording
PRE_EVENT_BUFFER_SECS = 5    # seconds to keep in pre-event circular buffer
POST_EVENT_RECORD_SECS = 5   # seconds to keep recording after event ends

# --- Helmet detection (RT-DETR, Apache-2.0) --------------------------------
# All knobs are env-overridable with safe defaults; no absolute path is baked
# in. The model + its classes.txt live under MODELS_DIR/helmet by default
# (e.g. %APPDATA%/CamAI/models/helmet/rtdetr_helmet.onnx), which is writable and
# per-user. HELMET_ENABLED is a global kill-switch independent of the per-camera
# zone-profile toggle — both must be on (and the model present) for helmet
# inference to run.
def _env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")

def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "")) if os.getenv(name) else default
    except ValueError:
        return default

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "")) if os.getenv(name) else default
    except ValueError:
        return default

HELMET_ENABLED = _env_bool("CAMAI_HELMET_ENABLED", True)
HELMET_MODEL_DIR = Path(os.getenv("CAMAI_HELMET_MODEL_DIR", str(MODELS_DIR / "helmet")))
# Filename resolved under HELMET_MODEL_DIR, or an absolute path if given.
HELMET_MODEL = os.getenv("CAMAI_HELMET_MODEL", "rtdetr_helmet.onnx")
HELMET_CLASSES_FILE = os.getenv("CAMAI_HELMET_CLASSES", "classes.txt")
HELMET_THRESHOLD = _env_float("CAMAI_HELMET_THRESHOLD", 0.35)
HELMET_NMS = _env_float("CAMAI_HELMET_NMS", 0.45)
HELMET_INPUT_SIZE = _env_int("CAMAI_HELMET_INPUT_SIZE", 640)
HELMET_COOLDOWN = _env_float("CAMAI_HELMET_COOLDOWN", 15.0)
# Submit a frame to the helmet worker at most this often (seconds). A helmet
# doesn't change frame-to-frame, so there is nothing to gain from a higher rate.
# This is now a SUBMIT cadence, not an inline throttle: the pass itself runs on
# app/ai/helmet_worker.py, off the tracking thread. As an inline throttle it was
# ineffective by construction — a tracking iteration that ran the helmet pass
# took ~850ms, far longer than the 0.3s interval, so the interval had already
# elapsed by the time the next iteration began and the pass ran every frame
# anyway, pinning tracking at ~1 FPS.
HELMET_INTERVAL_S = _env_float("CAMAI_HELMET_INTERVAL_S", 0.3)

# Minimum PRIMARY-DETECTOR confidence a "motorcycle"/vehicle box must carry to
# be used as the anchor for a helmet_violation association or an ANPR crop.
# The general tracker only requires >= 0.25 (app/ai/pipeline.py Tracker.update,
# lower still in crowded scenes via CROWDED_CONF_RATIO) — fine for drawing a
# box on the overlay, too permissive for actions with real consequences (an
# alert, a plate-read attempt). Confirmed live 2026-08-02: a car misclassified
# as "motorcycle" at 0.25 confidence anchored a false helmet_violation with a
# wrong evidence crop. This is deliberately separate from the unused, never-
# wired CONFIDENCE_THRESHOLD above — raising that would blanket-filter every
# detection class (person/vehicle counts, overlay, everything), which is a
# much bigger behavior change than gating just these two action points.
VEHICLE_ACTION_MIN_CONFIDENCE = _env_float("CAMAI_VEHICLE_ACTION_MIN_CONFIDENCE", 0.5)

# Minimum primary-detector confidence a "person" box must carry to count as a
# genuine rider when deciding whether a motorcycle gets a helmet-detection
# pass at all (app/ai/helmet.py _rider_crops). Below this, a motorcycle with
# no other qualifying person is treated as un-ridden and skipped entirely —
# see the 2026-08-02 fix note there for why a parked bike was getting a crop
# (and a hallucinated helmet/no_helmet call) even with zero real riders.
HELMET_RIDER_MIN_PERSON_CONFIDENCE = _env_float("CAMAI_HELMET_RIDER_MIN_PERSON_CONFIDENCE", 0.5)

# How long a published helmet result stays on the overlay. Slightly longer than
# the submit cadence so boxes don't flicker between passes, short enough that a
# dead worker's output disappears instead of going stale.
HELMET_RESULT_TTL_S = _env_float("CAMAI_HELMET_RESULT_TTL_S", 1.5)

# --- ANPR / number-plate detection (Apache-2.0) ----------------------------
# Vehicle-crop + gating first: the plate detector runs ONLY on car/truck/bus/
# motorcycle crops (never the full frame), and candidates are gated by aspect
# ratio and size before they count as plates. This is the fix for the failure
# that kept ANPR "coming soon" — on the full frame the detector read painted
# vehicle text (e.g. "emisiones" on a bus) as a plate. Model path is pluggable
# (LPD-YuNet is Chinese-trained; an India-tuned detector can drop in here).
ANPR_ENABLED = _env_bool("CAMAI_ANPR_ENABLED", True)
ANPR_MODEL_DIR = Path(os.getenv("CAMAI_ANPR_MODEL_DIR", str(MODELS_DIR / "plate")))
ANPR_MODEL = os.getenv("CAMAI_ANPR_MODEL", "plate_detector.onnx")
ANPR_CLASSES_FILE = os.getenv("CAMAI_ANPR_CLASSES", "classes.txt")
# Detector score floor. 0.5 was measured to be far above the shipped plate
# model's real operating range on CCTV imagery: over 145 vehicle crops from the
# test footage the model's TOP score was 0.35, so 0.5 rejected ~97% of genuine
# plates before gating ever ran (docs/ANPR.md). The geometry gates below —
# aspect, size, area fraction — plus format validation downstream are what
# reject false positives; the score threshold is deliberately permissive so
# real plates survive to be judged on their shape.
ANPR_THRESHOLD = _env_float("CAMAI_ANPR_THRESHOLD", 0.15)
ANPR_NMS = _env_float("CAMAI_ANPR_NMS", 0.3)
# Aspect band accepts BOTH single-row (~3-6:1) and two-row plates (~1.3-2.5:1) —
# Indian two-wheeler plates are commonly two-row, so a wide-only band would miss
# exactly the DM pilot's target vehicles.
ANPR_ASPECT_MIN = _env_float("CAMAI_ANPR_ASPECT_MIN", 1.2)
ANPR_ASPECT_MAX = _env_float("CAMAI_ANPR_ASPECT_MAX", 6.5)
# A plate narrower than this (px) carries too few characters to OCR reliably.
# Measured against the *upscaled* crop (see ANPR_UPSCALE_TO_W): small plates are
# enlarged before this gate, so distant vehicles are no longer discarded on
# source resolution alone.
ANPR_MIN_PLATE_W = _env_int("CAMAI_ANPR_MIN_PLATE_W", 24)
# Vehicle crops narrower than this are upscaled to it before plate detection.
# The detector letterboxes to 640 anyway, so feeding it a larger, sharper crop
# costs nothing extra and materially improves small-plate recall. 0 disables.
ANPR_UPSCALE_TO_W = _env_int("CAMAI_ANPR_UPSCALE_TO_W", 320)
# Grow the plate box by this fraction of its size before OCR. Plate detectors
# produce tight boxes that clip the first and last glyph; a small margin
# recovers them.
ANPR_PLATE_PAD_FRAC = _env_float("CAMAI_ANPR_PLATE_PAD_FRAC", 0.08)
# A real plate is a small fraction of the vehicle it's on; a "plate" covering
# most of the vehicle crop is painted text or a mis-detection.
ANPR_MAX_AREA_FRAC = _env_float("CAMAI_ANPR_MAX_AREA_FRAC", 0.35)

# OCR stage — reads characters off a gated plate crop (CRNN, OpenCV Zoo,
# Apache-2.0). Optional and independent: if the OCR model is absent, plates are
# still localised (plate_text stays None) and CamAI keeps running. Charset is
# loaded from a file, never hardcoded. Model + charset live in ANPR_MODEL_DIR.
ANPR_OCR_ENABLED = _env_bool("CAMAI_ANPR_OCR_ENABLED", True)
ANPR_OCR_MODEL = os.getenv("CAMAI_ANPR_OCR_MODEL", "plate_ocr.onnx")
ANPR_OCR_CHARSET = os.getenv("CAMAI_ANPR_OCR_CHARSET", "charset.txt")
# Reject OCR output shorter than this — a plate has several characters, and a
# 1-2 char read is noise, not a plate number.
ANPR_OCR_MIN_LEN = _env_int("CAMAI_ANPR_OCR_MIN_LEN", 4)

# Country plate grammar (app/ai/plate_format.py). "IN" = India; "GENERIC"
# disables structural constraints for deployments we don't model. The grammar
# is the single biggest accuracy lever downstream of the recogniser: on
# rendered plates it took exact matches from 1.0% to 13.5% (docs/ANPR.md),
# because the recogniser's errors are letter-vs-digit class errors that the
# format resolves positionally.
ANPR_COUNTRY = os.getenv("CAMAI_ANPR_COUNTRY", "IN")
# Reject a read below this confidence. Previously there was NO floor at all:
# any text the recogniser emitted was published as the plate number, which is
# why wrong plates appeared with no way to tell them from right ones.
ANPR_OCR_MIN_CONF = _env_float("CAMAI_ANPR_OCR_MIN_CONF", 0.35)
# Publish only reads that satisfy the country grammar. On by default: a string
# that cannot be a plate is worse than no read, because downstream it becomes a
# logged event and a Telegram alert.
ANPR_REQUIRE_VALID_FORMAT = _env_bool("CAMAI_ANPR_REQUIRE_VALID_FORMAT", True)
# Constrained-beam width. 8-16 is the useful range; above that the extra beams
# are duplicates of the top hypothesis and only cost latency.
ANPR_OCR_BEAM_WIDTH = _env_int("CAMAI_ANPR_OCR_BEAM_WIDTH", 12)
# How many preprocessing variants to try per plate, and the confidence at which
# a grammar-valid read is good enough to stop. Together these bound the cost of
# the retry ensemble: an easy daytime plate runs ONE inference.
ANPR_OCR_MAX_VARIANTS = _env_int("CAMAI_ANPR_OCR_MAX_VARIANTS", 4)
ANPR_OCR_EARLY_EXIT_CONF = _env_float("CAMAI_ANPR_OCR_EARLY_EXIT_CONF", 0.80)
# Preprocessing toggles — all measured to help on their target condition and to
# cost nothing when they don't fire.
ANPR_OCR_DESKEW = _env_bool("CAMAI_ANPR_OCR_DESKEW", True)
ANPR_OCR_RECTIFY = _env_bool("CAMAI_ANPR_OCR_RECTIFY", True)
ANPR_OCR_TWO_ROW = _env_bool("CAMAI_ANPR_OCR_TWO_ROW", True)
# Crops wider:taller than this are single-row; below it, try a two-row split.
# Indian two-wheeler plates — the DM pilot's target — are commonly two-row, and
# a single-line recogniser reads straight across both rows and returns nonsense.
ANPR_TWO_ROW_ASPECT = _env_float("CAMAI_ANPR_TWO_ROW_ASPECT", 2.6)
# Smallest plate crop worth attempting, and the focus floor (variance of the
# Laplacian) below which the crop is motion-blurred or defocused past reading.
ANPR_OCR_MIN_CROP_W = _env_int("CAMAI_ANPR_OCR_MIN_CROP_W", 24)
ANPR_OCR_MIN_CROP_H = _env_int("CAMAI_ANPR_OCR_MIN_CROP_H", 8)
ANPR_BLUR_MIN = _env_float("CAMAI_ANPR_BLUR_MIN", 12.0)

# --- ANPR temporal aggregation (app/ai/plate_track.py) ---------------------
# A plate is read many times as a vehicle crosses the frame. Voting across
# those reads is far more reliable than any single frame, and it is also what
# stops duplicate events: a track publishes its plate once and only re-publishes
# if the winning candidate actually changes.
ANPR_TRACK_MIN_READS = _env_int("CAMAI_ANPR_TRACK_MIN_READS", 2)
# Once a track's winner has this many votes AND clears this confidence, the
# track is "settled" and OCR is skipped for it entirely — the main saving that
# keeps ANPR affordable on busy scenes.
ANPR_TRACK_SETTLE_VOTES = _env_int("CAMAI_ANPR_TRACK_SETTLE_VOTES", 3)
ANPR_TRACK_SETTLE_CONF = _env_float("CAMAI_ANPR_TRACK_SETTLE_CONF", 0.65)
# Forget a track this long after it was last seen.
ANPR_TRACK_TTL_S = _env_float("CAMAI_ANPR_TRACK_TTL_S", 60.0)

# --- ANPR async worker -----------------------------------------------------
# Run plate detection + OCR off the capture/tracking thread. The pipeline hands
# over a frame reference and reads whatever the worker has published; it never
# waits. A bounded, drop-oldest queue means a slow OCR pass degrades ANPR
# cadence and nothing else — video FPS is unaffected by construction.
ANPR_ASYNC = _env_bool("CAMAI_ANPR_ASYNC", True)
ANPR_QUEUE_MAX = _env_int("CAMAI_ANPR_QUEUE_MAX", 2)
# How long a published ANPR result keeps being overlaid before it goes stale.
# Slightly longer than ANPR_INTERVAL_S so boxes don't flicker between passes.
ANPR_RESULT_TTL_S = _env_float("CAMAI_ANPR_RESULT_TTL_S", 2.0)

# --- ANPR debug mode -------------------------------------------------------
# Writes the full evidence chain per attempt — original frame, vehicle crop,
# plate crop, every enhanced variant fed to the recogniser, plus a JSONL row
# with the text, confidence and failure reason. Off by default: it writes a lot
# of images. This is the tool for answering "why was THAT plate not read".
ANPR_DEBUG = _env_bool("CAMAI_ANPR_DEBUG", False)
ANPR_DEBUG_DIR = Path(os.getenv("CAMAI_ANPR_DEBUG_DIR", str(RECORDINGS_DIR / "anpr_debug")))
# Cap the debug directory so a session left in debug mode cannot fill the disk.
ANPR_DEBUG_MAX_ATTEMPTS = _env_int("CAMAI_ANPR_DEBUG_MAX_ATTEMPTS", 500)
# Save artefacts only for failures (the useful case) unless this is on.
ANPR_DEBUG_SAVE_SUCCESS = _env_bool("CAMAI_ANPR_DEBUG_SAVE_SUCCESS", False)
# Log a read plate at most once per this many seconds per vehicle track — the
# same dedup idea as helmet violations, keyed to the vehicle it sits on.
ANPR_EVENT_COOLDOWN = _env_float("CAMAI_ANPR_EVENT_COOLDOWN", 30.0)
# Run the plate detector at most this often (seconds). ANPR is by far the
# heaviest pass — a plate detector (and OCR) on every vehicle crop EVERY frame
# froze the tracking loop to <1 fps in a live run. A plate doesn't change frame
# to frame and the read is deduped over ANPR_EVENT_COOLDOWN, so a coarse cadence
# loses nothing. Between runs the pass is skipped entirely.
ANPR_INTERVAL_S = _env_float("CAMAI_ANPR_INTERVAL_S", 1.0)

# --- Invisible AI Zoom Engine (adaptive tile inference) --------------------
# Defaults for app.ai.tiling. These are STARTING values only: every one of them
# is live-adjustable by an admin via POST /api/detection/tiling, and the engine
# clamps whatever it is given (see tiling._sanitize) so no value here or from an
# admin can wedge a camera.
#
# The defaults are deliberately conservative. Tile passes are additive on top of
# the full-frame pass that has always run, and the budget below is what stops
# them multiplying inference cost the way the old unconditional 5-pass quadrant
# code did (that regression is why this is budgeted at all — see tiling.py).
TILING_ENABLED = _env_bool("CAMAI_TILING_ENABLED", True)
# Densest grid the engine may choose (N x N). It picks lower automatically when
# objects are already large; 3 covers the "distant road/yard" case that motivates
# tiling without ever planning 25 crops of a frame.
TILING_MAX_GRID = _env_int("CAMAI_TILING_MAX_GRID", 3)
# Neighbouring tiles share this fraction of their extent, so an object on a seam
# is whole in at least one tile. Clamped to 0.15-0.25.
TILING_OVERLAP = _env_float("CAMAI_TILING_OVERLAP", 0.20)
# Hard ceiling on EXTRA inference passes per camera per cycle, on top of the
# full-frame pass. 0 disables tiling as surely as CAMAI_TILING_ENABLED=0.
TILING_MAX_TILES = _env_int("CAMAI_TILING_MAX_TILES", 4)
# Wall-clock inference time (ms) the engine may spend on tiles, DIVIDED between
# all cameras currently running. This is the governor: as cameras are added each
# one's tile allowance shrinks toward zero, i.e. toward plain single-pass
# inference, instead of every camera independently overcommitting one GPU.
#
# 180ms is measured, not guessed, and the margin above one pass is the point.
#
# A tile pass costs about what the full-frame pass costs (same tensor size —
# real zoom is not free), benchmarked at 76-90ms warm for yolox_tiny/640 on this
# machine's integrated GPU and up to ~150ms while the box is otherwise busy.
# A budget smaller than one pass is worse than useless: it makes the tile count
# zero and the feature ships switched off while appearing to be on. A budget
# roughly EQUAL to one pass is worse still, because then ambient load decides —
# at 120ms, five identical runs on identical video gave 4.34 to 6.11
# detections/frame, the same configuration behaving like two different products.
# 180ms clears one pass with margin under load, still affords 4+ on fast
# hardware, and still halves per camera as cameras are added.
TILING_LATENCY_BUDGET_MS = _env_float("CAMAI_TILING_LATENCY_BUDGET_MS", 180.0)

# Frame rate each camera's AI stage aims for. This is a DEADLINE, not a limiter:
# nothing throttles down to it, but it is the period the adaptive tile engine
# must fit inside, so it is the single knob that trades frame rate against
# small-object recall.
#
# Measured on the reference machine (i7-8665U + UHD 620, yolox @ 416, one
# camera, real video):
#
#   target 15  ->  44.6ms/cycle, 22.4 fps ceiling, 10.57 detections/frame
#   target 25  ->  37.1ms/cycle, 26.9 fps ceiling,  6.78 detections/frame
#
# 15 is the default because the extra ~5 fps that 25 buys costs 36% of the
# detections — on this hardware a tile pass costs ~30ms and simply does not fit
# inside a 40ms period. On a machine with real GPU headroom (a discrete NVIDIA
# card, where a pass is a few ms) both fit and raising this is free. Anyone who
# wants raw frame rate over recall can set it here rather than editing code.
TARGET_FPS = _env_float("CAMAI_TARGET_FPS", 15.0)
# Threads in the process-wide tile pool (NOT per camera) — bounds the number of
# extra per-thread InferRequests the backend caches, regardless of camera count.
TILING_WORKERS = _env_int("CAMAI_TILING_WORKERS", 2)
# Fraction of a tile's pixels that must change before it is re-inferred rather
# than served from its previous result.
TILING_MOTION_THRESHOLD = _env_float("CAMAI_TILING_MOTION_THRESHOLD", 0.0015)
# Longest a still tile's cached detections may be reused. Bounds how long a
# ghost could persist if the change detector ever misses a departure.
#
# Must exceed the interval at which a tile actually gets re-inferred, or the
# cache is dead weight: measured on a fixed camera, a given tile comes back
# round roughly every 1.5s at a one-tile budget, so a 0.8s TTL expired every
# entry before it was ever reused (0.17 reuses/frame) and the scheduler paid
# full price for tiles it had already computed. The staleness risk this buys is
# small and bounded: an entry is only reused while that tile's PIXELS are
# unchanged, and the full-frame pass re-examines the whole scene every cycle
# regardless.
TILING_CACHE_TTL_S = _env_float("CAMAI_TILING_CACHE_TTL_S", 1.5)
# Frame-area fraction below which an object counts as "small" and is worth
# zooming for. 0.010 = 1% of frame area (~a 120x90 box on 1080p).
TILING_SMALL_OBJECT_FRAC = _env_float("CAMAI_TILING_SMALL_OBJECT_FRAC", 0.010)
# Result fusion. IoU merges two views of the same object; containment
# (intersection over the smaller box) is what merges a seam-truncated box with
# the whole-object box from the neighbouring tile, where IoU alone is too low.
TILING_FUSION_IOU = _env_float("CAMAI_TILING_FUSION_IOU", 0.55)
TILING_FUSION_CONTAINMENT = _env_float("CAMAI_TILING_FUSION_CONTAINMENT", 0.75)
# ROI boost: re-run only the neighbourhood of a marginal detection at a higher
# input size, never the whole frame again.
TILING_ROI_BOOST = _env_bool("CAMAI_TILING_ROI_BOOST", True)
TILING_ROI_BOOST_MAX = _env_int("CAMAI_TILING_ROI_BOOST_MAX", 2)
# Detections scoring below this are the ones a boost pass can still change the
# answer for; above it there is nothing to gain.
TILING_SECOND_PASS_CONF = _env_float("CAMAI_TILING_SECOND_PASS_CONF", 0.45)
# How often an idle camera sweeps at full density to look for small objects it
# cannot currently see. Without this a scene containing ONLY tiny objects would
# report "no detections", conclude objects are large, and never zoom.
TILING_DISCOVERY_INTERVAL_S = _env_float("CAMAI_TILING_DISCOVERY_INTERVAL_S", 5.0)

# --- v2 engine ------------------------------------------------------------
# The v2 defaults live on TilingSettings (app/ai/tiling.py) rather than here,
# because unlike the v1 knobs they are not things a deployment usually pins at
# boot — they are governed at runtime and adjusted per site through
# POST /api/detection/tiling. These two are the exceptions worth an env var:
# a deployment that must never let the closed loop run (mode=latency reproduces
# v1's equal division exactly), and one that must never pay a new shape's
# compile cost at all.
TILING_GOVERNOR_MODE = os.getenv("CAMAI_TILING_GOVERNOR_MODE", "auto").strip().lower()
TILING_MULTI_RESOLUTION = _env_bool("CAMAI_TILING_MULTI_RESOLUTION", True)

# Web Server Settings.
# The engine exposes camera streams and control endpoints on loopback behind
# the desktop app / local viewer. Only bind a routable interface
# (CAMAI_HOST=0.0.0.0) on a trusted network or behind an authenticating proxy.
HOST = os.getenv("CAMAI_HOST", "127.0.0.1")
PORT = int(os.getenv("CAMAI_PORT", "8000"))

# Shared secret the desktop app must present on CONFIGURATION endpoints — the
# ones that change what the AI does (AI mode / zone profile, model, confidence,
# camera registration). See main.py's require_control_token().
#
# This is a "you are the CamAI app" capability, NOT a role check: the engine has
# no users. Who may CHANGE an AI mode is decided in the cloud, by RLS on
# public.cameras (cameras_write → cameras.manage, migration 0020); the desktop
# only ever replays an already-authorised value down to the engine. The token
# exists so that a value which did not come through that check — a stray browser
# tab, a script, another local process — cannot write straight into the engine
# and silently diverge it from the database.
#
# Empty means "unset", which leaves the endpoints open. That only happens for an
# engine somebody started by hand (dev, CI, a bare uvicorn); the supervisor
# always spawns with a token, so the shipped product is never in that state.
API_TOKEN = os.getenv("CAMAI_API_TOKEN", "").strip()

# Origins allowed to make cross-origin calls. The desktop renderer is a
# file:// page in production and the Vite dev server in development; the
# legacy local viewer runs on 5173/4173 too. "*" is still available via
# CAMAI_CORS_ORIGINS for anyone embedding the engine elsewhere.
_cors = os.getenv("CAMAI_CORS_ORIGINS", "").strip()
CORS_ORIGINS = (
    [o.strip() for o in _cors.split(",") if o.strip()]
    if _cors
    else [
        # Electron file:// renderer. Older Chromium sent the literal string
        # "null" as Origin for a file:// page; the Chromium build in the
        # currently-shipped Electron sends "file://" instead. Both have to be
        # accepted or the packaged app's /ws telemetry socket gets a 403 on
        # every single connection attempt — the engine still detects
        # correctly, but not one detection ever reaches the overlay, which is
        # indistinguishable from "the AI isn't running" to an operator. Keep
        # both forms rather than replacing one with the other so a future
        # Electron/Chromium bump in either direction can't reopen this.
        "null",
        "file://",
        # desktop/vite.config.ts pins the desktop renderer's dev server to 5180.
        # It was missing here, and the effect was not subtle: _ws_origin_allowed()
        # rejects an unlisted Origin with close code 1008, so `npm run dev` on
        # the desktop app had its /ws telemetry socket refused on every attempt.
        # TelemetrySession just saw a close and backed off, so the renderer
        # reconnect-looped in silence and NO detections ever reached the overlay
        # in development — while the packaged build (Origin: null) worked fine.
        # That asymmetry is exactly what makes this class of bug expensive.
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
)
