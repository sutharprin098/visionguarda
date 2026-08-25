import asyncio
import edge_tts
import numpy as np
import subprocess
import os
import wave
import struct

VOICEOVER_PARTS = [
    {
        "id": "vo_01_hook",
        "text": "Your cameras are watching. But who is watching your cameras?",
        "start": 1.2
    },
    {
        "id": "vo_02_problem",
        "text": "Hundreds of cameras. Thousands of hours of footage. Critical events can be missed in seconds.",
        "start": 8.2
    },
    {
        "id": "vo_03_intro",
        "text": "Meet CamAI.",
        "start": 16.5
    },
    {
        "id": "vo_04_detection",
        "text": "CamAI understands what is happening in your cameras in real time.",
        "start": 24.2
    },
    {
        "id": "vo_05_monitoring",
        "text": "Detect people, track movement, identify intrusions, monitor restricted zones, and receive instant alerts.",
        "start": 36.0
    },
    {
        "id": "vo_06_value",
        "text": "Turn your existing CCTV infrastructure into an intelligent security system.",
        "start": 46.0
    }
]

VOICE = "en-US-ChristopherNeural" # Professional, authoritative, deep male tech commercial voice

async def generate_tts():
    audio_dir = r"d:\camAI\videos\audio_stems"
    os.makedirs(audio_dir, exist_ok=True)
    print("Generating TTS voiceover clips...")
    for part in VOICEOVER_PARTS:
        output_file = os.path.join(audio_dir, f"{part['id']}.mp3")
        communicate = edge_tts.Communicate(part["text"], VOICE, rate="-3%", pitch="-2Hz")
        await communicate.save(output_file)
        print(f"Saved {part['id']} -> {output_file}")

