// HTML5 Web Audio API Synthesizer for tactical sound effects
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  return audioCtx;
}

export function playFlipSound(soundId?: string) {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (browser security policy)
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  masterGain.gain.setValueAtTime(0, now);

  const selected = (soundId || 'classic').toLowerCase().trim();

  if (selected === 'coin') {
    // Retro Arcade Coin: two fast square wave notes
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.connect(masterGain);

    masterGain.gain.linearRampToValueAtTime(0.12, now + 0.01);
    masterGain.gain.setValueAtTime(0.12, now + 0.08);
    masterGain.gain.linearRampToValueAtTime(0.0, now + 0.22);

    osc.frequency.setValueAtTime(987.77, now); // B5 note
    osc.frequency.setValueAtTime(1318.51, now + 0.08); // E6 note

    osc.start(now);
    osc.stop(now + 0.23);

  } else if (selected === 'laser') {
    // Cyber Laser: fast exponential pitch decay
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.connect(masterGain);

    masterGain.gain.linearRampToValueAtTime(0.15, now + 0.01);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);

    osc.start(now);
    osc.stop(now + 0.19);

  } else if (selected === 'metallic') {
    // Military Metallic Clank: multiple detuned sine wave frequencies
    const frequencies = [220, 392, 440, 587, 880];
    const duration = 0.35;

    masterGain.gain.linearRampToValueAtTime(0.2, now + 0.005);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    frequencies.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(250, now);

      osc.connect(filter);
      filter.connect(masterGain);

      osc.start(now);
      osc.stop(now + duration);
    });

  } else if (selected === 'meow') {
    // Tactical Kitten Chirp / Meow: rising then falling triangle wave
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.connect(masterGain);

    masterGain.gain.linearRampToValueAtTime(0.18, now + 0.05);
    masterGain.gain.setValueAtTime(0.18, now + 0.18);
    masterGain.gain.linearRampToValueAtTime(0.0, now + 0.28);

    // Frequency bend
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(1050, now + 0.1);
    osc.frequency.linearRampToValueAtTime(800, now + 0.28);

    osc.start(now);
    osc.stop(now + 0.29);

  } else {
    // Classic Woosh: filtered white noise + sweep osc
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(masterGain);

    masterGain.gain.linearRampToValueAtTime(0.25, now + 0.08);
    masterGain.gain.linearRampToValueAtTime(0.0, now + 0.35);

    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.3);

    // Add filter sweep
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(120, now);
    filter.frequency.linearRampToValueAtTime(1200, now + 0.15);
    filter.frequency.linearRampToValueAtTime(150, now + 0.35);

    osc.disconnect(masterGain);
    osc.connect(filter);
    filter.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.36);
  }
}
