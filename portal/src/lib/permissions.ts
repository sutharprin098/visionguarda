// The permission vocabulary — the single source of truth for the portal.
//
// WHY THIS FILE EXISTS
// --------------------
// `public.permissions` in Postgres is the real catalog. `role_permissions`
// carries an FK to it (`permission references permissions(key)`), so a key that
// is not in this list CANNOT be granted to anybody, by anybody, ever.
//
// The Cameras lockout came from exactly that: the route guards asked for
// `cameras.read`, a key nobody had invented on the database side. It could not
// be granted, so `permissions.includes("cameras.read")` was false for every
// user — including an Organization Owner holding literally all 14 real
// permissions. The nav (nav.ts) meanwhile used the real keys, so the link
// rendered and the page behind it refused: "ACCESS DENIED BY ADMIN".
//
// Typing every permission call site against this union turns that class of bug
// from a silent runtime lockout into a compile error — and `npm run build` runs
// `tsc` first, so it cannot reach production.
//
// KEEPING IT HONEST
// -----------------
// If you add a permission here, add it to the database in the same change (a
// migration inserting into `public.permissions`). The reverse is also true.
// Anything else and the two vocabularies drift apart again.
export const PERMISSIONS = [
  "org.manage",
  "users.manage",
  "roles.manage",
  "licenses.manage",
  "devices.manage",
  "cameras.manage",
  "cameras.assign",
  "ai.configure",
  "alerts.view",
  "reports.view",
  "audit.view",
  "projects.manage",
  "incidents.manage",
  "support.manage",
] as const;

/** A permission key that actually exists in `public.permissions`. */
export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

/** Runtime companion to the type, for values that only exist at runtime
 *  (e.g. a permission string read back from the database). */
export function isPermission(key: string): key is Permission {
  return PERMISSION_SET.has(key);
}
