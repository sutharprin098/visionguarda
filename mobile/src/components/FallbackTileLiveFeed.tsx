import { useEffect, useRef } from "react";
import type { TelemetryDetection } from "../lib/telemetry";

export default function FallbackTileLiveFeed({
  cameraName,
  detections,
}: {
  cameraName: string;
  detections?: TelemetryDetection[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let animId: number;
    let time = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      time += 0.04;
      const w = (canvas.width = canvas.parentElement?.clientWidth || 400);
      const h = (canvas.height = canvas.parentElement?.clientHeight || 225);

      // Security Feed Background Gradient
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#070b12");
      grad.addColorStop(0.5, "#0d1524");
      grad.addColorStop(1, "#04070e");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // CCTV Grid Pattern
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      const step = 40;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Live Vector Radar Scanline
      const scanY = (Math.sin(time * 0.8) * 0.5 + 0.5) * h;
      ctx.strokeStyle = "rgba(6, 182, 212, 0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(w, scanY);
      ctx.stroke();

      // Active or Simulated Targets
      const activeDets =
        detections && detections.length > 0
          ? detections
          : [
              {
                label: "person",
                confidence: 0.96,
                bbox: [0.22 + Math.sin(time * 0.4) * 0.03, 0.22, 0.2, 0.52],
                track_id: 101,
              },
              {
                label: "vehicle",
                confidence: 0.92,
                bbox: [0.54 + Math.cos(time * 0.3) * 0.02, 0.46, 0.3, 0.38],
                track_id: 204,
              },
            ];

      activeDets.forEach((d: any) => {
        const [bx, by, bw, bh] = d.bbox || [0.3, 0.3, 0.2, 0.3];
        const rx = bx * w;
        const ry = by * h;
        const rw = bw * w;
        const rh = bh * h;

        const isPerson = d.label === "person";
        const colorHex = isPerson ? "#06b6d4" : "#10b981";
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);

        ctx.fillStyle = isPerson
          ? "rgba(6, 182, 212, 0.16)"
          : "rgba(16, 185, 129, 0.16)";
        ctx.fillRect(rx, ry, rw, rh);

        // Label Tag
        ctx.fillStyle = colorHex;
        ctx.fillRect(rx, Math.max(0, ry - 18), 120, 18);

        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(
          `${d.label.toUpperCase()} #${d.track_id || 1} ${(
            (d.confidence || 0.9) * 100
          ).toFixed(0)}%`,
          rx + 4,
          Math.max(12, ry - 5)
        );
      });

      // HUD Header Overlay
      ctx.fillStyle = "#06b6d4";
      ctx.font = "bold 11px monospace";
      ctx.fillText(
        `● LIVE CLOUD GPU STREAM | ${(cameraName || "CAMERA").toUpperCase()}`,
        12,
        22
      );

      // Real-time Clock Timestamp
      const now = new Date();
      const timeStr = now.toISOString().replace("T", " ").substring(0, 19);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px monospace";
      ctx.fillText(timeStr, w - 145, 22);

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [cameraName, detections]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full object-cover bg-black select-none pointer-events-none"
    />
  );
}
