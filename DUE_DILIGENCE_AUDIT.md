# CamAI — Enterprise Due Diligence Audit

Prepared 2026-07-12 for an outright source-code + IP sale. This report is
based on a full read of the repository (194 tracked files across
`client/`, `server/`, `portal/`, `desktop/`, `supabase/`, root), every
dependency manifest, every `.env*` file, full `git log --all` history, and
every on-disk model/asset file. Every finding below cites the exact file
and, where applicable, line number. Anything that could not be verified
from the repository alone is stated explicitly — nothing is guessed.

Companion documents already in the repo, cross-checked against this audit
and found accurate: `LICENSE`, `LICENSING.md`, `README.md`, `PLATFORM.md`,
`HANDOVER.md`, `DEPLOYMENT.md`.

---

## 1. Project Overview

CamAI is a real-time CCTV video-analytics platform: multi-camera YOLO11
detection + segmentation, persistent multi-object tracking (original
ByteTrack-style implementation with appearance ReID), zone/line/dwell/
speed/crowd/parking analytics, recording, plus an enterprise licensing
and multi-tenant SaaS platform (portal + Windows desktop app on Supabase).

## 2. Architecture

| Workspace | Role | Stack |
|---|---|---|
| `server/` | Local AI engine — cameras in, telemetry out | FastAPI, OpenVINO/ONNX Runtime, YOLO11-seg, original ByteTrack-style tracker |
| `client/` | Local CCTV viewer (MJPEG video + WebSocket telemetry overlay) | React 18, Vite, Tailwind |
| `portal/` | SaaS admin portal (orgs, users, roles, licenses, devices, cameras) | React, Supabase JS, Recharts |
| `desktop/` | Windows app, license activation, DPAPI vault | Electron 31, electron-builder (NSIS) |
| `supabase/` | Multi-tenant backend: Postgres + RLS, Auth, Realtime, 12 Edge Functions | Supabase (Deno) |

Video/AI are decoupled (MJPEG for frames, WebSocket for AI-only telemetry;
canvas is overlay-only). Per-camera pipeline is a 5-module slot design
(capture → detect → track → analyze → publish), measured at 30 fps /
~10 ms avg AI-cycle latency on Intel iGPU. Source: `README.md:50-57`.

---

## 3. Dependency Inventory

### 3a. JavaScript/TypeScript (5 workspaces, ~966 resolved packages incl. transitive)

Root, `client/`, `desktop/`, `portal/`, `server/` each have their own
`package.json` + lockfile; `node_modules` installed for all 5, so licenses
below were read from installed packages, not inferred.

**Result: every resolved package (direct + transitive) is MIT, ISC,
Apache-2.0, or BSD-2-Clause. Zero GPL/AGPL/LGPL/MPL/SSPL/BUSL packages
anywhere in the JS/TS stack.**

Key direct dependencies:

