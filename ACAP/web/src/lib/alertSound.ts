// The audible cue for critical alerts.
//
// Synthesised with WebAudio rather than shipped as a file. Three reasons, in
// order of how much they matter: an operator may be looking at another monitor
// and the sound is the only channel left, so it must never fail to load; a
// bundled .mp3 is a licensing question in a product being sold as source; and
// an oscillator is a few hundred bytes against a few hundred kilobytes.
//
// The cue itself is two short sine tones a fifth apart with a fast attack and a
// gentle release. Deliberately NOT a klaxon: this plays in a room where people
// work, possibly many times an hour, and a harsh sound gets the speakers muted
// within a day — at which point the alert system has no audio channel at all.
// A soft, distinctive two-tone is recognisable at low volume and survives being
// heard a hundred times.

let ctx: AudioContext | null = null;
let lastPlayed = 0;

/** Two criticals a second apart should not stack into a chord. */
const MIN_GAP_MS = 1200;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Browsers refuse to start audio until the user has interacted with the page.
 * Calling this from any early click means the first REAL critical alert is
 * audible instead of being the one that silently unlocks the context.
 */
export function primeAudio(): void {
  const ac = audioContext();
  if (ac && ac.state === "suspended") void ac.resume().catch(() => { /* stays suspended */ });
}

export function criticalChime(volume = 0.18): void {
  const now = Date.now();
  if (now - lastPlayed < MIN_GAP_MS) return;
  const ac = audioContext();
  if (!ac) return;
  // An autoplay-blocked context throws on connect in some builds; a missing
  // sound must never take an alert down with it.
  try {
    if (ac.state === "suspended") void ac.resume().catch(() => {});
    lastPlayed = now;

    const t0 = ac.currentTime;
    const master = ac.createGain();
    master.gain.value = volume;
    master.connect(ac.destination);

    for (const [freq, at, dur] of [[784, 0, 0.18], [523.25, 0.16, 0.30]] as const) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Ramped, never stepped: an instantaneous gain change is an audible click.
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(1, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch {
    /* no audio on this machine — the visual alert stands on its own */
  }
}
