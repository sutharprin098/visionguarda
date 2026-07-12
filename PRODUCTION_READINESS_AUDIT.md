# CamAI — Production Readiness Audit

Prepared 2026-07-12, on top of commit `bb6fdd1` (working tree has uncommitted
fixes from this audit, listed below — not yet committed pending your review).
Scope: full platform (`portal/`, `desktop/`, `client/`, `server/`, `supabase/`).

**Read this section first.** This audit found and fixed three genuine,
previously-undetected production bugs — one of them a privilege-escalation
gap — on top of two *prior* "complete" audit passes recorded in project
history. That track record is itself the reason this report does not declare
the platform "100% verified, zero issues": a purely static/live-data audit
cannot substitute for driving the actual UI, the actual Electron app, and the
actual AI pipeline against real hardware. Section 5 states exactly what was
and wasn't exercised, so you can weigh the score correctly.

---

## 1. Issues found and fixed this session

| # | Issue | Root cause | Fix | Evidence |
|---|---|---|---|---|
| 1 | Cameras added successfully but never appeared in the Cameras table | `cameras_read` RLS policy ↔ `camera_assignments` RLS policy queried each other — genuine infinite recursion (Postgres `42P17`), present since the tables' first migration (0002). Insert succeeded (service-role edge function bypasses RLS); the follow-up SELECT from the browser errored, and the frontend never checked `.error`. | `supabase/migrations/0021_fix_camera_rls_recursion.sql` — moved the cross-table (and `camera_group_members` self-table) lookups into `SECURITY DEFINER` helper functions, which bypass RLS the same way `app.current_org_id()`/`app.has_perm()` already do. | Reproduced live via a simulated RLS session (`42P17` error), fixed, re-verified same session now returns rows correctly. |
| 2 | Migration 0020 (super-admin RLS bypass on camera tables, status-enum widening) existed in git but was never applied to production | Migration written, never pushed | Applied via `supabase db push` | `supabase migration list --linked` showed 0001–0019 applied, 0020 missing; now shows applied. |
| 3 | `Cameras.tsx` add/edit/delete/enable/disable/assign all silently swallowed Supabase errors (`.data` read, `.error` ignored) | Any future backend error (not just #1) would render identically to an empty/no-op state, invisible to the user | List query now throws on error (surfaced in a dismissible banner); every mutation checks `.error` and surfaces it | Code review + rebuild verified. |
| 4 | "Could not embed because more than one relationship was found for 'camera_assignments' and 'profiles'" — surfaced only *after* fix #3 made errors visible | `camera_assignments` has two FKs into `profiles` (`user_id`, `assigned_by`); the embed `profiles(full_name)` was ambiguous | Pinned to `profiles!camera_assignments_user_id_fkey(full_name)` | Confirmed no other unpinned embed exists anywhere in the repo; swept all multi-FK table pairs schema-wide (`incidents`, `support_tickets` also have 2 FKs into `profiles` — both already correctly pinned in `Incidents.tsx`/`Support.tsx`). |
| 5 | `add-camera`, `update-camera`, `test-camera`, `decrypt-camera` edge functions may have drifted from repo source; `report-camera-health` existed in git but was **never deployed at all** | No deploy-on-merge pipeline (no CI/CD exists in this repo, per prior due-diligence audit) | Redeployed all 5 from current repo source | `supabase functions list` before/after — version numbers bumped, `report-camera-health` went from absent to `v1`. |
| 6 | Live Supabase Management API token (`sbp_...`) sat in plaintext in uncommitted debug scripts under `desktop/scripts/` | Leftover from an earlier ad-hoc debugging session | Deleted the 7 scripts | **Action still required from you: rotate this token at supabase.com** — it was exposed on disk and used (with your explicit authorization) for this session's diagnostics. |
| 7 | 4 stray `console.log` debug statements in the local CCTV client (`CCTVPlayer.tsx`, `TelemetryContext.tsx`, `overlay.worker.ts`) | Leftover debug logging | Removed | Repo-wide TODO/FIXME/mock/placeholder/debug sweep; `client` still typechecks clean after removal. |
| 8 | `add-camera`/`update-camera` had **no rate limiting** despite making the same outbound network probe (`verifyCameraConnection`, dials caller-supplied hosts) as `test-camera`, which is rate-limited at 20/min | Inconsistent application of the existing `rateLimit()` helper | Added matching 20/min limits to both | Code review; redeployed. |
| 9 | `invite-user` (creates a real auth user + license + sends email per call) and `admin-users` (destructive account actions + email on `reset_password`) had no rate limiting | Same as above | Added 10/min and 30/min respectively | Code review; redeployed. |
| 10 | `Organizations.tsx` → "Create Organization" was silently broken: `app.create_organization` RPC lives in the `app` Postgres schema, which PostgREST was not configured to expose (`db_schema` was `public,graphql_public` only) | Config drift — `supabase/config.toml` already declared `app` as an exposed schema for local dev, but production's live PostgREST config was never updated to match | Exposed `app` via a targeted `db_schema` PATCH (not the broader `config push`, which would also have synced unreviewed auth settings) | Live-tested against the real REST API with the anon key: went from `PGRST202` (function not found) to the function's own `is_super_admin()` check firing correctly. |
| 11 | **Privilege escalation gap that fix #10 would have introduced if shipped alone**: `app.seed_system_roles(p_org uuid)` had `EXECUTE` granted to `PUBLIC` (including `anon`) with **zero check that the caller owns or administers `p_org`** — it unconditionally inserts a full-permission "Organization Owner" role into whatever org UUID is passed. Exposing the `app` schema without locking this down would have made it an unauthenticated privilege-escalation endpoint reachable by anyone with the public anon key. | Function-level `EXECUTE` defaults to `PUBLIC` in Postgres unless explicitly revoked; this was never done because the function was previously unreachable (schema not exposed) | `supabase/migrations/0022_lock_down_internal_app_functions.sql` revokes `EXECUTE` from `PUBLIC` on `seed_system_roles` and 8 other internal/trigger-only `app.*` functions, applied **before** exposing the schema | Live-tested with the anon key, no user JWT: `seed_system_roles` call returned `permission denied for function seed_system_roles`; confirmed zero rows written to `public.roles` for the target org. |
| 12 | Even after #10/#11, `Organizations.tsx` still called `supabase.rpc("create_organization", ...)` without `.schema('app')` — `supabase-js` defaults to the `public` schema, so this would still 404 | Frontend never updated for the schema the RPC actually lives in | Added `.schema("app")` | Rebuilt clean; matches the same header (`Content-Profile: app`) verified working directly against the REST API. |

All of the above (except #6, a deletion) are deployed to production: DB migrations 0020–0023, edge functions `add-camera`/`update-camera`/`test-camera`/`decrypt-camera`/`report-camera-health`/`invite-user`/`admin-users`, and the portal (Vercel, `https://portal-gilt-iota.vercel.app`).

---

## 2. Systematic checks performed (schema/platform-wide, with live evidence)

- **RLS recursion, every table.** Statically mapped every cross-table reference in all 34 public tables' policies (excluding calls through `SECURITY DEFINER` helpers, which are safe by construction). Only the `cameras`/`camera_assignments`/`camera_group_members` cycle existed (fixed, #1). Live-tested: every one of the 34 tables `SELECT`s cleanly as a real authenticated non-admin session (single combined query, zero errors).
- **PostgREST FK-embed ambiguity, every table pair.** Queried `pg_constraint` schema-wide for any child/parent pair with 2+ FKs. Found 3 affected tables (`camera_assignments`, `incidents`, `support_tickets`); only `camera_assignments`'s embed was unpinned (fixed, #4) — the other two were already correct.
- **Every edge function** (13 total) checked for consistent auth/rate-limiting/CORS. Gaps found and fixed: #8, #9. `desktop-sync` and `my-keys` were confirmed *correctly* unthrottled (legitimate high-frequency heartbeat; self-limiting one-time fetch, respectively) — not flagged as issues.
- **TypeScript.** `tsc --noEmit` clean (zero errors) across `portal/`, `desktop/`, `client/`, both before and after this session's edits.
- **Dead code / TODO / mock / placeholder sweep**, full repo (`client`, `desktop`, `portal`, `server`, `supabase/functions`). No real TODOs, fake data, or mock APIs found — only legitimate hits (HTML `placeholder=` attributes, AI-model warmup `dummy_img` tensors used for benchmarking) plus the 4 debug logs (fixed, #7).
- **Secrets.** No secrets in git history (per the existing `DUE_DILIGENCE_AUDIT.md`, independently re-spot-checked this session). This session's own leaked token (#6) was in *uncommitted* files only.
- **Branding/favicon.** Consistent `favicon.svg` usage across web/portal login, sidebar, navbar, settings/about — and a properly branded `.ico` (not Electron's default) wired for the desktop window, taskbar, installer, and uninstaller.
- **Realtime.** `cameras`, `camera_assignments`, `camera_health` all confirmed present in the `supabase_realtime` publication.
- **Auth config.** `mailer_autoconfirm: true`, `disable_signup: false` — signups don't deadlock on email confirmation, consistent with the desktop's no-login-screen, license-key-activation flow.
- **Super-admin RLS bypass path.** Verified by static inspection only (every policy's first branch is a trivial `app.is_super_admin() OR ...`, and `is_super_admin()` itself is a non-recursive, already-verified lookup) — **not** live-tested against a real super-admin session, because no super-admin account currently exists in this environment and flipping one's flag for a test (even inside a rolled-back transaction) was correctly declined without your explicit sign-off.

---

## 3. What this audit could not do

This environment has no browser-automation tool and no way to launch/drive the
Electron app's UI. Concretely, **not done**:

- Clicking through the 19 listed modules' actual pages, buttons, modals, and
  forms in a live browser. All of it was code-reviewed; the Cameras module
  specifically was also *live-data-verified* (real inserts, real RLS
  sessions, real REST calls) because that's where the reported bug was.
- Running the Electron desktop app end-to-end (build → install → activate →
  auto-login → camera sync → notifications).
- Exercising a full license lifecycle (generate → assign → activate on a
  real device → suspend → revoke → renew) as a live workflow — the
  individual RPCs were read for correctness, not run in sequence.
- Running the Python AI engine against a real camera/RTSP stream. No changes
  were made to `server/app/ai/pipeline.py` this session; project memory
  records it was measured at 30 fps / 9.6 ms avg latency in an earlier
  session, not re-verified now.
- Verifying GitHub auto-update inside a packaged installer (the
  `github-releases`/`download-release` edge functions were code-reviewed and
  found well-engineered — rate-limited, checksum-verified, CORS-safe error
  handling — but not exercised against a real packaged build).
- Adding ESLint. No config exists anywhere in this repo; introducing one now
  would be new tooling infrastructure, not a bug fix, so it was left alone
  per "keep the existing architecture."

---

## 4. Remaining known items (not fixed this session)

1. **5 leftover test camera rows** in production (2 in your own org), from
   earlier debugging — still there, pending your call on whether to delete
   them (asked previously, unanswered).
2. No containerization or CI/CD pipeline exists (carried over from the prior
   due-diligence audit — a deployment-maturity gap, not a correctness bug).
3. The super-admin RLS path is unverified live (see §2) for lack of a real
   super-admin account in this environment.

---

## 5. Production Readiness Score: 7.5 / 10

**What earns the 7.5:** every mechanically-checkable class of backend bug
(RLS recursion, FK-embed ambiguity, schema-exposure/grant mismatches, missing
rate limits) was swept *schema-wide*, not just where the original report
pointed — and the sweep paid off twice more, finding both the `create_organization`
404 and the `seed_system_roles` privilege-escalation gap before either
shipped. TypeScript is clean everywhere, no dead/mock code, no committed
secrets, branding is consistent, and every fix was verified against live
production data or the live REST API, not assumed.

**What withholds a higher score:** per your own instruction — don't mark it
production-ready unless every critical workflow was verified end-to-end — the
items in §3 are real gaps in *verification*, not known bugs. The Electron
app, the AI pipeline against real hardware, the full license lifecycle as a
live sequence, and a live super-admin session were not exercised this
session. Given that two prior "complete" audits both missed the recursion bug
that was actually breaking Camera Management in production, I'd treat "no
browser/Electron/hardware testing happened" as a meaningfully open risk
rather than round up.

**To close the gap to a real 9–10:** run the desktop app through activation
and camera sync once against a real license; click through each of the 19
modules once as an org admin and once (if you create one) as a super admin;
confirm the AI pipeline still hits its measured 30 fps benchmark; and decide
on the two open items in §4.
