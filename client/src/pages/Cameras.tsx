import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Pencil,
  Video,
  Wifi,
  UsbIcon,
  Camera as CameraIcon,
  MonitorPlay,
  UploadCloud,
  Loader2,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { EmptyState } from '../components/ui/EmptyState';
import {
  fetchCameras,
  saveCamera,
  deleteCamera,
  uploadCameraVideo,
  updateCameraDisplay,
  fetchStatus,
  CameraRecord,
} from '../utils/api';

const SOURCE_TYPES: { value: string; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { value: 'rtsp', label: 'RTSP / IP Camera', icon: <Wifi size={13} />, placeholder: 'rtsp://user:pass@192.168.1.20:554/stream' },
  { value: 'usb', label: 'USB Camera', icon: <UsbIcon size={13} />, placeholder: '0, 1, 2 (device index)' },
  { value: 'webcam', label: 'Webcam', icon: <CameraIcon size={13} />, placeholder: '0 (system default webcam)' },
  { value: 'screenshare', label: 'Screen Share', icon: <MonitorPlay size={13} />, placeholder: 'client' },
  { value: 'upload', label: 'Video Upload', icon: <UploadCloud size={13} />, placeholder: 'Choose a video file below' },
];

const RESOLUTION_PRESETS = [
  { label: '640×360', width: 640 },
  { label: '960×540', width: 960 },
  { label: '1280×720', width: 1280 },
  { label: '1920×1080', width: 1920 },
];

function typeIcon(type: string) {
  return SOURCE_TYPES.find((t) => t.value === type)?.icon || <Video size={13} />;
}

function typeLabel(type: string) {
  return SOURCE_TYPES.find((t) => t.value === type)?.label || type;
}

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `cam_${Date.now()}`;
}

