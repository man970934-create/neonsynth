/* ============================================================
   NEON SYNTH SIMULATOR — ADVANCED VERSION WITH FALLING NOTES
   Pure vanilla JS, Web Audio API, no external dependencies.
   ============================================================ */

// --- Audio Context & Shared Nodes ---
let audioCtx = null;
let masterGain = null;
let delayNode = null;
let delayFeedback = null;
let delayWet = null;
let reverbNode = null;
let reverbWet = null;
let filterNode = null;

// --- Synth Parameters ---
let params = {
  waveform: 'sine',
  volume: 0.5,
  attack: 0.05,
  release: 0.3,
  sustain: 0.7,
  filterCutoff: 8000,
  resonance: 1,
  delayAmount: 0.2,
  vibrato: 0,
  detune: 0,
  reverbAmount: 0.3,
  keyboardScale: 100,
};

// --- Instrument Presets ---
const PRESETS = {
  neon: {
    waveform: 'sawtooth',
    attack: 0.02,
    release: 0.4,
    sustain: 0.8,
    filterCutoff: 6000,
    resonance: 3,
    delayAmount: 0.35,
    vibrato: 2,
    detune: 8,
    reverbAmount: 0.2,
    volume: 0.45,
  },
  piano: {
    waveform: 'triangle',
    attack: 0.005,
    release: 0.25,
    sustain: 0.4,
    filterCutoff: 5000,
    resonance: 1,
    delayAmount: 0.05,
    vibrato: 0,
    detune: 0,
    reverbAmount: 0.35,
    volume: 0.55,
  },
  pad: {
    waveform: 'sine',
    attack: 0.8,
    release: 1.5,
    sustain: 0.9,
    filterCutoff: 3000,
    resonance: 2,
    delayAmount: 0.45,
    vibrato: 1,
    detune: 5,
    reverbAmount: 0.6,
    volume: 0.4,
  },
  bass: {
    waveform: 'square',
    attack: 0.01,
    release: 0.2,
    sustain: 0.6,
    filterCutoff: 800,
    resonance: 4,
    delayAmount: 0.05,
    vibrato: 0.5,
    detune: 3,
    reverbAmount: 0.1,
    volume: 0.6,
  },
  lead: {
    waveform: 'sawtooth',
    attack: 0.01,
    release: 0.35,
    sustain: 0.85,
    filterCutoff: 8000,
    resonance: 5,
    delayAmount: 0.25,
    vibrato: 3,
    detune: 12,
    reverbAmount: 0.25,
    volume: 0.45,
  },
  gluco: {
    // Note: the actual oscillator topology for gluco is custom in playNote().
    // These envelope params still apply.
    waveform: 'sine',
    attack: 0.005,
    release: 1.6,
    sustain: 0.9,
    filterCutoff: 6000,
    resonance: 1,
    delayAmount: 0.35,
    vibrato: 0,
    detune: 0,
    reverbAmount: 0.5,
    volume: 0.55,
  },
};

// --- Active Voices Map ---
const activeVoices = {};

// --- Falling Notes Timing ---
// How long a strip travels from the top of the lane to the keys (in seconds).
// Comfortable preview window for the player.
const NOTE_TRAVEL_TIME = 3.6;

// --- Current Instrument ---
// 'piano' (uses regular keyboard) or 'gluco' (uses round glucophone).
let currentInstrument = 'piano';

// --- Glucophone Notes (D minor pentatonic, spans D4..D5+) ---
// 9 tongues arranged around the disc.
const GLUCO_NOTES = [
  { note: 'D',  octave: 4 },
  { note: 'F',  octave: 4 },
  { note: 'G',  octave: 4 },
  { note: 'A',  octave: 4 },
  { note: 'C',  octave: 5 },
  { note: 'D',  octave: 5 },
  { note: 'F',  octave: 5 },
  { note: 'G',  octave: 5 },
  { note: 'A',  octave: 5 },
];
// Built lazily after buildKeyData runs.
let glucoKeys = [];

// --- Musical Constants ---
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4_FREQ = 440.0;
const A4_MIDI = 69;

/** Convert note name + octave to MIDI number. */
function noteToMidi(note, octave) {
  const idx = NOTES.indexOf(note);
  return (octave + 1) * 12 + idx;
}

