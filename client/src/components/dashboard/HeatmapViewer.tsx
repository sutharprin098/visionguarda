import React, { useRef, useEffect } from 'react';

interface HeatmapViewerProps {
  heatmapData: number[][]; // 32x32 grid
}

export function HeatmapViewer({ heatmapData }: HeatmapViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 240;
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    if (!heatmapData || heatmapData.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.font = '11px sans-serif';
      ctx.fillText('Waiting for heatmap data...', 20, 20);
      return;
    }

    const rows = heatmapData.length;
    const cols = heatmapData[0].length;
    const cellW = width / cols;
    const cellH = height / rows;

    // Apply global blending for a smooth glow
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    // Optional: add a slight blur for smoother heatmap look
    ctx.filter = 'blur(6px)';

    // Find max value in grid to normalize color mapping
    let maxVal = 0.1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (heatmapData[r][c] > maxVal) {
          maxVal = heatmapData[r][c];
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = heatmapData[r][c];
        if (val <= 0.05) continue;

        const normalized = val / maxVal;
        
        // Color mapping: 240 (blue) to 0 (red)
        const hue = Math.max(0, 240 - normalized * 240);
        const opacity = Math.min(normalized * 0.7, 0.6);
        
        ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${opacity})`;
        ctx.beginPath();
        // Draw slightly overlapping circles/squares for a blended effect
        ctx.arc(c * cellW + cellW/2, r * cellH + cellH/2, Math.max(cellW, cellH) * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }, [heatmapData]);

  return (
    <div className="relative w-full h-full bg-slate-950/60 rounded-xl overflow-hidden border border-brand-500/10">
      <canvas ref={canvasRef} className="w-full h-full" />
      <div className="absolute top-2 left-2 px-2 py-1 rounded bg-slate-950/80 border border-brand-500/10 text-[9px] font-bold font-mono text-brand-300">
        LIVE ACTIVITY HEATMAP
      </div>
    </div>
  );
}
