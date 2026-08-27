# CamAI — What To Do Next, And The Prompts To Do It With

Companion to `CamAI-Pipeline-Architecture-Review.html`. That document explains *why*.
This one is just the actions and the copy-pasteable prompts.

---

## The short answer

Do these three things, in this order. Nothing else in the roadmap matters until they are done.

**Step 1 — Settle one number (1–2 days).**
Your profile says overall pipeline latency is ~18 ms *and* that a single OpenVINO
inference pass is 25 ms. Both cannot be true if inference is on the critical path.
Find out whether 25 ms is a measured time or an allocated budget. The answer changes
your 16-camera capacity from ~2.5 FPS per camera to ~15 FPS per camera. Six-fold.
Do not commit engineering effort in any direction until you know which world you are in.

**Step 2 — Two changes that take hours (do them this week).**

- Change detector input from `416x416` to `512x288`. 1080p letterboxed into a square
  wastes 43.75% of every inference on grey padding. 512x288 is exactly 16:9, divisible
  by 32 on both axes, has 15% fewer pixels, and gives 1.23x higher linear resolution on
  actual content. Cheaper and better at the same time.
- Point analytics at your cameras' **substreams** instead of main streams. A 704x480
  substream is still larger than 512x288, so the detector loses nothing, and decode load
  drops to roughly 8% of current. This is a camera config change, not code.

**Step 3 — Stop inferring at 30–40 FPS (3–5 days).**
Tracking association needs about 6 FPS. Static surveillance scenes are empty 80–95% of
the time. So: display at source frame rate using Kalman-interpolated boxes between
detections, and run analytics at 8 FPS, gated by cheap frame-differencing motion
detection. This frees roughly 5x inference headroom.

**Then, and only then — spend that headroom on YOLOX-S instead of on more frames.**
+7.7 COCO AP over Tiny, with a wider gap on small objects, which is exactly your
night-time problem. It costs 1.75x Tiny at the same input size, which is unaffordable at
uniform 8 FPS and comfortable once motion gating is in. That is the strategic move.

Everything you actually asked about — shared memory, INT8, load balancing — is Phase 2.
Worth doing, but smaller than the four items above.

---

## Prompt 1 — Run this first (measurement)

> You are a senior performance engineer working on CamAI, a real-time multi-camera CV
> pipeline: OpenCV + OpenVINO YOLOX-Tiny + ByteTrack + a LUT-based low-light
> enhancement stage. Ingest is 1080p RTSP, Windows Graphics Capture, and YouTube HLS.
> Frontend is Electron; the inference service is Python/FastAPI. Target device is an
> Intel iGPU.
>
> I do not trust our current latency numbers and I want ground truth before I optimise
> anything. Build me a measurement harness.
>
> **Task**
> 1. Instrument every pipeline stage separately: decode, enhancement, preprocess,
>    inference, NMS, tracking, preview encode, transport. Attach a monotonic capture
>    timestamp at decoder output and carry it in the frame metadata so every stage
>    latency is a subtraction.
> 2. Report p50, p95, and p99 per stage as histograms. Do not report means.
> 3. Report **queue wait separately from service time** for every stage. I suspect we
>    have been conflating them.
> 4. Discard the first 100 iterations as warm-up.
> 5. For OpenVINO: time the async completion callback, not the submit call. Also dump
>    `ov::ProfilingInfo` per layer for one representative frame.
> 6. Separately report three distinct numbers that we have been collapsing into one:
>    (a) sum of per-stage compute, (b) sustained throughput = 1/max(stage_time),
>    (c) true glass-to-glass latency.
> 7. Add a 30-minute soak test across all cameras that logs, at 1 Hz: achieved aggregate
>    inference rate, GPU frequency, package power, GPU temperature, per-camera drop rate.
>    Report percentage decay in achieved inference rate between minute 2 and minute 30.
>
> **Constraints**
> - Use `time.perf_counter_ns()` in Python, never `time.time()`.
> - Overhead of the instrumentation itself must be under 2% — measure and prove it.
> - Output a single markdown report plus the raw CSVs.
>
> **Acceptance criteria**
> - I can answer: is our 25 ms inference figure a measurement or a budget?
> - I can answer: what is our real sustained throughput on hot silicon, not cold?
> - Every number has a p95, not just an average.

