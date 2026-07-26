-- 0043_camera_stream_url_source.sql
--
-- Adds the 'stream_url' camera source type.
--
-- Every existing source type builds its connection URI from separate
-- host/port/username/password/path fields (see _shared/util.ts
-- buildConnectionUri). That shape cannot express a stream whose address is a
-- single long URL carrying its own query string — an HLS/.m3u8 playlist, an
-- MJPEG endpoint, or a public municipal traffic feed. Splitting such a URL
-- across the existing fields mangles it, because buildConnectionUri
-- re-assembles scheme, auth and path itself.
--
-- 'stream_url' stores the URL verbatim as the connection string. The local
-- engine already handles it: localEngine.ts engineType() maps every
-- network-addressable type to 'rtsp', and pipeline.py opens anything that is
-- neither a device nor an on-disk file through cv2.VideoCapture/CAP_FFMPEG,
-- which reads HLS and HTTP streams natively.
--
-- Note the constraint must be re-created in full — 0028 already replaced the
-- original 0002 constraint, and Postgres has no "add value to CHECK" form.

alter table public.cameras drop constraint if exists cameras_source_type_check;
alter table public.cameras add constraint cameras_source_type_check
  check (source_type in ('rtsp','usb','onvif','ip','nvr','dvr','screen_share','stream_url'));
