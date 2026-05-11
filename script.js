/* ============================================================
   NEON SYNTH SIMULATOR — LIQUID GLASS + GLUCOPHONE EDITION
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

// --- Note Fall Speed (seconds to travel full lane) ---
const NOTE_FALL_SPEED = 3.2;

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
  glucophone: {
    waveform: 'sine',
    attack: 0.005,
    release: 2.5,
    sustain: 0.9,
    filterCutoff: 2500,
    resonance: 2,
    delayAmount: 0.25,
    vibrato: 1.5,
    detune: 2,
    reverbAmount: 0.7,
    volume: 0.5,
  },
};

// --- Active Voices Map ---
const activeVoices = {};

// --- Musical Constants ---
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4_FREQ = 440.0;
const A4_MIDI = 69;

function noteToMidi(note, octave) {
  const idx = NOTES.indexOf(note);
  return (octave + 1) * 12 + idx;
}

function midiToFreq(midi) {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

// --- Piano Key Data (3 octaves C3–B5) ---
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

      const keyData = { note, octave: oct, freq, isBlack, compKey, id: `${note}${oct}`, midi };
      allKeys.push(keyData);
      if (compKey) kbMap[compKey] = keyData;
    }
  }
}
buildKeyData();

// --- Glucophone Data (C major pentatonic, 9 tongues) ---
const GLUCO_NOTES = [
  { note: 'C4', angle: 0 },
  { note: 'D4', angle: 40 },
  { note: 'E4', angle: 80 },
  { note: 'G4', angle: 120 },
  { note: 'A4', angle: 160 },
  { note: 'C5', angle: 200 },
  { note: 'D5', angle: 240 },
  { note: 'E5', angle: 280 },
  { note: 'G5', angle: 320 },
];
const glucoMap = {};

function buildGlucoMap() {
  GLUCO_NOTES.forEach(g => {
    const keyData = allKeys.find(k => k.id === g.note);
    if (keyData) glucoMap[g.note] = { ...keyData, angle: g.angle };
  });
}
buildGlucoMap();

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
  currentInstrument: 'neon',
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
  Am