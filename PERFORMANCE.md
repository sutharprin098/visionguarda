# CamAI Enterprise — Performance Reference

Throughput on this product is **hardware-bound**. The figures below are measurements on
specific machines, not guarantees for yours. Size a deployment from the class of hardware
it will actually run on.

---

## Measured results

Run with `server/benchmarks/pipeline_benchmark.py`:

| Configuration | FPS | Pipeline latency | Stage errors |
| :--- | ---: | ---: | ---: |
| OpenVINO discrete/mid GPU, 1 camera | 57 | 5.7 ms | 0 |
| CPU only, 1 camera | 31 | 131 ms | 0 |
| GPU, 4 cameras concurrently | 4.0–4.5 / stream | 266 ms | 0 |

**Low-end datapoint** — Intel UHD 620 integrated graphics, no discrete GPU, running the
full traffic stack including ANPR: **9–11 FPS** on one camera. On that hardware class the
25–60 FPS range is **not achievable**. (The same machine managed 0.6 FPS before ANPR was
throttled per track.)

---

## Sizing rules of thumb

- Budget roughly **one CPU core and ~1 GB RAM per camera** on top of the base app.
- ANPR, helmet and face passes are inference *in addition to* detection — enable them only
  on the cameras that need them.
- Adding cameras trades FPS per stream, not stability: the 4-camera run above completed
  with zero stage errors.
- The **Adaptive Tile Governor** scales inference resolution (320–1280 px) to hold GPU
  utilisation in a 70–90 % band.
- Video is decoupled from AI (MJPEG at camera FPS, WebSocket for telemetry only), so slow
  inference degrades overlay freshness, never the live picture.

---

## Reproducing

```powershell
# 1-camera and 4-camera pipeline benchmarks
python server/benchmarks/pipeline_benchmark.py --cameras 4 --seconds 10

# Force CPU mode
$env:CAMAI_FORCE_CPU = "1"
python server/benchmarks/pipeline_benchmark.py --cameras 1 --seconds 5
```
