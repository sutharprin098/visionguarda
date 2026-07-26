// One-shot: upload the marketing demo videos to a PUBLIC Supabase bucket.
// Run from the portal folder so @supabase/supabase-js resolves.
//
//   PowerShell:
//     $env:SB_SERVICE_KEY="<your service_role key>"; node upload_marketing_videos.mjs
//
// The service_role key is in Supabase Dashboard -> Project Settings -> API
// -> "service_role" (secret). It bypasses RLS so no bucket policy is needed.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const URL = "https://kuqyhceykvisqfyghiot.supabase.co";
const KEY = process.env.SB_SERVICE_KEY;
if (!KEY) {
  console.error("Set SB_SERVICE_KEY to your service_role key first.");
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// Create the public bucket if it doesn't exist (ignore "already exists").
const { error: bErr } = await sb.storage.createBucket("marketing", {
  public: true,
  fileSizeLimit: 52428800, // 50 MB
});
if (bErr && !/exist/i.test(bErr.message)) console.warn("createBucket:", bErr.message);
else console.log("bucket 'marketing' ready (public)");

for (const f of ["demo.mp4", "features-demo.mp4"]) {
  const buf = readFileSync(new URL(`./public/${f}`, import.meta.url));
  process.stdout.write(`uploading ${f} (${(buf.length / 1048576).toFixed(1)} MB)... `);
  const { error } = await sb.storage
    .from("marketing")
    .upload(f, buf, { contentType: "video/mp4", upsert: true });
  console.log(error ? "ERR " + error.message : "OK");
}

console.log(
  "\nPublic URLs:\n" +
    `  ${URL}/storage/v1/object/public/marketing/demo.mp4\n` +
    `  ${URL}/storage/v1/object/public/marketing/features-demo.mp4`,
);
