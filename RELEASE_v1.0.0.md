# CamAI Desktop **v1.0.0** — Windows Installer

<p align="center">
  <b>Edge-first AI CCTV for Windows.</b><br>
  Live RTSP/USB/NVR streams → on-device AI detection, tracking &amp; analytics → alerts, clips and cloud reporting.<br>
  <i>No frames leave the machine. The AI engine runs entirely offline on your hardware.</i>
</p>

<p align="center">
  <img alt="version"  src="https://img.shields.io/badge/version-1.0.0-0b7285">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-blue">
  <img alt="size"     src="https://img.shields.io/badge/installer-414%20MB-lightgrey">
  <img alt="engine"   src="https://img.shields.io/badge/AI%20engine-bundled%20(offline)-success">
  <img alt="license"  src="https://img.shields.io/badge/models-Apache%202.0%20%2F%20MIT-brightgreen">
  <img alt="signing"  src="https://img.shields.io/badge/code%20signing-unsigned-orange">
</p>

---

## 📥 Download

| Asset | What it is | Size | You need it if… |
| :--- | :--- | ---: | :--- |
| **[`CamAI-Desktop-Setup-1.0.0.exe`](https://github.com/sutharprin098/visionguarda/releases/download/v1.0.0/CamAI-Desktop-Setup-1.0.0.exe)** | Full Windows installer — desktop app **+ AI engine + all models** bundled. Nothing else to download. | 414 MB | **Almost everyone. Start here.** |
| [`CamAI-Desktop-Setup-1.0.0.exe.sha256`](https://github.com/sutharprin098/visionguarda/releases/download/v1.0.0/CamAI-Desktop-Setup-1.0.0.exe.sha256) | Checksum for the installer | 96 B | You want to verify the download |
| [`camai-engine-v1.0.0-win64.zip`](https://github.com/sutharprin098/visionguarda/releases/download/v1.0.0/camai-engine-v1.0.0-win64.zip) | **Headless engine only** — `camai-engine.exe` + models, no GUI. Exposes the REST/WebSocket/MJPEG API. | 319 MB | You are running a server/edge box with no desktop, or integrating the API into your own UI |
| [`camai-engine-v1.0.0-win64.zip.sha256`](https://github.com/sutharprin098/visionguarda/releases/download/v1.0.0/camai-engine-v1.0.0-win64.zip.sha256) | Checksum for the engine ZIP | 96 B | You want to verify the download |

### Verify your download (recommended)

```powershell
Get-FileHash .\CamAI-Desktop-Setup-1.0.0.exe -Algorithm SHA256 | Format-List Hash
```

Expected values for this release:

| File | SHA-256 |
| :--- | :--- |
| `CamAI-Desktop-Setup-1.0.0.exe` | `df4a97c539456e415cf0fc5f665cd1cc0797f2e26e02fb9c01f4e1e7de798dc5` |
| `camai-engine-v1.0.0-win64.zip` | `92baafcc5e090929c8664765e368b62640cecdec5c76491dc22dc6f14c3afba1` |

If the hash does not match exactly, **delete the file and download again** — do not run it.

---

## ⚠️ Read this before you install

> **The installer is not code-signed.** Windows SmartScreen will show
> *"Windows protected your PC"*. This is expected for this build — there is no
> Authenticode certificate attached to it yet.
>
> To continue: click **More info → Run anyway**. Verify the SHA-256 above first
> so you know the file is the one published here.
>
> Signed builds are planned; until then treat SmartScreen as a reminder to check
> the checksum, not as a virus report.

Other things worth knowing up front:

- The app installs **per-user** (no admin rights needed) and lets you choose the install directory.
- First launch starts the bundled AI engine on `127.0.0.1:8000`. Windows Firewall may ask for permission — **local loopback only is enough**; you do not need to expose it to the network.
- Antivirus may briefly scan the ~750 MB of unpacked model/runtime files on first start. That is a one-time delay.

---

## 💻 System requirements

| | Minimum (it will run) | Recommended (it will run well) |
| :--- | :--- | :--- |
| **OS** | Windows 10 21H2 x64 | Windows 11 x64 |
| **CPU** | 4-core x86-64 with AVX2 | 8-core (i7 / Ryzen 7) or better |
| **RAM** | 8 GB | 16 GB+ (add ~1 GB per extra camera) |
| **Disk** | 3 GB for the app | + 50–500 GB for recorded clips, on an SSD |
| **GPU** | None — CPU fallback works | NVIDIA (CUDA/TensorRT) or Intel iGPU with current OpenVINO drivers |
| **Cameras** | 1 RTSP/USB stream | Depends on hardware — see [Performance](#-performance-honest-numbers) |

**Accelerator support**, picked automatically at startup in this order: NVIDIA TensorRT (FP16) → CUDA → Intel OpenVINO GPU → DirectML → CPU. Force CPU with the env var `CAMAI_FORCE_CPU=1` if a driver misbehaves.

---

## 🚀 Install & first run

<details open>
<summary><b>Step-by-step (5 minutes)</b></summary>

1. **Download** `CamAI-Desktop-Setup-1.0.0.exe` and verify the SHA-256.
2. **Run** the installer → *More info → Run anyway* at the SmartScreen prompt → choose an install folder → **Install**.
3. **Launch "CamAI Desktop"** from the Start menu. The splash screen waits while the AI engine boots (10–40 s on first run — models are being loaded and, on Intel GPUs, compiled).
4. **Add a camera**: *Camera Management → Add Camera*.
   - RTSP: `rtsp://user:password@192.168.1.64:554/Streaming/Channels/101`
   - USB webcam: pick the device from the dropdown
   - A video file path also works, for testing
5. **Pick an AI Mode** for the camera in *Admin Studio* — `Traffic`, `Security`, `Factory` or `Custom`. This decides which classes and rules run on that stream.
6. **Draw your geometry** in the ROI editor: counting lines, restricted zones, lanes, speed-calibration lines. Most rules do nothing until they have a shape to work with.
7. Go to **Live Monitor**. You should see the video with overlay boxes, and counts/alerts filling in.

</details>

<details>
<summary><b>Headless / server install (engine ZIP)</b></summary>

```powershell
Expand-Archive camai-engine-v1.0.0-win64.zip -DestinationPath C:\camai-engine
cd C:\camai-engine
.\camai-engine.exe            # serves http://127.0.0.1:8000
```

- Interactive API docs: `http://127.0.0.1:8000/docs`
- Register a camera: `POST /api/cameras` with `{"name": "...", "source": "rtsp://..."}`
- Live telemetry: `GET /api/cameras/{id}/telemetry`, WebSocket `/ws/telemetry`, video `GET /api/cameras/{id}/mjpeg`

> The engine does **not** loop video files. For a long file-based test, loop it with
> `ffmpeg -stream_loop -1 -i clip.mp4 -c copy long.mp4` first.

</details>

<details>
<summary><b>Uninstall</b></summary>

*Settings → Apps → CamAI Desktop → Uninstall*, or run `Uninstall CamAI Desktop.exe` from the install folder.
Recorded clips and the local SQLite database are **not** deleted with the app — remove `%APPDATA%\camai-desktop` manually if you want a clean slate.

</details>

---

## ✅ What actually works in v1.0.0

Every capability below has a real model or a real analytics implementation behind it, verified on real footage. Features that could not be delivered honestly are listed as **Coming soon** further down instead of being shipped as switches that produce nothing (or worse, invent results).

### Core engine — always on

| Capability | Implementation |
| :--- | :--- |
| **Object detection** | YOLOX-Tiny ONNX (Apache-2.0), 80 COCO classes, GPU/CPU |
| **Multi-object tracking** | ByteTrack + Hungarian matching + appearance ReID and a lost-track gallery, so IDs survive occlusion |
| **Adaptive tiling** | Small/distant objects recovered by tiled inference, resolution governed to keep the GPU in its efficient band |
| **Live video** | MJPEG at camera FPS, decoupled from AI — the video never stutters because inference is busy |
| **Telemetry** | WebSocket JSON (detections, tracks, counts, health) — overlay is drawn client-side |
| **Recording** | H.264 continuous + event clips, with a background write queue (SQLite WAL) |

### Traffic profile

| Feature | Notes |
| :--- | :--- |
| **Vehicle detection & classification** | car / truck / bus / motorcycle / bicycle |
| **Lane detection** | Geometry-driven — you draw the lanes |
| **Vehicle counting & line crossing** | Directional (in / out / both) |
| **Wrong-way detection** | Per-track heading vs the allowed direction |
| **Speed estimation (km/h)** | Real, but **requires calibration** — two lines and the true distance in metres between them |
| **ANPR — number plate** | Plate detector + CRNN OCR, both permissively licensed; India plate model included. Throttled per-track (running it every frame cost 1392 ms/frame) |
| **Helmet detection (rider)** | Dedicated helmet model, proven on real traffic footage |
| **Traffic density** | Zone occupancy over time |
| **Illegal parking** | Dwell in a no-parking polygon |

### Security profile

Intrusion detection · restricted area · perimeter (fence line) crossing · person counting · dwell time · loitering · crowd detection · object left behind · object removed · **face *detection*** (YuNet, MIT) · **fall detection** — flags a person whose tracked box becomes wider than tall (a genuine heuristic, *not* a pose model; it will miss a fall that keeps the box upright).

### Factory profile

Worker detection & counting · machine-zone / conveyor monitoring · restricted machine zone · hazard zone.

### Platform (beyond the exe)

Multi-tenant cloud portal with RBAC and row-level security · license activation & lifecycle · centralised camera/zone config push with rollback · incident logs & reports · **Telegram alerts with annotated snapshots** (live and proven end-to-end) · email delivery.

---

## 🚧 Coming soon — deliberately *not* enabled

These toggles are visible but locked, each with the honest reason shown in the UI. Several of them previously existed as fabrications (an HSV colour threshold reported "smoke" on 200/200 frames of ordinary pavement; a PPE check invented helmets at a hardcoded 0.95 confidence). Those were **removed in favour of showing nothing**.

| Feature | Why it is not on |
| :--- | :--- |
| Stop-line & red-light violation | Needs traffic-light **state** (colour). The engine sees the light as an object, not whether it is red. |
| U-turn detection | Needs per-track trajectory-angle analysis, not implemented. *Wrong-way detection works today.* |
| Queue length | Standing-queue length is not computed. *Traffic Density gives zone occupancy today.* |
| Face **recognition** | Detection is real; identifying *who* needs an enrolment flow and a known-faces DB that do not exist yet. |
| Fire / smoke detection | No licence-clean trained model integrated. Nearly all public ones are AGPL-3.0 YOLOv5/v8 derivatives, which this product moved off deliberately. |
| PPE / vest / gloves / shoes, factory hard-hat | Same reason. (Rider-helmet detection in the Traffic profile **is** real and separate.) |
| Forklift detection | No dedicated model yet. |

---

## 📊 Performance (honest numbers)

Throughput on this product is **entirely hardware-dependent**. Numbers from a benchmark box are not a promise about yours.

Measured with `server/benchmarks/pipeline_benchmark.py`:

| Configuration | FPS | Pipeline latency | Errors |
| :--- | ---: | ---: | ---: |
| OpenVINO **discrete/mid GPU**, 1 camera | 57 | 5.7 ms | 0 |
| CPU only, 1 camera | 31 | 131 ms | 0 |
| GPU, 4 cameras concurrently | 4.0–4.5 / stream | 266 ms | 0 |

**Real-world low-end datapoint** — Intel UHD 620 integrated graphics, no NVIDIA, running the full traffic stack including ANPR: **9–11 FPS** on one camera. On that class of hardware the 25–60 FPS figure is **not achievable**, and the product should be sized accordingly. (Before the ANPR throttling fix the same machine managed 0.6 FPS.)

Rules of thumb:

- Budget roughly **one CPU core and ~1 GB RAM per camera** beyond the base app.
- ANPR and helmet passes are extra inference on top of detection — enable them only on the cameras that need them.
- More cameras trade FPS per stream, not stability: the 4-camera run above completed with zero stage errors.

---

## 🏗️ How it is put together

```mermaid
graph LR
    A[RTSP / USB / NVR / file] --> B[Capture]
    B --> C[Decode]
    C --> D[MJPEG stream to UI]
    C --> E[H.264 recorder]
    C --> F[AI inference<br/>YOLOX + ANPR/helmet/face passes]
    F --> G[ByteTrack + analytics rules]
    G --> H[(SQLite WAL<br/>async write queue)]
    G --> I[Telemetry build]
    I --> J[WebSocket to Desktop / Portal]
    G --> K[Alerts → Telegram / email / cloud]
```

Video and AI are **decoupled on purpose**: MJPEG carries frames at camera FPS while the WebSocket carries AI telemetry only. No frame ever travels over the WebSocket, and the canvas is a pure overlay — so slow inference degrades the boxes, never the picture.

---

## 🔒 Privacy & data

- **All inference is local.** Video frames are never uploaded — not to us, not to any model API.
- What *can* leave the machine, only if you configure it: event metadata (counts, plate text, timestamps), alert snapshots to your own Telegram bot, and licence/heartbeat pings to your Supabase project.
- Recordings and the event database stay in your local app data folder.

---

## 🐞 Known limitations in this build

| | |
| :--- | :--- |
| **Unsigned installer** | SmartScreen warning on every fresh install. Verify by SHA-256. |
| **Electron 31** | The desktop shell runs an Electron version that is past end-of-life for security patches. A shell upgrade is the top item for the next release. |
| **Speed needs calibration** | Uncalibrated cameras produce meaningless km/h. Draw the two calibration lines and enter the real distance. |
| **≤6 live tiles per host** | Every MJPEG tile pins one browser/Chromium connection and the per-host cap is 6 — a 7th tile *and* any concurrent engine request will stall. Use fewer tiles or the fullscreen viewer. |
| **Windows x64 only** | No macOS, Linux or ARM build in v1.0.0. |
| **First start is slow** | 10–40 s while models load and OpenVINO compiles kernels for your GPU. Subsequent starts are faster. |

---

## 🆘 Troubleshooting

<details>
<summary><b>SmartScreen blocks the installer</b></summary>

Expected — the build is unsigned. Verify the SHA-256, then *More info → Run anyway*.
</details>

<details>
<summary><b>App opens but every camera shows "connecting"</b></summary>

The engine did not start or is not reachable on `127.0.0.1:8000`.

```powershell
curl http://127.0.0.1:8000/health
```

If that fails, check that Windows Firewall did not block the loopback listener, and look at the engine log in `%APPDATA%\camai-desktop\logs`.
</details>

<details>
<summary><b>Video plays but there are no detection boxes</b></summary>

1. Check the camera's **AI Mode** in Admin Studio — the profile decides which classes are even looked for.
2. Rules that need geometry (counting, intrusion, speed, lanes) stay silent until you draw the shape.
3. Confirm telemetry is actually flowing: `GET /api/cameras/{id}/telemetry` should show a non-zero FPS and detection count.
</details>

<details>
<summary><b>Very low FPS / the machine is pegged</b></summary>

1. Turn ANPR and helmet passes off on cameras that do not need them — they are the expensive passes.
2. Reduce the number of live tiles (see the 6-connection cap above).
3. On a flaky GPU driver, force CPU: set `CAMAI_FORCE_CPU=1` and restart.
4. On an integrated GPU, expect ~10 FPS with the full traffic stack. That is the hardware, not a misconfiguration.
</details>

<details>
<summary><b>RTSP URL will not connect</b></summary>

Test the exact URL in VLC first (*Media → Open Network Stream*). If VLC cannot play it, the URL, credentials or codec is the problem, not CamAI. Sub-streams (`.../Channels/102`) are much cheaper than main streams and are usually enough for analytics.
</details>

---

## 📚 Documentation

| Topic | Where |
| :--- | :--- |
| Full docs set (14 documents) | [`docs/`](docs/) |
| Architecture & source walkthrough | [`docs/03_SOFTWARE_ARCHITECTURE.md`](docs/03_SOFTWARE_ARCHITECTURE.md), [`docs/04_SOURCE_CODE_DOCUMENTATION.md`](docs/04_SOURCE_CODE_DOCUMENTATION.md) |
| AI engine internals & tuning | [`docs/05_AI_ENGINE_DOCUMENTATION.md`](docs/05_AI_ENGINE_DOCUMENTATION.md) |
| REST / WebSocket API | [`docs/06_REST_WEBSOCKET_API.md`](docs/06_REST_WEBSOCKET_API.md) |
| Operator guide | [`USER_GUIDE.md`](USER_GUIDE.md) |
| Engineering changelog for this release | [`RELEASE_NOTES_v1.0.0.md`](RELEASE_NOTES_v1.0.0.md) |
| Licensing of bundled models | [`LICENSING.md`](LICENSING.md) |

---

## ⚖️ Licensing of what is inside

All bundled model weights are **permissively licensed** — Apache-2.0 or MIT (YOLOX, YuNet face detection, the plate detector and OCR). AGPL-3.0 YOLOv5/v8 weights were deliberately removed from both the source **and** the shipped executable, so this binary can be redistributed commercially without copyleft obligations. Details in [`LICENSING.md`](LICENSING.md).

---

<p align="center">
  <sub>CamAI Desktop v1.0.0 · Windows x64 · built 2026-07-25 · engine build 2026-07-24<br>
  SHA-256 <code>df4a97c539456e415cf0fc5f665cd1cc0797f2e26e02fb9c01f4e1e7de798dc5</code></sub>
</p>
