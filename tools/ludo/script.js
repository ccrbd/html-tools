/* ============================================================================
   LUDO — vanilla JS game engine
   ----------------------------------------------------------------------------
   Architecture (top → bottom):
     1. BOARD GEOMETRY   — the 15×15 grid, the 52-cell loop, per-colour paths.
     2. AI               — Easy / Medium / Hard decision engine.
     3. Game (class)     — all rules & state (turns, dice, capture, win).
     4. Renderer         — builds the DOM board, positions tokens.
     5. UI / glue        — lobby, dice, input (mouse + touch), persistence.

   Design notes:
     • A token's "pos" is a single integer along ITS OWN path:
         -1            = parked in base
         0 … 55        = on the track / home column
         56            = HOME (finished)
       Each colour's path = 51 shared-loop cells + 6 private home cells = 57.
     • Only loop cells (pos 0..50) can capture / be captured. Home column is safe.
     • Input uses pointerdown for zero-lag taps and works for mouse + touch + pen.
   ========================================================================== */

(function () {
  "use strict";

  /* =========================================================================
     1. BOARD GEOMETRY
     ========================================================================= */

  // The 52 shared-loop cells as [row, col] on a 15×15 grid (clockwise).
  const MAIN_PATH = [
    [6,1],[6,2],[6,3],[6,4],[6,5],                 // 0–4   (left arm, top file)
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],           // 5–10  (top arm, left file)
    [0,7],                                          // 11    (top turn)
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],           // 12–17 (top arm, right file)
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],      // 18–23 (right arm, top file)
    [7,14],                                         // 24    (right turn)
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],      // 25–30 (right arm, bottom file)
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],      // 31–36 (bottom arm, right file)
    [14,7],                                         // 37    (bottom turn)
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],      // 38–43 (bottom arm, left file)
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],           // 44–49 (left arm, bottom file)
    [7,0],                                          // 50    (left turn)
    [6,0]                                           // 51    (back to start of loop)
  ];

  const COLORS = ["red", "green", "yellow", "blue"];

  // Where each colour ENTERS the loop (its start square index in MAIN_PATH).
  const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };

  // The 6 private home-column cells for each colour (5 visible + the centre).
  // The token reaches these after travelling 51 loop cells.
  const HOME_CELLS = {
    red:    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
    green:  [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
    yellow: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
    blue:   [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]]
  };

  // Parking-slot coordinates inside each 6×6 base (fractional [row,col]).
  const BASE_SLOTS = {
    red:    [[1,1],[1,4],[4,1],[4,4]],
    green:  [[1,10],[1,13],[4,10],[4,13]],
    yellow: [[10,10],[10,13],[13,10],[13,13]],
    blue:   [[10,1],[10,4],[13,1],[13,4]]
  };

  // The 8 safe squares (loop indices): 4 coloured starts + 4 star squares.
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const STAR = new Set([8, 21, 34, 47]);          // the non-start safe squares

  // Build each colour's full 57-cell path: 51 loop cells + 6 home cells.
  const FULL_PATH = {};
  COLORS.forEach(function (color) {
    const cells = [];
    for (let k = 0; k <= 50; k++) {
      cells.push(MAIN_PATH[(START_INDEX[color] + k) % 52]);
    }
    HOME_CELLS[color].forEach(function (c) { cells.push(c); });
    FULL_PATH[color] = cells;                      // length 57, index 0..56
  });

  const HOME_POS = 56;                             // exact pos that means "finished"

  // Reverse map "r,c" → loop index, used to tag track cells when drawing.
  const LOOP_INDEX_AT = {};
  MAIN_PATH.forEach(function (rc, i) { LOOP_INDEX_AT[rc[0] + "," + rc[1]] = i; });

  // Display names + emoji for the colours.
  const COLOR_NAME = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" };

  /* =========================================================================
     2. AI DECISION ENGINE
     Returns the chosen move object from a list of legal moves.
     ========================================================================= */
  const AI = {
    choose: function (game, color, dice, moves, difficulty) {
      if (moves.length === 1) return moves[0];
      if (difficulty === "easy") {
        // Easy: purely random valid move.
        return moves[(Math.random() * moves.length) | 0];
      }
      // Medium & Hard: score every move and take the best (random tie-break).
      const scored = moves.map(function (m) {
        return { m: m, s: AI.score(game, color, dice, m, difficulty) };
      });
      let best = -Infinity;
      scored.forEach(function (x) { if (x.s > best) best = x.s; });
      const top = scored.filter(function (x) { return x.s >= best - 0.001; });
      return top[(Math.random() * top.length) | 0].m;
    },

    // Heuristic value of a single move.
    score: function (game, color, dice, move, difficulty) {
      const hard = difficulty === "hard";
      const t = move.token;
      const from = move.from;
      const to = move.to;
      let s = 0;

      const isSpawn      = from === -1;             // bringing a token out (needs 6)
      const reachesHome  = to === HOME_POS;
      const entersHome   = to >= 51 && from < 51;   // moved into the home column
      const progress     = isSpawn ? 1 : (to - from);

      // Target loop index (only meaningful while still on the shared loop).
      const targetLoop = to <= 50 ? (START_INDEX[color] + to) % 52 : null;
      const safeTarget = targetLoop !== null && SAFE.has(targetLoop);
      const captures   = targetLoop !== null ? game.capturesAt(targetLoop, color) : [];

      // Was this token in danger before moving? Does the move escape it?
      const wasInDanger = game.tokenInDanger(t);
      const nowInDanger = targetLoop !== null && !SAFE.has(targetLoop) &&
        game.threatsTo(targetLoop, color).length > 0;
      const escapes = wasInDanger && !nowInDanger;

      // How far along is this token (used to value saving / advancing it).
      const tokenProgress = from < 0 ? 0 : from;

      if (captures.length) {
        // Sum opponents' progress so capturing an advanced token scores higher.
        const val = captures.reduce(function (a, c) { return a + (c.pos < 0 ? 0 : c.pos); }, 0);
        s += (hard ? 130 : 100) + val * (hard ? 1.5 : 1);
      }
      if (reachesHome) s += hard ? 110 : 80;
      if (escapes)     s += (hard ? 40 : 28) + (hard ? tokenProgress * 0.5 : 0);
      if (isSpawn)     s += hard ? 70 : 55;
      if (entersHome)  s += hard ? 60 : 45;
      if (safeTarget)  s += hard ? 38 : 18;

      // Stacking onto a safe square that already holds a friendly token.
      if (hard && safeTarget && game.friendlyAt(targetLoop, color, t).length) s += 20;

      s += progress * (hard ? 1.0 : 0.6);

      // Penalty for moving INTO danger (weighted by how advanced the token is).
      if (nowInDanger && !captures.length) s -= hard ? (22 + tokenProgress * 0.4) : 14;

      return s;
    }
  };

  /* =========================================================================
     3. GAME — rules & state
     ========================================================================= */
  class Game {
    constructor(config, hooks) {
      this.hooks = hooks;                 // { onState, onMove, onCapture, onWin, onStatus }
      this.players = config.players;      // [{color, isBot, difficulty, name}] in turn order
      this.timers = [];

      // Build the 16 tokens.
      this.tokens = [];
      this.byColor = {};
      this.players.forEach(function (p) {
        this.byColor[p.color] = [];
        for (let i = 0; i < 4; i++) {
          const tk = { id: p.color + i, color: p.color, index: i, pos: -1 };
          this.tokens.push(tk);
          this.byColor[p.color].push(tk);
        }
      }, this);

      this.turnIdx = config.startIdx || 0;
      this.dice = null;
      this.phase = "roll";                // roll | move | anim | over
      this.sixStreak = 0;
      this.movable = [];                  // tokens the current player may move
      this.over = false;
    }

    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
    later(fn, ms) { const id = setTimeout(fn, ms); this.timers.push(id); return id; }

    current() { return this.players[this.turnIdx]; }
    isHumanTurn() { return !this.current().isBot && !this.over; }

    /* ---- helpers shared with the AI ---- */

    // Loop index of a token, or null if parked / in home column.
    loopIndexOf(t) {
      if (t.pos < 0 || t.pos > 50) return null;
      return (START_INDEX[t.color] + t.pos) % 52;
    }
    // Opponents sitting on loop index `li` that a move of `color` would capture.
    capturesAt(li, color) {
      if (SAFE.has(li)) return [];
      return this.tokens.filter(function (t) {
        return t.color !== color && this.loopIndexOf(t) === li;
      }, this);
    }
    // Friendly tokens already on loop index `li` (excluding `self`).
    friendlyAt(li, color, self) {
      return this.tokens.filter(function (t) {
        return t.color === color && t !== self && this.loopIndexOf(t) === li;
      }, this);
    }
    // Opponent tokens that could reach loop index `li` on their next roll (1..6).
    threatsTo(li, color) {
      const res = [];
      this.tokens.forEach(function (t) {
        if (t.color === color) return;
        const l = this.loopIndexOf(t);
        if (l === null) return;
        let d = ((li - l) % 52 + 52) % 52;
        if (d >= 1 && d <= 6) res.push(t);
      }, this);
      return res;
    }
    tokenInDanger(t) {
      const li = this.loopIndexOf(t);
      if (li === null || SAFE.has(li)) return false;
      return this.threatsTo(li, t.color).length > 0;
    }

    // All legal moves for `color` given a dice value.
    legalMoves(color, dice) {
      const moves = [];
      this.byColor[color].forEach(function (t) {
        if (t.pos === HOME_POS) return;                       // finished
        if (t.pos === -1) {
          if (dice === 6) moves.push({ token: t, from: -1, to: 0 });   // leave base
        } else {
          const to = t.pos + dice;
          if (to <= HOME_POS) moves.push({ token: t, from: t.pos, to: to });
        }
      });
      return moves;
    }

    /* ---- turn flow ---- */

    begin() {
      if (this.over) return;
      const p = this.current();
      this.dice = null;
      this.phase = "roll";
      this.movable = [];
      this.hooks.onState();
      if (p.isBot) {
        // Bots auto-roll after a natural 1-second delay.
        this.hooks.onStatus(p.name + " is thinking…");
        this.later(this.roll.bind(this), 1000);
      } else {
        this.hooks.onStatus("Your turn — tap the dice.");
      }
    }

    roll() {
      if (this.phase !== "roll" || this.over) return;
      const value = 1 + ((Math.random() * 6) | 0);
      this.dice = value;
      this.phase = "anim";
      this.hooks.onState();
      this.hooks.onRoll(value, this.handleRoll.bind(this, value));
    }

    handleRoll(value) {
      if (this.over) return;
      const p = this.current();

      // Three sixes in a row → forfeit the turn.
      this.sixStreak = value === 6 ? this.sixStreak + 1 : 0;
      if (this.sixStreak === 3) {
        this.hooks.onStatus(p.name + " rolled three 6s — turn forfeited.");
        this.sixStreak = 0;
        return this.endTurn(false);
      }

      const moves = this.legalMoves(p.color, value);
      if (!moves.length) {
        this.hooks.onStatus(p.name + " rolled " + value + " — no moves.");
        return this.later(this.endTurn.bind(this, false), 750);
      }

      this.phase = "move";
      this.movable = moves.map(function (m) { return m.token; });

      if (p.isBot) {
        const move = AI.choose(this, p.color, value, moves, p.difficulty);
        this.later(this.execute.bind(this, move), 550);
      } else {
        this.hooks.onState();              // highlights the movable tokens (pulse)
        if (moves.length === 1) {
          // Only one option → auto-play it after a brief glow.
          this.hooks.onStatus("Moving your only available token…");
          this.later(this.execute.bind(this, moves[0]), 600);
        } else {
          this.hooks.onStatus("Tap a glowing token to move.");
        }
      }
    }

    // Called by the UI when the human taps a movable token.
    humanMove(tokenId) {
      if (this.phase !== "move" || this.current().isBot) return;
      const moves = this.legalMoves(this.current().color, this.dice);
      const move = moves.find(function (m) { return m.token.id === tokenId; });
      if (move) this.execute(move);
    }

    execute(move) {
      if (this.over) return;
      this.phase = "anim";
      this.movable = [];
      const color = this.current().color;
      const value = this.dice;
      move.token.pos = move.to;

      // Resolve a capture if we landed on an unsafe loop cell.
      let captured = [];
      if (move.to <= 50) {
        const li = (START_INDEX[color] + move.to) % 52;
        captured = this.capturesAt(li, color);
        captured.forEach(function (t) { t.pos = -1; });   // send opponents home
      }
      const reachedHome = move.to === HOME_POS;

      // Announce the move so the renderer can animate, then continue.
      this.hooks.onMove(move, captured, function () {
        if (captured.length) {
          const names = captured.map(function (t) { return COLOR_NAME[t.color]; });
          this.hooks.onStatus(
            "<span class='cap'>" + COLOR_NAME[color] + " captured " +
            uniq(names).join(" & ") + "!</span>");
        }

        // Win? (all four tokens of this colour finished)
        if (this.byColor[color].every(function (t) { return t.pos === HOME_POS; })) {
          return this.win(color);
        }

        // Extra turn on a 6, a capture, or sending a token home.
        const extra = value === 6 || captured.length > 0 || reachedHome;
        this.endTurn(extra);
      }.bind(this));
    }

    endTurn(extra) {
      if (this.over) return;
      if (!extra) {
        this.sixStreak = 0;
        // Advance to the next player who has not already finished.
        let n = this.players.length, i = this.turnIdx;
        do { i = (i + 1) % n; } while (this.allHome(this.players[i].color) && i !== this.turnIdx);
        this.turnIdx = i;
      }
      this.begin();
    }

    allHome(color) {
      return this.byColor[color].every(function (t) { return t.pos === HOME_POS; });
    }

    win(color) {
      this.over = true;
      this.phase = "over";
      this.clearTimers();
      this.hooks.onState();
      this.hooks.onWin(color);
    }
  }

  // small helper
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  /* =========================================================================
     4. RENDERER — owns the DOM board & token elements
     ========================================================================= */
  class Renderer {
    constructor(boardEl) {
      this.board = boardEl;
      this.tokenEls = {};      // id → element
      this.game = null;
    }

    // Centre of grid cell [r,c] as board-relative percentages.
    static center(r, c) {
      return { left: ((c + 0.5) / 15) * 100, top: ((r + 0.5) / 15) * 100 };
    }

    buildBoard(palette) {
      const b = this.board;
      b.setAttribute("data-palette", palette);
      b.innerHTML = "";

      // ---- track / arm cells ----
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          const inBase = (r < 6 && c < 6) || (r < 6 && c > 8) ||
                         (r > 8 && c > 8) || (r > 8 && c < 6);
          const inCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;
          if (inBase || inCenter) continue;

          const cell = document.createElement("div");
          cell.className = "cell";
          cell.style.gridRow = (r + 1);
          cell.style.gridColumn = (c + 1);

          // Colour the home-column lanes.
          COLORS.forEach(function (color) {
            const lane = HOME_CELLS[color];
            for (let k = 0; k < 5; k++) {                  // first 5 are arm cells
              if (lane[k][0] === r && lane[k][1] === c) cell.classList.add("home-" + color);
            }
            const s = MAIN_PATH[START_INDEX[color]];
            if (s[0] === r && s[1] === c) cell.classList.add("start-" + color);
          });

          // Star (non-start safe square).
          const li = LOOP_INDEX_AT[r + "," + c];
          if (li !== undefined && STAR.has(li)) cell.classList.add("safe");

          b.appendChild(cell);
        }
      }

      // ---- corner bases + decorative yards ----
      COLORS.forEach(function (color) {
        const base = document.createElement("div");
        base.className = "base " + color;
        const yard = document.createElement("div");
        yard.className = "yard";
        base.appendChild(yard);
        b.appendChild(base);

        // Parking rings, positioned to match where parked tokens sit.
        BASE_SLOTS[color].forEach(function (rc) {
          const slot = document.createElement("div");
          slot.className = "slot " + color;
          const p = Renderer.center(rc[0], rc[1]);
          slot.style.left = p.left + "%";
          slot.style.top = p.top + "%";
          b.appendChild(slot);
        });
      });

      // ---- centre (four triangles via CSS conic-gradient) ----
      const center = document.createElement("div");
      center.className = "center";
      b.appendChild(center);
    }

    // Create token elements for the active colours.
    buildTokens(game) {
      this.game = game;
      this.tokenEls = {};
      game.tokens.forEach(function (t) {
        const el = document.createElement("div");
        el.className = "token " + t.color;
        el.dataset.id = t.id;
        el.innerHTML = '<div class="hit"></div><div class="disc"></div>';
        this.board.appendChild(el);
        this.tokenEls[t.id] = el;
      }, this);
      this.layout();
    }

    coordsOf(t) {
      if (t.pos < 0) return BASE_SLOTS[t.color][t.index];
      return FULL_PATH[t.color][t.pos];
    }

    // Position every token; spread out stacks that share a cell.
    layout() {
      const game = this.game;
      const groups = {};
      game.tokens.forEach(function (t) {
        const rc = this.coordsOf(t);
        const key = rc[0] + "," + rc[1];
        (groups[key] = groups[key] || []).push(t);
      }, this);

      Object.keys(groups).forEach(function (key) {
        const arr = groups[key];
        const n = arr.length;
        arr.forEach(function (t, i) {
          const rc = this.coordsOf(t);
          const base = Renderer.center(rc[0], rc[1]);
          let dx = 0, dy = 0;
          if (n > 1) {
            const ang = (i / n) * Math.PI * 2;
            const rad = 1.9;
            dx = Math.cos(ang) * rad;
            dy = Math.sin(ang) * rad;
          }
          const el = this.tokenEls[t.id];
          el.style.left = (base.left + dx) + "%";
          el.style.top = (base.top + dy) + "%";
          el.style.zIndex = 5 + i;
        }, this);
      }, this);
    }

    // Re-apply movable highlights. Movable tokens are lifted above the rest so
    // their (enlarged) touch targets are never covered by neighbouring tokens.
    setMovable(movable, enabled) {
      const set = {};
      movable.forEach(function (t) { set[t.id] = true; });
      Object.keys(this.tokenEls).forEach(function (id) {
        const on = enabled && !!set[id];
        const el = this.tokenEls[id];
        el.classList.toggle("movable", on);
        if (on) el.style.zIndex = 30;            // layout() resets this each turn
      }, this);
    }

    // Animate a single move (with a little hop), then call done().
    animateMove(move, done) {
      const el = this.tokenEls[move.token.id];
      el.classList.add("hop");
      this.layout();
      const self = this;
      setTimeout(function () { el.classList.remove("hop"); done(); }, 300);
    }
  }

  /* =========================================================================
     4b. SOUND — all audio is SYNTHESISED with the Web Audio API.
     No audio files: keeps the repo tiny, works fully offline, and is
     inherently royalty-free. SFX are one-shot tones/noise; the background
     music is a gentle generative arpeggio over a calm chord loop.
     ========================================================================= */
  const Sound = {
    ctx: null, master: null, sfxBus: null, musicBus: null,
    sfxOn: true, musicOn: false,
    _timer: null, _step: 0, _next: 0,
    STEP: 0.38,                                  // seconds per arpeggio step (~78 BPM)
    PROG: [                                       // C – Am – F – G (MIDI notes)
      [60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]
    ],

    ensure: function () {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.0001; this.musicBus.connect(this.master);
    },
    resume: function () { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },

    // A single enveloped oscillator note (optionally gliding in pitch).
    tone: function (freq, dur, type, when, gain, glideTo, bus) {
      if (!this.ctx) return;
      const t = when || this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain == null ? 0.3 : gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(bus || this.sfxBus);
      o.start(t); o.stop(t + dur + 0.03);
    },
    // A short filtered white-noise burst (clicks, rattles, impacts).
    noise: function (dur, when, gain, freq, q) {
      if (!this.ctx) return;
      const t = when || this.ctx.currentTime;
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = src;
      if (freq) {
        const f = this.ctx.createBiquadFilter();
        f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q || 1;
        src.connect(f); node = f;
      }
      node.connect(g).connect(this.sfxBus);
      src.start(t); src.stop(t + dur + 0.03);
    },

    /* ---- one-shot SFX ---- */
    roll: function () {                            // dice rattle
      if (!this.sfxOn) { return; } this.ensure(); this.resume(); if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      for (let i = 0; i < 5; i++) this.noise(0.05, t0 + i * 0.08, 0.16, 480 + Math.random() * 900, 2);
    },
    land: function () {                            // dice settles
      if (!this.sfxOn || !this.ctx) return;
      const t = this.ctx.currentTime;
      this.noise(0.09, t, 0.22, 240, 1.4);
      this.tone(170, 0.13, "square", t, 0.12, 120);
    },
    move: function () {                            // token hop
      if (!this.sfxOn) { return; } this.ensure(); this.resume(); if (!this.ctx) return;
      this.tone(520, 0.12, "triangle", this.ctx.currentTime, 0.22, 740);
    },
    capture: function () {                         // send opponent home
      if (!this.sfxOn) { return; } this.ensure(); this.resume(); if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone(440, 0.3, "sawtooth", t, 0.24, 90);
      this.noise(0.24, t, 0.16, 900, 0.7);
    },
    homeIn: function () {                           // token reaches centre
      if (!this.sfxOn) { return; } this.ensure(); this.resume(); if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [523, 659, 784].forEach(function (f, i) { Sound.tone(f, 0.2, "sine", t + i * 0.1, 0.24); });
    },
    win: function () {                             // victory fanfare
      if (!this.sfxOn) { return; } this.ensure(); this.resume(); if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [523, 659, 784, 1046].forEach(function (f, i) { Sound.tone(f, 0.32, "triangle", t + i * 0.12, 0.26); });
    },
    click: function () {
      if (!this.sfxOn || !this.ctx) return;
      this.tone(330, 0.06, "square", this.ctx.currentTime, 0.1);
    },

    /* ---- generative background music ---- */
    musicStart: function () {
      this.ensure(); this.resume(); if (!this.ctx) return;
      this.musicOn = true;
      this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicBus.gain.setTargetAtTime(0.13, this.ctx.currentTime, 0.6);   // fade in
      this._step = 0; this._next = this.ctx.currentTime + 0.12;
      const self = this;
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(function () { self._schedule(); }, 25);
    },
    musicStop: function () {
      this.musicOn = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this.ctx) this.musicBus.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    },
    _schedule: function () {                        // look-ahead scheduler
      if (!this.ctx) return;
      while (this._next < this.ctx.currentTime + 0.1) {
        this._playStep(this._step, this._next);
        this._next += this.STEP;
        this._step = (this._step + 1) % (this.PROG.length * 8);
      }
    },
    _playStep: function (step, t) {
      const chord = this.PROG[Math.floor(step / 8) % this.PROG.length];
      const inBar = step % 8;
      // soft arpeggio (an octave up in the back half of each bar)
      this._mnote(chord[inBar % chord.length] + (inBar >= 4 ? 12 : 0), t, 0.36, "triangle", 0.16);
      if (inBar === 0) {                            // bass + pad on the down-beat
        this._mnote(chord[0] - 12, t, 1.45, "sine", 0.2);
        this._mnote(chord[0], t, 1.45, "sine", 0.05);
        this._mnote(chord[1], t, 1.45, "sine", 0.045);
      }
    },
    _mnote: function (midi, t, dur, type, gain) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1900;
      o.connect(g).connect(lp).connect(this.musicBus);
      o.start(t); o.stop(t + dur + 0.05);
    }
  };

  /* =========================================================================
     5. UI / GLUE — lobby, dice, input, persistence
     ========================================================================= */
  const LS_KEY = "html-tools-ludo";
  const $ = function (id) { return document.getElementById(id); };

  const els = {
    lobby: $("lobby"), gameWrap: $("gameWrap"),
    colorPick: $("colorPick"), numBots: $("numBots"),
    boardTheme: $("boardTheme"), botDiffs: $("botDiffs"), startBtn: $("startBtn"),
    board: $("board"), players: $("players"),
    dice: $("dice"), diceFace: $("diceFace"), diceHint: $("diceHint"),
    turnCard: $("turnCard"), turnDot: $("turnDot"),
    turnName: $("turnName"), turnSub: $("turnSub"),
    status: $("status"), newBtn: $("newBtn"), fsBtn: $("fsBtn"),
    soundBtn: $("soundBtn"), musicBtn: $("musicBtn"),
    winModal: $("winModal"), winEmoji: $("winEmoji"),
    winTitle: $("winTitle"), winSub: $("winSub"), winAgain: $("winAgain")
  };

  const renderer = new Renderer(els.board);
  let game = null;
  let chosenColor = "red";

  // ---- dice pip layout (which of the 9 cells light up per value) ----
  const PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
  };
  function drawDice(value) {
    const spans = els.diceFace.children;
    const on = PIPS[value] || [];
    for (let i = 0; i < 9; i++) {
      spans[i].classList.toggle("on", on.indexOf(i) > -1);
    }
    els.diceFace.dataset.val = value;
  }

  /* ---- persistence ---- */
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePrefs() {
    const diffs = [].map.call(els.botDiffs.querySelectorAll("select"),
      function (s) { return s.value; });
    localStorage.setItem(LS_KEY, JSON.stringify({
      color: chosenColor,
      numBots: els.numBots.value,
      theme: els.boardTheme.value,
      diffs: diffs,
      sfx: Sound.sfxOn,
      music: Sound.musicOn
    }));
  }

  /* ---- lobby ---- */
  function setColor(color) {
    chosenColor = color;
    [].forEach.call(els.colorPick.children, function (chip) {
      chip.setAttribute("aria-checked", chip.dataset.color === color ? "true" : "false");
    });
  }

  // Rebuild the per-bot difficulty rows to match the bot count + chosen colour.
  function rebuildBotDiffs(savedDiffs) {
    const n = parseInt(els.numBots.value, 10);
    const botColors = botColorList(chosenColor, n);
    els.botDiffs.innerHTML = "";
    botColors.forEach(function (color, i) {
      const row = document.createElement("div");
      row.className = "bot-diff";
      const prev = savedDiffs && savedDiffs[i];
      row.innerHTML =
        '<span class="badge" style="background:' + swatch(color) + '"></span>' +
        '<span class="who">' + COLOR_NAME[color] + ' bot</span>' +
        '<select aria-label="' + COLOR_NAME[color] + ' bot difficulty">' +
          '<option value="easy">Easy</option>' +
          '<option value="medium">Medium</option>' +
          '<option value="hard">Hard</option>' +
        '</select>';
      els.botDiffs.appendChild(row);
      const sel = row.querySelector("select");
      sel.value = prev || (i === 0 ? "medium" : i === 1 ? "easy" : "hard");
    });
  }

  // Solid swatch colours for lobby chips (independent of board palette).
  function swatch(color) {
    return { red: "#e63d34", green: "#2ea04f", yellow: "#f4c220", blue: "#2f6bd4" }[color];
  }

  // Decide which colours the bots take, spread around the board.
  function botColorList(human, numBots) {
    const order = ["red", "green", "yellow", "blue"];
    const hi = order.indexOf(human);
    // Offsets chosen so opponents sit opposite / spread, not bunched.
    const offsetsByPlayers = { 2: [2], 3: [1, 2], 4: [1, 2, 3] };
    const offs = offsetsByPlayers[numBots + 1];
    return offs.map(function (o) { return order[(hi + o) % 4]; });
  }

  /* ---- start a game ---- */
  function startGame() {
    const numBots = parseInt(els.numBots.value, 10);
    const theme = els.boardTheme.value;
    const botColors = botColorList(chosenColor, numBots);
    const diffSelects = els.botDiffs.querySelectorAll("select");

    // Build player list, then sort into clockwise turn order.
    const order = ["red", "green", "yellow", "blue"];
    const players = [];
    players.push({ color: chosenColor, isBot: false, difficulty: null, name: "You" });
    botColors.forEach(function (color, i) {
      players.push({
        color: color, isBot: true,
        difficulty: diffSelects[i] ? diffSelects[i].value : "medium",
        name: COLOR_NAME[color] + " bot"
      });
    });
    players.sort(function (a, b) { return order.indexOf(a.color) - order.indexOf(b.color); });

    // Start with the human for a friendly first move.
    const startIdx = players.findIndex(function (p) { return !p.isBot; });

    savePrefs();
    renderer.buildBoard(theme);
    game = new Game({ players: players, startIdx: startIdx }, hooks);
    renderer.buildTokens(game);

    els.lobby.hidden = true;
    els.gameWrap.hidden = false;
    els.winModal.hidden = true;
    drawDice(6);
    game.begin();
  }

  /* ---- hooks: the Game calls these; the UI reacts ---- */
  const hooks = {
    onState: function () {
      renderer.layout();
      const human = game.isHumanTurn();
      renderer.setMovable(game.movable, human && game.phase === "move");

      // Dice availability + glow.
      const canRoll = human && game.phase === "roll";
      els.dice.disabled = !canRoll;
      els.dice.classList.toggle("ready", canRoll);
      els.diceHint.textContent = canRoll ? "Tap the dice to roll" :
        (game.current().isBot ? game.current().name + "…" : "");

      // Turn card.
      const p = game.current();
      els.turnDot.style.background = swatch(p.color);
      els.turnName.textContent = COLOR_NAME[p.color] + (p.isBot ? "" : " (You)");
      els.turnSub.textContent = p.isBot ? ("Bot · " + cap(p.difficulty)) : "Your turn";

      renderPlayers();
    },

    onStatus: function (html) { els.status.innerHTML = html; },

    onRoll: function (value, after) {
      // Shake the dice, flash a few faces, then settle on the real value.
      Sound.roll();
      els.dice.classList.add("rolling");
      let ticks = 6;
      const iv = setInterval(function () {
        drawDice(1 + ((Math.random() * 6) | 0));
        if (--ticks <= 0) {
          clearInterval(iv);
          drawDice(value);
          els.dice.classList.remove("rolling");
          Sound.land();
          els.status.textContent = COLOR_NAME[game.current().color] + " rolled " + value + ".";
          setTimeout(after, 250);
        }
      }, 70);
    },

    onMove: function (move, captured, done) {
      // Pick the most salient sound for this move.
      if (captured.length) Sound.capture();
      else if (move.to === HOME_POS) Sound.homeIn();
      else Sound.move();
      renderer.animateMove(move, done);
    },

    onWin: function (color) {
      Sound.win();
      renderPlayers();
      const youWon = !game.players.find(function (p) { return p.color === color; }).isBot;
      els.winEmoji.textContent = youWon ? "🏆" : "🤖";
      els.winTitle.textContent = youWon ? "You win!" : COLOR_NAME[color] + " bot wins!";
      els.winSub.textContent = "All four " + COLOR_NAME[color] + " tokens are home.";
      els.winModal.hidden = false;
    }
  };

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Player status strip (turn highlight + home progress pips).
  function renderPlayers() {
    els.players.innerHTML = "";
    game.players.forEach(function (p, i) {
      const homeCount = game.byColor[p.color].filter(function (t) { return t.pos === HOME_POS; }).length;
      const card = document.createElement("div");
      card.className = "pcard" + (i === game.turnIdx && !game.over ? " turn" : "") +
        (game.allHome(p.color) ? " done" : "");
      card.style.color = swatch(p.color);
      let pips = "";
      for (let k = 0; k < 4; k++) pips += '<i class="' + (k < homeCount ? "on" : "") + '"></i>';
      card.innerHTML =
        '<span class="dot" style="background:' + swatch(p.color) + '"></span>' +
        '<div class="pinfo">' +
          '<div class="pname" style="color:var(--text)">' + p.name + '</div>' +
          '<div class="pmeta">' + (p.isBot ? "Bot · " + cap(p.difficulty) : "Human") + '</div>' +
          '<div class="home-pips">' + pips + '</div>' +
        '</div>';
      els.players.appendChild(card);
    });
  }

  /* ---- input wiring (mouse + touch via pointerdown = zero lag) ---- */

  // Dice
  function rollNow(e) {
    if (e) e.preventDefault();
    if (game && !els.dice.disabled) game.roll();
  }
  els.dice.addEventListener("pointerdown", rollNow);
  els.dice.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") rollNow(e);
  });

  // Tokens — delegate from the board.
  els.board.addEventListener("pointerdown", function (e) {
    const tk = e.target.closest(".token.movable");
    if (!tk || !game) return;
    e.preventDefault();
    game.humanMove(tk.dataset.id);
  });

  // Lobby controls
  els.colorPick.addEventListener("click", function (e) {
    const chip = e.target.closest(".color-chip");
    if (!chip) return;
    setColor(chip.dataset.color);
    rebuildBotDiffs();
    savePrefs();
  });
  els.numBots.addEventListener("change", function () { rebuildBotDiffs(); savePrefs(); });
  els.boardTheme.addEventListener("change", function () {
    // Live-preview the palette if a game is already on the board.
    if (!els.gameWrap.hidden) els.board.setAttribute("data-palette", els.boardTheme.value);
    savePrefs();
  });
  els.botDiffs.addEventListener("change", savePrefs);
  els.startBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); startGame(); });

  // New game → back to lobby
  els.newBtn.addEventListener("click", function () {
    if (game) game.clearTimers();
    els.gameWrap.hidden = true;
    els.lobby.hidden = false;
    els.winModal.hidden = true;
    exitFs();
  });
  els.winAgain.addEventListener("click", function () {
    els.winModal.hidden = true;
    els.gameWrap.hidden = true;
    els.lobby.hidden = false;
    exitFs();
  });

  /* ---- audio toggles + first-gesture priming ---- */
  let pendingMusic = false;                 // music wanted, waiting for a user gesture

  function updateAudioButtons() {
    els.soundBtn.innerHTML = (Sound.sfxOn ? "🔊" : "🔇") + " Sound";
    els.soundBtn.classList.toggle("off", !Sound.sfxOn);
    els.musicBtn.innerHTML = (Sound.musicOn ? "🎵" : "🎶") + " Music";
    els.musicBtn.classList.toggle("off", !Sound.musicOn);
  }
  els.soundBtn.addEventListener("click", function () {
    Sound.sfxOn = !Sound.sfxOn;
    if (Sound.sfxOn) { Sound.ensure(); Sound.resume(); Sound.click(); }
    updateAudioButtons(); savePrefs();
  });
  els.musicBtn.addEventListener("click", function () {
    if (Sound.musicOn) Sound.musicStop();
    else Sound.musicStart();
    pendingMusic = false;
    updateAudioButtons(); savePrefs();
  });

  // Browsers only allow audio after a user gesture; prime it on the first one.
  function primeAudio() {
    Sound.ensure(); Sound.resume();
    if (pendingMusic) { pendingMusic = false; Sound.musicStart(); updateAudioButtons(); }
  }
  document.addEventListener("pointerdown", primeAudio);
  document.addEventListener("keydown", primeAudio);

  /* ---- keyboard shortcuts ---- */
  document.addEventListener("keydown", function (e) {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;  // don't hijack the lobby
    const k = e.key.toLowerCase();

    if (e.code === "Space" || e.key === " ") { e.preventDefault(); rollNow(); return; }
    if (k === "f") { e.preventDefault(); els.fsBtn.click(); return; }
    if (k === "m") { els.musicBtn.click(); return; }
    if (k === "s") { els.soundBtn.click(); return; }
    if (k === "n") { els.newBtn.click(); return; }
    if (k >= "1" && k <= "4") {
      if (game && !game.over && game.isHumanTurn() && game.phase === "move") {
        const t = game.movable[parseInt(k, 10) - 1];
        if (t) { e.preventDefault(); game.humanMove(t.id); }
      }
    }
  });

  // Fullscreen (with a graceful fallback when the API is unavailable).
  function exitFs() {
    els.gameWrap.classList.remove("fs-fallback");
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }
  els.fsBtn.addEventListener("click", function () {
    const w = els.gameWrap;
    if (document.fullscreenElement || w.classList.contains("fs-fallback")) {
      exitFs();
    } else if (w.requestFullscreen) {
      w.requestFullscreen().catch(function () { w.classList.add("fs-fallback"); });
    } else {
      w.classList.add("fs-fallback");
    }
  });

  /* ---- init: restore last choices ---- */
  (function init() {
    const prefs = loadPrefs();
    setColor(prefs.color && COLORS.indexOf(prefs.color) > -1 ? prefs.color : "red");
    if (prefs.numBots) els.numBots.value = prefs.numBots;
    if (prefs.theme) els.boardTheme.value = prefs.theme;
    rebuildBotDiffs(prefs.diffs);
    drawDice(6);

    // Restore audio prefs. SFX default ON; music defaults OFF and (if it was on
    // last time) starts on the first user gesture, per browser autoplay rules.
    Sound.sfxOn = prefs.sfx !== false;
    if (prefs.music) { Sound.musicOn = true; pendingMusic = true; }
    updateAudioButtons();
  })();

  // Expose internals for the (Node) test harness — no effect in the browser UI.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { MAIN_PATH, FULL_PATH, START_INDEX, HOME_CELLS, SAFE, STAR, BASE_SLOTS, Game, AI };
  }
})();
