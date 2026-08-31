const ITEMS = [
  "RTSP", "ONVIF", "USB UVC", "NVR / DVR", "VISION-ENGINE", "BYTETRACK REID",
  "HELMET + ANPR", "SPEED ESTIMATE", "YuNet FACE", "SUB-12ms", "ON-PREM",
  "ZERO CLOUD EGRESS", "SINGLE ACTIVATION KEY", "REALTIME ALERTS",
];

export default function TrustMarquee() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <section className="border-y border-sky-100 bg-sky-50/50 py-5 overflow-hidden">
      <div className="relative">
        <div className="ap-marquee gap-10">
          {row.map((t, i) => (
            <span key={i} className="flex items-center gap-10 whitespace-nowrap">
              <span className="font-mono text-[11px] font-bold tracking-[0.08em] text-sky-800">{t}</span>
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-sky-50/80 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-sky-50/80 to-transparent" />
      </div>
    </section>
  );
}