| Package | Version | License | Workspace | Notes |
|---|---|---|---|---|
| react, react-dom | 18.3.1 | MIT | client, portal, desktop | |
| electron | 31.7.7 | MIT | desktop | Safe for closed-source commercial distribution (Electron's own FAQ endorses this; used by Slack/VS Code/Discord) |
| electron-builder | 24.13.3 | MIT | desktop | NSIS installer target (zlib/bzip2-licensed, standard) |
| @supabase/supabase-js | 2.110.2 | MIT | desktop, portal | |
| @tanstack/react-query | 5.101.2 | MIT | client, portal | |
| recharts | 3.9.2 | MIT | portal | |
| lucide-react | 0.395.0 | ISC | client, desktop, portal | ISC = MIT-equivalent permissive |
| vite, typescript, tailwindcss | latest pinned | MIT/Apache-2.0 | all | build tooling |

Two cosmetic (non-legal) hygiene notes: `spawn-command@0.0.2` (transitive
of root's `concurrently`) has no `"license"` field in its own
`package.json` but ships an MIT `LICENSE` file; `busboy`/`streamsearch`/
`dynamic-dedupe` (transitive of `ts-node-dev`) use the legacy `licenses[]`
array format instead of SPDX — both confirmed MIT, will just trip an
automated SPDX scanner.

**`server/package.json` is dead weight** — declares an Express/Node
dependency set (`express`, `cors`, `multer`, etc., all MIT) but the actual
server is 100% Python; no `.js`/`.ts` server source exists. Leftover from
an earlier Node backend, superseded (see commit `156e7ca8`, "Repo hygiene:
untrack artifacts, remove legacy Node inference server"). Recommend
removing before buyer handoff to avoid due-diligence confusion — not a
licensing risk, just clarity.

### 3b. Python (`server/` — only real dependency manifests in the repo)

No `requirements.txt`, `pyproject.toml`, or `poetry.lock` exists anywhere.
The two manifests are `server/server-requirements.txt` (production) and
`server/dev-requirements.txt` (adds 2 dev-only packages via `-r`).

| Package | Version | File:Line | License | Commercial | SaaS | Closed-source dist. | Risk |
|---|---|---|---|---|---|---|---|
| fastapi | 0.111.1 | server-requirements.txt:1 | MIT | Yes | Yes | Yes | None |
| uvicorn[standard] | 0.23.2 | server-requirements.txt:2 | BSD-3 | Yes | Yes | Yes | None |
| opencv-python-headless | 4.8.1.78 | server-requirements.txt:3 | Apache-2.0 | Yes | Yes | Yes | None (headless variant confirmed) |
| openvino | 2026.2.1 | server-requirements.txt:8 | Apache-2.0 | Yes | Yes | Yes | None |
| onnxruntime | 1.27.0 | server-requirements.txt:9 | MIT | Yes | Yes | Yes | None |
| numpy | 1.26.4 | server-requirements.txt:11 | BSD-3 | Yes | Yes | Yes | None |
| pillow | 10.2.0 | server-requirements.txt:12 | HPND | Yes | Yes | Yes | None |
| python-multipart | 0.0.7 | server-requirements.txt:13 | Apache-2.0 | Yes | Yes | Yes | None |
| scipy | 1.13.1 | server-requirements.txt:17 | BSD-3 | Yes | Yes | Yes | None — powers the Hungarian-algorithm assignment in the original tracker (`pipeline.py:205`) |
| imageio-ffmpeg | 0.6.0 | server-requirements.txt:22 | BSD-2 (wrapper) | Yes | Yes | Conditional | **Bundles a static ffmpeg binary built with libx264 = GPL-2.0+.** Invoked as a subprocess from `server/app/recorder.py` — "mere aggregation," doesn't taint CamAI code, but the binary itself carries GPL source-availability obligations if redistributed as-is. |
| pytest | 8.3.3 | dev-requirements.txt:2 | MIT | Yes | N/A (dev) | Yes | None |
| **ultralytics** | 8.4.90 | dev-requirements.txt:8 | **AGPL-3.0-only** | No (w/o commercial license) | **No** | **No** | Dev-only; gated behind `try/except ImportError` in `backend.py:21-26`, used only as a last-resort `.pt` fallback when exports are missing. Confirmed **not** a production runtime dependency (`server-requirements.txt` never references it). |

TensorRT and PyTorch/TorchVision appear only as unpinned optional
fallback imports (`backend.py:23`, `main.py:243-244`) — neither is in
either requirements file, so on a stock install these code paths silently
no-op. GPU acceleration requires the buyer to separately install
`onnxruntime-gpu` (noted at `server-requirements.txt:4-6`).

**Confirmed absent** (recursively searched all of `server/`): YOLOv5/v8/
v9/v10 as packages, SAM/SAM2/SAM3, Roboflow, Grounding DINO, Florence-2,
PaddleOCR, EasyOCR, pytesseract/Tesseract, HuggingFace transformers/
huggingface_hub, Detectron2, MMDetection, boxmot/deep-sort-realtime or
any other third-party tracker package.

---

## 4. AI Model Inventory

None of the model weight files below are tracked in git (`git ls-files |
grep -E "\.pt$|\.onnx$|openvino_model"` → empty; excluded by
`.gitignore:9-11`). They exist only on the local disk of whoever is
running the engine.

| File(s) | Origin | License | Auto-downloaded? | Redistributed via git? |
|---|---|---|---|---|
| `server/yolo11{n,s,m}-seg.pt/.onnx` + `*_openvino_model/{*.bin,*.xml}` (9 files) | Ultralytics YOLO11-seg, trained on COCO. Confirmed by embedded export metadata: `server/yolo11n-seg_openvino_model/metadata.yaml:1-5` — `author: Ultralytics`, `version: 8.4.90`, `license: AGPL-3.0 License (https://ultralytics.com/license)` | **AGPL-3.0** | No — `backend.py:197-219` and `export_models.py:15` only call `YOLO(path)` after confirming the file already exists locally; no bare-name auto-fetch in any code path | No |
| Root `./yolov8n-seg.pt` | Dead/unused leftover. Not referenced anywhere in code (repo-wide search for "yolov8" = 0 hits outside this filename); not in git history at all; 6.7MB size and single-instant creation timestamp (2026-07-08 13:43) match Ultralytics' stock auto-download behavior when `YOLO("yolov8n-seg.pt")` is run from a directory without the file present. Predates the current YOLO11 set. | AGPL-3.0 (moot — unused) | N/A | No |

**AGPL risk is real and singular**: the AGPL-3.0 license attaches to the
weights themselves (and their ONNX/OpenVINO export derivatives), not
just the `ultralytics` package — so even though the package is out of
the runtime, the model files a buyer would deploy remain AGPL-encumbered
until one of the three remediation paths in §9 below is taken.

**Action item**: delete the unused root `yolov8n-seg.pt` before buyer
handoff — an unreferenced AGPL-licensed binary sitting in the repo root
is exactly the kind of thing buyer's counsel flags. (`LICENSING.md` does
not currently mention this file.)

## 5. Dataset Inventory

No dataset directories, no bundled training data. One flagged asset:
`client/public/person_sample.jpg` (106,847 bytes) is **tracked in git**
but not referenced anywhere in `client/src/**` or `client/index.html`
(zero code references found). Filename and format strongly suggest a
stock/sample photo of a person used at some point for detection testing.
`git log --follow` shows only the single initial-import commit
(`58dc4b33`) with no provenance or attribution comment. **Origin/license
could not be verified from the repository alone** — flag for the seller
to source or remove before redistribution, since it appears to depict an
identifiable person (PII/likeness risk — see §18).

## 6. Third-Party Code Inventory

`LICENSING.md` (root, dated 2026-07-11) states all first-party code
(`server/app/`, `client/`, `portal/`, `desktop/`, `supabase/`) is original
and transfers with the sale — cross-checked against the actual source and
confirmed accurate for every claim it makes (tracker is original, not a
`boxmot`/DeepSORT import; parking-occupancy scorer is original OpenCV/
NumPy statistics, not a third-party algorithm).

A repo-wide grep for common copied-code markers (`Copyright (c)`,
`Source:`, `Adapted from`, `Based on`, `stackoverflow.com`, external
`github.com/<owner>/<repo>` URLs in comments) found no genuine hits — the
only `github.com/...` match is a self-referential support link
(`portal/src/pages/app/Support.tsx:75`) to the project's own private
repo. **Caveat**: absence of attribution comments is evidence of a clean
commenting style, not proof no code was ever copied or AI-assisted — a
keyword grep cannot detect uncredited copying. Disclose this as an audit
limitation, not a guarantee of originality.

---

## 7. Open Source Compliance Summary

| License family | Found? | Where |
|---|---|---|
| MIT / ISC / BSD / Apache-2.0 / HPND | Yes, ~980 packages | Entire JS/TS stack + entire Python runtime stack |
| **AGPL-3.0** | **Yes — model weights only** | `server/yolo11*-seg.*` (all 9 files), root `yolov8n-seg.pt` (unused); the `ultralytics` pip package (dev-only, not shipped) |
| GPL-2.0+ | Yes — one bundled binary | `imageio-ffmpeg`'s vendored static ffmpeg binary (libx264); invoked via subprocess = mere aggregation |
| LGPL, MPL, SSPL, BUSL | **None found** | — |

## 8. AGPL Risk

**High, but scoped and already correctly disclosed.** The only AGPL
exposure in the entire codebase is the YOLO11-seg model weights (§4).
The `ultralytics` package that produced them is confirmed dev-only and
never touches the production runtime. This is a model-licensing problem,
not a code-contamination problem — CamAI's own source is not AGPL-tainted.
Three remediation paths exist and are already documented in
`LICENSING.md:42-51` (Ultralytics Enterprise license / swap detector /
full AGPL compliance). See §22 for cost framing.

## 9. GPL Risk

**Low.** Confined to the ffmpeg binary bundled inside `imageio-ffmpeg`
(libx264, GPL-2.0+), invoked strictly as a subprocess from
`server/app/recorder.py` — standard "mere aggregation," does not require
CamAI's own source to be GPL'd. If redistributing, either require ffmpeg
as a separately-installed prerequisite or pass through the GPL notice +
source-availability statement for that one binary. `LICENSING.md:67-72`
already states this correctly.

## 10. Commercial Risk

Low outside of the AGPL item. Every runtime dependency across both stacks
(FastAPI, OpenVINO, ONNX Runtime, React, Electron, Supabase JS, etc.) is
permissively licensed and explicitly commercial-use-safe. The one
material commercial blocker is the YOLO11 weights (§8).

## 11. Source Code Sale Risk

Medium-low. `LICENSE` (root) is a clean proprietary/all-rights-reserved
grant appropriate for an asset-purchase transfer — no license is granted
except by written agreement, exactly the posture needed for an outright
sale. The AGPL weights are the one item a buyer's counsel will insist on
resolving (or explicitly accepting as a post-close TODO) before the
product can be redistributed to the buyer's own customers.

## 12. SaaS Risk

The AGPL-3.0 license is a *network* copyleft — it triggers on any
network-accessible use, not just distribution, which is more restrictive
for CamAI's SaaS portal/hosted-engine ambitions than for a pure desktop
sale. This makes the YOLO11 weights the highest-priority item to resolve
specifically because CamAI's own roadmap includes SaaS delivery
(portal + realtime sync), not just an offline desktop app.

## 13. Desktop Distribution Risk

Low. Electron (MIT) + electron-builder (MIT) + NSIS installer are
well-established as safe for closed-source commercial desktop
distribution. No DRM/Widevine or proprietary codec integration found in
`desktop/vite.config.ts` or the `build` config
(`desktop/package.json:33-49`). One portability issue (not legal):
`desktop/scripts/wrap7za.cs:11` hardcodes an absolute path
(`D:\camAI\desktop\node_modules\7zip-bin\win\x64\7za.exe`) that will
break on the buyer's machine/CI — fix before handoff.

## 14. Patent Risk

**Could not be verified from the repository.** No patent filings,
patent-pending markers, or third-party patent-licensing terms appear
anywhere in the source, docs, or dependency licenses. This requires a
direct answer from the seller (has any patent application ever been
filed on the tracker, ReID, or analytics algorithms?) — not something a
code audit can determine either way.

## 15. Trademark Risk

Low. `LICENSING.md:80-83` states "CamAI" naming/branding transfers with
the sale and no third-party trademarks are used in the product UI —
confirmed by the third-party-assets sweep in §5/§17 (only found generic
generated icons and one unattributed photo, no logo marks).

## 16. Security Risk

Low-Medium. No critical secrets found (§17). The system's actual security
boundary is Postgres RLS: a Supabase anon/publishable key is intentionally
compiled into every distributed desktop binary
(`desktop/electron/main.ts:7-8`) — this is Supabase's standard public-key
model, safe *only if* RLS is airtight on every table. This is a
design-review item for the buyer, not a leak. Separately: the local AI
engine binds `127.0.0.1` by default with no auth of its own by design
(`README.md:87-89`) — exposing it beyond loopback requires the buyer to
add a proxy/auth layer. **No containerization and no CI/CD pipeline
exist anywhere in the repo** (confirmed: no `Dockerfile`, no
`docker-compose*`, no `.github/workflows`, no other CI config) — there is
no automated test gate or reproducible build/deploy pipeline, a gap for
an enterprise buyer's engineering diligence.

## 17. Secret Exposure

**Verified clean.** Full `git log --all` (30 commits, 2026-07-10 through
2026-07-12, single branch `main` + tag `v1.0.0`) was regex-scanned for
Replicate/AWS/GitHub/JWT/PEM-key/Supabase-service-role patterns —
zero matches for any literal secret value. `server/.env`, `portal/.env`,
`portal/.env.local` exist on disk but are confirmed **never committed**
(`.gitignore` + `git log --all -- <path>` returns nothing for each). The
one hardcoded credential found, a Supabase anon/publishable JWT in
`desktop/electron/main.ts:7-8`, is public-safe by design (see §16).
`portal/.env.local` contains a short-lived Vercel OIDC token
(~12h expiry) — low blast radius. `supabase/functions/_shared/util.ts`
references `SUPABASE_SERVICE_ROLE_KEY` and `CAMAI_AES_KEY` only via
`Deno.env.get()`, never as literal values.

**Replicate token**: confirmed the leaked token string does not appear
in any commit reachable from current refs; the repo's earliest reachable
commit (`58dc4b33`, 2026-07-10) is consistent with a successful
history-rewrite. **Two caveats that remain outside what a repo audit can
confirm**: (1) `HANDOVER.md` states the seller retains a "pre-rewrite
bundle" — if that still exists anywhere, it still contains the token and
should be destroyed once revocation is confirmed; (2) GitHub can retain
force-pushed-away objects by exact SHA for a retention window even off
any ref — not testable without an old SHA, which by design we don't have.
**Action item carried over: revoke the Replicate token at replicate.com**
— this is the only fully reliable remediation regardless of purge
success, and it is still unconfirmed whether this has been done.

## 18. PII Risk

Low-Medium. `client/public/person_sample.jpg` (§5) is a photo apparently
depicting an identifiable person, tracked in git, unreferenced in code,
with no attribution or consent documentation found in the repo. Source/
consent status could not be verified — recommend the seller confirm
provenance or remove it before any redistribution. No other PII (customer
data, camera footage, personal records) is tracked in git — recordings
under `server/history/recordings/` (557 files) are runtime-generated and
gitignored (`.gitignore:28`), not part of the transferable history.

## 19. IP Ownership Assessment

All first-party source (`server/app/`, `client/`, `portal/`, `desktop/`,
`supabase/`) is represented as original work in `LICENSING.md:7-24`, and
spot-checks (tracker implementation, parking-occupancy scorer) confirm
original, from-scratch code rather than repackaged third-party
algorithms. **What cannot be verified from the repository**: whether any
past contractor or freelancer contributed code, and if so, whether a
signed IP-assignment agreement exists. Git history shows a single squash
commit as the earliest point (`58dc4b33`, "push 01") — authorship
attribution for work prior to that point is not reconstructable from git
alone. This must be confirmed directly with the seller as a transaction
representation/warranty, not something code inspection can settle.

## 20. Redistribution Rights

- CamAI's own code: fully redistributable under whatever agreement the
  sale contract specifies (`LICENSE` grants no rights except by written
  agreement — exactly the posture needed).
- All JS/TS and Python runtime dependencies: freely redistributable
  (permissive licenses, §3).
- YOLO11 weights: **not** redistributable to the buyer's own customers
  without one of the three remediations in §8/§22.
- ffmpeg binary (via imageio-ffmpeg): redistributable with GPL notice/
  source-availability pass-through, or kept as a separate prerequisite.
- `person_sample.jpg`: redistribution rights unverified (§5/§18).
- Supabase backend: runs on the buyer's own (or self-hosted, Apache-2.0)
  Supabase project — no proprietary Supabase code is vendored.

## 21. Missing Documentation

- No `NOTICE` file at repo root (`LICENSING.md` substantively covers the
  same ground, informally).
- No `CONTRIBUTING.md`, no `SECURITY.md`.
- No documented IP-assignment/CLA history for any past contractor —
  must come from the seller directly (§19).
- No containerization and no CI/CD config anywhere (§16) — no automated
  build/test/release pipeline for a buyer to inherit.
- `person_sample.jpg` has no attribution/source comment.
- `LICENSING.md` does not currently mention the unused root
  `yolov8n-seg.pt` file — minor addendum needed.

## 22. Required Commercial Licenses

| Item | License needed | Est. cost driver |
|---|---|---|
| YOLO11-seg weights (Ultralytics) | Ultralytics Enterprise License (if keeping the model as-is), **or** re-detector swap engineering cost (YOLOX/RT-DETR/D-FINE — permissive), **or** AGPL compliance (source disclosure — generally incompatible with a closed-source resale) | Enterprise license pricing is Ultralytics' commercial rate card (varies by deployment scale — not obtainable from this repo, must be quoted directly by Ultralytics); model-swap is an engineering cost (export + post-processing adaptation + revalidation against the existing `backend.py` pipeline) |
| ffmpeg binary redistribution | None required if kept as a separate prerequisite install; GPL notice pass-through if bundled | Documentation/packaging cost only |

No other component in the dependency tree requires a commercial license.

## 23. Recommended Replacements

If avoiding the AGPL/Ultralytics-Enterprise path: YOLOX (Apache-2.0),
RT-DETR (Apache-2.0), or D-FINE (Apache-2.0) are drop-in candidates since
`EngineBackend` already consumes standard ONNX with first-party pre/post
processing (`server/app/ai/backend.py`) — the integration surface is the
export step and any postprocessing differences (anchor-free vs.
anchor-based heads, mask-decode format for segmentation variants), not a
pipeline rewrite.

---

## 24. Critical Blockers

1. **YOLO11-seg model weights are AGPL-3.0** and the current product
   cannot be redistributed/sold to end customers as-is without one of the
   three remediations in §8/§22. This is the single deal-relevant legal
   blocker in the entire codebase.

## 25. High Risk Issues

1. Replicate API token revocation at replicate.com is still unconfirmed
   from repo evidence alone (§17) — must be confirmed directly with the
   seller before close.
2. No containerization or CI/CD pipeline exists anywhere (§16/§21) — an
   enterprise buyer's engineering diligence will flag this as a gap in
   deployment maturity, independent of code quality.
3. `person_sample.jpg` — unverified provenance/consent for a photo of an
   identifiable person, tracked in git (§5/§18).
4. IP-assignment history for any past contractor cannot be verified from
   the repo and must be a seller representation (§19).

## 26. Medium Risk Issues

1. Unused root `yolov8n-seg.pt` — dead AGPL-licensed file, unreferenced,
   should be deleted before handoff (§4).
2. `server/package.json` — vestigial Node/Express dependency set for a
   server that is actually 100% Python; recommend removing for clarity
   (§3a).
3. `desktop/scripts/wrap7za.cs:11` hardcodes an absolute developer-machine
   path that will break the build on the buyer's machine (§13).
4. GitHub API dependency for release hosting
   (`supabase/functions/github-releases`, `download-release`) — buyer
   must either keep using GitHub (private repo + PAT) or re-point these
   functions to their own release host.
5. Supabase anon key hardcoded into the desktop binary — standard/safe
   pattern, but the entire security model rests on RLS coverage being
   complete; worth an explicit RLS audit as part of the sale (§16).

## 27. Low Risk Issues

1. Two SPDX-formatting-only quirks in transitive JS packages
   (`spawn-command`, `busboy`/`streamsearch`/`dynamic-dedupe`) — all
   confirmed MIT, will just trip automated scanners (§3a).
2. No `NOTICE` file (informally covered by `LICENSING.md`) (§21).
3. No `CONTRIBUTING.md`/`SECURITY.md` (§21).
4. SMTP provider must be buyer-supplied — no vendor lock-in, just a setup
   step (`supabase/functions/send-email/index.ts`).

---

## 28. Buyer Readiness Score: 7 / 10

Clean permissive-license stack across ~980 JS/Python packages, no secret
leaks in current history, clear proprietary LICENSE grant, and an already
accurate LICENSING.md/HANDOVER.md pair. Held back by the unresolved AGPL
model-weight decision (§8), the unconfirmed Replicate token revocation,
and the unverified photo/IP-history items a buyer's counsel will ask
about in diligence.

## 29. Enterprise Readiness Score: 5 / 10

Strong engineering (5-module pipeline, original tracker, multi-tenant RLS
platform, license/device-binding system) undercut by the complete absence
of containerization and CI/CD — an enterprise buyer evaluating
operational maturity, not just code quality, will see no reproducible
build pipeline and no automated test gate to inherit.

## 30. Acquisition Readiness Score: 6 / 10

The deal is fundamentally clean (no code-level IP contamination, no
active secret leaks, working proprietary license grant) but has one
critical blocker (AGPL weights) that must be resolved or explicitly
priced into the deal before close, plus a short list of concrete,
inexpensive pre-close cleanup items (delete dead files, confirm token
revocation, fix hardcoded paths, get a seller representation on
contractor IP history). None of these are structural — all are closeable
in days, not months.

---

*Evidence for every finding above was gathered by direct repository
inspection (file reads, `git log --all` history scan, installed
`node_modules` license fields, embedded model export metadata) on
2026-07-12. Where a claim could not be independently verified from the
repository, that limitation is stated explicitly in the relevant section
rather than assumed.*