/** Convert MIDI number to frequency (A4 = 440 Hz). */
function midiToFreq(midi) {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

// --- Build Key Data for 3 Octaves (C3 to B5) ---
const allKeys = [];
const kbMap = {};

function buildKeyData() {
  const whiteChars = ['a','s','d','f','g','h','j','k','l',';'];
  const blackChars = ['w','e','t','y','u','o','p'];
  let wIdx = 0, bIdx = 0;

  for (let oct = 3; oct <= 5; oct++) {
    for (let i = 0; i < 12; i++) {
      const note = NOTES[i];
      const midi = noteToMidi(note, oct);
      const freq = midiToFreq(midi);
      const isBlack = note.includes('#');
      let compKey = null;

      if (oct === 4) {
        if (!isBlack && wIdx < whiteChars.length) compKey = whiteChars[wIdx++];
        if (isBlack && bIdx < blackChars.length) compKey = blackChars[bIdx++];
      }

      const keyData = {
        note,
        octave: oct,
        freq,
        isBlack,
        compKey,
        id: `${note}${oct}`,
        midi,
      };
      allKeys.push(keyData);

      if (compKey) {
        kbMap[compKey] = keyData;
      }
    }
  }
}
buildKeyData();

// Build glucophone key data using frequencies derived from the same MIDI table.
glucoKeys = GLUCO_NOTES.map((n, i) => {
  const midi = noteToMidi(n.note, n.octave);
  const freq = midiToFreq(midi);
  return {
    note: n.note,
    octave: n.octave,
    id: `${n.note}${n.octave}`,
    freq,
    midi,
    isBlack: false,
    tongueIndex: i,
  };
});

// --- Built-in Melody Presets ---
const MELODY_PRESETS = {
  twinkle: [
    { note: 'C4', duration: 0.4 }, { note: 'C4', duration: 0.4 },
    { note: 'G4', duration: 0.4 }, { note: 'G4', duration: 0.4 },
    { note: 'A4', duration: 0.4 }, { note: 'A4', duration: 0.4 },
    { note: 'G4', duration: 0.8 },
    { note: 'F4', duration: 0.4 }, { note: 'F4', duration: 0.4 },
    { note: 'E4', duration: 0.4 }, { note: 'E4', duration: 0.4 },
    { note: 'D4', duration: 0.4 }, { note: 'D4', duration: 0.4 },
    { note: 'C4', duration: 0.8 },
  ],
  morning: [
    { note: 'E4', duration: 0.5 }, { note: 'G4', duration: 0.5 },
    { note: 'B4', duration: 0.5 }, { note: 'E5', duration: 0.5 },
    { note: 'D5', duration: 0.4 }, { note: 'B4', duration: 0.4 },
    { note: 'G4', duration: 0.6 }, { note: 'A4', duration: 0.3 },
    { note: 'B4', duration: 0.3 }, { note: 'C5', duration: 0.6 },
    { note: 'B4', duration: 0.4 }, { note: 'G4', duration: 0.8 },
  ],
  cascade: [
    { note: 'C4', duration: 0.3 }, { note: 'E4', duration: 0.3 },
    { note: 'G4', duration: 0.3 }, { note: 'C5', duration: 0.3 },
    { note: 'B4', duration: 0.3 }, { note: 'G4', duration: 0.3 },
    { note: 'E4', duration: 0.3 }, { note: 'C4', duration: 0.3 },
    { note: 'D4', duration: 0.3 }, { note: 'F4', duration: 0.3 },
    { note: 'A4', duration: 0.3 }, { note: 'D5', duration: 0.3 },
    { note: 'C5', duration: 0.3 }, { note: 'A4', duration: 0.3 },
    { note: 'F4', duration: 0.3 }, { note: 'D4', duration: 0.6 },
  ],
  lullaby: [
    { note: 'A3', duration: 0.6 }, { note: 'C4', duration: 0.4 },
    { note: 'E4', duration: 0.4 }, { note: 'A4', duration: 0.6 },
    { note: 'G4', duration: 0.4 }, { note: 'E4', duration: 0.4 },
    { note: 'C4', duration: 0.6 }, { note: 'D4', duration: 0.4 },
    { note: 'E4', duration: 0.4 }, { note: 'F4', duration: 0.4 },
    { note: 'E4', duration: 0.4 }, { note: 'D4', duration: 0.8 },
  ],
  arp: [
    { note: 'C4', duration: 0.25 }, { note: 'E4', duration: 0.25 },
    { note: 'G4', duration: 0.25 }, { note: 'C5', duration: 0.25 },
    { note: 'G4', duration: 0.25 }, { note: 'E4', duration: 0.25 },
    { note: 'C4', duration: 0.25 }, { note: 'E4', duration: 0.25 },
    { note: 'A3', duration: 0.25 }, { note: 'C4', duration: 0.25 },
    { note: 'E4', duration: 0.25 }, { note: 'A4', duration: 0.25 },
    { note: 'E4', duration: 0.25 }, { note: 'C4', duration: 0.25 },
    { note: 'A3', duration: 0.25 }, { note: 'C4', duration: 0.5 },
  ],
};

// --- Game State ---
let game = {
  mode: 'free',
  score: 0,
  level: 1,
  streak: 0,
  targetSequence: [],
  playerIndex: 0,
  chordTarget: [],
  chordInput: [],
  chordTimer: null,
  currentPreset: null,
  isPlayingPreset: false,
};

// --- Musical Data for Generation ---
const SCALE_C_MAJOR = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SCALE_A_MINOR_PENTA = ['A', 'C', 'D', 'E', 'G'];
const CHORDS = {
  C:  ['C','E','G'],
  Dm: ['D','F','A'],
  Em: ['E','G','B'],
  F:  ['F','A','C'],
  G:  ['G','B','D'],
  Am: ['A','C','E'],
};

// --- DOM References ---
const startScreen = document.getElementById('start-screen');
const mainScreen = document.getElementById('main-screen');
const rotateHint = document.getElementById('rotate-hint');
const startBtn = document.getElementById('start-btn');

const presetSelect = document.getElementById('preset');
const gameModeSelect = document.getElementById('game-mode-select');
const waveformSelect = document.getElementById('waveform');
const volumeSlider = document.getElementById('volume');
const attackSlider = document.getElementById('attack');
const releaseSlider = document.getElementById('release');
const sustainSlider = document.getElementById('sustain');
const filterCutoffSlider = document.getElementById('filter-cutoff');
const resonanceSlider = document.getElementById('resonance');
const delaySlider = document.getElementById('delay-amount');
const vibratoSlider = document.getElementById('vibrato');
const detuneSlider = document.getElementById('detune');
const reverbSlider = document.getElementById('reverb-amount');
const scaleSlider = document.getElementById('keyboard-scale');
const melodyPresetSelect = document.getElementById('melody-preset');
const playPresetBtn = document.getElementById('play-preset-btn');
const practicePresetBtn = document.getElementById('practice-preset-btn');

const scoreDisplay = document.getElementById('score');
const levelDisplay = document.getElementById('level');
const streakDisplay = document.getElementById('streak');
const targetDisplay = document.getElementById('target-display');
const targetSteps = document.getElementById('target-steps');
const modeBadge = document.getElementById('mode-badge');
const gameModeHud = document.getElementById('game-mode');
const presetNameHud = document.getElementById('preset-name');

const newMelodyBtn = document.getElementById('new-melody-btn');
const playMelodyBtn = document.getElementById('play-melody-btn');
const resetScoreBtn = document.getElementById('reset-score-btn');
const resetLevelBtn = document.getElementById('reset-level-btn');

const keyboardEl = document.getElementById('keyboard');
const keyboardWrapperEl = document.getElementById('keyboard-wrapper');
const glucophoneWrapperEl = document.getElementById('glucophone-wrapper');
const glucophoneEl = document.getElementById('glucophone');
const kbHintEl = document.getElementById('kb-hint');
const laneContainer = document.getElementById('lane-container');

// --- Audio System Setup ---

/** Initialize AudioContext and shared effect nodes on first user gesture.
 *  IMPORTANT: this must always be called from a user gesture handler
 *  (click / touch / keydown). On iOS / Telegram WebView, AudioContext
 *  stays suspended until that happens. */
function initAudio() {
  try {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('Web Audio API not supported');
      return;
    }
    audioCtx = new AC();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = params.filterCutoff;
    filterNode.Q.value = params.resonance;

    // Dry path is the MAIN signal route — always audible regardless of FX state.
    filterNode.connect(masterGain);

    // Delay (parallel send) — bounded feedback so it can't blow up volume.
    delayNode = audioCtx.createDelay(2.0);
    delayFeedback = audioCtx.createGain();
    delayWet = audioCtx.createGain();
    delayNode.delayTime.value = 0.35;
    delayFeedback.gain.value = 0.35;
    delayWet.gain.value = params.delayAmount;
    filterNode.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(delayWet);
    delayWet.connect(masterGain);

    // Reverb-ish (feedback delay network) — short delay, modest feedback.
    reverbNode = audioCtx.createDelay(3.0);
    const reverbFeedback = audioCtx.createGain();
    reverbWet = audioCtx.createGain();
    reverbNode.delayTime.value = 0.06;
    reverbFeedback.gain.value = 0.5;
    reverbWet.gain.value = params.reverbAmount;
    filterNode.connect(reverbNode);
    reverbNode.connect(reverbFeedback);
    reverbFeedback.connect(reverbNode);
    reverbNode.connect(reverbWet);
    reverbWet.connect(masterGain);

    // Try to resume immediately in case context started suspended.
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch (err) {
    console.error('initAudio failed:', err);
  }
}

/** Resume helper — safe to call from any user gesture. */
function resumeAudio() {
  if (!audioCtx) {
    initAudio();
    return;
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

/** Stop all currently active voices (used on instrument switch etc). */
function stopAllNotes() {
  Object.keys(activeVoices).forEach(id => stopNote(id));
}

/** Convert noteId like "C4" / "F#5" to frequency. */
function noteToFrequency(noteId) {
  const k = allKeys.find(x => x.id === noteId);
  if (k) return k.freq;
  // fallback: parse "C#4"
  const m = /^([A-G]#?)(-?\d+)$/.exec(noteId);
  if (!m) return 440;
  return midiToFreq(noteToMidi(m[1], parseInt(m[2], 10)));
}

/** Update real-time effect parameters. */
function updateEffects() {
  if (!audioCtx) return;
  if (filterNode) {
    filterNode.frequency.setTargetAtTime(params.filterCutoff, audioCtx.currentTime, 0.05);
    filterNode.Q.setTargetAtTime(params.resonance, audioCtx.currentTime, 0.05);
  }
  if (delayWet) delayWet.gain.setTargetAtTime(params.delayAmount, audioCtx.currentTime, 0.05);
  if (reverbWet) reverbWet.gain.setTargetAtTime(params.reverbAmount, audioCtx.currentTime, 0.05);
}

// --- Note Playback ---

/** Play a note with envelope, vibrato, detune, effects. */
function playNote(freq, noteId) {
  // Ensure audio is ready. If still suspended (no gesture yet) — bail quietly.
  if (!audioCtx) {
    initAudio();
  }
  if (!audioCtx || !filterNode) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  // If this voice is already active, stop the old one before re-triggering.
  if (activeVoices[noteId]) {
    stopNote(noteId);
  }

  const now = audioCtx.currentTime;
  const voice = {
    oscs: [],
    gain: null,
    vibratoOsc: null,
    vibratoGain: null,
    extraNodes: [],
  };

  // Safe envelope target — never exactly 0, so exponentialRamp on release works.
  const targetLevel = Math.max(0.0001, params.volume * (params.sustain > 0 ? params.sustain : 0.7));
  const attackTime = Math.max(0.005, params.attack);

  // For glucophone instrument, use a richer bell-like voice.
  const isGluco = currentInstrument === 'gluco';

  if (isGluco) {
    // Bell-like: fundamental sine + soft triangle 2x + quiet 3x partial.
    const partials = [
      { type: 'sine',     mult: 1.0, level: 1.0 },
      { type: 'triangle', mult: 2.0, level: 0.35 },
      { type: 'sine',     mult: 3.0, level: 0.12 },
    ];
    partials.forEach(p => {
      const o = audioCtx.createOscillator();
      o.type = p.type;
      o.frequency.setValueAtTime(freq * p.mult, now);
      const og = audioCtx.createGain();
      og.gain.value = p.level;
      o.connect(og);
      voice.oscs.push(o);
      voice.extraNodes.push(og);
      // Connect each partial through its level gain into the main voice gain (created below).
      // We'll wire after creating gainNode.
      o._levelGain = og;
    });
  } else {
    const osc = audioCtx.createOscillator();
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(freq, now);
    voice.oscs.push(osc);

    if (params.detune > 0) {
      osc.detune.setValueAtTime(params.detune, now);
      const osc2 = audioCtx.createOscillator();
      osc2.type = params.waveform;
      osc2.frequency.setValueAtTime(freq, now);
      osc2.detune.setValueAtTime(-params.detune, now);
      voice.oscs.push(osc2);
    }
  }

  const gainNode = audioCtx.createGain();
  // Start from a tiny non-zero value so exponential release later is safe.
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.linearRampToValueAtTime(targetLevel, now + attackTime);
  voice.gain = gainNode;

  // Vibrato (skip for gluco — it muddies the bell)
  if (!isGluco && params.vibrato > 0) {
    const vibOsc = audioCtx.createOscillator();
    vibOsc.frequency.value = params.vibrato;
    const vibGain = audioCtx.createGain();
    vibGain.gain.value = freq * 0.005;
    vibOsc.connect(vibGain);
    voice.oscs.forEach(o => {
      try { vibGain.connect(o.frequency); } catch (e) {}
    });
    vibOsc.start(now);
    voice.vibratoOsc = vibOsc;
    voice.vibratoGain = vibGain;
  }

  // Wire oscillators -> gain.
  voice.oscs.forEach(o => {
    if (o._levelGain) {
      o.connect(o._levelGain);
      o._levelGain.connect(gainNode);
    } else {
      o.connect(gainNode);
    }
    try { o.start(now); } catch (e) {}
  });

  // Route into the effect chain (filter is always the entry point).
  gainNode.connect(filterNode);

  activeVoices[noteId] = voice;
}

/** Stop a note with release envelope. */
function stopNote(noteId) {
  const voice = activeVoices[noteId];
  if (!voice || !audioCtx) return;
  const now = audioCtx.currentTime;
  const { gain, oscs, vibratoOsc } = voice;

  // Glucophone uses a longer release for bell-like decay.
  const isGluco = currentInstrument === 'gluco';
  const rel = isGluco ? Math.max(1.6, params.release * 3) : Math.max(0.05, params.release);

  try {
    // Snapshot current gain so the ramp starts from "right now", not from a stale value.
    const currentVal = Math.max(0.0001, gain.gain.value);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(currentVal, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + rel);
  } catch (e) {}

  const stopTime = now + rel + 0.05;
  oscs.forEach(o => { try { o.stop(stopTime); } catch (e) {} });
  if (vibratoOsc) { try { vibratoOsc.stop(stopTime); } catch (e) {} }

  // Mark this voice slot free immediately so the same key can be retriggered.
  delete activeVoices[noteId];

  // Clean up nodes a little after audio fully stops.
  setTimeout(() => {
    try {
      gain.disconnect();
      oscs.forEach(o => o.disconnect());
      if (voice.vibratoGain) voice.vibratoGain.disconnect();
      if (voice.extraNodes) voice.extraNodes.forEach(n => { try { n.disconnect(); } catch (e) {} });
    } catch (e) {}
  }, rel * 1000 + 200);
}

// --- Visual Key Handling ---

function findKeyEl(noteId) {
  // Try keyboard first, then glucophone tongues.
  let el = keyboardEl ? keyboardEl.querySelector(`.key[data-id="${noteId}"]`) : null;
  if (el) return el;
  if (glucophoneEl) {
    el = glucophoneEl.querySelector(`.tongue[data-id="${noteId}"]`);
  }
  return el;
}

function activateKey(noteId) {
  const el = findKeyEl(noteId);
  if (el) el.classList.add('active');
}

function deactivateKey(noteId) {
  const el = findKeyEl(noteId);
  if (el) el.classList.remove('active');
}

function flashCorrect(noteId) {
  const el = findKeyEl(noteId);
  if (!el) return;
  el.classList.add('correct');
  setTimeout(() => el.classList.remove('correct'), 400);
}

function flashWrong(noteId) {
  const el = findKeyEl(noteId);
  if (!el) return;
  el.classList.add('wrong');
  setTimeout(() => el.classList.remove('wrong'), 400);
}

// --- Falling Notes System ---

// Track all currently animating strips so we can cancel them on instrument switch.
const activeStrips = new Set();

/** Spawn a falling note strip aligned to a key.
 *  durationSec — the note's musical duration (controls strip length).
 *  Travel time across the lane is fixed (NOTE_TRAVEL_TIME) regardless of length. */
function spawnFallingNote(noteId, durationSec) {
  // No falling-strip lane for the glucophone — different visual style entirely.
  if (currentInstrument === 'gluco') return null;
  if (!laneContainer || !keyboardWrapperEl) return null;

  const keyEl = findKeyEl(noteId);
  if (!keyEl) return null;

  const strip = document.createElement('div');
  const isBlack = keyEl.classList.contains('black');
  strip.className = `falling-note ${isBlack ? 'black-lane' : 'white-lane'}`;

  // Geometry
  const keyRect = keyEl.getBoundingClientRect();
  const wrapperRect = keyboardWrapperEl.getBoundingClientRect();
  const laneRect = laneContainer.getBoundingClientRect();

  // X position: align horizontally to the visible center of the key.
  // Using boundingClientRect handles horizontal scroll automatically.
  const keyCenterX = keyRect.left + keyRect.width / 2;
  const stripWidth = isBlack
    ? Math.max(14, keyRect.width * 0.7)   // thinner for black keys
    : Math.max(20, keyRect.width * 0.85); // thicker for white keys
  const leftPx = keyCenterX - laneRect.left - stripWidth / 2;

  // Clamp inside the lane so strips never overlap UI outside.
  const clampedLeft = Math.max(0, Math.min(laneRect.width - stripWidth, leftPx));

  strip.style.left = clampedLeft + 'px';
  strip.style.width = stripWidth + 'px';

  // Height proportional to duration (longer note = longer strip).
  const laneHeight = laneRect.height || 120;
  const minHeight = 18;
  const maxHeight = Math.max(40, laneHeight * 0.55);
  // Scale: 1.0s of note duration ≈ 60px tall (visually clear without overflowing the lane).
  const heightPx = Math.max(minHeight, Math.min(maxHeight, durationSec * 70));
  strip.style.height = heightPx + 'px';

  laneContainer.appendChild(strip);
  activeStrips.add(strip);

  // Animate: travel from above the lane down to the keyboard line.
  // Total travel distance = lane height + strip height (so head reaches the bottom).
  const totalDist = laneHeight + heightPx + 10;
  const durationMs = NOTE_TRAVEL_TIME * 1000;

  let startTime = null;
  let rafId = null;
  function animate(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    const progress = elapsed / durationMs;
    if (progress >= 1) {
      activeStrips.delete(strip);
      if (strip.parentNode) strip.parentNode.removeChild(strip);
      return;
    }
    // Start above lane (negative Y) so the head enters smoothly.
    const y = progress * totalDist - heightPx;
    strip.style.transform = `translateY(${y}px)`;
    rafId = requestAnimationFrame(animate);
  }
  rafId = requestAnimationFrame(animate);

  // Store rafId in case we need to cancel.
  strip._rafId = () => rafId;

  return strip;
}

/** Clear all falling notes. */
function clearFallingNotes() {
  activeStrips.forEach(s => {
    if (s.parentNode) s.parentNode.removeChild(s);
  });
  activeStrips.clear();
  if (laneContainer) laneContainer.innerHTML = '';
}

/** Re-align falling notes after resize/scale change. */
function realignFallingNotes() {
  // Simplest safe behavior: clear; the next round will spawn correctly.
  clearFallingNotes();
}

// --- Game Logic ---

/** Generate a harmonious melody sequence. */
function generateMelody() {
  const len = Math.min(game.level, 8);

  // For glucophone: pick only from its 9 tongues — guaranteed playable.
  if (currentInstrument === 'gluco') {
    const seq = [];
    let prevIdx = Math.floor(Math.random() * glucoKeys.length);
    for (let i = 0; i < len; i++) {
      // Move by ±1 or ±2 within the gluco range for melodic flow.
      let step = (Math.random() > 0.5 ? 1 : -1) * (Math.random() > 0.7 ? 2 : 1);
      let idx = prevIdx + step;
      if (idx < 0) idx = 0;
      if (idx >= glucoKeys.length) idx = glucoKeys.length - 1;
      prevIdx = idx;
      const k = glucoKeys[idx];
      seq.push({
        note: k.note,
        octave: k.octave,
        id: k.id,
        freq: k.freq,
        duration: 0.5,
      });
    }
    return seq;
  }

  const scale = Math.random() > 0.4 ? SCALE_C_MAJOR : SCALE_A_MINOR_PENTA;
  const seq = [];
  let lastNote = scale[Math.floor(Math.random() * scale.length)];
  const octaves = [3, 4, 5];

  for (let i = 0; i < len; i++) {
    const idx = scale.indexOf(lastNote);
    let nextIdx = idx + (Math.random() > 0.5 ? 1 : -1);
    if (Math.random() > 0.7) nextIdx += (Math.random() > 0.5 ? 1 : -1);
    nextIdx = Math.max(0, Math.min(scale.length - 1, nextIdx));
    lastNote = scale[nextIdx];
    const oct = octaves[Math.floor(Math.random() * octaves.length)];
    const id = `${lastNote}${oct}`;
    const keyData = allKeys.find(k => k.id === id);
    seq.push({
      note: lastNote,
      octave: oct,
      id,
      freq: keyData ? keyData.freq : midiToFreq(noteToMidi(lastNote, oct)),
      duration: 0.4,
    });
  }
  return seq;
}

/** Generate a chord target. */
function generateChord() {
  const names = Object.keys(CHORDS);
  const name = names[Math.floor(Math.random() * names.length)];
  const notes = CHORDS[name];
  const oct = 4;
  return {
    name,
    notes: notes.map(n => {
      const id = `${n}${oct}`;
      const keyData = allKeys.find(k => k.id === id);
      return {
        note: n,
        octave: oct,
        id,
        freq: keyData ? keyData.freq : midiToFreq(noteToMidi(n, oct)),
        duration: 0.5,
      };
    }),
  };
}

/** Update target display and step dots. */
function updateTargetDisplay() {
  if (game.mode === 'free') {
    targetDisplay.textContent = '-';
    targetSteps.innerHTML = '';
    modeBadge.textContent = 'Free Play';
    return;
  }

  if (game.mode === 'melody') {
    modeBadge.textContent = `Melody L${game.level}`;
    const text = game.targetSequence.map((t, i) => {
      if (i < game.playerIndex) return t.note + t.octave;
      if (i === game.playerIndex) return '➤ ' + t.note + t.octave;
      return t.note + t.octave;
    }).join(' → ');
    targetDisplay.textContent = text || '-';

    targetSteps.innerHTML = '';
    game.targetSequence.forEach((t, i) => {
      const dot = document.createElement('div');
      dot.className = 'step-dot';
      if (i < game.playerIndex) dot.classList.add('correct');
      else if (i === game.playerIndex) dot.classList.add('active');
      targetSteps.appendChild(dot);
    });
    return;
  }

  if (game.mode === 'chord') {
    modeBadge.textContent = `Chord L${game.level}`;
    const text = game.chordTarget.map(t => t.note + t.octave).join(' + ');
    targetDisplay.textContent = text || '-';
    targetSteps.innerHTML = '';
    return;
  }
}

/** Start a new melody round with falling notes preview. */
function newMelody() {
  if (game.mode !== 'melody') {
    game.mode = 'melody';
    gameModeSelect.value = 'melody';
  }
  game.targetSequence = generateMelody();
  game.playerIndex = 0;
  updateTargetDisplay();
  gameModeHud.textContent = 'Melody';
  game.currentPreset = null;
  melodyPresetSelect.value = '';

  // Spawn falling notes preview
  clearFallingNotes();
  spawnMelodyStrips(game.targetSequence);
}

/** Start a new chord round with falling notes preview. */
function newChord() {
  if (game.mode !== 'chord') {
    game.mode = 'chord';
    gameModeSelect.value = 'chord';
  }
  const chord = generateChord();
  game.chordTarget = chord.notes;
  game.chordInput = [];
  game.chordName = chord.name;
  updateTargetDisplay();
  gameModeHud.textContent = 'Chord';
  game.currentPreset = null;
  melodyPresetSelect.value = '';

  // Spawn chord strips simultaneously
  clearFallingNotes();
  game.chordTarget.forEach(t => {
    spawnFallingNote(t.id, t.duration);
  });
}

/** Spawn falling strips for a melody sequence with staggered timing. */
function spawnMelodyStrips(sequence) {
  let delay = 0;
  sequence.forEach(t => {
    setTimeout(() => {
      spawnFallingNote(t.id, t.duration);
    }, delay);
    delay += 700;
  });
}

/** Auto-play current melody or chord. */
function playMelody() {
  if (!audioCtx) initAudio();
  if (game.mode === 'melody' && game.targetSequence.length > 0) {
    let delay = 0;
    game.targetSequence.forEach((t) => {
      setTimeout(() => {
        playNote(t.freq, t.id);
        activateKey(t.id);
        setTimeout(() => {
          stopNote(t.id);
          deactivateKey(t.id);
        }, 400);
      }, delay);
      delay += 500;
    });
  } else if (game.mode === 'chord' && game.chordTarget.length > 0) {
    game.chordTarget.forEach((t) => {
      playNote(t.freq, t.id);
      activateKey(t.id);
    });
    setTimeout(() => {
      game.chordTarget.forEach(t => {
        stopNote(t.id);
        deactivateKey(t.id);
      });
    }, 600);
  }
}

/** Play a built-in preset melody. */
function playPresetMelody(presetName) {
  const preset = MELODY_PRESETS[presetName];
  if (!preset) return;
  if (!audioCtx) initAudio();

  clearFallingNotes();
  let delay = 0;
  preset.forEach(item => {
    const keyData = pickPlayableKey(item.note);
    if (!keyData) return;
    setTimeout(() => {
      playNote(keyData.freq, keyData.id);
      activateKey(keyData.id);
      spawnFallingNote(keyData.id, item.duration);
      setTimeout(() => {
        stopNote(keyData.id);
        deactivateKey(keyData.id);
      }, item.duration * 1000);
    }, delay);
    delay += item.duration * 1000 + 50;
  });
}

/** Pick a key the player can actually press given the current instrument.
 *  For glucophone: snap to nearest tongue by MIDI distance.
 *  For piano: exact match in allKeys. */
function pickPlayableKey(noteId) {
  if (currentInstrument === 'gluco') {
    const exact = glucoKeys.find(k => k.id === noteId);
    if (exact) return exact;
    const m = /^([A-G]#?)(-?\d+)$/.exec(noteId);
    if (!m) return glucoKeys[0];
    const targetMidi = noteToMidi(m[1], parseInt(m[2], 10));
    let best = glucoKeys[0];
    let bestDist = Infinity;
    glucoKeys.forEach(k => {
      const d = Math.abs(k.midi - targetMidi);
      if (d < bestDist) { bestDist = d; best = k; }
    });
    return best;
  }
  return allKeys.find(k => k.id === noteId);
}

/** Set practice mode for a preset melody. */
function practicePresetMelody(presetName) {
  const preset = MELODY_PRESETS[presetName];
  if (!preset) return;

  game.mode = 'melody';
  gameModeSelect.value = 'melody';
  game.currentPreset = presetName;

  game.targetSequence = preset.map(item => {
    const keyData = pickPlayableKey(item.note);
    if (!keyData) return null;
    return {
      note: keyData.note,
      octave: keyData.octave,
      id: keyData.id,
      freq: keyData.freq,
      duration: item.duration,
    };
  }).filter(Boolean);

  game.playerIndex = 0;
  updateTargetDisplay();
  gameModeHud.textContent = 'Melody';
  modeBadge.textContent = 'Practice';

  // Spawn falling notes for practice (no-op for gluco).
  clearFallingNotes();
  spawnMelodyStrips(game.targetSequence);
}

/** Process a played note in game modes. */
function checkGame(noteId) {
  if (game.mode === 'free') return;

  if (game.mode === 'melody') {
    if (game.targetSequence.length === 0) return;
    const expected = game.targetSequence[game.playerIndex];
    if (expected && expected.id === noteId) {
      flashCorrect(noteId);
      game.playerIndex++;
      if (game.playerIndex >= game.targetSequence.length) {
        game.score++;
        game.streak++;
        if (game.streak >= 3) {
          game.level++;
          game.streak = 0;
        }
        updateHud();
        setTimeout(() => {
          if (game.currentPreset) {
            // Replay same preset for practice
            practicePresetMelody(game.currentPreset);
          } else {
            newMelody();
          }
        }, 500);
      }
    } else {
      flashWrong(noteId);
      game.streak = 0;
      updateHud();
      game.playerIndex = 0;
    }
    updateTargetDisplay();
    return;
  }

  if (game.mode === 'chord') {
    if (game.chordTarget.length === 0) return;
    game.chordInput.push(noteId);
    const needed = game.chordTarget.map(t => t.id);
    const hasAll = needed.every(n => game.chordInput.includes(n));
    const hasWrong = game.chordInput.some(n => !needed.includes(n));

    if (hasAll && !hasWrong) {
      needed.forEach(n => flashCorrect(n));
      game.score++;
      game.streak++;
      if (game.streak >= 3) {
        game.level++;
        game.streak = 0;
      }
      updateHud();
      setTimeout(() => newChord(), 500);
      return;
    }

    if (hasWrong) {
      flashWrong(noteId);
      game.streak = 0;
      updateHud();
      game.chordInput = [];
    }

    clearTimeout(game.chordTimer);
    game.chordTimer = setTimeout(() => { game.chordInput = []; }, 800);
    updateTargetDisplay();
  }
}

/** Update HUD numbers. */
function updateHud() {
  scoreDisplay.textContent = game.score;
  levelDisplay.textContent = game.level;
  streakDisplay.textContent = game.streak;
  updateKeyboardThemeByLevel(game.level);
}

/** Reset score. */
function resetScore() {
  game.score = 0;
  game.streak = 0;
  updateHud();
}

/** Reset level. */
function resetLevel() {
  game.level = 1;
  game.streak = 0;
  if (game.mode === 'melody') newMelody();
  if (game.mode === 'chord') newChord();
  updateHud();
}

// --- Keyboard Rendering ---

/** Render all keys with proper labels, octaves, and scaling. */
function renderKeyboard() {
  keyboardEl.innerHTML = '';
  const scale = params.keyboardScale / 100;

  let whiteCount = 0;
  const whiteW = Math.round(56 * scale);
  const blackW = Math.round(36 * scale);
  const keyH = Math.round(200 * scale);

  allKeys.forEach((k) => {
    const el = document.createElement('div');
    el.className = `key ${k.isBlack ? 'black' : 'white'}`;
    el.dataset.id = k.id;
    el.dataset.note = k.note;
    el.dataset.octave = k.octave;
    el.dataset.freq = k.freq.toFixed(3);

    const span = document.createElement('span');

    const noteName = document.createElement('span');
    noteName.className = 'note-name';
    noteName.textContent = k.note;
    span.appendChild(noteName);

    const octNum = document.createElement('span');
    octNum.className = 'octave-num';
    octNum.textContent = k.octave;
    span.appendChild(octNum);

    if (k.compKey) {
      const hint = document.createElement('span');
      hint.className = 'key-hint';
      hint.textContent = k.compKey.toUpperCase();
      span.appendChild(hint);
    }

    el.appendChild(span);

    if (!k.isBlack) {
      el.style.width = whiteW + 'px';
      el.style.height = keyH + 'px';
      whiteCount++;
    } else {
      el.style.width = blackW + 'px';
      el.style.height = Math.round(keyH * 0.6) + 'px';
      el.style.left = (whiteCount * whiteW - blackW / 2) + 'px';
    }

    const startHandler = (e) => {
      e.preventDefault();
      initAudio();
      resumeAudio();
      triggerKey(k.id, k.freq);
    };
    const endHandler = (e) => {
      if (e) e.preventDefault();
      releaseKey(k.id);
    };

    el.addEventListener('mousedown', startHandler);
    el.addEventListener('mouseup', endHandler);
    el.addEventListener('mouseleave', endHandler);
    el.addEventListener('touchstart', startHandler, { passive: false });
    el.addEventListener('touchend', endHandler, { passive: false });
    el.addEventListener('touchcancel', endHandler, { passive: false });

    keyboardEl.appendChild(el);
  });

  keyboardEl.style.width = (whiteCount * whiteW) + 'px';
  keyboardEl.style.height = keyH + 'px';
}

// --- Glucophone Rendering ---

/** Render the round glucophone with N tongues around the circle. */
function renderGlucophone() {
  if (!glucophoneEl) return;
  glucophoneEl.innerHTML = '';

  const n = glucoKeys.length;
  // SVG-based for crisp rendering and easy pointer events on irregular shapes.
  const size = 320; // logical units; scaled by CSS
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.46;
  const innerR = size * 0.16;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('class', 'gluco-svg');

  // Outer rim
  const rim = document.createElementNS(svgNS, 'circle');
  rim.setAttribute('cx', cx);
  rim.setAttribute('cy', cy);
  rim.setAttribute('r', outerR + 6);
  rim.setAttribute('class', 'gluco-rim');
  svg.appendChild(rim);

  // Body
  const body = document.createElementNS(svgNS, 'circle');
  body.setAttribute('cx', cx);
  body.setAttribute('cy', cy);
  body.setAttribute('r', outerR);
  body.setAttribute('class', 'gluco-body');
  svg.appendChild(body);

  // Tongues — wedges from inner to outer radius.
  for (let i = 0; i < n; i++) {
    const startAngle = (i / n) * Math.PI * 2 - Math.PI / 2; // start at top
    const endAngle = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const pad = 0.04; // small gap between tongues

    const a1 = startAngle + pad;
    const a2 = endAngle - pad;

    const x1o = cx + Math.cos(a1) * outerR;
    const y1o = cy + Math.sin(a1) * outerR;
    const x2o = cx + Math.cos(a2) * outerR;
    const y2o = cy + Math.sin(a2) * outerR;
    const x1i = cx + Math.cos(a1) * innerR;
    const y1i = cy + Math.sin(a1) * innerR;
    const x2i = cx + Math.cos(a2) * innerR;
    const y2i = cy + Math.sin(a2) * innerR;

    const largeArc = (a2 - a1) > Math.PI ? 1 : 0;

    const d = [
      `M ${x1i} ${y1i}`,
      `L ${x1o} ${y1o}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o}`,
      `L ${x2i} ${y2i}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1i} ${y1i}`,
      `Z`,
    ].join(' ');

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'tongue');
    const k = glucoKeys[i];
    path.setAttribute('data-id', k.id);
    path.setAttribute('data-note', k.note);
    path.setAttribute('data-octave', k.octave);
    svg.appendChild(path);

    // Note label, placed at mid-radius.
    const midAngle = (a1 + a2) / 2;
    const labelR = (outerR + innerR) / 2;
    const lx = cx + Math.cos(midAngle) * labelR;
    const ly = cy + Math.sin(midAngle) * labelR;

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', lx);
    label.setAttribute('y', ly + 4);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'tongue-label');
    label.textContent = `${k.note}${k.octave}`;
    label.style.pointerEvents = 'none';
    svg.appendChild(label);

    // Pointer events on the path itself.
    const onDown = (e) => {
      e.preventDefault();
      initAudio();
      triggerKey(k.id, k.freq);
    };
    const onUp = (e) => {
      e.preventDefault();
      releaseKey(k.id);
    };
    path.addEventListener('mousedown', onDown);
    path.addEventListener('mouseup', onUp);
    path.addEventListener('mouseleave', onUp);
    path.addEventListener('touchstart', onDown, { passive: false });
    path.addEventListener('touchend', onUp, { passive: false });
    path.addEventListener('touchcancel', onUp, { passive: false });
  }

  // Center decoration
  const center = document.createElementNS(svgNS, 'circle');
  center.setAttribute('cx', cx);
  center.setAttribute('cy', cy);
  center.setAttribute('r', innerR - 4);
  center.setAttribute('class', 'gluco-center');
  svg.appendChild(center);

  glucophoneEl.appendChild(svg);
}

/** Show piano keyboard, hide glucophone (or vice versa). */
function setInstrumentVisibility(instrument) {
  if (instrument === 'gluco') {
    if (keyboardWrapperEl) keyboardWrapperEl.style.display = 'none';
    if (glucophoneWrapperEl) glucophoneWrapperEl.style.display = 'flex';
    if (kbHintEl) kbHintEl.style.display = 'none';
  } else {
    if (keyboardWrapperEl) keyboardWrapperEl.style.display = 'block';
    if (glucophoneWrapperEl) glucophoneWrapperEl.style.display = 'none';
    if (kbHintEl) kbHintEl.style.display = '';
  }
}

/** Switch instrument cleanly: stop notes, clear strips, reset game input,
 *  re-render UI, then regenerate the round so it uses available notes. */
function switchInstrument(name) {
  // Stop any sound first.
  stopAllNotes();
  clearFallingNotes();

  // Reset in-flight game input.
  game.playerIndex = 0;
  game.chordInput = [];
  if (game.chordTimer) { clearTimeout(game.chordTimer); game.chordTimer = null; }

  const isGluco = (name === 'gluco');
  currentInstrument = isGluco ? 'gluco' : 'piano';

  setInstrumentVisibility(currentInstrument);

  // Apply audio preset for this instrument (gluco has its own).
  applyPreset(name);

  // Regenerate round so it uses only the notes the player can hit now.
  if (game.mode === 'melody') {
    newMelody();
  } else if (game.mode === 'chord') {
    if (isGluco) {
      // Chord mode on a 9-tongue gluco is awkward; downgrade to melody.
      game.mode = 'melody';
      if (gameModeSelect) gameModeSelect.value = 'melody';
      newMelody();
    } else {
      newChord();
    }
  } else {
    updateTargetDisplay();
  }
}

// --- Keyboard Theme by Level ---

/** Update keyboard color theme based on current level.
 *  Level 1-2: classic black/white.
 *  Level 3-4: soft cyan/violet edge accent.
 *  Level 5-6: gradient neon on active keys.
 *  Level 7+:  full cyber/neon style. */
function updateKeyboardThemeByLevel(level) {
  if (!keyboardEl) return;
  // Remove old theme classes
  keyboardEl.classList.remove('theme-l1', 'theme-l3', 'theme-l5', 'theme-l7');
  let cls = 'theme-l1';
  if (level >= 7) cls = 'theme-l7';
  else if (level >= 5) cls = 'theme-l5';
  else if (level >= 3) cls = 'theme-l3';
  keyboardEl.classList.add(cls);
}

/** Trigger a key press. */
function triggerKey(noteId, freq) {
  playNote(freq, noteId);
  activateKey(noteId);
  checkGame(noteId);
}

/** Release a key press. */
function releaseKey(noteId) {
  stopNote(noteId);
  deactivateKey(noteId);
}

// --- Computer Keyboard Handling ---

const pressedKeys = new Set();

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (pressedKeys.has(k)) return;
  pressedKeys.add(k);

  if (kbMap[k]) {
    e.preventDefault();
    initAudio();
    const info = kbMap[k];
    triggerKey(info.id, info.freq);
  }
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  pressedKeys.delete(k);
  if (kbMap[k]) {
    e.preventDefault();
    const info = kbMap[k];
    releaseKey(info.id);
  }
});

// --- UI Event Listeners ---

// Start button: try several event types so it works across browsers + Telegram WebView.
// AudioContext must be created/resumed inside a user gesture handler — that's the whole point.
let startActivated = false;
function activateStart() {
  if (startActivated) return;
  startActivated = true;
  initAudio();
  resumeAudio();
  startScreen.classList.remove('active');
  mainScreen.classList.add('active');
  checkOrientation();
}
startBtn.addEventListener('click', activateStart);
startBtn.addEventListener('touchend', (e) => {
  e.preventDefault();
  activateStart();
}, { passive: false });
startBtn.addEventListener('pointerup', (e) => {
  // Pointer events fire on most modern WebViews.
  activateStart();
});

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  params = { ...params, ...p };
  waveformSelect.value = params.waveform;
  volumeSlider.value = params.volume;
  attackSlider.value = params.attack;
  releaseSlider.value = params.release;
  sustainSlider.value = params.sustain;
  filterCutoffSlider.value = params.filterCutoff;
  resonanceSlider.value = params.resonance;
  delaySlider.value = params.delayAmount;
  vibratoSlider.value = params.vibrato;
  detuneSlider.value = params.detune;
  reverbSlider.value = params.reverbAmount;
  const displayName = name === 'gluco' ? 'Glucophone'
                    : name === 'neon'  ? 'Neon Synth'
                    : name === 'piano' ? 'Classic Piano'
                    : name === 'pad'   ? 'Soft Pad'
                    : name.charAt(0).toUpperCase() + name.slice(1);
  presetNameHud.textContent = displayName;
  updateEffects();
}

