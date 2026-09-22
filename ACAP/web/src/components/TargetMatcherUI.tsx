import React, { useState, useEffect } from 'react';
import { Target, Upload, Trash2, CheckCircle2, AlertCircle, UserCheck } from 'lucide-react';
import {
  EnrolledTarget,
  loadEnrolledTargets,
  saveEnrolledTargets,
} from '../lib/cameraEngine';

export const TargetMatcherUI: React.FC = () => {
  const [targets, setTargets] = useState<EnrolledTarget[]>([]);
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState(0.70);
  const [preview, setPreview] = useState<string | null>(null);
  const [autoEnroll, setAutoEnroll] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setTargets(loadEnrolledTargets());
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleEnroll = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setStatusMsg({ type: 'error', text: 'Target name is required.' });
      return;
    }
    const newTarget: EnrolledTarget = {
      target_id: 'tgt_' + Date.now(),
      name: name.trim(),
      threshold: Number(threshold),
      created_at: Date.now(),
      thumbnail: preview || undefined,
      has_face: true,
    };
    const updated = [newTarget, ...targets];
    setTargets(updated);
    saveEnrolledTargets(updated);
    setName('');
    setPreview(null);
    setStatusMsg({ type: 'success', text: `Enrolled "${newTarget.name}" to camera memory.` });
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleDelete = (id: string, targetName: string) => {
    const updated = targets.filter(t => t.target_id !== id);
    setTargets(updated);
    saveEnrolledTargets(updated);
    setStatusMsg({ type: 'success', text: `Deleted target "${targetName}".` });
    setTimeout(() => setStatusMsg(null), 3000);
  };

  return (
    <div className="space-y-3.5 p-3 rounded-lg border border-line bg-slate-50/70 shadow-2xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
          <Target size={14} className="text-accent" />
          <span>Face &amp; Target Matcher Engine</span>
        </div>
        <button
          type="button"
          onClick={() => setAutoEnroll(!autoEnroll)}
          className={`text-[9.5px] px-2 py-0.5 rounded font-semibold border transition ${
            autoEnroll ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-slate-600 border-line'
          }`}
        >
          {autoEnroll ? 'Auto-Enroll Active' : 'Manual Only'}
        </button>
      </div>

      {statusMsg && (
        <div className={`p-2 rounded text-[11px] flex items-center gap-1.5 ${
          statusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-300'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Enrollment form */}
      <form onSubmit={handleEnroll} className="space-y-2.5 pt-1">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Target Name / Person Name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 text-xs bg-white border border-line rounded px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-accent"
          />
          <label className="flex items-center justify-center gap-1 text-[11px] px-2.5 py-1.5 rounded bg-white border border-line text-slate-700 hover:text-slate-900 cursor-pointer hover:bg-slate-100 transition shadow-2xs font-medium">
            <Upload size={12} />
            <span>Photo</span>
            <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </label>
        </div>

        {preview && (
          <div className="flex items-center gap-2.5 p-2 rounded bg-white border border-line shadow-2xs">
            <img src={preview} alt="Target Preview" className="h-10 w-10 object-cover rounded border border-line" />
            <span className="text-[10px] text-slate-600">Photo attached for facial vector extraction</span>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-slate-600 font-medium">
          <span>Similarity Threshold</span>
          <span className="font-mono text-slate-800 font-bold">{(threshold * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min={0.4}
          max={0.95}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full accent-accent cursor-pointer"
        />

        <button
          type="submit"
          className="w-full py-1.5 px-3 rounded text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition flex items-center justify-center gap-1.5 shadow-sm"
        >
          <UserCheck size={13} />
          <span>Enroll Target to Camera</span>
        </button>
      </form>

      {/* Enrolled Gallery List */}
      <div className="space-y-1.5 pt-2 border-t border-line">
        <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-slate-500">
          <span>Enrolled Gallery ({targets.length})</span>
          <span className="text-slate-400 font-normal lowercase">{targets.length} signatures</span>
        </div>

        {targets.length === 0 ? (
          <div className="text-[10px] text-slate-500 py-2 text-center italic">
            No targets enrolled. Upload a photo or enter a name above.
          </div>
        ) : (
          <div className="max-h-36 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {targets.map((tgt) => (
              <div
                key={tgt.target_id}
                className="flex items-center justify-between p-1.5 rounded bg-white border border-line text-xs shadow-2xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {tgt.thumbnail ? (
                    <img src={tgt.thumbnail} alt="" className="h-6 w-6 rounded object-cover border border-line shrink-0" />
                  ) : (
                    <div className="h-6 w-6 rounded bg-blue-50 text-blue-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {tgt.name[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="truncate">
                    <div className="font-semibold text-slate-800 text-[11px] truncate">{tgt.name}</div>
                    <div className="text-[9px] text-slate-500 font-mono">{(tgt.threshold * 100).toFixed(0)}% match threshold</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(tgt.target_id, tgt.name)}
                  className="text-slate-400 hover:text-danger p-1 transition shrink-0"
                  title="Delete Target"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TargetMatcherUI;
