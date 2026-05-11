/* ============================================================
   NEON SYNTH SIMULATOR — FIXED script.js
   Работает локально, на GitHub Pages и внутри Telegram WebView.
   Без библиотек, звук только через Web Audio API.
   ============================================================ */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4_MIDI = 69;
  const A4_FREQ = 440;
  const COMPUTER_KEYS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j"];
  const COMPUTER_LABELS = ["A", "W", "S", "E", "D", "F", "T", "G", "Y", "H", "U", "J"];

  const PRESETS = {
    neon: { name: "Neon Synth", waveform: "sawtooth", attack: 0.02, release: 0.45, sustain: 0.75, cutoff: 6500, q: 3, delay: 0.28, vibrato: 2, detune: 8, reverb: 0.2, volume: 0.45 },
    piano: { name: "Classic Piano", waveform: "triangle", attack: 0.004, release: 0.35, sustain: 0.25, cutoff: 4200, q: 0.8, delay: 0.03, vibrato: 0, detune: 0, reverb: 0.25, volume: 0.55 },
    pad: { name: "Soft Pad", waveform: "sine", attack: 0.7, release: 1.7, sustain: 0.85, cutoff: 2600, q: 1.5, delay: 0.38, vibrato: 1.2, detune: 5, reverb: 0.55, volume: 0.42 },
    bass: { name: "Bass", waveform: "square", attack: 0.01, release: 0.22, sustain: 0.55, cutoff: 850, q: 4, delay: 0.02, vibrato: 0.3, detune: 2, reverb: 0.08, volume: 0.6 },
    lead: { name: "Lead", waveform: "sawtooth", attack: 0.01, release: 0.35, sustain: 0.8, cutoff: 9000, q: 5, delay: 0.18, vibrato: 3, detune: 12, reverb: 0.2, volume: 0.45 },
    glucophone: { name: "Glucophone", waveform: "sine", attack: 0.006, release: 2.4, sustain: 0.85, cutoff: 3000, q: 1.2, delay: 0.28, vibrato: 0.8, detune: 1, reverb: 0.65, volume: 0.5 },
  };

  const state = {
    started: false,
    audioReady: false,
    keys: [],
    keyById: new Map(),
    computerMap: new Map(),
    activeVoices: new Map(),
    pressedComputer: new Set(),
    score: 0,
    level: 1,
    streak: 0,
    mode: "free",
    instrument: "neon",
    targetSequence: [],
    targetIndex: 0,
    chordTarget: [],
    chordPressed: new Set(),
    chordTimer: null,
    keyboardScale: 100,
    lastStartAt: 0,
  };

  const params = {
    waveform: "sine",
    volume: 0.5,
    attack: 0.05,
    release: 0.3,
    sustain: 0.7,
    cutoff: 8000,
    q: 1,
    delay: 0.2,
    vibrato: 0,
    detune: 0,
    reverb: 0.3,
  };

  let audioCtx = null;
  let masterGain = null;
  let delayNode = null;
  let delayFeedback = null;
  let delayWet = null;
  let reverbDelay = null;
  let reverbFeedback = null;
  let reverbWet = null;

  document.addEventListener("DOMContentLoaded", initApp);

  function initApp() {
    console.log("Neon Synth init started");

    injectRuntimeStyles();
    ensureGlucophoneOption();
    readControls();
    buildKeyData();
    createKeyboard();
    createGlucophone();
    bindControls();
    bindGameButtons();
    bindComputerKeyboard();
    updateHUD();
    updateKeyboardThemeByLevel();

    const startBtn = $("start-btn");
    if (startBtn) {
      console.log("Start button found");
      bindTap(startBtn, startApp);
    } else {
      console.warn("Start button not found");
    }

    document.body.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  function startApp(event) {
    if (event) event.preventDefault();

    const now = Date.now();
    if (now - state.lastStartAt < 300) return;
    state.lastStartAt = now;

    console.log("Start pressed");

    const startScreen = $("start-screen");
    const mainScreen = $("main-screen");

    if (startScreen) startScreen.classList.remove("active");
    if (mainScreen) mainScreen.classList.add("active");

    state.started = true;
    initAudio();
    applyPreset(state.instrument);
    generateNewChallenge();
    updateHUD();

    console.log("Main screen opened");
  }

  function bindTap(el, handler) {
    if (!el) return;

    let lastTouch = 0;

    el.addEventListener("touchend", (e) => {
      lastTouch = Date.now();
      handler(e);
    }, { passive: false });

    el.addEventListener("click", (e) => {
      if (Date.now() - lastTouch < 500) return;
      handler(e);
    });

    el.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      handler(e);
    }, { passive: false });
  }

  function noteToMidi(noteName, octave) {
    return (octave + 1) * 12 + NOTE_NAMES.indexOf(noteName);
  }

  function midiToFrequency(midi) {
    return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
  }

  function parseNoteId(noteId) {
    const m = String(noteId).match(/^([A-G]#?)(-?\d+)$/);
    return m ? { note: m[1], octave: Number(m[2]) } : null;
  }

  function noteIdToFrequency(noteId) {
    const p = parseNoteId(noteId);
    return p ? midiToFrequency(noteToMidi(p.note, p.octave)) : A4_FREQ;
  }

  function buildKeyData() {
    state.keys = [];
    state.keyById.clear();
    state.computerMap.clear();

    for (let octave = 3; octave <= 5; octave++) {
      for (const note of NOTE_NAMES) {
        const id = `${note}${octave}`;
        const midi = noteToMidi(note, octave);
        const data = {
          id,
          note,
          octave,
          midi,
          freq: midiToFrequency(midi),
          isBlack: note.includes("#"),
          computerKey: null,
        };

        state.keys.push(data);
        state.keyById.set(id, data);
      }
    }

    const middle = state.keys.filter((k) => k.octave === 4);

    middle.forEach((key, index) => {
      key.computerKey = COMPUTER_KEYS[index] || null;
      key.computerLabel = COMPUTER_LABELS[index] || "";

      if (key.computerKey) {
        state.computerMap.set(key.computerKey, key);
      }
    });
  }

  function createKeyboard() {
    const keyboard = $("keyboard");
    if (!keyboard) return;

    keyboard.innerHTML = "";

    const scale = state.keyboardScale / 100;
    const whiteWidth = Math.round(56 * scale);
    const blackWidth = Math.round(36 * scale);

    const blackOffsets = {
      "C#": 0.72,
      "D#": 1.72,
      "F#": 3.72,
      "G#": 4.72,
      "A#": 5.72,
    };

    keyboard.style.height = `${Math.round(220 * scale)}px`;
    keyboard.style.minWidth = `${21 * whiteWidth}px`;

    state.keys.forEach((key) => {
      const el = document.createElement("button");

      el.type = "button";
      el.className = `key ${key.isBlack ? "black" : "white"}`;
      el.dataset.note = key.id;
      el.innerHTML = `
        <span>
          <span class="note-name">${key.note}</span>
          <span class="octave-num">${key.octave}</span>
          ${key.computerLabel ? `<span class="key-hint">${key.computerLabel}</span>` : ""}
        </span>
      `;

      if (key.isBlack) {
        const octaveStartWhite = (key.octave - 3) * 7;
        const left = (octaveStartWhite + blackOffsets[key.note]) * whiteWidth - blackWidth / 2;

        el.style.left = `${left}px`;
        el.style.width = `${blackWidth}px`;
      } else {
        el.style.width = `${whiteWidth}px`;
      }

      bindKeyPointer(el, key);
      keyboard.appendChild(el);
    });
  }

  function bindKeyPointer(el, key) {
    const down = (e) => {
      e.preventDefault();
      playNote(key.id);
      setKeyActive(key.id, true);
    };

    const up = (e) => {
      e.preventDefault();
      stopNote(key.id);
      setKeyActive(key.id, false);
    };

    el.addEventListener("pointerdown", down, { passive: false });
    el.addEventListener("pointerup", up, { passive: false });
    el.addEventListener("pointercancel", up, { passive: false });

    el.addEventListener("pointerleave", (e) => {
      if (e.buttons) up(e);
    }, { passive: false });
  }

  function initAudio() {
    if (state.audioReady && audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      alert("Web Audio API is not supported in this browser.");
      return;
    }

    audioCtx = new AudioContextClass();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = params.volume;
    masterGain.connect(audioCtx.destination);

    delayNode = audioCtx.createDelay(1.5);
    delayNode.delayTime.value = 0.23;

    delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.28;

    delayWet = audioCtx.createGain();
    delayWet.gain.value = params.delay;

    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(delayWet);
    delayWet.connect(masterGain);

    reverbDelay = audioCtx.createDelay(1.2);
    reverbDelay.delayTime.value = 0.085;

    reverbFeedback = audioCtx.createGain();
    reverbFeedback.gain.value = 0.45;

    reverbWet = audioCtx.createGain();
    reverbWet.gain.value = params.reverb;

    reverbDelay.connect(reverbFeedback);
    reverbFeedback.connect(reverbDelay);
    reverbDelay.connect(reverbWet);
    reverbWet.connect(masterGain);

    state.audioReady = true;

    if (audioCtx.state === "suspended") audioCtx.resume();

    console.log("AudioContext ready");
  }

  function updateEffects() {
    if (!audioCtx || !state.audioReady) return;

    if (masterGain) masterGain.gain.setTargetAtTime(params.volume, audioCtx.currentTime, 0.02);
    if (delayWet) delayWet.gain.setTargetAtTime(params.delay, audioCtx.currentTime, 0.02);
    if (reverbWet) reverbWet.gain.setTargetAtTime(params.reverb, audioCtx.currentTime, 0.02);
  }

  function playNote(noteId, options = {}) {
    if (!state.started && !options.preview) return;

    initAudio();

    if (!audioCtx) return;

    const key = state.keyById.get(noteId) || {
      id: noteId,
      freq: noteIdToFrequency(noteId),
      isBlack: noteId.includes("#"),
    };

    const voiceId = options.voiceId || noteId;

    if (state.activeVoices.has(voiceId)) {
      stopNote(voiceId, 0.02);
    }

    const now = audioCtx.currentTime;
    const instrument = options.instrument || state.instrument;
    const frequency = key.freq || noteIdToFrequency(noteId);
    const attack = Math.max(0.001, params.attack);
    const release = Math.max(0.03, params.release);
    const sustain = clamp(params.sustain, 0, 1);
    const peak = clamp(params.volume, 0.001, 1);

    const output = audioCtx.createGain();

    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(peak, now + attack);
    output.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * sustain), now + attack + 0.08);

    const filter = audioCtx.createBiquadFilter();

    filter.type = "lowpass";
    filter.frequency.value = clamp(params.cutoff, 40, 20000);
    filter.Q.value = clamp(params.q, 0.001, 30);

    output.connect(filter);
    filter.connect(masterGain);
    filter.connect(delayNode);
    filter.connect(reverbDelay);

    const oscList = [];

    const makeOsc = (type, freq, gain, detune = 0) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();

      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.value = gain;

      osc.connect(g);
      g.connect(output);
      osc.start(now);

      oscList.push({ osc, gain: g });

      return osc;
    };

    if (instrument === "piano") {
      makeOsc("triangle", frequency, 0.72);
      makeOsc("sine", frequency * 2.01, 0.18);
      makeOsc("sine", frequency * 3.01, 0.08);
      output.gain.exponentialRampToValueAtTime(0.001, now + Math.max(0.25, release));
    } else if (instrument === "glucophone") {
      makeOsc("sine", frequency, 0.8);
      makeOsc("sine", frequency * 2.02, 0.22);
      makeOsc("triangle", frequency * 3.01, 0.09);
      output.gain.exponentialRampToValueAtTime(0.001, now + 2.6);
    } else if (instrument === "bass") {
      makeOsc("square", frequency / 2, 0.85, params.detune);
      makeOsc("sine", frequency, 0.25);
    } else {
      makeOsc(params.waveform, frequency, 0.65, params.detune);
      makeOsc(params.waveform, frequency, 0.35, -params.detune);
    }

    let lfo = null;
    let lfoGain = null;

    if (params.vibrato > 0) {
      lfo = audioCtx.createOscillator();
      lfoGain = audioCtx.createGain();

      lfo.frequency.value = 5.5;
      lfoGain.gain.value = params.vibrato;

      lfo.connect(lfoGain);

      oscList.forEach(({ osc }) => {
        lfoGain.connect(osc.frequency);
      });

      lfo.start(now);
    }

    state.activeVoices.set(voiceId, {
      output,
      filter,
      oscList,
      lfo,
      lfoGain,
    });

    setKeyActive(noteId, true);
    flashGlucophone(noteId, "active");

    if (!options.skipGame) {
      handleGameInput(noteId);
    }

    if (options.duration) {
      setTimeout(() => {
        stopNote(voiceId, release);
      }, options.duration * 1000);
    }
  }

  function stopNote(voiceId, forcedRelease) {
    if (!audioCtx) return;

    const voice = state.activeVoices.get(voiceId);

    if (!voice) return;

    const now = audioCtx.currentTime;
    const release = forcedRelease ?? Math.max(0.03, params.release);

    try {
      voice.output.gain.cancelScheduledValues(now);
      voice.output.gain.setTargetAtTime(0.0001, now, release / 4);

      voice.oscList.forEach(({ osc }) => {
        osc.stop(now + release + 0.08);
      });

      if (voice.lfo) {
        voice.lfo.stop(now + release + 0.08);
      }
    } catch (_) {}

    setTimeout(() => {
      try {
        voice.output.disconnect();
      } catch (_) {}

      state.activeVoices.delete(voiceId);
      setKeyActive(voiceId, false);
      flashGlucophone(voiceId, "inactive");
    }, (release + 0.12) * 1000);
  }

  function stopAllNotes() {
    [...state.activeVoices.keys()].forEach((id) => {
      stopNote(id, 0.05);
    });

    state.pressedComputer.clear();

    document.querySelectorAll(".key.active,.gluco-tongue.active").forEach((el) => {
      el.classList.remove("active");
    });
  }

  function setKeyActive(noteId, active) {
    const el = document.querySelector(`.key[data-note="${CSS.escape(noteId)}"]`);

    if (el) {
      el.classList.toggle("active", active);
    }
  }

  function flashKey(noteId, className) {
    const el =
      document.querySelector(`.key[data-note="${CSS.escape(noteId)}"]`) ||
      document.querySelector(`.gluco-tongue[data-note="${CSS.escape(noteId)}"]`);

    if (!el) return;

    el.classList.add(className);

    setTimeout(() => {
      el.classList.remove(className);
    }, 350);
  }

  function bindControls() {
    const preset = $("preset");
    const mode = $("game-mode-select");

    if (preset) {
      preset.addEventListener("change", () => {
        applyPreset(preset.value);
      });
    }

    if (mode) {
      mode.addEventListener("change", () => {
        state.mode = mode.value;
        clearChallengeInput();
        generateNewChallenge();
        updateHUD();
      });
    }

    bindRange("volume", "volume", 0.5);
    bindRange("attack", "attack", 0.05);
    bindRange("release", "release", 0.3);
    bindRange("sustain", "sustain", 0.7);
    bindRange("filter-cutoff", "cutoff", 8000);
    bindRange("resonance", "q", 1);
    bindRange("delay-amount", "delay", 0.2);
    bindRange("vibrato", "vibrato", 0);
    bindRange("detune", "detune", 0);
    bindRange("reverb-amount", "reverb", 0.3);

    const waveform = $("waveform");

    if (waveform) {
      waveform.addEventListener("change", () => {
        params.waveform = waveform.value;
      });
    }

    const scale = $("keyboard-scale");

    if (scale) {
      scale.addEventListener("input", () => {
        state.keyboardScale = Number(scale.value || 100);
        createKeyboard();
        updateKeyboardThemeByLevel();
      });
    }
  }

  function bindRange(id, key, fallback) {
    const el = $(id);

    params[key] = el ? Number(el.value || fallback) : fallback;

    if (el) {
      el.addEventListener("input", () => {
        params[key] = Number(el.value || fallback);
        updateEffects();
      });
    }
  }

  function readControls() {
    const scale = $("keyboard-scale");

    if (scale) {
      state.keyboardScale = Number(scale.value || 100);
    }

    const mode = $("game-mode-select");

    if (mode) {
      state.mode = mode.value;
    }

    const preset = $("preset");

    if (preset) {
      state.instrument = preset.value;
    }
  }

  function applyPreset(name) {
    const preset = PRESETS[name] || PRESETS.neon;

    state.instrument = name in PRESETS ? name : "neon";

    params.waveform = preset.waveform;
    params.volume = preset.volume;
    params.attack = preset.attack;
    params.release = preset.release;
    params.sustain = preset.sustain;
    params.cutoff = preset.cutoff;
    params.q = preset.q;
    params.delay = preset.delay;
    params.vibrato = preset.vibrato;
    params.detune = preset.detune;
    params.reverb = preset.reverb;

    setControlValue("waveform", params.waveform);
    setControlValue("volume", params.volume);
    setControlValue("attack", params.attack);
    setControlValue("release", params.release);
    setControlValue("sustain", params.sustain);
    setControlValue("filter-cutoff", params.cutoff);
    setControlValue("resonance", params.q);
    setControlValue("delay-amount", params.delay);
    setControlValue("vibrato", params.vibrato);
    setControlValue("detune", params.detune);
    setControlValue("reverb-amount", params.reverb);

    stopAllNotes();
    updateEffects();
    updateInstrumentView();
    clearChallengeInput();
    generateNewChallenge();
    updateHUD();
  }

  function setControlValue(id, value) {
    const el = $(id);

    if (el) {
      el.value = value;
    }
  }

  function bindGameButtons() {
    bindTap($("new-melody-btn"), () => {
      generateNewChallenge();
    });

    bindTap($("play-melody-btn"), () => {
      playCurrentChallenge();
    });

    bindTap($("reset-score-btn"), () => {
      state.score = 0;
      state.streak = 0;
      updateHUD();
    });

    bindTap($("reset-level-btn"), () => {
      state.level = 1;
      state.streak = 0;
      clearChallengeInput();
      generateNewChallenge();
      updateKeyboardThemeByLevel();
      updateHUD();
    });
  }

  function bindComputerKeyboard() {
    window.addEventListener("keydown", (e) => {
      const keyName = e.key.toLowerCase();
      const data = state.computerMap.get(keyName);

      if (!data || state.pressedComputer.has(keyName)) return;

      e.preventDefault();

      state.pressedComputer.add(keyName);

      playNote(data.id, {
        voiceId: `keyboard_${keyName}`,
      });

      setKeyActive(data.id, true);
    });

    window.addEventListener("keyup", (e) => {
      const keyName = e.key.toLowerCase();
      const data = state.computerMap.get(keyName);

      if (!data) return;

      e.preventDefault();

      state.pressedComputer.delete(keyName);

      stopNote(`keyboard_${keyName}`);
      setKeyActive(data.id, false);
    });
  }

  function generateNewChallenge() {
    if (state.mode === "free") {
      setTargetText("Free Play");
      renderSteps(0, 0);
      updateHUD();
      return;
    }

    if (state.mode === "chord") {
      generateChordChallenge();
    } else {
      generateMelodyChallenge();
    }

    updateHUD();
  }

  function generateMelodyChallenge() {
    const pool =
      state.instrument === "glucophone"
        ? ["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5"]
        : ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "G5"];

    const length = clamp(state.level, 1, 8);

    let index = Math.floor(pool.length / 3);

    state.targetSequence = [];

    for (let i = 0; i < length; i++) {
      const move = [-1, 0, 1, 2][Math.floor(Math.random() * 4)];

      index = clamp(index + move, 0, pool.length - 1);

      state.targetSequence.push({
        note: pool[index],
        duration: i === length - 1 ? 0.65 : 0.38,
      });
    }

    state.targetIndex = 0;

    setTargetText(`Play: ${state.targetSequence.map((n) => n.note).join(" → ")}`);
    renderSteps(state.targetSequence.length, state.targetIndex);
  }

  function generateChordChallenge() {
    const chords =
      state.instrument === "glucophone"
        ? [["C4", "E4"], ["D4", "G4"], ["E4", "A4"], ["C5", "G5"]]
        : [["C4", "E4", "G4"], ["D4", "F4", "A4"], ["E4", "G4", "B4"], ["F4", "A4", "C5"], ["G4", "B4", "D5"], ["A3", "C4", "E4"]];

    const chord = chords[Math.floor(Math.random() * chords.length)];
    const size = state.level < 3 ? 2 : Math.min(3, chord.length);

    state.chordTarget = chord.slice(0, size);
    state.chordPressed.clear();

    setTargetText(`Play chord: ${state.chordTarget.join(" + ")}`);
    renderSteps(state.chordTarget.length, 0);
  }

  function handleGameInput(noteId) {
    if (state.mode === "free") return;

    if (state.mode === "melody") {
      handleMelodyInput(noteId);
    }

    if (state.mode === "chord") {
      handleChordInput(noteId);
    }
  }

  function handleMelodyInput(noteId) {
    const target = state.targetSequence[state.targetIndex];

    if (!target) return;

    if (noteId === target.note) {
      flashKey(noteId, "correct");
      state.targetIndex += 1;
      renderSteps(state.targetSequence.length, state.targetIndex);

      if (state.targetIndex >= state.targetSequence.length) {
        state.score += 1;
        state.streak += 1;

        if (state.streak > 0 && state.streak % 3 === 0) {
          state.level += 1;
        }

        showTemporaryTarget("Great!", "#00ff99");
        updateKeyboardThemeByLevel();

        setTimeout(() => {
          clearChallengeInput();
          generateNewChallenge();
        }, 550);
      }
    } else {
      flashKey(noteId, "wrong");

      state.streak = 0;
      state.targetIndex = 0;

      showTemporaryTarget("Wrong note", "#ff4d6d");
      renderSteps(state.targetSequence.length, 0);

      setTimeout(() => {
        setTargetText(`Play: ${state.targetSequence.map((n) => n.note).join(" → ")}`);
      }, 650);
    }

    updateHUD();
  }

  function handleChordInput(noteId) {
    if (!state.chordTarget.length) return;

    if (state.chordTarget.includes(noteId)) {
      state.chordPressed.add(noteId);
      flashKey(noteId, "correct");
    } else {
      state.chordPressed.clear();
      state.streak = 0;

      flashKey(noteId, "wrong");
      showTemporaryTarget("Wrong note", "#ff4d6d");
      updateHUD();

      return;
    }

    renderSteps(state.chordTarget.length, state.chordPressed.size);

    clearTimeout(state.chordTimer);

    state.chordTimer = setTimeout(() => {
      if (state.chordTarget.every((n) => state.chordPressed.has(n))) {
        state.score += 1;
        state.streak += 1;

        if (state.streak > 0 && state.streak % 3 === 0) {
          state.level += 1;
        }

        showTemporaryTarget("Nice chord!", "#00ff99");
        updateKeyboardThemeByLevel();

        setTimeout(() => {
          clearChallengeInput();
          generateNewChallenge();
        }, 550);
      } else {
        state.chordPressed.clear();
        renderSteps(state.chordTarget.length, 0);
      }

      updateHUD();
    }, 700);
  }

  function clearChallengeInput() {
    state.targetIndex = 0;
    state.chordPressed.clear();

    clearTimeout(state.chordTimer);

    state.chordTimer = null;
  }

  function playCurrentChallenge() {
    const melody =
      state.mode === "chord"
        ? state.chordTarget.map((note) => ({ note, duration: 0.7 }))
        : state.targetSequence;

    if (!melody.length) {
      generateNewChallenge();
      return;
    }

    let time = 0;

    melody.forEach((item, index) => {
      setTimeout(() => {
        playNote(item.note, {
          duration: item.duration,
          voiceId: `${item.note}_preview_${index}_${Date.now()}`,
          skipGame: true,
          preview: true,
        });
      }, time * 1000);

      time += state.mode === "chord" ? 0 : item.duration + 0.12;
    });
  }

  function renderSteps(total, current) {
    const steps = $("target-steps");

    if (!steps) return;

    steps.innerHTML = "";

    for (let i = 0; i < total; i++) {
      const dot = document.createElement("span");

      dot.className = "step-dot";

      if (i < current) {
        dot.classList.add("correct");
      }

      if (i === current) {
        dot.classList.add("active");
      }

      steps.appendChild(dot);
    }
  }

  function setTargetText(text) {
    const target = $("target-display");

    if (target) {
      target.textContent = text;
      target.style.color = "";
    }
  }

  function showTemporaryTarget(text, color) {
    const target = $("target-display");

    if (!target) return;

    target.textContent = text;
    target.style.color = color;
  }

  function updateHUD() {
    setText("score", state.score);
    setText("level", state.level);
    setText("streak", state.streak);

    const modeNames = {
      free: "Free Play",
      melody: "Melody",
      chord: "Chord",
    };

    setText("game-mode", modeNames[state.mode] || state.mode);
    setText("mode-badge", modeNames[state.mode] || "Free Play");
    setText("preset-name", (PRESETS[state.instrument] || PRESETS.neon).name);
  }

  function setText(id, value) {
    const el = $(id);

    if (el) {
      el.textContent = value;
    }
  }

  function updateKeyboardThemeByLevel() {
    const keyboard = $("keyboard");

    if (!keyboard) return;

    keyboard.classList.remove("level-classic", "level-soft-neon", "level-neon", "level-cyber");

    if (state.level <= 2) {
      keyboard.classList.add("level-classic");
    } else if (state.level <= 4) {
      keyboard.classList.add("level-soft-neon");
    } else if (state.level <= 6) {
      keyboard.classList.add("level-neon");
    } else {
      keyboard.classList.add("level-cyber");
    }
  }

  const GLUCO_NOTES = [
    { note: "C4", angle: 0 },
    { note: "D4", angle: 40 },
    { note: "E4", angle: 80 },
    { note: "G4", angle: 120 },
    { note: "A4", angle: 160 },
    { note: "C5", angle: 200 },
    { note: "D5", angle: 240 },
    { note: "E5", angle: 280 },
    { note: "G5", angle: 320 },
  ];

  function ensureGlucophoneOption() {
    const preset = $("preset");

    if (!preset || preset.querySelector('option[value="glucophone"]')) return;

    const option = document.createElement("option");

    option.value = "glucophone";
    option.textContent = "Глюкофон";

    preset.appendChild(option);
  }

  function createGlucophone() {
    const wrapper = document.querySelector(".keyboard-wrapper");

    if (!wrapper || $("glucophone")) return;

    const gluco = document.createElement("div");

    gluco.id = "glucophone";
    gluco.className = "glucophone hidden";

    GLUCO_NOTES.forEach((item) => {
      const tongue = document.createElement("button");

      tongue.type = "button";
      tongue.className = "gluco-tongue";
      tongue.dataset.note = item.note;
      tongue.textContent = item.note;
      tongue.style.transform = `rotate(${item.angle}deg) translateY(-125px) rotate(-${item.angle}deg)`;

      bindTap(tongue, (e) => {
        e.preventDefault();
        playNote(item.note, { duration: 1.2 });
      });

      gluco.appendChild(tongue);
    });

    wrapper.insertAdjacentElement("afterend", gluco);
  }

  function updateInstrumentView() {
    const wrapper = document.querySelector(".keyboard-wrapper");
    const gluco = $("glucophone");
    const isGluco = state.instrument === "glucophone";

    if (wrapper) {
      wrapper.style.display = isGluco ? "none" : "block";
    }

    if (gluco) {
      gluco.classList.toggle("hidden", !isGluco);
    }
  }

  function flashGlucophone(noteId, mode) {
    const el = document.querySelector(`.gluco-tongue[data-note="${CSS.escape(noteId)}"]`);

    if (!el) return;

    if (mode === "active") {
      el.classList.add("active");
    }

    if (mode === "inactive") {
      el.classList.remove("active");
    }
  }

  function injectRuntimeStyles() {
    if ($("runtime-neon-synth-style")) return;

    const style = document.createElement("style");

    style.id = "runtime-neon-synth-style";
    style.textContent = `
      button, select, input {
        touch-action: manipulation;
      }

      #start-btn {
        position: relative;
        z-index: 20;
        pointer-events: auto;
      }

      #rotate-hint:not(.active) {
        display: none !important;
        pointer-events: none !important;
      }

      .keyboard.level-soft-neon .key.white {
        box-shadow: inset 0 0 10px rgba(0,255,255,.12);
      }

      .keyboard.level-soft-neon .key.black {
        box-shadow: 0 4px 8px rgba(0,0,0,.55), 0 0 10px rgba(0,255,255,.18);
      }

      .keyboard.level-neon .key.white {
        box-shadow: inset 0 0 14px rgba(0,255,255,.18), 0 0 8px rgba(255,0,255,.12);
      }

      .keyboard.level-neon .key.black {
        box-shadow: 0 4px 8px rgba(0,0,0,.55), 0 0 12px rgba(255,0,255,.25);
      }

      .keyboard.level-cyber .key.white {
        box-shadow: inset 0 0 18px rgba(0,255,255,.24), 0 0 12px rgba(0,255,255,.18);
      }

      .keyboard.level-cyber .key.black {
        box-shadow: 0 4px 8px rgba(0,0,0,.55), 0 0 18px rgba(255,0,255,.35);
      }

      .glucophone {
        position: relative;
        width: min(70vw, 360px);
        height: min(70vw, 360px);
        margin: 12px auto 8px;
        border-radius: 50%;
        background:
          radial-gradient(circle at 35% 30%, rgba(255,255,255,.24), transparent 18%),
          radial-gradient(circle, rgba(0,255,255,.18), rgba(255,0,255,.11) 48%, rgba(20,20,30,.95) 70%);
        border: 1px solid rgba(0,255,255,.45);
        box-shadow: 0 0 30px rgba(0,255,255,.22), inset 0 0 35px rgba(255,255,255,.08);
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .glucophone.hidden {
        display: none;
      }

      .glucophone::after {
        content: "";
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,255,255,.35), rgba(0,255,255,.16), rgba(0,0,0,.3));
        border: 1px solid rgba(255,255,255,.2);
        box-shadow: inset 0 0 14px rgba(255,255,255,.2);
      }

      .gluco-tongue {
        position: absolute;
        left: calc(50% - 36px);
        top: calc(50% - 23px);
        width: 72px;
        height: 46px;
        border-radius: 999px 999px 18px 18px;
        border: 1px solid rgba(0,255,255,.45);
        color: #eaffff;
        background: linear-gradient(145deg, rgba(255,255,255,.22), rgba(0,255,255,.12), rgba(255,0,255,.1));
        box-shadow: 0 0 13px rgba(0,255,255,.16), inset 0 0 14px rgba(255,255,255,.1);
        cursor: pointer;
        font-weight: 700;
        letter-spacing: .5px;
        user-select: none;
      }

      .gluco-tongue.active {
        filter: brightness(1.45);
        box-shadow: 0 0 28px rgba(0,255,255,.75), inset 0 0 16px rgba(255,255,255,.25);
      }

      .gluco-tongue.correct {
        border-color: #00ff99;
        box-shadow: 0 0 24px rgba(0,255,153,.7), inset 0 0 14px rgba(0,255,153,.25);
      }

      .gluco-tongue.wrong {
        border-color: #ff4d6d;
        box-shadow: 0 0 24px rgba(255,77,109,.7), inset 0 0 14px rgba(255,77,109,.25);
      }

      @media (max-height: 520px) {
        .glucophone {
          width: min(58vw, 280px);
          height: min(58vw, 280px);
        }

        .gluco-tongue {
          width: 62px;
          height: 38px;
          left: calc(50% - 31px);
          top: calc(50% - 19px);
          font-size: .75rem;
        }
      }
    `;

    document.head.appendChild(style);
  }

  window.NeonSynthDebug = {
    state,
    playNote,
    stopAllNotes,
    generateNewChallenge,
  };
})();