presetSelect.addEventListener('change', (e) => {
  const val = e.target.value;
  // 'gluco' is the only value that changes the *visual* instrument.
  if (val === 'gluco' || currentInstrument === 'gluco') {
    switchInstrument(val);
  } else {
    applyPreset(val);
  }
});

gameModeSelect.addEventListener('change', (e) => {
  const mode = e.target.value;
  game.mode = mode;
  gameModeHud.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  game.currentPreset = null;
  melodyPresetSelect.value = '';
  if (mode === 'melody') newMelody();
  else if (mode === 'chord') newChord();
  else {
    game.targetSequence = [];
    game.chordTarget = [];
    clearFallingNotes();
    updateTargetDisplay();
    modeBadge.textContent = 'Free Play';
  }
});

waveformSelect.addEventListener('change', (e) => { params.waveform = e.target.value; });
volumeSlider.addEventListener('input', (e) => { params.volume = parseFloat(e.target.value); });
attackSlider.addEventListener('input', (e) => { params.attack = parseFloat(e.target.value); });
releaseSlider.addEventListener('input', (e) => { params.release = parseFloat(e.target.value); });
sustainSlider.addEventListener('input', (e) => { params.sustain = parseFloat(e.target.value); });
filterCutoffSlider.addEventListener('input', (e) => {
  params.filterCutoff = parseFloat(e.target.value);
  updateEffects();
});
resonanceSlider.addEventListener('input', (e) => {
  params.resonance = parseFloat(e.target.value);
  updateEffects();
});
delaySlider.addEventListener('input', (e) => {
  params.delayAmount = parseFloat(e.target.value);
  updateEffects();
});
vibratoSlider.addEventListener('input', (e) => { params.vibrato = parseFloat(e.target.value); });
detuneSlider.addEventListener('input', (e) => { params.detune = parseFloat(e.target.value); });
reverbSlider.addEventListener('input', (e) => {
  params.reverbAmount = parseFloat(e.target.value);
  updateEffects();
});
scaleSlider.addEventListener('input', (e) => {
  params.keyboardScale = parseInt(e.target.value);
  renderKeyboard();
  realignFallingNotes();
});