def create_procedural_soundtrack(duration_sec=60.0, sample_rate=44100):
    print("Generating cinematic synth tech soundtrack & UI sound effects...")
    num_samples = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, num_samples, endpoint=False)
    
    # Base dark pulse synth (sub bass + atmospheric drone)
    sub_freq = 45.0  # F1 note
    bass = 0.25 * np.sin(2 * np.pi * sub_freq * t)
    
    # Pulse rhythm (tick every second, swelling at transitions)
    pulse = np.sin(2 * np.pi * 2.0 * t) ** 4 * 0.08
    
    # Mid synth pads (chords evolving over 60 seconds)
    pad = np.zeros(num_samples)
    for i, t_val in enumerate(t):
        # Build intensity over time
        envelope = 0.12 + 0.18 * (t_val / duration_sec) ** 1.5
        # Harmonic frequencies (F minor scale: F, Ab, C, Eb)
        f1, f2, f3 = 174.61, 207.65, 261.63 # F3, Ab3, C4
        if t_val > 15.0:
            f1, f2, f3 = 174.61, 220.00, 261.63 # brightens slightly
        if t_val > 45.0:
            f1, f2, f3 = 220.00, 261.63, 329.63 # high intensity
            
        pad[i] = (np.sin(2 * np.pi * f1 * t_val) * 0.4 +
                  np.sin(2 * np.pi * f2 * t_val) * 0.3 +
                  np.sin(2 * np.pi * f3 * t_val) * 0.3) * envelope

    # High arpeggio tech pulse (subtle technological ticking)
    arp_freqs = [523.25, 659.25, 783.99, 1046.50] # C5, E5, G5, C6
    arp = np.zeros(num_samples)
    arp_step = 0.125 # 16th notes
    for idx in range(int(duration_sec / arp_step)):
        t_start = idx * arp_step
        t_idx_start = int(t_start * sample_rate)
        t_idx_end = int(min((t_start + arp_step) * sample_rate, num_samples))
        if t_idx_start < num_samples:
            freq = arp_freqs[idx % len(arp_freqs)]
            local_t = t[t_idx_start:t_idx_end] - t_start
            decay = np.exp(-30.0 * local_t)
            gain = 0.04 * (0.5 + 0.5 * (t_start / duration_sec))
            arp[t_idx_start:t_idx_end] += np.sin(2 * np.pi * freq * local_t) * decay * gain

    # UI Alert Chimes at key timestamps (e.g., 25s, 30s, 40s)
    alerts = np.zeros(num_samples)
    alert_times = [15.2, 25.0, 31.0, 39.5, 41.2, 54.0]
    for at in alert_times:
        idx_s = int(at * sample_rate)
        idx_e = int(min((at + 0.4) * sample_rate, num_samples))
        if idx_s < num_samples:
            local_t = t[idx_s:idx_e] - at
            chime = (np.sin(2 * np.pi * 880 * local_t) + np.sin(2 * np.pi * 1760 * local_t) * 0.5) * np.exp(-12.0 * local_t) * 0.15
            alerts[idx_s:idx_e] += chime

    # Final CTA impact sound (at 53.0s)
    cta_impact = np.zeros(num_samples)
    if int(53.0 * sample_rate) < num_samples:
        idx_s = int(53.0 * sample_rate)
        idx_e = int(min(57.0 * sample_rate, num_samples))
        local_t = t[idx_s:idx_e] - 53.0
        cta_impact[idx_s:idx_e] = (np.sin(2 * np.pi * 65.4 * local_t) * 0.4 + np.sin(2 * np.pi * 130.8 * local_t) * 0.3) * np.exp(-1.5 * local_t)

    # Master mix
    stereo_l = bass + pulse + pad + arp + alerts + cta_impact
    stereo_r = bass + pulse + pad + arp * 0.9 + alerts * 1.1 + cta_impact

    # Normalize music
    max_val = max(np.max(np.abs(stereo_l)), np.max(np.abs(stereo_r)))
    if max_val > 0:
        stereo_l = (stereo_l / max_val) * 0.35
        stereo_r = (stereo_r / max_val) * 0.35

    music_wav = r"d:\camAI\videos\audio_stems\soundtrack_60s.wav"
    
    # Save stereo 16-bit PCM WAV
    stereo_data = np.zeros((num_samples, 2), dtype=np.int16)
    stereo_data[:, 0] = np.clip(stereo_l * 32767, -32768, 32767).astype(np.int16)
    stereo_data[:, 1] = np.clip(stereo_r * 32767, -32768, 32767).astype(np.int16)

    with wave.open(music_wav, 'wb') as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(stereo_data.tobytes())
    print(f"Saved soundtrack -> {music_wav}")

def mix_full_audio():
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    audio_dir = r"d:\camAI\videos\audio_stems"
    soundtrack = os.path.join(audio_dir, "soundtrack_60s.wav")
    final_audio = r"d:\camAI\videos\audio_stems\final_ad_audio_60s.mp3"

    inputs = ["-i", soundtrack]
    filter_complex = ["[0:a]volume=0.45[bg];"]
    
    for i, part in enumerate(VOICEOVER_PARTS, start=1):
        vo_path = os.path.join(audio_dir, f"{part['id']}.mp3")
        delay_ms = int(part["start"] * 1000)
        inputs.extend(["-i", vo_path])
        filter_complex.append(f"[{i}:a]adelay={delay_ms}|{delay_ms},volume=1.8[vo{i}];")
        
    mix_inputs = "[bg]" + "".join([f"[vo{i}]" for i in range(1, len(VOICEOVER_PARTS) + 1)])
    filter_complex.append(f"{mix_inputs}amix=inputs={len(VOICEOVER_PARTS) + 1}:duration=first:dropout_transition=0.5[outa]")
    
    cmd = [
        ffmpeg, "-y",
        *inputs,
        "-filter_complex", "".join(filter_complex),
        "-map", "[outa]",
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        final_audio
    ]
    print("Mixing voiceovers and soundtrack with FFmpeg...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"Successfully generated final audio track: {final_audio}")
    else:
        print(f"FFmpeg audio mixing failed:\n{res.stderr}")

if __name__ == "__main__":
    asyncio.run(generate_tts())
    create_procedural_soundtrack()
    mix_full_audio()