export default function Cameras() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CameraRecord | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('rtsp');
  const [source, setSource] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: fetchCameras,
  });

  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 5000,
  });

  const saveMutation = useMutation({
    mutationFn: saveCamera,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      closeModal();
    },
  });

  // Separate from saveMutation even though it hits the same endpoint: the
  // active-toggle switch lives outside the add/edit modal, but saveMutation's
  // onSuccess unconditionally closes whatever modal is open. If a toggle's
  // response resolves after the user has since opened the edit modal for a
  // (possibly different) camera, it would silently dismiss that modal out
  // from under them.
  const toggleActiveMutation = useMutation({
    mutationFn: saveCamera,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCamera,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });

  const resolutionMutation = useMutation({
    mutationFn: ({ id, width }: { id: string; width: number }) => updateCameraDisplay(id, { max_width: width }),
  });

  const openAddModal = () => {
    setEditing(null);
    setName('');
    setType('rtsp');
    setSource('');
    setModalOpen(true);
  };

  const openEditModal = (cam: CameraRecord) => {
    setEditing(cam);
    setName(cam.name);
    setType(cam.type);
    setSource(cam.source);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setUploading(false);
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const { path } = await uploadCameraVideo(file);
      setSource(path);
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !source.trim()) return;
    saveMutation.mutate({
      id: editing?.id || slugify(name),
      name: name.trim(),
      type,
      source: source.trim(),
      is_active: true,
      zones: editing?.zones,
      lines: editing?.lines,
    });
  };

  const toggleActive = (cam: CameraRecord) => {
    toggleActiveMutation.mutate({
      id: cam.id,
      name: cam.name,
      type: cam.type,
      source: cam.source,
      is_active: !cam.is_active,
      zones: cam.zones,
      lines: cam.lines,
    });
  };

  const selectedTypeMeta = SOURCE_TYPES.find((t) => t.value === type);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar
        title="Cameras"
        subtitle="Add, configure, and manage every camera source"
        actions={
          <Button variant="primary" size="sm" onClick={openAddModal}>
            <Plus size={14} />
            Add Camera
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl animate-pulse bg-white/[0.04]" />
            ))}
          </div>
        ) : cameras.length === 0 ? (
          <EmptyState
            icon={<Video size={20} />}
            title="No cameras configured"
            description="Add your first camera source — RTSP, IP, USB, webcam, screen share, or an uploaded video file."
            action={<Button variant="primary" onClick={openAddModal}><Plus size={14} />Add Camera</Button>}
          />
        ) : (
          <div className="panel overflow-hidden">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-white/[0.03] text-ink-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-3.5 font-semibold">Camera</th>
                  <th className="p-3.5 font-semibold">Source</th>
                  <th className="p-3.5 font-semibold">Status</th>
                  <th className="p-3.5 font-semibold">Live FPS</th>
                  <th className="p-3.5 font-semibold">Resolution</th>
                  <th className="p-3.5 font-semibold">Active</th>
                  <th className="p-3.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {cameras.map((cam) => {
                  const live = status?.cameras?.[cam.id];
                  return (
                    <tr key={cam.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-brand-300 shrink-0">
                            {typeIcon(cam.type)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-white truncate">{cam.name}</p>
                            <p className="text-[10px] text-ink-500 font-mono truncate">{cam.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <Badge tone="neutral">{typeLabel(cam.type)}</Badge>
                        <p className="text-[10px] text-ink-500 font-mono mt-1 max-w-[220px] truncate">{cam.source}</p>
                      </td>
                      <td className="p-3.5">
                        <Badge tone={live?.running ? 'success' : 'neutral'}>{live?.running ? 'Running' : 'Stopped'}</Badge>
                      </td>
                      <td className="p-3.5 font-mono text-ink-300">{live ? `${live.fps} Hz` : '—'}</td>
                      <td className="p-3.5">
                        <select
                          disabled={!live?.running}
                          defaultValue=""
                          onChange={(e) => {
                            const width = Number(e.target.value);
                            if (width) resolutionMutation.mutate({ id: cam.id, width });
                          }}
                          className="bg-white/[0.04] border border-white/[0.08] rounded-md px-1.5 py-1 text-[11px] text-white disabled:opacity-40 focus:outline-none"
                        >
                          <option value="">Preview size…</option>
                          {RESOLUTION_PRESETS.map((r) => (
                            <option key={r.width} value={r.width}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3.5">
                        <Switch checked={!!cam.is_active} onChange={() => toggleActive(cam)} />
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="icon" variant="ghost" onClick={() => openEditModal(cam)} title="Rename / change source">
                            <Pencil size={13} />
                          </Button>
                          <Button size="icon" variant="ghost" className="hover:text-red-400" onClick={() => deleteMutation.mutate(cam.id)} title="Remove camera">
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Camera' : 'Add Camera'} width="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">Display Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Front Gate Entrance"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">Source Type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {SOURCE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => { setType(t.value); setSource(t.value === 'webcam' ? '0' : t.value === 'screenshare' ? 'client' : ''); }}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors border ${
                    type === t.value ? 'bg-brand-500/15 border-brand-500/40 text-brand-300' : 'border-white/[0.06] text-ink-400 hover:text-white'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {type === 'upload' ? (
            <div key="upload-field">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">Video File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-white/15 rounded-lg py-4 text-[12px] text-ink-300 hover:border-brand-500/40 hover:text-white transition-colors"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                {uploading ? 'Uploading…' : source ? 'Video uploaded — choose a different file' : 'Choose video file (MP4, MOV, AVI, MKV, WebM)'}
              </button>
              {source && !uploading && <p className="text-[10px] text-emerald-400 font-mono mt-1.5 truncate">Ready: {source.split(/[\\/]/).pop()}</p>}
            </div>
          ) : (
            <div key="source-field">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">Source Address</label>
              <input
                type="text"
                required
                placeholder={selectedTypeMeta?.placeholder}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={type === 'screenshare'}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 disabled:opacity-50"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4 mt-2">
            <Button type="button" variant="ghost" onClick={closeModal}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saveMutation.isPending} disabled={uploading}>
              {editing ? 'Save Changes' : 'Add Camera'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