newMelodyBtn.addEventListener('click', () => {
  if (game.mode === 'melody') newMelody();
  else if (game.mode === 'chord') newChord();
  else {
    game.mode = 'melody';
    gameModeSelect.value = 'melody';
    newMelody();
  }
});

playMelodyBtn.addEventListener('click', () => playMelody());
resetScoreBtn.addEventListener('click', () => resetScore());
resetLevelBtn.addEventListener('click', () => resetLevel());

playPresetBtn.addEventListener('click', () => {
  const val = melodyPresetSelect.value;
  if (val) playPresetMelody(val);
});

practicePresetBtn.addEventListener('click', () => {
  const val = melodyPresetSelect.value;
  if (val) practicePresetMelody(val);
});

// --- Orientation / Mobile ---

function checkOrientation() {
  // Show a non-blocking rotate hint on narrow portrait screens,
  // but DO NOT hide the start screen or the main screen — the player
  // can still tap Start and play.
  if (window.innerWidth < 500 && window.innerHeight > window.innerWidth) {
    rotateHint.classList.add('visible');
  } else {
    rotateHint.classList.remove('visible');
  }
}

window.addEventListener('resize', () => {
  checkOrientation();
  realignFallingNotes();
});
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 300));

// --- Initialization ---

renderKeyboard();
renderGlucophone();
applyPreset('neon');
updateTargetDisplay();
updateKeyboardThemeByLevel(game.level);
setInstrumentVisibility('piano');
checkOrientation();