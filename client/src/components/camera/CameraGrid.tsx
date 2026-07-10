import React from 'react';
import { CCTVPlayer } from './CCTVPlayer';
import { VideoOff } from 'lucide-react';

interface Camera {
  id: string;
  name: string;
  type: string;
  source: string;
  is_active: number;
  zones: string;
  lines: string;
}

interface CameraGridProps {
  cameras: Camera[];
  gridSize: number; // 1, 4, 9, 16, 25, 36, 64
  onConfigChange?: () => void;
}

export function CameraGrid({ cameras, gridSize, onConfigChange }: CameraGridProps) {
  // Filter active cameras
  const activeCameras = cameras.filter((c) => c.is_active === 1);

  // Generate grid items
  const gridItems = Array.from({ length: gridSize }).map((_, index) => {
    const camera = activeCameras[index];
    return {
      index,
      camera,
    };
  });

  // Determine Tailwind CSS grid classes
  const getGridClasses = () => {
    switch (gridSize) {
      case 1:
        return 'grid-cols-1';
      case 4:
        return 'grid-cols-2';
      case 9:
        return 'grid-cols-3';
      case 16:
        return 'grid-cols-4';
      case 25:
        return 'grid-cols-5';
      case 36:
        return 'grid-cols-6';
      case 64:
        return 'grid-cols-8';
      default:
        return 'grid-cols-2';
    }
  };

  return (
    <div className={`grid ${getGridClasses()} gap-3 w-full h-full p-2 bg-slate-950/40 rounded-2xl overflow-y-auto`}>
      {gridItems.map(({ index, camera }) => {
        if (camera) {
          return (
            <div key={camera.id} className="relative aspect-video w-full h-full min-h-[180px] rounded-xl overflow-hidden shadow-lg border border-brand-500/10">
              <CCTVPlayer
                cameraId={camera.id}
                cameraName={camera.name}
                cameraType={camera.type}
                initialZones={camera.zones}
                initialLines={camera.lines}
                onConfigChange={onConfigChange}
              />
            </div>
          );
        } else {
          return (
            <div
              key={`empty-${index}`}
              className="relative aspect-video w-full h-full min-h-[180px] rounded-xl overflow-hidden border border-dashed flex flex-col items-center justify-center gap-2"
              style={{
                borderColor: 'rgba(99,102,241,0.15)',
                background: 'rgba(15,23,42,0.4)',
              }}
            >
              <VideoOff size={24} className="text-slate-600 opacity-60 animate-pulse" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                No Video Feed
              </span>
              <span className="text-[8px] text-slate-600">
                Channel {index + 1}
              </span>
            </div>
          );
        }
      })}
    </div>
  );
}
