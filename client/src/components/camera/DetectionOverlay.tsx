import React, { useRef, useEffect } from 'react';
import type { Detection, DetectResponse } from '../../types';

interface DetectionOverlayProps {
  detections: Detection[];
  lastResult: DetectResponse | null;
  videoWidth: number;
  videoHeight: number;
  showSegmentation: boolean;
}

/**
 * Draws bounding boxes, labels, and polygon segmentation masks over the video feed.
 */
export function DetectionOverlay({
  detections,
  lastResult,
  videoWidth,
  videoHeight,
  showSegmentation,
}: DetectionOverlayProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = videoWidth || 640;
    canvas.height = videoHeight || 480;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw segmentation mask polygons
    if (showSegmentation && lastResult?.masks && lastResult.masks.length > 0) {
      ctx.globalAlpha = 0.4;
      const colors = [
        '#6366f1', // indigo
        '#10b981', // emerald
        '#f59e0b', // amber
        '#ef4444', // red
        '#8b5cf6', // violet
        '#06b6d4', // cyan
      ];

      lastResult.masks.forEach((poly, idx) => {
        if (!poly || poly.length === 0) return;
        ctx.fillStyle = colors[idx % colors.length];
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;
    }

    // 2. Draw bounding boxes
    detections.forEach((det, idx) => {
      const { x1, y1, x2, y2 } = det.bbox;
      const w = x2 - x1;
      const h = y2 - y1;
      const conf = (det.confidence * 100).toFixed(1);
      const className = (det.class || 'person').toLowerCase();
      
      let color = '#6366f1'; // default/person (indigo)
      let glowColor = 'rgba(99,102,241,0.8)';
      let bgLabelColor = 'rgba(99,102,241,0.85)';

      if (['car', 'truck', 'bus'].includes(className)) {
        color = '#06b6d4'; // cyan
        glowColor = 'rgba(6,182,212,0.8)';
        bgLabelColor = 'rgba(6,182,212,0.85)';
      } else if (['motorcycle', 'bicycle'].includes(className)) {
        color = '#10b981'; // emerald
        glowColor = 'rgba(16,185,129,0.8)';
        bgLabelColor = 'rgba(16,185,129,0.85)';
      } else if (className !== 'person') {
        color = '#8b5cf6'; // violet
        glowColor = 'rgba(139,92,246,0.8)';
        bgLabelColor = 'rgba(139,92,246,0.85)';
      }

      // Display format: e.g. "PERSON ID:1 95%" or "CAR ID:2 88%"
      const trackSuffix = det.track_id ? ` ID:${det.track_id}` : '';
      const label = `${className.toUpperCase()}${trackSuffix}  ${conf}%`;

      // Glowing box
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);
      ctx.shadowBlur = 0;

      // Corner accents
      const cs = 14; // corner size
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      [
        [x1, y1, x1 + cs, y1, x1, y1 + cs],
        [x2 - cs, y1, x2, y1, x2, y1 + cs],
        [x1, y2 - cs, x1, y2, x1 + cs, y2],
        [x2 - cs, y2, x2, y2, x2, y2 - cs],
      ].forEach(([mx, my, lx1, ly1, lx2, ly2]) => {
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();
      });

      // Label background
      ctx.font = 'bold 11px Inter, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const padX = 8;
      const padY = 5;
      const labelH = 20;

      ctx.fillStyle = bgLabelColor;
      roundRect(ctx, x1 - 1, y1 - labelH - padY * 2, textWidth + padX * 2, labelH + padY, 6);
      ctx.fill();

      // Label text
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x1 + padX - 1, y1 - padY - 2);
    });
  }, [detections, videoWidth, videoHeight, showSegmentation, lastResult]);

  return (
    <canvas
      ref={overlayRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ mixBlendMode: 'normal' }}
    />
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
