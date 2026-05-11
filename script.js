(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  // Fallback for CSS.escape
  const cssEscape = typeof CSS.escape === 'function' ? CSS.escape : (s) => s.replace(/[^\\w-]/g, '\\$&');

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4_MIDI = 69;
  const A4_FREQ = 440;
  const COMP_KEYS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j"];
  const COMP_LABELS = ["A", "W", "S", "E", "D", "F", "T", "G", "Y", "H", "U", "J"];

  const PRESETS = {
    neon: { name: "Neon Synth", waveform: "sawtooth", attack: 0.02, release: 0.45, sustain: 0.7, cutoff: 6000, q: 2, delay: 0.2, vibrato: 0, reverb: 0.15, volume: 0.4 },
    piano: { name: "Classic Piano", waveform: "triangle", attack: 0.004, release: 0.4, sustain: 0.2, cutoff: 4500, q: 1, delay: 0.05, vibrato: 0, reverb: 0.2, volume: 0.5 },
    pad: { name: "Soft Pad", waveform: "sine", attack: 0.6, release: 1.5, sustain: 0.8, cutoff: 2800, q: 1.5, delay: 0.3, vibrato: 1.5, reverb: 0.4, volume: 0.35 },
    bass: { name: "Bass", waveform: "square", attack: 0.01, release: 0.2, sustain: 0.6, cutoff: 900, q: 4, delay: 0.02, vibrato: 0, reverb: 0.05, volume: 0.55 },
    lead: { name: "Lead", waveform: "sawtooth", attack: 0.01, release: 0.3, sustain: 0.75, cutoff: 8500, q: 3, delay: 0.15, vibrato: 4, reverb: 0.1, volume: 0.45 }
  };

  const state = {
    started: false,
    audioCtx: null,
    masterGain: null,
    delayWet: null,
    reverbWet: null,
    keys: [],
    keyMap: new Map(),
    activeVoices: new Map(),
    score: 0,
    level: 1,
    streak: 0,
    mode: "free",
    instrument: "neon",
    targetSeq: [],
    targetIdx: 0,
    chordTarget: [],
    chordPressed: new Set(),
    chordTimer: null,
    scale: 100,
    lastTap: 0,
    compKeysDown: new Set()
  };

  const params = {
    waveform: "sawtooth", volume: 0.4, attack: 0.02, release: 0.45, sustain: 0.7,
    cutoff: 6000, q: 2, delay: 0.2, vibrato: 0, reverb: 0.15
  };

  document.addEventListener("DOMContentLoaded", initApp);

  function initApp() {
    applyPreset("neon");
    readControls();
    buildKeyData();
    createKeyboard();
    bindEvents();
    updateHUD();
    bindControls();
  }

  function readControls() {
    const scaleEl = $("keyboard-scale");
    if (scaleEl) state.scale = Number(scaleEl.value || 100);
    const modeEl = $("game-mode-select");
    if (modeEl) state.mode = modeEl.value;
    const presetEl = $("preset");
    if (presetEl) state.instrument = presetEl.value;
  }

  function bindEvents() {
    const startBtn = $("start-btn");
    if (startBtn) {
      const handler = (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - state.lastTap < 300) return;
        state.lastTap = now;
        startApp();
      };
      startBtn.addEventListener("pointerup", handler, { passive: false });
      startBtn.addEventListener("click", handler);
    }

    $("toggle-controls-btn")?.addEventListener("click", () => {
      $("controls-panel")?.classList.toggle("hidden");
    });

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.body.addEventListener("contextmenu", e => e.preventDefault());
  }

  function startApp() {
    if (state.started) return;
    state.started = true;

    $("start-screen")?.classList.remove("active");
    $("main-screen")?.classList.add("active");

    initAudio();
    generateChallenge();
    updateHUD();
  }

  function initAudio() {
    if (state.audioCtx) {
      if (state.audioCtx.state === "suspended") state.audioCtx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return alert("Web Audio API не поддерживается");
    state.audioCtx = new AC();

    state.masterGain = state.audioCtx.createGain();
    state.masterGain.gain.value = params.volume;
    state.masterGain.connect(state.audioCtx.destination);

    // Delay
    const del = state.audioCtx.createDelay(2);
    del.delayTime.value = 0.2;
    const delFb = state.audioCtx.createGain();
    delFb.gain.value = 0.3;
    state.delayWet = state.audioCtx.createGain();
    state.delayWet.gain.value = params.delay;
    del.connect(delFb);
    delFb.connect(del);
    del.connect(state.delayWet);
    state.delayWet.connect(state.masterGain);

    // Reverb (simple delay-based)
    const rev = state.audioCtx.createDelay(2);
    rev.delayTime.value = 0.05;
    const revFb = state.audioCtx.createGain();
    revFb.gain.value = 0.4;
    state.reverbWet = state.audioCtx.createGain();
    state.reverbWet.gain.value = params.reverb;
    rev.connect(revFb);
    revFb.connect(rev);
    rev.connect(state.reverbWet);
    state.reverbWet.connect(state.masterGain);

    state.audioCtx.delayNode = del;
    state.audioCtx.reverbNode = rev;
  }

  function buildKeyData() {
    state.keys = [];
    state.keyMap.clear();
    let midi = 48; // C3
    for (let oct = 3; oct <= 5; oct++) {
      for (let n = 0; n < 12; n++) {
        const id = NOTE_NAMES[n] + oct;
        const freq = A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
        const isBlack = NOTE_NAMES[n].includes("#");
        const compIdx = oct === 4 ? n : -1;
        const compKey = compIdx !== -1 ? COMP_KEYS[compIdx] : null;
        const compLabel = compIdx !== -1 ? COMP_LABELS[compIdx] : null;
        state.keys.push({ id, midi, freq, isBlack, oct, compKey, compLabel, whiteIndex: state.keys.filter(k => !k.isBlack && k.midi < midi).length });
        if (compKey) state.keyMap.set(compKey, id);
        midi++;
      }
    }
  }

  function createKeyboard() {
    const kb = $("keyboard");
    if (!kb) return;
    kb.innerHTML = "";
    const sc = state.scale / 100;
    const wW = Math.round(52 * sc);
    const bW = Math.round(34 * sc);

    state.keys.forEach(k => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `key ${k.isBlack ? "black" : "white"}`;
      el.dataset.note = k.id;
      el.style.width = k.isBlack ? `${bW}px` : `${wW}px`;
      el.innerHTML = `<span><span class="note-name">${k.id.replace(/\d/, "")}</span>${k.compLabel ? `<span class="key-hint">${k.compLabel}</span>` : ""}</span>`;

      if (k.isBlack) {
        const left = (k.whiteIndex * wW) - (bW / 2);
        el.style.left = `${left}px`;
        kb.style.minWidth = `${state.keys[state.keys.length-1].whiteIndex * wW + wW}px`;
      }

      el.addEventListener("pointerdown", e => { e.preventDefault(); playNote(k.id); flashKey(k.id, "active"); });
      el.addEventListener("pointerup", e => { e.preventDefault(); stopNote(k.id); unflashKey(k.id); });
      el.addEventListener("pointerleave", e => { if (e.buttons) { stopNote(k.id); unflashKey(k.id); } });
      kb.appendChild(el);
    });
  }

  function playNote(id, opts = {}) {
    if (!state.started && !opts.preview) return;
    initAudio();
    const k = state.keys.find(x => x.id === id);
    if (!k) return;

    if (state.activeVoices.has(id)) stopNote(id, 0.05);

    const now = state.audioCtx.currentTime;
    const atk = Math.max(0.001, params.attack);
    const sus = clamp(params.sustain, 0, 1);
    const pk = clamp(params.volume, 0.001, 1);

    const out = state.audioCtx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(pk, now + atk);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0001, pk * sus), now + atk + 0.05);

    const filt = state.audioCtx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = clamp(params.cutoff, 40, 20000);
    filt.Q.value = clamp(params.q, 0.1, 20);

    out.connect(filt);
    filt.connect(state.masterGain);
    filt.connect(state.audioCtx.delayNode);
    filt.connect(state.audioCtx.reverbNode);

    const oscs = [];
    const addOsc = (type, freq, gain, det = 0) => {
      const o = state.audioCtx.createOscillator();
      const g = state.audioCtx.createGain();
      o.type = type; o.frequency.value = freq; o.detune.value = det; g.gain.value = gain;
      o.connect(g); g.connect(out); o.start(now); oscs.push(o);
    };

    if (state.instrument === "piano") {
      addOsc("triangle", k.freq, 0.7);
      addOsc("sine", k.freq * 2.01, 0.15);
      addOsc("sine", k.freq * 3.01, 0.05);
    } else if (state.instrument === "pad") {
      addOsc("sine", k.freq, 0.5, params.vibrato);
      addOsc("sine", k.freq, 0.5, -params.vibrato);
    } else {
      addOsc(params.waveform, k.freq, 0.6, params.vibrato);
      addOsc(params.waveform, k.freq, 0.4, -params.vibrato);
    }

    state.activeVoices.set(id, { out, filt, oscs });
    if (!opts.skipGame) handleGameInput(id);

    if (opts.duration) {
      setTimeout(() => stopNote(id, Math.max(0.05, params.release * 0.5)), opts.duration * 1000);
    }
  }

  function stopNote(id, forced = null) {
    if (!state.audioCtx) return;
    const v = state.activeVoices.get(id);
    if (!v) return;

    const now = state.audioCtx.currentTime;
    const rel = forced ?? Math.max(0.03, params.release);
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0.0001, now, rel / 3);
      v.oscs.forEach(o => o.stop(now + rel + 0.1));
    } catch(e) {}
    setTimeout(() => { state.activeVoices.delete(id); }, (rel + 0.15) * 1000);
  }

  function flashKey(id, cls) {
    const el = document.querySelector(`.key[data-note="${cssEscape(id)}"]`);
    if (el) el.classList.add(cls);
  }
  function unflashKey(id) {
    const el = document.querySelector(`.key[data-note="${cssEscape(id)}"]`);
    if (el) el.classList.remove("active");
  }

  function handleKeyDown(e) {
    const k = e.key.toLowerCase();
    if (state.compKeysDown.has(k) || !state.keyMap.has(k)) return;
    e.preventDefault();
    state.compKeysDown.add(k);
    playNote(state.keyMap.get(k));
    flashKey(state.keyMap.get(k), "active");
  }
  function handleKeyUp(e) {
    const k = e.key.toLowerCase();
    if (!state.keyMap.has(k)) return;
    e.preventDefault();
    state.compKeysDown.delete(k);
    stopNote(state.keyMap.get(k));
    unflashKey(state.keyMap.get(k));
  }

  function bindControls() {
    const bind = (id, param, fallback) => {
      const el = $(id);
      if (!el) return;
      params[param] = Number(el.value || fallback);
      el.addEventListener("input", () => {
        params[param] = Number(el.value);
        if (state.masterGain) state.masterGain.gain.setTargetAtTime(params.volume, state.audioCtx.currentTime, 0.01);
        if (state.delayWet) state.delayWet.gain.setTargetAtTime(params.delay, state.audioCtx.currentTime, 0.01);
        if (state.reverbWet) state.reverbWet.gain.setTargetAtTime(params.reverb, state.audioCtx.currentTime, 0.01);
      });
    };
    bind("volume", "volume", 0.5);
    bind("attack", "attack", 0.05);
    bind("release", "release", 0.3);
    bind("sustain", "sustain", 0.7);
    bind("filter-cutoff", "cutoff", 8000);
    bind("resonance", "q", 1);
    bind("delay-amount", "delay", 0.2);
    bind("reverb-amount", "reverb", 0.3);

    const presetEl = $("preset");
    presetEl?.addEventListener("change", () => { applyPreset(presetEl.value); generateChallenge(); });
    $("game-mode-select")?.addEventListener("change", e => { state.mode = e.target.value; generateChallenge(); updateHUD(); });
    $("waveform")?.addEventListener("change", e => { params.waveform = e.target.value; });
    $("keyboard-scale")?.addEventListener("input", e => { state.scale = Number(e.target.value); createKeyboard(); });

    $("new-melody-btn")?.addEventListener("click", generateChallenge);
    $("play-melody-btn")?.addEventListener("click", playPreview);
    $("reset-score-btn")?.addEventListener("click", () => { state.score = 0; state.streak = 0; updateHUD(); });
    $("reset-level-btn")?.addEventListener("click", () => { state.level = 1; state.streak = 0; generateChallenge(); updateHUD(); });
  }

  function applyPreset(name) {
    const p = PRESETS[name] || PRESETS.neon;
    state.instrument = name;
    Object.keys(params).forEach(k => { if (p[k] !== undefined) params[k] = p[k]; });
    // Update UI values
    ["volume","attack","release","sustain","filter-cutoff","resonance","delay-amount","reverb-amount","waveform"].forEach(id => {
      const el = $(id); if (el) el.value = params[id.replace(/-amount/,"")];
    });
  }

  function generateChallenge() {
    state.targetIdx = 0;
    state.chordPressed.clear();
    clearTimeout(state.chordTimer);
    if (state.mode === "free") { setTarget("Free Play"); renderSteps(0,0); return; }
    if (state.mode === "chord") {
      const chords = [["C4","E4","G4"],["D4","F4","A4"],["E4","G4","B4"],["F4","A4","C5"],["G4","B4","D5"]];
      state.chordTarget = chords[Math.floor(Math.random()*chords.length)];
      setTarget(`Chord: ${state.chordTarget.join(" + ")}`);
      renderSteps(state.chordTarget.length, 0);
    } else {
      const pool = ["C4","D4","E4","F4","G4","A4","B4","C5","D5","E5"];
      const len = clamp(state.level, 1, 6);
      let idx = 3;
      state.targetSeq = [];
      for(let i=0; i<len; i++) { idx = clamp(idx + (Math.floor(Math.random()*3)-1), 0, pool.length-1); state.targetSeq.push(pool[idx]); }
      setTarget(`Play: ${state.targetSeq.join(" → ")}`);
      renderSteps(len, 0);
    }
  }

  function handleGameInput(id) {
    if (state.mode === "free") return;
    if (state.mode === "melody") {
      if (!state.targetSeq[state.targetIdx]) return;
      if (id === state.targetSeq[state.targetIdx]) {
        flashKey(id, "correct");
        state.targetIdx++;
        renderSteps(state.targetSeq.length, state.targetIdx);
        if (state.targetIdx >= state.targetSeq.length) {
          state.score++; state.streak++;
          if (state.streak > 0 && state.streak % 3 === 0) state.level++;
          showTemp("Nice!", "#0f0");
          setTimeout(generateChallenge, 600);
        }
      } else {
        flashKey(id, "wrong"); state.streak = 0; state.targetIdx = 0;
        showTemp("Wrong!", "#f00"); renderSteps(state.targetSeq.length, 0);
      }
    }
    if (state.mode === "chord") {
      if (state.chordTarget.includes(id)) state.chordPressed.add(id);
      else { state.chordPressed.clear(); state.streak = 0; flashKey(id, "wrong"); showTemp("Wrong!", "#f00"); updateHUD(); return; }
      renderSteps(state.chordTarget.length, state.chordPressed.size);
      clearTimeout(state.chordTimer);
      state.chordTimer = setTimeout(() => {
        if (state.chordTarget.every(n => state.chordPressed.has(n))) {
          state.score++; state.streak++;
          if (state.streak > 0 && state.streak % 3 === 0) state.level++;
          showTemp("Great!", "#0f0");
          setTimeout(generateChallenge, 600);
        } else { state.chordPressed.clear(); renderSteps(state.chordTarget.length, 0); }
        updateHUD();
      }, 500);
    }
    updateHUD();
  }

  function playPreview() {
    const notes = state.mode === "chord" ? state.chordTarget.map(n => ({n, d:0.6})) : state.targetSeq.map(n => ({n, d:0.35}));
    if (!notes.length) generateChallenge();
    let t = 0;
    notes.forEach((n, i) => {
      setTimeout(() => playNote(n.n, { preview: true, skipGame: true, duration: n.d, voiceId: `pv_${i}` }), t * 1000);
      t += state.mode === "chord" ? 0 : n.d + 0.1;
    });
  }

  function renderSteps(total, curr) {
    const el = $("target-steps");
    if (!el) return;
    el.innerHTML = "";
    for(let i=0; i<total; i++) {
      const d = document.createElement("span"); d.className = "step-dot";
      if (i < curr) d.classList.add("correct");
      if (i === curr) d.classList.add("active");
      el.appendChild(d);
    }
  }

  function setTarget(txt) { const el = $("target-display"); if(el) el.textContent = txt; }
  function showTemp(txt, color) { const el = $("target-display"); if(el) { el.textContent = txt; el.style.color = color; setTimeout(() => el.style.color = "", 800); } }
  function updateHUD() {
    const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
    set("score", state.score); set("level", state.level); set("streak", state.streak);
    set("mode-badge", {free:"Free Play", melody:"Melody", chord:"Chord"}[state.mode] || state.mode);
  }
})();
