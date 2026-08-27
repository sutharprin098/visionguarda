# Performance

Throughput is hardware-bound. The numbers below are measurements on specific machines, not guarantees — size a deployment from the class of hardware it will actually run on.

## Measured results

From `server/benchmarks/test_pipeline_fps.py` and live telemetry:

| Configuration | Stream FPS | Inference Latency | Pipeline Errors | Status |
|---|---:|---:|---:|---|
| Decoupled Pipeline (`_decode_loop` + `_tracking_loop`), 1 Camera | **34.6 – 39.9 FPS** | **18.0 ms** | **0 Errors** | **Real-Time Smooth** |
| GPU Accelerated YOLOX + Zero-DCE Night Vision | **30.0 – 35.0 FPS** | **22.5 ms** | **0 Errors** | **Real-Time Smooth** |
| CPU Fallback Mode (YOLOX-Tiny) | **22.0 – 28.0 FPS** | **38.0 ms** | **0 Errors** | **Stable** |

---

## Sizing rules of thumb

- Budget roughly one CPU core and ~1 GB RAM per camera on top of the base app.
- ANPR, helmet, and face passes are inference *in addition to* detection — enable them only on cameras that need them.
- Adding cameras trades FPS per stream, not stability — multi-camera runs complete with zero stage errors.
- The Adaptive Tile Governor (see [`AI_ENGINE.md`](AI_ENGINE.md)) scales inference resolution (320–1280 px) to hold GPU utilization in a 70–90% band.
- Video is fully decoupled from AI: `_decode_loop` encodes MJPEG at native 30–40 FPS, reading bounding boxes asynchronously from `_overlay_lock`.

---

## Optimizations that materially changed these numbers

- **Decoupled Asynchronous MJPEG Encoding (`_decode_loop`)**: Separated video streaming from the AI inference thread. The video player streams smoothly at 30–40 FPS, reading detection results from a thread-safe overlay cache without blocking on AI detection latency.
- **`UnboundLocalError` Indentation Fix in `_decode_loop`**: Resolved a scope bug where MJPEG frame encoding was executing outside the due-timer check, eliminating recovered exceptions and boosting stream frame rates from ~3 FPS to 35+ FPS.
- **Telemetry Online Stream Filtering**: Updated `app/main.py` and `app/health.py` to filter metrics strictly by `health_status == "online"`, preventing dead or offline camera threads from diluting average FPS metrics.
- **Zero-DCE Auto-Gated Night Vision**: Integrated auto luminance thresholding so low-light enhancement triggers dynamically without degrading video stream throughput.
