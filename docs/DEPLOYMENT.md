# Deployment & Release

There is no Docker/container-based deployment path in this repository (see [`INSTALLATION.md`](INSTALLATION.md)). Each workspace ships through its own native toolchain.

## 1. AI engine → standalone executable

The engine that ships inside the desktop installer is a frozen PyInstaller build, produced by `server/build_engine.ps1`:

```powershell
pwsh -ExecutionPolicy Bypass -File server/build_engine.ps1
```

This creates an isolated build venv (`server/.venv-build`), installs `server-requirements.txt` + PyInstaller, and freezes `run_engine.py` (via `camai-engine.spec`) into `server/dist/camai-engine/camai-engine.exe`. It's a one-time packaging step meant to run on a build machine, not something end users run — expect multiple GB of disk usage and 30+ GB free space recommended. `desktop/package.json`'s `extraResources` then bundles that output as `engine/camai-engine.zip` inside the installer.

`desktop/package.json` wires this up as `npm run build:engine`; `npm run build:full` runs it before building the desktop app itself.

## 2. Desktop installer

```bash
cd desktop
npm run build         # tsc -> vite build -> electron-builder --win -> checksum -> verify-signature
# or, including a fresh engine build:
npm run build:full
```

`electron-builder` produces an NSIS installer (`release/CamAI-Desktop-Setup-<version>.exe`). `desktop/scripts/checksum.cjs` writes a companion `.sha256` file next to it; `desktop/scripts/verify-signature.cjs` verifies code signing before the build is considered done. An Admin Studio variant is built with `npm run build:admin`, using `electron-builder.admin.json`.

**Code signing:** v1.0.0 ships deliberately unsigned — a code-signing certificate is bound to a legal identity and isn't transferable, so the acquirer signs future builds under their own. `verify-signature.cjs` only *fails the build* if signing was actually requested (via `CSC_LINK`/`WIN_CSC_LINK`/etc. or `build.win.certificateFile` in `package.json`) and didn't produce a valid Authenticode signature — an unsigned build with no signing requested passes, logging a SmartScreen warning note.

**Publishing a release:** the AI engine and model weights are gitignored (proprietary/licensed — see `server/models/`), so there is no way to build the full installer on a stock GitHub Actions runner; releases are cut locally, on the build machine that already has the engine and models. Bump `desktop/package.json`'s `version`, then run:

```bash
cd desktop
GH_TOKEN=<a token with repo:release write access> npm run release        # or release:full to rebuild the engine first
```

This runs the same build as `npm run build`, then `electron-builder --win --publish always` creates the GitHub Release for the current `version` (tag `v<version>`) if it doesn't exist and uploads the installer, its `.blockmap`, and `latest.yml`; `scripts/publish-checksum.cjs` then attaches the `.sha256` to the same release. `desktop/package.json`'s `build.publish` points at `sutharprin098/visionguarda` with `private: true` (electron-builder authenticates the upload with `GH_TOKEN`, since the repo has no anonymous/public release access — see `supabase/functions/download-release`). Never create the release manually and separately from the build — that's what left v1.0.0 with a tag and a local installer but no GitHub Release, breaking the Downloads page's direct link for weeks.

The portal's Downloads page reads releases live via the `github-releases` Edge Function — there's nothing to register or upload into Supabase, and the page never hashes the multi-hundred-MB installer itself; it reads the small `.sha256` companion file. Because the repo is private, the plain `github.com/.../releases/download/...` URL only resolves for a browser session authenticated to GitHub with repo access — the portal's own download button instead calls the `download-release` Edge Function, which resolves a short-lived signed URL server-side using a `GITHUB_TOKEN` Supabase secret, so a portal user never needs a GitHub login. Configure `GITHUB_RELEASES_REPO` and `GITHUB_TOKEN` as Supabase Edge Function secrets for both `github-releases` and `download-release`.

## 3. Supabase backend

```powershell
.\deploy_supabase.ps1
```

Applies all migrations, deploys every Edge Function, and sets up Telegram alert secrets, driven entirely by the Supabase Management API (personal access token — no direct DB password needed). See [`DATABASE.md`](DATABASE.md#deploying-a-fresh-supabase-project) for the manual/step-by-step equivalent and what each secret is for.

Telegram-specific setup (webhook registration, bot command menu) can be run standalone via `supabase/deploy_telegram.ps1`.

## 4. Portal + Edge Functions

```powershell
.\deploy_website.ps1                  # build + deploy portal (Vercel) and edge functions together
.\deploy_website.ps1 -SkipFunctions   # portal only
.\deploy_website.ps1 -SkipPortal      # edge functions only
.\deploy_website.ps1 -CheckOnly       # reachability preflight only, no deploy
```

Portal and Edge Functions are deployed together deliberately — a change to a form on the portal and the validation that backs it in an Edge Function need to ship in the same step, or the UI can promise something the backend still rejects.

**Network reachability to Vercel/GitHub from this environment has been observed to be intermittent** (working in some sessions, blocked in others). Always run `deploy_website.ps1 -CheckOnly` before promising or attempting a deploy, rather than assuming connectivity.

## Release checklist

1. `server/build_engine.ps1` — freeze the engine
2. `desktop && npm run build:full` — build the installer against the fresh engine
3. Attach the installer + `.sha256` to a GitHub Release
4. `deploy_supabase.ps1` if schema/functions changed
5. `deploy_website.ps1` if the portal or its supporting edge functions changed