---

## Prompt 2 — Phase 1 implementation (the quick wins)

> You are a senior computer vision engineer working on CamAI: OpenCV + OpenVINO
> YOLOX-Tiny + ByteTrack + LUT low-light enhancement, ingesting 1080p RTSP plus Windows
> Graphics Capture plus YouTube HLS, Electron frontend, Python/FastAPI inference service,
> Intel iGPU target, scaling to 16 concurrent cameras.
>
> Implement the following four changes. Each is independent; do them in order and keep
> each one in a separate commit so I can bisect.
>
> **1. Change detector input geometry from 416x416 to 512x288.**
> Rationale: 1080p letterboxed into a square wastes 43.75% of compute on padding.
> 512x288 is exactly 16:9 and divisible by 32 on both axes, so the FPN strides are valid.
> - Update the OpenVINO reshape, the preprocessing resize, and the box-decode coordinate
>   mapping consistently. Grep for every hardcoded 416 and every hardcoded square
>   assumption.
> - Verify the letterbox code path is now a no-op for 16:9 sources and remove it if so.
> - Confirm AP does not regress on our evaluation set; report AP, AP50, and AP_small.
>
> **2. Switch analytics ingest to camera substreams.**
> - Add per-camera config for a separate analytics RTSP URL, defaulting to the substream.
> - Before trusting it: capture a substream frame and a main-stream frame simultaneously
>   from the same camera and verify the field of view matches. Some cameras crop rather
>   than scale to produce a 4:3 substream, which would break coordinate projection onto
>   the main stream. Fail loudly with a clear error if FOV parity check fails.
> - Keep the main stream available for on-demand operator zoom and event recording.
>
> **3. Confirm and enforce hardware decode.**
> - Verify QSV / D3D11VA / VAAPI is actually engaged for all streams. Log the active
>   decoder per stream at startup.
> - If a stream silently falls back to software decode, log a warning at ERROR level. At
>   16x1080p30, software decode would need 11–24 cores and will sink the whole system.
>
> **4. Replace every frame queue with a depth-1 latest-wins slot.**
> - No unbounded queues anywhere in the frame path.
> - Rationale: a stale frame is worse than a dropped one, because feeding the tracker a
>   detection from 200 ms ago corrupts the Kalman velocity estimate and degrades every
>   subsequent prediction. A dropped frame costs one observation; a late frame costs the
>   state estimate.
> - Expose per-camera drop rate as a first-class metric, not a debug log line.
>
> **Also do these small ones:**
> - Enable OpenVINO `CACHE_DIR` so OpenCL kernels are not re-JITed every run.
> - Pin static input shapes; dynamic shapes carry a large penalty on the iGPU plugin.
> - Fuse resize, colour conversion, and type conversion into the model via
>   `PrePostProcessor` so they run on GPU instead of in Python. Caution: PPP resize is a
>   plain resize, not aspect-preserving letterbox — since we are moving to 512x288 for
>   16:9 sources this is fine, but assert the source aspect ratio.
> - Drop preview JPEG quality from 85 to 72–75. Roughly 40% bandwidth saving, visually
>   indistinguishable at 720p.
>
> **Acceptance criteria**
> - AP_small and ID-switches-per-minute do not regress versus the current baseline.
> - Aggregate decode load measurably drops.
> - No unbounded queue remains in the frame path; grep proves it.

---

## Prompt 3 — Decouple frame rates and add motion gating

