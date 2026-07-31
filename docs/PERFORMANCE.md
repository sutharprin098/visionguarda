# Performance

Throughput is hardware-bound. The numbers below are measurements on specific machines, not guarantees — size a deployment from the class of hardware it will actually run on.

## Measured results

From `server/benchmarks/pipeline_benchmark.py`:

| Configuration | FPS | Pipeline latency | Stage errors |
|---|---:|---:|---:|
| OpenVINO discrete/mid GPU, 1 camera | 57 | 5.7 ms | 0 |
| CPU only, 1 camera | 31 | 131 ms | 0 |
| GPU, 4 cameras concurrently | 4.0–4.5 / stream | 266 ms | 0 |

**Low-end datapoint** — Intel UHD 620 integrated graphics (no discrete GPU), full traffic stack including ANPR: **9–11 FPS** on one camera. The 25–60 FPS range is not achievable on that hardware class. (Before ANPR was throttled per track instead of running every frame, the same machine managed 0.6 FPS.)

## Sizing rules of thumb

- Budget roughly one CPU core and ~1 GB RAM per camera on top of the base app.
- ANPR, helmet, and face passes are inference *in addition to* detection — enable them only on cameras that need them.
- Adding cameras trades FPS per stream, not stability — the 4-camera run above completed with zero stage errors.
- The Adaptive Tile Governor (see [`AI_ENGINE.md`](AI_ENGINE.md)) scales inference resolution (320–1280 px) to hold GPU utilization in a 70–90% band.
- Video is decoupled from AI (MJPEG at camera FPS, WebSocket for telemetry only) — slow inference degrades overlay freshness, never the live picture.

## Reproducing

```powershell
# 1-camera and 4-camera pipeline benchmarks
python server/benchmarks/pipeline_benchmark.py --cameras 4 --seconds 10

# Force CPU mode
$env:CAMAI_FORCE_CPU = "1"
python server/benchmarks/pipeline_benchmark.py --cameras 1 --seconds 5
```

## Optimizations that materially changed these numbers

Several pipeline bottlenecks have been found and fixed by profiling live runs rather than guessing — each is a cautionary example worth knowing before re-tuning:

- **Overlay latency vs. detection correctness**: boxes that appeared "not detecting" were actually correct but 141ms late, because video and overlay are decoupled and the overlay trails when the AI stage is slow. Memoizing `get_bbox` (previously O(n²) in a dedup scan and 22% of the tracking stage) took latency from 141.7ms to 98.1ms and FPS from 13 to 16.5.
- **MJPEG encoding with no viewer**: `cv2.imencode` was running on every frame at full camera FPS for every camera, including cameras nobody was watching — there was no viewer accounting. Adding reference counting plus an `MJPEG_MAX_FPS` cap took CPU from 220% to 187% and RSS from 455MB to 375MB on an 8-camera run.
- **Fixed tiling budget vs. actual frame period**: an early Adaptive Tile Governor used a fixed 180ms per-cycle budget unrelated to the camera's real frame period, which collapsed a 34.7ms inference pass into a 141.6ms cycle for close to zero extra recall. Deriving the budget from the actual deadline instead took FPS from 7.0 to 22.4 at an identical detections-per-frame rate.
- **Time-blind tracker**: the Kalman tracker originally advanced its motion model by a fixed step per iteration, while the actual pipeline cycle time varied from 25ms to 850ms (helmet inference ran inline). This caused severe track-ID churn — 603 IDs minted in 10 minutes for 12 real objects. Fixing the tracker to use wall-clock `dt` and moving helmet inference to an async worker resolved it.
- **iGPU-specific constraints**: on Intel UHD 620 (no discrete GPU), per-shape OpenVINO GPU recompiles from adaptive resolution/tiling caused a crash loop. The fix pins a static input shape and a single tiling pass specifically when running on that device class — sub-10ms inference at 25–60 FPS is not achievable on that hardware regardless of software tuning.
