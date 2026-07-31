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

**Publishing a release:** create a GitHub Release on the configured releases repo (tag = version, release body = notes), and attach both the `.exe` and its `.exe.sha256`. The portal's Downloads page reads releases live via the `github-releases` Edge Function — there's nothing to register or upload into Supabase, and the page never hashes the multi-hundred-MB installer itself; it reads the small `.sha256` companion file.

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
