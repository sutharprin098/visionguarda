const ITEMS = [
  "RTSP", "ONVIF", "USB UVC", "NVR / DVR", "YOLO-DETECT", "BYTETRACK REID",
  "HELMET + ANPR", "SPEED ESTIMATE", "YuNet FACE", "SUB-12ms", "ON-PREM",
  "ZERO CLOUD EGRESS", "SINGLE ACTIVATION KEY", "REALTIME ALERTS",
];

export default function TrustMarquee() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <section className="border-y border-[var(--ap-border)] bg-[var(--ap-surface-2)] py-5 overflow-hidden">
      <div className="relative">
        <div className="ap-marquee gap-10">
          {row.map((t, i) => (
            <span key={i} className="flex items-center gap-10 whitespace-nowrap">
              <span className="ap-pixel text-[11px] tracking-[0.08em] text-[var(--ap-ink-2)]">{t}</span>
              <span className="h-1.5 w-1.5 rounded-[1px] bg-[var(--ap-accent)]" />
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--ap-surface-2)] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--ap-surface-2)] to-transparent" />
      </div>
    </section>
  );
}