> Continuing on CamAI (OpenVINO YOLOX-Tiny + ByteTrack, 16 static surveillance cameras,
> Intel iGPU). Currently we run inference on every displayed frame targeting 30–40 FPS.
> That is the wrong target and it is consuming the budget I want for a better detector.
>
> **Task — split display rate from analytics rate.**
> 1. Display path: decode and present at source frame rate with no inference at all.
>    Render tracker boxes by advancing each ByteTrack Kalman prediction forward on
>    display frames between detections, so the operator sees smooth 30 FPS motion from
>    8 FPS of detections.
> 2. Analytics path: run at an adaptive per-camera rate, driven by a motion gate.
>
> **Motion gate**
> - Frame differencing or MOG2 on a 160x90 downscaled thumbnail. Budget: under 200 us.
> - Per-camera state machine:
>   - no motion, no active tracks -> 1–2 FPS keepalive
>   - new motion detected -> burst to 12–15 FPS for ~1 s
>   - active tracks present -> 8–10 FPS
>   - motion ceased, tracks aged out -> decay back to 1–2 FPS with hysteresis
> - The burst matters: track *initiation* is the frame-rate-critical phase because there
>   is no velocity estimate yet for the Kalman filter to work with. Steady-state tracking
>   of a constant-velocity target tolerates much lower rates.
> - Exempt any PTZ or wind-swayed camera from the gate, or stabilise first. The gate
>   assumes a static scene.
>
> **Before relying on this, measure the assumption.**
> Deploy the gate in observe-only mode for 24 hours and log the activity duty cycle per
> camera. I have assumed 80–95% idle. If our sites are busier than that, the headroom
> calculation changes and so does the next step.
>
> **Acceptance criteria**
> - Aggregate inference demand across 16 cameras drops to roughly 45 inferences/second in
>   the common case.
> - ID switches per minute does not increase versus the 30 FPS baseline. Measure at 4, 6,
>   8, and 10 FPS analytics rates and give me the curve — I want to see where it breaks,
>   not just that 8 works.
> - Report the measured idle duty cycle per camera.

---

## Prompt 4 — Spend the headroom on the detector

> CamAI now has roughly 5x inference headroom from motion gating. I want to spend it on
> detection quality rather than on frame rate. Run this ablation before we commit.
>
> **Evaluate four configurations** on our own night-time footage, not on COCO:
>
> | | 512x288 | 1024x576 |
> |---|---|---|
> | YOLOX-Tiny | 5.50 GFLOPs (baseline) | 22.0 GFLOPs |
> | YOLOX-S | 9.65 GFLOPs | 38.6 GFLOPs |
>
> **Score on AP_small and ID-switches-per-minute**, not aggregate AP. Those two metrics
> are what this system actually exists to optimise. Also report measured inferences/second
> for each via `benchmark_app` so I can check the GFLOPs-scale-linearly assumption.
>
> **Build the evaluation set first if it does not exist:** at least 500 annotated frames
> from our own cameras, stratified by camera, time of day, and weather, deliberately
> over-weighted toward night. Also tell me what fraction of our targets are smaller than
> 32x32 px — that number determines whether resolution or model capacity is the better
> buy, and I do not currently know it.
>
> Then quantize the winner to INT8 with NNCF:
> - `nncf.quantize` with `QuantizationPreset.MIXED`, `TargetDevice.GPU`,
>   `subset_size=300`, `fast_bias_correction=False`.
> - Calibration transform must reproduce runtime preprocessing **exactly**, including the
>   same enhancement LUT. Most quantization accuracy loss in practice is a preprocessing
>   mismatch, not a numerics problem.
> - Verify whether our YOLOX export is legacy or non-legacy preprocessing. Stock
>   non-legacy YOLOX takes raw 0–255 BGR with no /255 and no ImageNet mean/std. Getting
>   this wrong silently costs accuracy and corrupts the calibration statistics.
> - Exclude the decode head via `IgnoredScope` — the `Exp` on width/height outputs has
>   wide dynamic range and quantizes badly.
> - Use `quantize_with_accuracy_control` with an absolute AP drop threshold so the tool
>   reverts individual layers rather than handing me a fast, subtly broken model.
>
> Judge the INT8 result on the 30-minute soak test, not the microbenchmark. On an iGPU the
> real INT8 win is reduced power draw and therefore sustained clocks, not peak latency.

---

## One thing to check before any of this

**Which exact Intel iGPU SKU are you targeting?**

It determines your peak throughput, whether INT8 acceleration comes from DP4A or XMX,
how many hardware decode engines you have, and — if it is Meteor Lake or newer — whether
you have an NPU. If you do have an NPU, put detection on it: it is built for sustained
low-power INT8 inference and it does not compete with the EUs that your enhancement and
preview encode need. That single fact would reorder most of this roadmap.
