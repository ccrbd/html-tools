/* ============================================================
   UNO — turn-based card game vs 1–3 AI bots
   Modular vanilla JS (Card, Deck, AIController, AudioController,
   UIController, GameEngine).

   Design notes
   ------------
   * GameEngine holds all rules + state. Its rule primitives
     (legalMoves / applyPlay / applyDraw / nextIndex …) are pure
     and DOM-free, so they can be unit-tested under Node.
   * Presentation (DOM, animation) lives in UIController and sound
     in AudioController; the engine talks to them through injected
     `ui` / `sfx` objects, both of which can be stubbed.
   * Settings persist in localStorage under "html-tools-uno".
   ============================================================ */

(function (root) {
  "use strict";

  /* ---------------- constants + tiny utils ---------------- */
  var COLORS = ["red", "yellow", "green", "blue"];
  var STORE_KEY = "html-tools-uno";

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ============================================================
     Card
     ============================================================ */
  var _cardId = 0;
  function Card(color, type, value) {
    this.color = color;          // 'red'|'yellow'|'green'|'blue'|'wild'
    this.type = type;            // 'number'|'skip'|'reverse'|'draw2'|'wild'|'wild4'
    this.value = (value == null ? null : value); // 0-9 for numbers
    this.id = "c" + (_cardId++);
    this.rot = randInt(-15, 15); // resting angle on the discard pile
  }
  Card.prototype.isWild = function () { return this.type === "wild" || this.type === "wild4"; };
  Card.prototype.isAction = function () {
    return this.type === "skip" || this.type === "reverse" || this.type === "draw2" || this.isWild();
  };
  Card.prototype.matches = function (top, activeColor) {
    if (this.isWild()) return true;                       // wilds are always legal
    if (this.color === activeColor) return true;          // colour match
    if (this.type === "number" && top.type === "number" && this.value === top.value) return true;
    if (this.type !== "number" && this.type === top.type) return true; // symbol match
    return false;
  };
  Card.prototype.points = function () {
    if (this.type === "number") return this.value;
    if (this.isWild()) return 50;
    return 20; // skip / reverse / draw2
  };
  Card.prototype.glyph = function () {
    switch (this.type) {
      case "number": return String(this.value);
      case "skip": return "⊘";     // ⊘
      case "reverse": return "⇄";  // ⇄
      case "draw2": return "+2";
      case "wild": return "W";
      case "wild4": return "+4";
    }
    return "?";
  };
  Card.prototype.colorClass = function () {
    return this.isWild() ? "c-wild" : "c-" + this.color;
  };
  Card.prototype.label = function () {
    var c = this.color === "wild" ? "" : (this.color.charAt(0).toUpperCase() + this.color.slice(1) + " ");
    switch (this.type) {
      case "number": return c + this.value;
      case "skip": return c + "Skip";
      case "reverse": return c + "Reverse";
      case "draw2": return c + "Draw Two";
      case "wild": return "Wild";
      case "wild4": return "Wild Draw Four";
    }
    return "card";
  };

  /* ============================================================
     Deck — full 108-card UNO deck
     ============================================================ */
  function Deck() { this.cards = []; }
  Deck.build = function () {
    var d = new Deck();
    COLORS.forEach(function (col) {
      d.cards.push(new Card(col, "number", 0));      // one 0
      for (var v = 1; v <= 9; v++) {                 // two each of 1-9
        d.cards.push(new Card(col, "number", v));
        d.cards.push(new Card(col, "number", v));
      }
      ["skip", "reverse", "draw2"].forEach(function (t) { // two each action
        d.cards.push(new Card(col, t, null));
        d.cards.push(new Card(col, t, null));
      });
    });
    for (var i = 0; i < 4; i++) {                    // 4 wild + 4 wild4
      d.cards.push(new Card("wild", "wild", null));
      d.cards.push(new Card("wild", "wild4", null));
    }
    return d; // 108
  };
  Deck.prototype.shuffle = function () { shuffle(this.cards); return this; };
  Deck.prototype.draw = function () { return this.cards.pop(); };
  Deck.prototype.size = function () { return this.cards.length; };

  /* ============================================================
     AIController — three distinct difficulties
     ============================================================ */
  function AIController(difficulty) { this.difficulty = difficulty || "medium"; }

  AIController.prototype.dominantColor = function (hand) {
    var counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    hand.forEach(function (c) { if (c.color !== "wild") counts[c.color]++; });
    var best = "red", n = -1;
    COLORS.forEach(function (col) { if (counts[col] > n) { n = counts[col]; best = col; } });
    return best;
  };

  // Returns { action:'play', card, color? } or { action:'draw' }
  AIController.prototype.decide = function (player, engine) {
    var legal = engine.legalMoves(player);
    if (!legal.length) return { action: "draw" };

    var self = this;
    var hand = player.hand;
    var minOpp = engine.minOpponentCount(engine.players.indexOf(player));

    function withColor(card) {
      var col = (self.difficulty === "easy") ? choice(COLORS) : self.dominantColor(hand);
      return { action: "play", card: card, color: card.isWild() ? col : undefined };
    }
    function byType(list, type) { return list.filter(function (c) { return c.type === type; }); }

    if (this.difficulty === "easy") {
      return withColor(choice(legal)); // random legal card
    }

    var numbers = byType(legal, "number");
    var skips = byType(legal, "skip");
    var rev = byType(legal, "reverse");
    var d2 = byType(legal, "draw2");
    var wild = byType(legal, "wild");
    var wild4 = byType(legal, "wild4");

    if (this.difficulty === "medium") {
      // numbers first (shed highest points), then action cards, save wilds.
      if (numbers.length) {
        numbers.sort(function (a, b) { return b.value - a.value; });
        return withColor(numbers[0]);
      }
      var act = skips.concat(rev, d2);
      if (act.length) return withColor(act[0]);
      if (wild.length) return withColor(wild[0]);
      return withColor(wild4[0]);
    }

    // ---- hard: aggressive + counts + hoards wild4 ----
    var aggressive = minOpp <= 2; // someone is close to winning → disrupt
    if (aggressive) {
      var disrupt = d2.concat(skips, rev);
      if (disrupt.length) return withColor(disrupt[0]);
      if (wild4.length && minOpp <= 1) return withColor(wild4[0]); // last-ditch defence
    }
    if (numbers.length) {            // shed points but keep colour balance
      numbers.sort(function (a, b) { return b.value - a.value; });
      return withColor(numbers[0]);
    }
    var act2 = skips.concat(rev, d2);
    if (act2.length) return withColor(act2[0]);
    if (wild.length) return withColor(wild[0]); // play plain wild before hoarded wild4
    return withColor(wild4[0]);      // only when nothing else is legal
  };

  // probability a bot remembers to call its own UNO
  AIController.prototype.unoSelfChance = function () {
    return this.difficulty === "easy" ? 0.35 : this.difficulty === "medium" ? 0.85 : 1.0;
  };
  // probability a bot catches a forgetful human
  AIController.prototype.catchChance = function () {
    return this.difficulty === "easy" ? 0.2 : this.difficulty === "medium" ? 0.7 : 1.0;
  };
  AIController.prototype.thinkTime = function () {
    return this.difficulty === "easy" ? 1500 : this.difficulty === "medium" ? 950 : 450;
  };

  /* ============================================================
     AudioController — Web Audio API (synthesised)
     ============================================================ */
  function AudioController() {
    this.ctx = null;
    this.muteSfx = false;
    this.muteMusic = true;
    this.theme = "classic";
    this._musicTimer = null;
    this._step = 0;
  }
  AudioController.prototype.ensure = function () {
    if (this.ctx) return;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
  };
  AudioController.prototype.resume = function () {
    this.ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  };
  AudioController.prototype.setTheme = function (t) { this.theme = t; };
  AudioController.prototype._wave = function () {
    return this.theme === "cyber" ? "sawtooth"
      : this.theme === "matte" ? "sine"
      : this.theme === "gold" ? "triangle" : "square";
  };
  // one synthesised tone
  AudioController.prototype.tone = function (freq, dur, opts) {
    if (this.muteSfx || !this.ctx) return;
    opts = opts || {};
    var t0 = this.ctx.currentTime + (opts.when || 0);
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = opts.type || this._wave();
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    var vol = (opts.gain == null ? 0.18 : opts.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  };
  // filtered noise burst (snaps / whooshes)
  AudioController.prototype.noise = function (dur, opts) {
    if (this.muteSfx || !this.ctx) return;
    opts = opts || {};
    var t0 = this.ctx.currentTime;
    var n = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var filt = this.ctx.createBiquadFilter();
    filt.type = opts.type || "bandpass";
    filt.frequency.setValueAtTime(opts.freq || 1200, t0);
    if (opts.slideTo) filt.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.gain || 0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(this.ctx.destination);
    src.start(t0);
  };
  AudioController.prototype.hover = function () { this.tone(this.theme === "cyber" ? 1400 : 900, 0.05, { gain: 0.06, type: this.theme === "matte" ? "sine" : "triangle" }); };
  AudioController.prototype.playCard = function () { this.noise(0.09, { freq: 2200, slideTo: 400, gain: 0.3 }); this.tone(160, 0.08, { gain: 0.12, type: "square" }); };
  AudioController.prototype.drawCard = function () { this.noise(0.16, { type: "highpass", freq: 300, slideTo: 3000, gain: 0.18 }); };
  AudioController.prototype.action = function (kind) {
    if (kind === "skip") { this.tone(660, 0.12, { gain: 0.2 }); this.tone(440, 0.16, { when: 0.08, gain: 0.2 }); }
    else if (kind === "reverse") { this.tone(500, 0.1, { gain: 0.18, slideTo: 900 }); this.tone(900, 0.12, { when: 0.09, gain: 0.18, slideTo: 500 }); }
    else { // draw2 / draw4 — progressive rising pitch
      var n = kind === "draw4" ? 4 : 2, base = 300;
      for (var i = 0; i < n; i++) this.tone(base + i * 180, 0.1, { when: i * 0.09, gain: 0.2 });
    }
  };
  AudioController.prototype.buzzer = function () { // UNO! / penalty
    this.tone(180, 0.32, { gain: 0.3, type: "sawtooth", slideTo: 90 });
    this.tone(240, 0.32, { gain: 0.22, type: "square" });
  };
  AudioController.prototype.win = function () {
    var notes = [523, 659, 784, 1047];
    for (var i = 0; i < notes.length; i++) this.tone(notes[i], 0.3, { when: i * 0.12, gain: 0.22, type: "triangle" });
  };
  AudioController.prototype.startMusic = function () {
    if (this.muteMusic || !this.ctx || this._musicTimer) return;
    var self = this;
    var scale = this.theme === "cyber" ? [220, 277, 330, 440, 554]
      : this.theme === "gold" ? [196, 261, 311, 392, 466]
      : [262, 294, 330, 392, 440];
    this._musicTimer = setInterval(function () {
      if (self.muteMusic) return;
      var f = scale[self._step % scale.length];
      self._step++;
      var saved = self.muteSfx; self.muteSfx = false;
      self.tone(f, 0.5, { gain: 0.05, type: self.theme === "matte" ? "sine" : "triangle" });
      if (self._step % 2 === 0) self.tone(f / 2, 0.6, { gain: 0.04, type: "sine" });
      self.muteSfx = saved;
    }, 620);
  };
  AudioController.prototype.stopMusic = function () { if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; } };

  /* ============================================================
     UIController — DOM rendering, animation, input
     ============================================================ */
  function UIController() {
    this.engine = null;
    this.$ = {};
    if (typeof document === "undefined") return; // headless
    var ids = ["lobby", "stage", "table", "seat-top", "seat-left", "seat-right",
      "seat-bottom", "humanHand", "drawPile", "discardPile", "drawCount", "dropHint",
      "turnStatus", "drawBtn", "passBtn", "unoBtn", "fxLayer", "colorChooser",
      "resultOverlay", "resultTitle", "resultBody", "eventLog", "dirBadge",
      "colorBadge", "dirRing", "sfxBtn", "musicBtn", "autoBtn"];
    var self = this;
    ids.forEach(function (id) { self.$[id] = document.getElementById(id); });
  }
  UIController.prototype.setTheme = function (t) { if (this.$.table) this.$.table.setAttribute("data-uno-theme", t); };

  function cardInner(card) {
    var g = card.glyph();
    return '<span class="corner tl">' + g + '</span>' +
      '<div class="card-oval"><span class="glyph' + (card.type === "number" ? "" : " sym") + '">' + g + '</span></div>' +
      '<span class="corner br">' + g + '</span>';
  }
  function rectOf(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }

  UIController.prototype.showStage = function () { this.$.lobby.hidden = true; this.$.stage.hidden = false; };
  UIController.prototype.showLobby = function () { this.$.stage.hidden = true; this.$.lobby.hidden = false; };

  UIController.prototype.renderAll = function (engine) {
    this.renderBots(engine);
    this.renderHuman(engine);
    this.renderDiscard(engine);
    this.updateCounts(engine);
    this.updateBadges(engine);
  };

  UIController.prototype.renderBots = function (engine) {
    var self = this;
    ["top", "left", "right"].forEach(function (s) { if (self.$["seat-" + s]) self.$["seat-" + s].innerHTML = ""; });
    engine.players.forEach(function (p, idx) {
      if (p.isHuman) return;
      var seat = self.$["seat-" + p.seat];
      if (!seat) return;
      var el = document.createElement("div");
      el.className = "bot" + (idx === engine.turnIndex ? " active" : "");
      el.id = "bot-" + idx;
      var fan = "";
      var shown = Math.min(p.hand.length, 7);
      for (var i = 0; i < shown; i++) fan += '<div class="mini-back"></div>';
      el.innerHTML =
        '<div class="bot-cards">' + fan + '</div>' +
        '<div class="avatar">' + (p.avatar || "🤖") + '</div>' +
        '<div class="bot-name">' + p.name + '</div>' +
        '<div class="bot-count">' + p.hand.length + ' card' + (p.hand.length === 1 ? "" : "s") + '</div>';
      seat.appendChild(el);
    });
  };

  UIController.prototype.renderHuman = function (engine) {
    var hand = this.$.humanHand;
    if (!hand) return;
    hand.innerHTML = "";
    var human = engine.players[0];
    var myTurn = (engine.turnIndex === 0) && !engine.over && !engine.locked && !engine.autoplay;
    var legalIds = {};
    if (myTurn) engine.legalMoves(human).forEach(function (c) { legalIds[c.id] = true; });
    var self = this;
    human.hand.forEach(function (card) {
      var el = document.createElement("div");
      el.className = "card " + card.colorClass();
      el.dataset.id = card.id;
      el.innerHTML = cardInner(card);
      if (myTurn) el.classList.add(legalIds[card.id] ? "playable" : "disabled");
      self._bindCard(el, card, engine);
      hand.appendChild(el);
    });
  };

  UIController.prototype.renderDiscard = function (engine) {
    var pile = this.$.discardPile;
    if (!pile) return;
    pile.innerHTML = '<div class="drop-hint" id="dropHint">Drop here</div>';
    var n = engine.discardPile.length;
    var start = Math.max(0, n - 4);
    for (var i = start; i < n; i++) {
      var card = engine.discardPile[i];
      var el = document.createElement("div");
      el.className = "card " + (card.isWild() && card._chosen ? "c-" + card._chosen : card.colorClass());
      el.style.transform = "rotate(" + card.rot + "deg) translate(" + (i - n) * 0 + "px,0)";
      el.innerHTML = cardInner(card);
      if (i < n - 1) el.style.opacity = "0.85";
      pile.appendChild(el);
    }
    if (n) this.$.dropHint = null;
  };

  UIController.prototype.updateCounts = function (engine) {
    if (this.$.drawCount) this.$.drawCount.textContent = engine.deck.size();
  };
  UIController.prototype.updateBadges = function (engine) {
    if (this.$.dirBadge) this.$.dirBadge.textContent = engine.direction === 1 ? "⟳ Clockwise" : "⟲ Counter-cw";
    var cb = this.$.colorBadge;
    if (cb) {
      cb.className = "badge col-" + engine.activeColor;
      cb.textContent = "Colour: " + engine.activeColor.charAt(0).toUpperCase() + engine.activeColor.slice(1);
    }
  };
  UIController.prototype.setStatus = function (txt) { if (this.$.turnStatus) this.$.turnStatus.textContent = txt; };
  UIController.prototype.setActiveSeat = function (engine) {
    var self = this;
    engine.players.forEach(function (p, idx) {
      if (p.isHuman) return;
      var el = document.getElementById("bot-" + idx);
      if (el) el.classList.toggle("active", idx === engine.turnIndex);
    });
  };
  UIController.prototype.enableHuman = function (on) {
    if (this.$.drawBtn) this.$.drawBtn.disabled = !on;
  };
  UIController.prototype.showPass = function (on) { if (this.$.passBtn) this.$.passBtn.hidden = !on; };

  UIController.prototype.log = function (txt) {
    var log = this.$.eventLog;
    if (!log) return;
    var line = document.createElement("div");
    line.className = "line"; line.textContent = txt;
    log.appendChild(line);
    while (log.children.length > 5) log.removeChild(log.firstChild);
  };

  /* ----- input binding for a human card (tap + drag) ----- */
  UIController.prototype._bindCard = function (el, card, engine) {
    var self = this;
    el.addEventListener("pointerenter", function () { if (engine.sfx) engine.sfx.hover(); });
    el.addEventListener("pointerdown", function (e) {
      el.classList.add("lift");
      if (engine.sfx) engine.sfx.hover();
      if (engine.turnIndex !== 0 || engine.locked || engine.over || engine.autoplay) return;
      var start = { x: e.clientX, y: e.clientY };
      var dragging = false;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      var discardRect = rectOf(self.$.discardPile);

      function move(ev) {
        var dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) > 10) { dragging = true; el.classList.add("dragging"); }
        if (dragging) {
          el.style.transform = "translate(" + dx + "px," + dy + "px) scale(1.05)";
          el.style.zIndex = 50;
          var over = ev.clientX > discardRect.x && ev.clientX < discardRect.x + discardRect.w &&
            ev.clientY > discardRect.y && ev.clientY < discardRect.y + discardRect.h;
          self.$.discardPile.classList.toggle("drop-active", over);
        }
      }
      function up(ev) {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        self.$.discardPile.classList.remove("drop-active");
        el.classList.remove("lift", "dragging");
        el.style.transform = ""; el.style.zIndex = "";
        var legal = engine.canPlay(card);
        if (!dragging) { if (legal) engine.onHumanPlay(card); return; } // tap
        var over = ev.clientX > discardRect.x && ev.clientX < discardRect.x + discardRect.w &&
          ev.clientY > discardRect.y && ev.clientY < discardRect.y + discardRect.h;
        if (over && legal) engine.onHumanPlay(card);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    el.addEventListener("pointerleave", function () { el.classList.remove("lift"); });
  };

  /* ----- colour chooser ----- */
  UIController.prototype.promptColor = function () {
    var self = this;
    return new Promise(function (resolve) {
      var box = self.$.colorChooser;
      if (!box) { resolve(choice(COLORS)); return; }
      box.hidden = false;
      var btns = box.querySelectorAll(".cc");
      function pick(e) {
        var col = e.currentTarget.dataset.color;
        btns.forEach(function (b) { b.removeEventListener("click", pick); });
        box.hidden = true;
        resolve(col);
      }
      btns.forEach(function (b) { b.addEventListener("click", pick); });
    });
  };

  /* ----- flying-card animations ----- */
  UIController.prototype._fly = function (innerHTML, fromR, toR, klass, rot) {
    var self = this;
    return new Promise(function (resolve) {
      if (typeof document === "undefined" || !self.$.fxLayer) { resolve(); return; }
      var fly = document.createElement("div");
      fly.className = "fly-card " + (klass || "");
      fly.style.left = fromR.x + "px";
      fly.style.top = fromR.y + "px";
      fly.style.width = fromR.w + "px";
      fly.style.height = fromR.h + "px";
      fly.innerHTML = innerHTML;
      self.$.fxLayer.appendChild(fly);
      var dx = toR.cx - fromR.cx, dy = toR.cy - fromR.cy;
      var done = false;
      function finish() { if (done) return; done = true; if (fly.parentNode) fly.parentNode.removeChild(fly); resolve(); }
      fly.addEventListener("transitionend", finish);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          fly.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (rot || 0) + "deg)";
        });
      });
      setTimeout(finish, 600); // safety
    });
  };

  UIController.prototype.flyPlay = function (engine, idx, card) {
    var p = engine.players[idx];
    var fromEl = p.isHuman ? (this.$.humanHand.querySelector('[data-id="' + card.id + '"]') || this.$.humanHand)
      : (document.getElementById("bot-" + idx) || this.$["seat-" + p.seat]);
    if (!fromEl) return Promise.resolve();
    var fromR = rectOf(fromEl);
    var toR = rectOf(this.$.discardPile);
    // size the fly card to a real card size
    fromR.w = toR.w; fromR.h = toR.h;
    var klass = (card.isWild() && card._chosen) ? "c-" + card._chosen : card.colorClass();
    return this._fly(cardInner(card), fromR, toR, klass, card.rot);
  };

  UIController.prototype.flyDraw = function (engine, idx, count) {
    var p = engine.players[idx];
    var toEl = p.isHuman ? this.$.humanHand : (document.getElementById("bot-" + idx) || this.$["seat-" + p.seat]);
    if (!toEl) return Promise.resolve();
    var fromR = rectOf(this.$.drawPile);
    var toR = rectOf(toEl);
    var back = '<div class="card-back" style="width:100%;height:100%"></div>';
    var chain = Promise.resolve();
    var self = this;
    var n = Math.min(count, 4);
    for (var i = 0; i < n; i++) {
      (function (i) {
        chain = chain.then(function () {
          var f = { x: fromR.x, y: fromR.y, w: fromR.w, h: fromR.h, cx: fromR.cx, cy: fromR.cy };
          var t = { cx: toR.cx + randInt(-14, 14), cy: toR.cy };
          return Promise.race([self._fly(back, f, t, "", randInt(-12, 12)), delay(110)]);
        });
      })(i);
    }
    return chain;
  };

  UIController.prototype.dealAnim = function (engine) {
    var self = this;
    var fromR = rectOf(this.$.drawPile);
    var seq = Promise.resolve();
    var order = engine.players;
    var back = '<div class="card-back" style="width:100%;height:100%"></div>';
    for (var round = 0; round < 7; round++) {
      order.forEach(function (p, idx) {
        seq = seq.then(function () {
          var toEl = p.isHuman ? self.$.humanHand : (self.$["seat-" + p.seat]);
          if (!toEl) return;
          var toR = rectOf(toEl);
          return Promise.race([
            self._fly(back, { x: fromR.x, y: fromR.y, w: fromR.w, h: fromR.h, cx: fromR.cx, cy: fromR.cy },
              { cx: toR.cx, cy: toR.cy }, "", randInt(-10, 10)),
            delay(70) // cascade
          ]);
        });
      });
    }
    return seq;
  };

  /* ----- VFX ----- */
  UIController.prototype.vfxSkip = function (idx) {
    if (typeof document === "undefined") return;
    var el = document.getElementById("bot-" + idx) ||
      (idx === 0 ? this.$.humanHand : null) || this.$["seat-" + this.engine.players[idx].seat];
    if (!el) return;
    var r = rectOf(el);
    var v = document.createElement("div");
    v.className = "vfx-skip";
    v.style.left = r.cx + "px"; v.style.top = r.cy + "px";
    v.innerHTML = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#ff3b3b" stroke-width="9"/><line x1="24" y1="24" x2="76" y2="76" stroke="#ff3b3b" stroke-width="9" stroke-linecap="round"/></svg>';
    this.$.fxLayer.appendChild(v);
    setTimeout(function () { if (v.parentNode) v.parentNode.removeChild(v); }, 950);
  };
  UIController.prototype.vfxReverse = function (direction) {
    var ring = this.$.dirRing;
    if (!ring) return;
    ring.classList.remove("spin", "ccw"); void ring.offsetWidth;
    ring.classList.add("spin"); if (direction === -1) ring.classList.add("ccw");
    setTimeout(function () { ring.classList.remove("spin", "ccw"); }, 950);
  };
  UIController.prototype.shake = function () {
    var t = this.$.table; if (!t) return;
    t.classList.remove("shake"); void t.offsetWidth; t.classList.add("shake");
    setTimeout(function () { t.classList.remove("shake"); }, 520);
  };
  UIController.prototype.toast = function (txt, color) {
    if (typeof document === "undefined" || !this.$.fxLayer) return;
    var el = document.createElement("div");
    el.className = "toast"; el.textContent = txt;
    if (color) el.style.color = color;
    this.$.fxLayer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1250);
  };
  UIController.prototype.confetti = function (heavy) {
    if (typeof document === "undefined" || !this.$.fxLayer) return;
    var cols = ["#e3000f", "#f6b700", "#00a651", "#0072bc", "#ff2e88", "#00e5ff"];
    var count = heavy ? 120 : 36;
    for (var i = 0; i < count; i++) {
      var c = document.createElement("div");
      c.className = "confetti";
      c.style.left = rand(0, 100) + "vw";
      c.style.background = choice(cols);
      c.style.animationDuration = rand(1.6, 3.2) + "s";
      c.style.animationDelay = rand(0, 0.5) + "s";
      c.style.width = randInt(6, 12) + "px";
      c.style.height = randInt(10, 18) + "px";
      this.$.fxLayer.appendChild(c);
      (function (node) { setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 3800); })(c);
    }
  };
  UIController.prototype.setUno = function (mode) {
    var b = this.$.unoBtn;
    if (!b) return;
    b.classList.remove("hot", "catch");
    if (mode === "self") { b.classList.add("hot"); b.textContent = "UNO!"; }
    else if (mode === "catch") { b.classList.add("hot", "catch"); b.textContent = "Catch!"; }
    else { b.textContent = "UNO!"; }
  };
  UIController.prototype.showResult = function (title, body) {
    if (this.$.resultTitle) this.$.resultTitle.textContent = title;
    if (this.$.resultBody) this.$.resultBody.textContent = body;
    if (this.$.resultOverlay) this.$.resultOverlay.hidden = false;
  };
  UIController.prototype.hideResult = function () { if (this.$.resultOverlay) this.$.resultOverlay.hidden = true; };

  /* ============================================================
     GameEngine — rules, state, orchestration
     ============================================================ */
  function GameEngine(opts) {
    opts = opts || {};
    this.numBots = opts.numBots || 3;
    this.difficulty = opts.difficulty || "medium";
    this.humanName = opts.humanName || "You";
    this.ui = opts.ui || new NullUI();
    this.sfx = opts.sfx || new NullSfx();
    this.ai = new AIController(this.difficulty);
    this.autoUno = opts.autoUno !== false;
    this.autoplay = !!opts.autoplay;

    this.deck = null;
    this.discardPile = [];
    this.players = [];
    this.direction = 1;     // 1 = clockwise, -1 = counter
    this.turnIndex = 0;
    this.activeColor = "red";
    this.over = false;
    this.locked = false;    // input/animation lock
    this._drewThisTurn = false;
    this._uno = { actor: -1, timers: [] };
  }

  /* ---- pure rule primitives (safe for Node) ---- */
  GameEngine.prototype.topCard = function () { return this.discardPile[this.discardPile.length - 1]; };
  GameEngine.prototype.canPlay = function (card) { return card.matches(this.topCard(), this.activeColor); };
  GameEngine.prototype.legalMoves = function (player) {
    var self = this;
    return player.hand.filter(function (c) { return self.canPlay(c); });
  };
  GameEngine.prototype.nextIndex = function (from, steps) {
    var n = this.players.length;
    if (steps == null) steps = 1;
    return ((from + this.direction * steps) % n + n) % n;
  };
  GameEngine.prototype.minOpponentCount = function (selfIdx) {
    var m = Infinity;
    this.players.forEach(function (p, i) { if (i !== selfIdx) m = Math.min(m, p.hand.length); });
    return m;
  };
  GameEngine.prototype.reshuffleIfNeeded = function () {
    if (this.deck.size() > 0) return;
    if (this.discardPile.length <= 1) return; // nothing to recycle
    var top = this.discardPile.pop();
    var recycled = this.discardPile;
    recycled.forEach(function (c) { if (c.isWild()) { c.color = "wild"; c._chosen = null; } });
    this.deck.cards = shuffle(recycled);
    this.discardPile = [top];
  };
  GameEngine.prototype.applyDraw = function (idx, n) {
    var drawn = [];
    for (var i = 0; i < n; i++) {
      this.reshuffleIfNeeded();
      if (this.deck.size() === 0) break;
      var c = this.deck.draw();
      this.players[idx].hand.push(c);
      drawn.push(c);
    }
    return drawn;
  };
  // mutate state for a play; returns { skipNext, draw, type }
  GameEngine.prototype.applyPlay = function (idx, card, color) {
    var p = this.players[idx];
    var pos = p.hand.indexOf(card);
    if (pos >= 0) p.hand.splice(pos, 1);
    if (card.isWild()) { card._chosen = color || choice(COLORS); this.activeColor = card._chosen; }
    else { this.activeColor = card.color; }
    this.discardPile.push(card);
    var effect = { type: card.type, skipNext: false, draw: 0 };
    if (card.type === "reverse") { this.direction *= -1; if (this.players.length === 2) effect.skipNext = true; }
    else if (card.type === "skip") { effect.skipNext = true; }
    else if (card.type === "draw2") { effect.draw = 2; effect.skipNext = true; }
    else if (card.type === "wild4") { effect.draw = 4; effect.skipNext = true; }
    return effect;
  };

  /* ---- setup (DOM-free state init) ---- */
  GameEngine.prototype.initState = function () {
    this.deck = Deck.build().shuffle();
    this.discardPile = [];
    this.direction = 1;
    this.over = false;
    this.turnIndex = 0;

    var avatars = ["🦊", "🐼", "🐧", "🦉", "🐢", "🐯"];
    this.players = [{ id: 0, name: this.humanName, isHuman: true, hand: [], saidUno: false, seat: "bottom" }];
    var seats = this.numBots === 1 ? ["top"] : this.numBots === 2 ? ["left", "right"] : ["left", "top", "right"];
    for (var b = 0; b < this.numBots; b++) {
      this.players.push({ id: b + 1, name: "Bot " + (b + 1), isHuman: false, hand: [], saidUno: false, seat: seats[b], avatar: avatars[b % avatars.length] });
    }
    // deal 7 each
    for (var r = 0; r < 7; r++) for (var pi = 0; pi < this.players.length; pi++) this.players[pi].hand.push(this.deck.draw());
    // starting discard must be a plain number card
    var idx = this.deck.cards.length - 1;
    while (idx >= 0 && this.deck.cards[idx].type !== "number") idx--;
    var start = (idx >= 0) ? this.deck.cards.splice(idx, 1)[0] : this.deck.draw();
    this.discardPile.push(start);
    this.activeColor = start.color;
  };

  /* ---- orchestration (browser) ---- */
  GameEngine.prototype.start = function () {
    var self = this;
    this.initState();
    this.ui.setTheme(this._theme || "classic");
    this.ui.showStage();
    this.ui.renderAll(this);
    this.ui.setStatus("Dealing…");
    this.locked = true;
    this.ui.dealAnim(this).then(function () {
      self.locked = false;
      self.ui.renderAll(self);
      self.ui.log("Top card: " + self.topCard().label());
      self.beginTurn();
    });
  };

  GameEngine.prototype.beginTurn = function () {
    if (this.over) return;
    this._drewThisTurn = false;
    var p = this.players[this.turnIndex];
    this.ui.setActiveSeat(this);
    this.ui.renderHuman(this);
    this.ui.showPass(false);
    var human = (this.turnIndex === 0 && !this.autoplay);
    this.ui.enableHuman(human);
    if (human) {
      this.ui.setStatus("Your turn — play a glowing card or draw");
    } else {
      this.ui.enableHuman(false);
      this.ui.setStatus((p.isHuman ? "Auto-play" : p.name) + " is thinking…");
      var self = this;
      var t = p.isHuman ? 650 : this.ai.thinkTime();
      setTimeout(function () { self._autoMove(); }, t);
    }
  };

  GameEngine.prototype._autoMove = function () {
    if (this.over) return;
    var p = this.players[this.turnIndex];
    var decision = this.ai.decide(p, this);
    if (decision.action === "draw") return this._autoDraw(p);
    this.doPlay(this.turnIndex, decision.card, decision.color);
  };

  GameEngine.prototype._autoDraw = function (p) {
    var self = this;
    this.locked = true;
    this.sfx.drawCard();
    this.ui.flyDraw(this, this.turnIndex, 1).then(function () {
      var drawn = self.applyDraw(self.turnIndex, 1);
      self.ui.renderBots(self); self.ui.updateCounts(self);
      self.locked = false;
      var card = drawn[0];
      if (card && self.canPlay(card)) {
        // play the freshly drawn card
        setTimeout(function () { self.doPlay(self.turnIndex, card, self.ai.dominantColor(p.hand)); }, 350);
      } else {
        self.ui.log(p.name + " drew a card");
        self.endTurn(self.turnIndex, { skipNext: false, draw: 0 });
      }
    });
  };

  /* ---- human input handlers ---- */
  GameEngine.prototype.onHumanPlay = function (card) {
    if (this.turnIndex !== 0 || this.locked || this.over) return;
    if (!this.canPlay(card)) return;
    var self = this;
    if (card.isWild()) {
      this.locked = true;
      this.ui.promptColor().then(function (col) { self.locked = false; self.doPlay(0, card, col); });
    } else {
      this.doPlay(0, card);
    }
  };
  GameEngine.prototype.onHumanDraw = function () {
    if (this.turnIndex !== 0 || this.locked || this.over || this._drewThisTurn) return;
    this._drewThisTurn = true;
    var self = this;
    this.locked = true;
    this.ui.enableHuman(false);
    this.sfx.drawCard();
    this.ui.flyDraw(this, 0, 1).then(function () {
      var drawn = self.applyDraw(0, 1);
      self.locked = false;
      self.ui.renderHuman(self); self.ui.updateCounts(self);
      var card = drawn[0];
      if (card && self.canPlay(card)) {
        self.ui.setStatus("You may play the card you drew, or pass");
        self.ui.showPass(true);
      } else {
        self.ui.log("You drew and passed");
        self.endTurn(0, { skipNext: false, draw: 0 });
      }
    });
  };
  GameEngine.prototype.onHumanPass = function () {
    if (this.turnIndex !== 0 || this.locked || this.over) return;
    this.ui.showPass(false);
    this.endTurn(0, { skipNext: false, draw: 0 });
  };

  /* ---- core: play a card ---- */
  GameEngine.prototype.doPlay = function (idx, card, color) {
    if (this.over) return;
    var self = this;
    this.locked = true;
    this.ui.enableHuman(false);
    this.ui.showPass(false);
    var p = this.players[idx];

    this.ui.flyPlay(this, idx, card).then(function () {
      var effect = self.applyPlay(idx, card, color);
      self.sfx.playCard();
      self.ui.renderHuman(self); self.ui.renderBots(self);
      self.ui.renderDiscard(self); self.ui.updateBadges(self); self.ui.updateCounts(self);
      self.ui.log(p.name + " played " + card.label() + (card.isWild() ? " → " + self.activeColor : ""));

      if (effect.type === "reverse") { self.sfx.action("reverse"); self.ui.vfxReverse(self.direction); }

      // win?
      if (p.hand.length === 0) { return self.finish(idx); }

      // UNO vulnerability
      if (p.hand.length === 1) self.openUno(idx);

      var victim = self.nextIndex(idx, 1);

      function proceed() {
        if (effect.skipNext) { self.sfx.action("skip"); self.ui.vfxSkip(victim); }
        var steps = effect.skipNext ? 2 : 1;
        self.turnIndex = self.nextIndex(idx, steps);
        self.locked = false;
        self.beginTurn();
      }

      if (effect.draw) {
        self.sfx.action(effect.type === "wild4" ? "draw4" : "draw2");
        self.ui.flyDraw(self, victim, effect.draw).then(function () {
          self.applyDraw(victim, effect.draw);
          self.ui.renderBots(self); self.ui.renderHuman(self); self.ui.updateCounts(self);
          self.ui.log(self.players[victim].name + " drew " + effect.draw);
          proceed();
        });
      } else {
        proceed();
      }
    });
  };

  GameEngine.prototype.endTurn = function (idx, effect) {
    var steps = effect.skipNext ? 2 : 1;
    this.turnIndex = this.nextIndex(idx, steps);
    this.locked = false;
    this.beginTurn();
  };

  /* ---- UNO penalty window ---- */
  GameEngine.prototype._clearUno = function () {
    this._uno.timers.forEach(function (t) { clearTimeout(t); });
    this._uno.timers = [];
  };
  GameEngine.prototype.openUno = function (actorIdx) {
    var self = this;
    this._clearUno();
    var actor = this.players[actorIdx];
    actor.saidUno = false;
    this._uno.actor = actorIdx;
    var WINDOW = 1500;

    if (actor.isHuman) {
      if (this.autoUno || this.autoplay) { this.callUno(actorIdx); return; }
      this.ui.setUno("self");
      // bots may catch a forgetful human
      var catchDelay = this.difficulty === "hard" ? 350 : this.difficulty === "medium" ? 750 : 1250;
      this._uno.timers.push(setTimeout(function () { self._botCatch(actorIdx); }, catchDelay));
      this._uno.timers.push(setTimeout(function () { self.closeUno(); }, WINDOW));
    } else {
      // bot actor: maybe calls its own UNO; human may catch via button
      if (Math.random() < this.ai.unoSelfChance()) {
        var d = this.difficulty === "hard" ? randInt(150, 350) : randInt(400, 1000);
        this._uno.timers.push(setTimeout(function () { self.callUno(actorIdx); }, d));
      } else {
        this.ui.log(actor.name + " forgot to say UNO!");
      }
      this.ui.setUno("catch");
      this._uno.timers.push(setTimeout(function () { self.closeUno(); }, WINDOW));
    }
  };
  GameEngine.prototype.callUno = function (idx) {
    var p = this.players[idx];
    if (!p || p.saidUno || p.hand.length !== 1) return;
    p.saidUno = true;
    this.sfx.buzzer();
    this.ui.toast("UNO!", "#ffd54f");
    this.ui.shake();
    this.ui.confetti(false);
    this.ui.log(p.name + " called UNO!");
    if (this._uno.actor === idx && p.isHuman) { this.ui.setUno("off"); }
    if (this._uno.actor === idx) { this._clearUno(); if (!p.isHuman) this.ui.setUno("off"); this._uno.actor = -1; }
  };
  GameEngine.prototype.onUnoButton = function () {
    if (this.over) return;
    var idx = this._uno.actor;
    if (idx < 0) return;
    var actor = this.players[idx];
    if (actor.isHuman) {            // confirm own UNO
      if (!actor.saidUno) this.callUno(idx);
    } else {                        // catch a careless bot
      if (!actor.saidUno) this.penalize(idx, "You caught " + actor.name + "!");
    }
  };
  GameEngine.prototype._botCatch = function (humanIdx) {
    var human = this.players[humanIdx];
    if (human.saidUno || this.over) return;
    if (Math.random() < this.ai.catchChance()) {
      // find a bot to be the catcher
      var catcher = null;
      for (var i = 0; i < this.players.length; i++) if (!this.players[i].isHuman) { catcher = this.players[i]; break; }
      this.penalize(humanIdx, (catcher ? catcher.name : "A bot") + " caught you — +2!");
    }
  };
  GameEngine.prototype.penalize = function (idx, msg) {
    var self = this;
    var p = this.players[idx];
    if (p.saidUno || p.hand.length !== 1) { this.closeUno(); return; }
    this._clearUno();
    this.sfx.buzzer();
    this.ui.toast("+2", "#ff5252");
    this.ui.shake();
    this.ui.log(msg);
    this.ui.flyDraw(this, idx, 2).then(function () {
      self.applyDraw(idx, 2);
      self.ui.renderBots(self); self.ui.renderHuman(self); self.ui.updateCounts(self);
    });
    this.ui.setUno("off");
    this._uno.actor = -1;
  };
  GameEngine.prototype.closeUno = function () {
    this._clearUno();
    this.ui.setUno("off");
    this._uno.actor = -1;
  };

  /* ---- end of round ---- */
  GameEngine.prototype.finish = function (idx) {
    this.over = true;
    this.locked = true;
    this._clearUno();
    var winner = this.players[idx];
    this.sfx.win();
    this.sfx.stopMusic();
    this.ui.confetti(true);
    this.ui.shake();
    this.ui.toast(winner.isHuman ? "YOU WIN!" : winner.name + " wins", "#ffd54f");
    var pts = 0; var self = this;
    this.players.forEach(function (p, i) { if (i !== idx) p.hand.forEach(function (c) { pts += c.points(); }); });
    this.ui.setActiveSeat(this);
    setTimeout(function () {
      self.ui.showResult(
        winner.isHuman ? "You win! 🎉" : winner.name + " wins",
        winner.isHuman ? "You emptied your hand for " + pts + " points. Nicely played!"
          : "Better luck next round — " + winner.name + " banked " + pts + " points."
      );
    }, 900);
  };

  GameEngine.prototype.setAutoplay = function (on) {
    this.autoplay = on;
    if (on && this.turnIndex === 0 && !this.locked && !this.over) {
      this.ui.enableHuman(false);
      var self = this;
      setTimeout(function () { self._autoMove(); }, 400);
    }
  };

  /* ============================================================
     Null implementations (used for headless tests)
     ============================================================ */
  function NullUI() {}
  ["setTheme", "showStage", "showLobby", "renderAll", "renderBots", "renderHuman",
    "renderDiscard", "updateCounts", "updateBadges", "setStatus", "setActiveSeat",
    "enableHuman", "showPass", "log", "vfxSkip", "vfxReverse", "shake", "toast",
    "confetti", "setUno", "showResult", "hideResult"].forEach(function (m) {
      NullUI.prototype[m] = function () {};
    });
  ["flyPlay", "flyDraw", "dealAnim"].forEach(function (m) {
    NullUI.prototype[m] = function () { return Promise.resolve(); };
  });
  NullUI.prototype.promptColor = function () { return Promise.resolve(choice(COLORS)); };

  function NullSfx() {}
  ["ensure", "resume", "setTheme", "tone", "noise", "hover", "playCard", "drawCard",
    "action", "buzzer", "win", "startMusic", "stopMusic"].forEach(function (m) {
      NullSfx.prototype[m] = function () {};
    });

  /* ============================================================
     Bootstrap (browser only)
     ============================================================ */
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function initApp() {
    var ui = new UIController();
    var sfx = new AudioController();
    var engine = null;

    var el = {
      numBots: document.getElementById("numBots"),
      difficulty: document.getElementById("difficulty"),
      themeSel: document.getElementById("themeSel"),
      yourName: document.getElementById("yourName"),
      muteSfx: document.getElementById("muteSfx"),
      muteMusic: document.getElementById("muteMusic"),
      autoUno: document.getElementById("autoUno"),
      startBtn: document.getElementById("startBtn"),
      drawBtn: document.getElementById("drawBtn"),
      passBtn: document.getElementById("passBtn"),
      unoBtn: document.getElementById("unoBtn"),
      newRoundBtn: document.getElementById("newRoundBtn"),
      quitBtn: document.getElementById("quitBtn"),
      sfxBtn: document.getElementById("sfxBtn"),
      musicBtn: document.getElementById("musicBtn"),
      autoBtn: document.getElementById("autoBtn"),
      playAgainBtn: document.getElementById("playAgainBtn"),
      toLobbyBtn: document.getElementById("toLobbyBtn"),
      drawPile: document.getElementById("drawPile"),
      colorChooser: document.getElementById("colorChooser")
    };

    // restore settings
    var s = loadSettings();
    if (s.numBots) el.numBots.value = s.numBots;
    if (s.difficulty) el.difficulty.value = s.difficulty;
    if (s.theme) el.themeSel.value = s.theme;
    if (s.name) el.yourName.value = s.name;
    if (typeof s.muteSfx === "boolean") el.muteSfx.checked = s.muteSfx;
    if (typeof s.muteMusic === "boolean") el.muteMusic.checked = s.muteMusic;
    if (typeof s.autoUno === "boolean") el.autoUno.checked = s.autoUno;

    // live theme preview on the (hidden) table + persist
    function persist() {
      saveSettings({
        numBots: el.numBots.value, difficulty: el.difficulty.value,
        theme: el.themeSel.value, name: el.yourName.value,
        muteSfx: el.muteSfx.checked, muteMusic: el.muteMusic.checked,
        autoUno: el.autoUno.checked
      });
    }
    [el.numBots, el.difficulty, el.themeSel, el.yourName, el.muteSfx, el.muteMusic, el.autoUno]
      .forEach(function (n) { n.addEventListener("change", persist); });
    el.themeSel.addEventListener("change", function () { ui.setTheme(el.themeSel.value); sfx.setTheme(el.themeSel.value); });
    el.yourName.addEventListener("input", persist);

    function syncAudioButtons() {
      el.sfxBtn.setAttribute("aria-pressed", String(!sfx.muteSfx));
      el.sfxBtn.textContent = sfx.muteSfx ? "🔇 SFX" : "🔊 SFX";
      el.musicBtn.setAttribute("aria-pressed", String(!sfx.muteMusic));
      el.musicBtn.textContent = sfx.muteMusic ? "🎵 Music" : "🎶 Music";
    }

    function startGame() {
      sfx.resume();
      sfx.muteSfx = el.muteSfx.checked;
      sfx.muteMusic = el.muteMusic.checked;
      sfx.setTheme(el.themeSel.value);
      engine = new GameEngine({
        numBots: parseInt(el.numBots.value, 10),
        difficulty: el.difficulty.value,
        humanName: (el.yourName.value || "You").slice(0, 14),
        autoUno: el.autoUno.checked,
        ui: ui, sfx: sfx
      });
      engine._theme = el.themeSel.value;
      ui.engine = engine;
      ui.setTheme(el.themeSel.value);
      el.autoBtn.setAttribute("aria-pressed", "false");
      syncAudioButtons();
      if (!sfx.muteMusic) sfx.startMusic();
      engine.start();
    }

    el.startBtn.addEventListener("click", startGame);
    el.playAgainBtn.addEventListener("click", function () { ui.hideResult(); startGame(); });
    el.newRoundBtn.addEventListener("click", function () { if (engine) { ui.hideResult(); startGame(); } });
    el.toLobbyBtn.addEventListener("click", function () { ui.hideResult(); sfx.stopMusic(); ui.showLobby(); });
    el.quitBtn.addEventListener("click", function () { sfx.stopMusic(); ui.showLobby(); });

    el.drawBtn.addEventListener("click", function () { if (engine) engine.onHumanDraw(); });
    el.passBtn.addEventListener("click", function () { if (engine) engine.onHumanPass(); });
    el.unoBtn.addEventListener("click", function () { if (engine) engine.onUnoButton(); });
    el.drawPile.addEventListener("click", function () {
      if (engine && engine.turnIndex === 0 && !engine.locked && !engine.over && !engine.autoplay) engine.onHumanDraw();
    });

    el.sfxBtn.addEventListener("click", function () { sfx.muteSfx = !sfx.muteSfx; syncAudioButtons(); });
    el.musicBtn.addEventListener("click", function () {
      sfx.muteMusic = !sfx.muteMusic;
      if (sfx.muteMusic) sfx.stopMusic(); else { sfx.resume(); sfx.startMusic(); }
      syncAudioButtons();
    });
    el.autoBtn.addEventListener("click", function () {
      if (!engine) return;
      var on = engine.autoBtnState = !engine.autoplay;
      el.autoBtn.setAttribute("aria-pressed", String(on));
      engine.setAutoplay(on);
    });

    // keyboard: U = uno, D = draw, Space = autoplay toggle
    document.addEventListener("keydown", function (e) {
      if (!engine || engine.over) return;
      if (e.key === "u" || e.key === "U") engine.onUnoButton();
      else if (e.key === "d" || e.key === "D") { if (engine.turnIndex === 0) engine.onHumanDraw(); }
    });
  }

  /* ---- exports ---- */
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", initApp);
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Card: Card, Deck: Deck, AIController: AIController, GameEngine: GameEngine, COLORS: COLORS };
  }

})(typeof window !== "undefined" ? window : globalThis);
