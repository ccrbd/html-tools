/* ============================================================
   Low Card — mig33 elimination game engine
   Vanilla, object-oriented JavaScript. Async/await drives the
   20s timers, card flips and chat log so the UI never freezes.
   Settings + balance persist in localStorage ("html-tools-low-card").
   ============================================================ */
(function () {
  "use strict";

  /* ---------- helpers ---------- */
  var STORE_KEY = "html-tools-low-card";
  var DEFAULT_BALANCE = 1000;
  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function loadState() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function saveState(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  function getBalance() { var s = loadState(); return typeof s.balance === "number" ? s.balance : DEFAULT_BALANCE; }
  function setBalance(v) { var s = loadState(); s.balance = Math.max(0, Math.round(v)); saveState(s); return s.balance; }
  function fmt(n) { return Number(n).toLocaleString(); }
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  var SPEEDS = { fast: [800, 1200], normal: [1000, 2000], slow: [2000, 3000] };

  var BOT_NAMES = [
    "Bot_Alpha", "Bot_Bravo", "Bot_Charlie", "Bot_Delta", "Bot_Echo", "Bot_Foxtrot",
    "Bot_Golf", "Bot_Hotel", "Bot_India", "Bot_Juliet", "Bot_Kilo", "Bot_Lima",
    "Bot_Mike", "Bot_November", "Bot_Oscar", "Bot_Papa", "Bot_Quebec", "Bot_Romeo", "Bot_Sierra"
  ];
  var AVATARS = ["🤖", "🐯", "🦅", "🐺", "🦊", "🐲", "🦁", "🐼", "🦉", "🐸",
    "🦈", "🐙", "🦄", "👾", "🐵", "🦂", "🐝", "🦖", "🐧"];

  /* ============================================================
     CARD + DECK
     ============================================================ */
  var SUITS = [
    { sym: "♠", name: "Spades", red: false },
    { sym: "♥", name: "Hearts", red: true },
    { sym: "♦", name: "Diamonds", red: true },
    { sym: "♣", name: "Clubs", red: false }
  ];
  var RANK_LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  var RANK_WORD = { 11: "Jack", 12: "Queen", 13: "King", 14: "Ace" };

  function Card(value, suit) { this.value = value; this.suit = suit; }
  Card.prototype.label = function () { return RANK_LABEL[this.value] || String(this.value); };
  Card.prototype.word = function () { return RANK_WORD[this.value] || String(this.value); };
  Card.prototype.fullName = function () { return this.word() + " of " + this.suit.name; };

  function Deck() { this.cards = []; }
  Deck.prototype.build = function () {
    this.cards = [];
    for (var v = 2; v <= 14; v++) for (var s = 0; s < SUITS.length; s++) this.cards.push(new Card(v, SUITS[s]));
    return this;
  };
  Deck.prototype.shuffle = function () { shuffleArr(this.cards); return this; };
  Deck.prototype.draw = function () { if (!this.cards.length) this.build().shuffle(); return this.cards.pop(); };

  /* ============================================================
     SOUND — Web Audio synth (no external assets)
     ============================================================ */
  function Sfx() { this.ctx = null; this.muted = false; }
  Sfx.prototype.ensure = function () {
    if (!this.ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  };
  Sfx.prototype.tone = function (freq, dur, type, gain, when) {
    var ctx = this.ensure(); if (!ctx || this.muted) return;
    var t = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain == null ? 0.2 : gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  };
  Sfx.prototype.tick = function () { this.tone(880, 0.05, "square", 0.10); };
  Sfx.prototype.draw = function () {
    var ctx = this.ensure(); if (!ctx || this.muted) return;
    var t = ctx.currentTime, len = Math.floor(ctx.sampleRate * 0.18);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) { var k = 1 - i / len; d[i] = (Math.random() * 2 - 1) * k * k; }
    var src = ctx.createBufferSource(); src.buffer = buf;
    var bp = ctx.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(1100, t + 0.16); bp.Q.value = 0.7;
    var g = ctx.createGain(); g.gain.setValueAtTime(0.26, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + 0.2);
  };
  Sfx.prototype.reveal = function () {
    var semis = [0, 4, 7, 12], base = 220, self = this;
    semis.forEach(function (s) { self.tone(base * Math.pow(2, s / 12), 0.6, "sawtooth", 0.09, 0); });
    this.tone(110, 0.75, "sine", 0.18, 0);
  };
  Sfx.prototype.eliminate = function () {
    var ctx = this.ensure(); if (!ctx || this.muted) return;
    var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.5);
    g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.6);
  };
  Sfx.prototype.victory = function () {
    var seq = [523.25, 659.25, 783.99, 1046.5], self = this;
    seq.forEach(function (f, i) { self.tone(f, 0.5, "triangle", 0.18, i * 0.13); });
    this.tone(1046.5, 0.85, "triangle", 0.15, seq.length * 0.13);
  };

  /* ============================================================
     PLAYER
     ============================================================ */
  function Player(name, isHuman, avatar) {
    this.name = name; this.isHuman = !!isHuman; this.avatar = avatar;
    this.eliminated = false; this.currentCard = null;
    this.seatEl = null; this.cardEl = null; this.stateEl = null;
  }

  /* ============================================================
     GAME
     ============================================================ */
  var CIRC = 326.726;

  function Game() {
    // dom
    this.lobby = $("lobby"); this.stage = $("stage"); this.arena = $("arena");
    this.seatsEl = $("seats"); this.feed = $("chatFeed"); this.chatOnline = $("chatOnline");
    this.statusEl = $("statusLine"); this.roundBadge = $("roundBadge");
    this.potBadge = $("potBadge"); this.balBadge = $("balBadge");
    this.deckBtn = $("drawDeck"); this.fx = $("fxLayer");
    this.timerWrap = $("timerWrap"); this.timerNum = $("timerNum");
    this.ringFill = this.timerWrap.querySelector(".ring-fill");
    this.footRow = $("footRow"); this.spectateBar = $("spectateBar");
    this.resultOverlay = $("resultOverlay");
    this.sfxBtn = $("sfxBtn"); this.autoBtn = $("autoBtn"); this.fsBtn = $("fsBtn");
    // state
    this.sfx = new Sfx(); this.deck = new Deck();
    this.players = []; this.active = []; this.human = null;
    this.round = 0; this.numPlayers = 4; this.stake = 50; this.potTotal = 0;
    this.autoPlay = false; this.speed = SPEEDS.normal;
    this.roundSeconds = 20; this.tieSeconds = 10;
    this.epoch = 0; this.fast = false; this.spectating = false;
    this._timers = []; this._tick = null;
    this._needed = 0; this._drawn = 0; this._phaseResolve = null; this._humanCanDraw = false;
  }

  /* ---------- fast-aware wait ---------- */
  Game.prototype.wait = function (ms) { return sleep(this.fast ? 0 : ms); };
  Game.prototype.botDelay = function () { return this.fast ? 0 : rand(this.speed[0], this.speed[1]); };

  /* ---------- settings + economy ---------- */
  Game.prototype.readSettings = function () {
    var s = loadState();
    s.name = ($("yourName").value || "You").trim().slice(0, 12) || "You";
    s.players = +$("playerSel").value;
    s.stake = +$("stakeSel").value;
    s.theme = $("themeSel").value;
    s.speed = $("speedSel").value;
    s.autoPlay = $("autoPlay").checked;
    s.muteSfx = $("muteSfx").checked;
    if (typeof s.balance !== "number") s.balance = DEFAULT_BALANCE;
    saveState(s);
    return s;
  };
  Game.prototype.restoreSettings = function () {
    var s = loadState();
    if (s.name) $("yourName").value = s.name;
    if (s.players) $("playerSel").value = String(s.players);
    if (s.stake) $("stakeSel").value = String(s.stake);
    if (s.theme) $("themeSel").value = s.theme;
    if (s.speed) $("speedSel").value = s.speed;
    if (typeof s.autoPlay === "boolean") $("autoPlay").checked = s.autoPlay;
    if (typeof s.muteSfx === "boolean") $("muteSfx").checked = s.muteSfx;
    this.arena.dataset.lcTheme = $("themeSel").value || "arcade";
    this.updateEconomy();
  };
  Game.prototype.updateEconomy = function () {
    var bal = getBalance();
    var stake = +$("stakeSel").value;
    var n = +$("playerSel").value;
    $("balanceVal").textContent = fmt(bal);
    $("potPreview").innerHTML = "Pot this game: <strong>💰 " + fmt(stake * n) +
      "</strong> · you ante <strong>💰 " + fmt(stake) + "</strong>";
    var broke = bal < stake;
    $("startBtn").disabled = broke;
    $("warnNote").hidden = !broke;
  };

  /* ---------- chat + status ---------- */
  Game.prototype.chat = function (cls, who, text) {
    var line = document.createElement("div");
    line.className = "chat-line " + cls;
    var time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    line.innerHTML = '<span class="chat-time">' + time + "</span>" +
      '<span class="who">[' + esc(who) + "]</span> " + esc(text);
    this.feed.appendChild(line);
    this.feed.scrollTop = this.feed.scrollHeight;
  };
  Game.prototype.setStatus = function (html) { this.statusEl.innerHTML = html; };

  /* ---------- fx ---------- */
  Game.prototype.toast = function (text, cls) {
    if (this.fast) return;
    var t = document.createElement("div");
    t.className = "toast " + (cls || ""); t.textContent = text;
    this.fx.appendChild(t);
    setTimeout(function () { t.remove(); }, 1400);
  };
  Game.prototype.shatterAt = function (seatEl) {
    if (this.fast) return;
    var a = this.arena.getBoundingClientRect(), r = seatEl.getBoundingClientRect();
    var cx = r.left - a.left + r.width / 2, cy = r.top - a.top + r.height / 2;
    for (var i = 0; i < 12; i++) {
      var sh = document.createElement("div"); sh.className = "shard";
      sh.style.left = cx + "px"; sh.style.top = cy + "px";
      this.fx.appendChild(sh);
      (function (sh) {
        var ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * 90;
        var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 30;
        sh.style.transition = "transform .8s cubic-bezier(.2,.6,.3,1), opacity .8s ease";
        requestAnimationFrame(function () {
          sh.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (Math.random() * 360) + "deg)";
          sh.style.opacity = "0";
        });
        setTimeout(function () { sh.remove(); }, 850);
      })(sh);
    }
  };

  /* ---------- seats / cards ---------- */
  Game.prototype.buildSeats = function () {
    var n = this.players.length;
    var size = n <= 4 ? "size-lg" : (n <= 10 ? "size-md" : "size-sm");
    this.seatsEl.className = "seats " + size;
    this.seatsEl.innerHTML = "";
    var self = this;
    this.players.forEach(function (p) {
      var seat = document.createElement("div");
      seat.className = "seat" + (p.isHuman ? " is-human" : "");
      seat.innerHTML =
        '<div class="seat-avatar">' + p.avatar + "</div>" +
        '<div class="seat-name">' + esc(p.name) + "</div>" +
        '<div class="card empty"><div class="card-inner">' +
          '<div class="card-face card-back"></div>' +
          '<div class="card-face card-front"></div>' +
        "</div></div>" +
        '<div class="seat-state">ready</div>';
      self.seatsEl.appendChild(seat);
      p.seatEl = seat;
      p.cardEl = seat.querySelector(".card");
      p.stateEl = seat.querySelector(".seat-state");
    });
  };
  Game.prototype.resetCard = function (p) {
    p.currentCard = null;
    p.cardEl.className = "card empty";
    var front = p.cardEl.querySelector(".card-front");
    front.innerHTML = ""; front.classList.remove("red");
  };
  Game.prototype.fillCard = function (p, card) {
    var front = p.cardEl.querySelector(".card-front");
    front.innerHTML = '<span class="rank">' + card.label() + "</span>" +
      '<span class="suit">' + card.suit.sym + "</span>";
    front.classList.toggle("red", card.suit.red);
    p.cardEl.classList.remove("empty", "flipped", "lowest", "winner-card");
    p.cardEl.classList.add("dealing");
  };

  /* ---------- timer ---------- */
  Game.prototype.setRing = function (rem, total) {
    this.ringFill.style.strokeDashoffset = (CIRC * (1 - rem / total)).toFixed(1);
  };
  Game.prototype.startTimer = function (seconds, onTimeout) {
    this.stopTimer();
    this.timerWrap.style.visibility = "visible";
    this.timerWrap.classList.remove("urgent");
    this.timerNum.textContent = seconds;
    this.ringFill.style.transition = "none";
    this.setRing(seconds, seconds);
    void this.ringFill.getBoundingClientRect();
    this.ringFill.style.transition = "";
    var rem = seconds, self = this;
    this._tick = setInterval(function () {
      rem--;
      self.timerNum.textContent = Math.max(0, rem);
      self.setRing(Math.max(0, rem), seconds);
      if (rem <= 5 && rem > 0) { self.sfx.tick(); self.timerWrap.classList.add("urgent"); }
      if (rem <= 0) { self.stopTimer(); if (onTimeout) onTimeout(); }
    }, 1000);
  };
  Game.prototype.stopTimer = function () {
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
    this.timerWrap.classList.remove("urgent");
  };
  Game.prototype.hideTimer = function () { this.stopTimer(); this.timerWrap.style.visibility = "hidden"; };

  /* ---------- draw phase ---------- */
  Game.prototype.drawPhase = function (group, seconds) {
    var self = this, myEpoch = this.epoch;
    return new Promise(function (resolve) {
      self._needed = group.length; self._drawn = 0; self._phaseResolve = resolve;

      self.players.forEach(function (p) {
        if (group.indexOf(p) > -1) {
          self.resetCard(p); p.stateEl.textContent = "to draw…";
          p.seatEl.classList.add("active"); p.seatEl.classList.remove("safe");
        } else if (!p.eliminated) {
          p.seatEl.classList.remove("active"); p.seatEl.classList.add("safe");
          p.stateEl.textContent = "safe";
        }
      });

      // bots draw with delay
      group.forEach(function (p) {
        if (p.isHuman) return;
        var id = setTimeout(function () { if (myEpoch !== self.epoch) return; self.doDraw(p); }, self.botDelay());
        self._timers.push(id);
      });

      var humanInPhase = group.indexOf(self.human) > -1 && !self.human.eliminated;
      if (humanInPhase) {
        if (self.autoPlay) {
          self.hideTimer();
          self.deckBtn.disabled = true;
          self.deckBtn.querySelector(".deck-sub").textContent = "auto";
          self.setStatus("🤖 Auto-play is drawing for you…");
          var aid = setTimeout(function () { if (myEpoch !== self.epoch) return; self.doDraw(self.human); }, rand(700, 1500));
          self._timers.push(aid);
        } else {
          self._humanCanDraw = true;
          self.deckBtn.disabled = false;
          self.deckBtn.querySelector(".deck-sub").textContent = "tap me";
          self.setStatus('Your turn — <span class="hl">tap the deck!</span>');
          self.startTimer(seconds, function () {
            if (myEpoch !== self.epoch) return;
            if (!self.human.currentCard) {
              self.chat("system", "System", self.human.name + " ran out of time — auto-drawn.");
              self.doDraw(self.human);
            }
          });
        }
      } else {
        self.hideTimer();
        self.deckBtn.disabled = true;
        self.deckBtn.querySelector(".deck-sub").textContent = "watching";
        if (!self.spectating) self.setStatus("Watching the table…");
      }
    });
  };

  Game.prototype.doDraw = function (player) {
    if (player.currentCard) return;
    var card = this.deck.draw();
    player.currentCard = card;
    this.fillCard(player, card);
    player.stateEl.textContent = "drew a card";
    this.sfx.draw();
    this.chat(player.isHuman ? "you" : "draw", player.name, "has drawn a card");

    if (player.isHuman) {
      this._humanCanDraw = false;
      this.deckBtn.disabled = true;
      this.deckBtn.querySelector(".deck-sub").textContent = "drawn";
      this.stopTimer();
      this.timerWrap.classList.remove("urgent");
    }

    this._drawn++;
    if (this._drawn < this._needed && !this.spectating) {
      this.setStatus(this._drawn === this._needed - 1 ? "Waiting for the last player…" : "Cards being drawn…");
    }
    if (this._drawn >= this._needed && this._phaseResolve) {
      var r = this._phaseResolve; this._phaseResolve = null; r();
    }
  };

  Game.prototype.humanDraw = function () {
    if (this._humanCanDraw && this.human && !this.human.currentCard) this.doDraw(this.human);
  };

  /* ---------- reveal ---------- */
  Game.prototype.reveal = function (group) {
    var self = this;
    this.setStatus("Showdown — cards flip!");
    this.sfx.reveal();
    group.forEach(function (p) { p.cardEl.classList.remove("dealing"); p.cardEl.classList.add("flipped"); });
    return this.wait(160).then(function () {
      group.forEach(function (p) {
        var c = p.currentCard;
        self.chat(p.isHuman ? "you" : "draw", p.name, "has drawn a " + c.fullName());
        p.stateEl.textContent = c.label() + c.suit.sym;
      });
    });
  };

  /* ---------- elimination resolution (handles ties) ---------- */
  Game.prototype.resolveElimination = function (group) {
    var self = this, myEpoch = this.epoch;
    var min = Math.min.apply(null, group.map(function (p) { return p.currentCard.value; }));
    var tied = group.filter(function (p) { return p.currentCard.value === min; });
    tied.forEach(function (p) { p.cardEl.classList.add("lowest"); });

    return this.wait(450).then(function () {
      if (tied.length === 1) return tied[0];
      var lbl = tied[0].currentCard.label();
      self.chat("system", "System",
        "Tie on " + lbl + "! Sudden death: " + tied.map(function (p) { return p.name; }).join(", ") + ".");
      self.toast("SUDDEN DEATH", "");
      self.setStatus('<span class="hl">Sudden death</span> — tied players redraw!');
      return self.wait(1100).then(function () {
        if (myEpoch !== self.epoch) return tied[0];
        return self.drawPhase(tied, self.tieSeconds).then(function () {
          if (myEpoch !== self.epoch) return tied[0];
          return self.reveal(tied);
        }).then(function () { return self.wait(780); })
          .then(function () { if (myEpoch !== self.epoch) return tied[0]; return self.resolveElimination(tied); });
      });
    });
  };

  Game.prototype.eliminate = function (player) {
    var self = this;
    this.sfx.eliminate();
    player.seatEl.classList.remove("active", "safe");
    player.cardEl.classList.add("lowest");
    this.setStatus('<span class="hl">' + esc(player.name) + "</span> holds the lowest card!");
    return this.wait(450).then(function () {
      self.shatterAt(player.seatEl);
      player.seatEl.classList.add("shatter");
      self.chat("elim", "System", player.name + " has been eliminated!");
      self.toast((player.isHuman ? "YOU ARE" : player.name + " is") + " OUT", "bad");
      return self.wait(820);
    }).then(function () {
      player.eliminated = true;
      player.seatEl.classList.remove("shatter");
      player.seatEl.classList.add("eliminated");
      player.stateEl.textContent = "eliminated";
      self.active = self.active.filter(function (p) { return p !== player; });
      self.chatOnline.textContent = self.active.length + " online";
      if (player.isHuman && self.active.length > 1) self.enterSpectator();
    });
  };

  /* ---------- spectator mode ---------- */
  Game.prototype.enterSpectator = function () {
    this.spectating = true;
    this.hideTimer();
    this.footRow.hidden = true;
    this.spectateBar.hidden = false;
    this.setStatus("You’re out — fast-forward, or keep watching.");
    this.chat("system", "System", "You are out. Hit “Simulate to end” to settle instantly, or keep watching.");
  };
  Game.prototype.exitSpectatorUI = function () {
    this.spectateBar.hidden = true;
    this.footRow.hidden = false;
  };

  /* ---------- one round ---------- */
  Game.prototype.playRound = function () {
    var self = this, myEpoch = this.epoch;
    this.round++;
    this.roundBadge.textContent = "Round " + this.round + " · " + this.active.length + " players";
    this.chat("system", "System", "Round " + this.round + " — " + this.active.length + " players. Draw!");

    this.drawPhase(this.active.slice(), this.roundSeconds).then(function () {
      if (myEpoch !== self.epoch) return;
      self.setStatus("Showdown!");
      return self.wait(250).then(function () { return self.reveal(self.active); });
    }).then(function () {
      if (myEpoch !== self.epoch) return;
      return self.wait(760);
    }).then(function () {
      if (myEpoch !== self.epoch) return;
      return self.resolveElimination(self.active.slice());
    }).then(function (loser) {
      if (myEpoch !== self.epoch || !loser) return;
      return self.eliminate(loser);
    }).then(function () {
      if (myEpoch !== self.epoch) return;
      if (self.active.length <= 1) return self.finish(self.active[0]);
      self.chat("system", "System", self.active.length + " players remain.");
      return self.wait(950).then(function () { if (myEpoch !== self.epoch) return; self.playRound(); });
    });
  };

  /* ---------- end of match ---------- */
  Game.prototype.finish = function (winner) {
    var self = this;
    this.hideTimer();
    this.deckBtn.disabled = true;
    this.exitSpectatorUI();
    this.players.forEach(function (p) { p.seatEl.classList.remove("active", "safe"); });
    if (winner) {
      winner.seatEl.classList.add("active");
      if (winner.cardEl) winner.cardEl.classList.add("winner-card");
      winner.stateEl.textContent = "WINNER";
    }
    var youWon = !!(winner && winner.isHuman);

    var bal = getBalance();
    if (youWon) bal = setBalance(bal + this.potTotal);
    this.balBadge.textContent = "💵 " + fmt(bal);

    if (youWon) this.sfx.victory();
    this.chat("win", "System", winner
      ? winner.name + " survives and wins the pot of " + fmt(this.potTotal) + " credits! 🏆"
      : "No winner.");
    this.setStatus(youWon ? "🏆 You win the pot!" : (winner ? winner.name + " wins." : ""));
    this.fast = false; // settle
    this.toast(youWon ? "YOU WIN!" : (winner ? winner.name + " WINS" : ""), youWon ? "good" : "");

    return sleep(600).then(function () {
      $("resultEmoji").textContent = youWon ? "🏆" : "💀";
      $("resultTitle").textContent = youWon ? "You win the pot!" : (winner ? winner.name + " wins" : "Game over");
      $("resultBody").textContent = youWon
        ? "You outlasted " + (self.numPlayers - 1) + " rivals and scooped the " + fmt(self.potTotal) + " pot."
        : "You were knocked out — " + (winner ? winner.name : "a bot") + " took the " + fmt(self.potTotal) + " pot.";
      $("resultBalance").innerHTML = youWon
        ? "Net <strong>+" + fmt(self.potTotal - self.stake) + "</strong> · Balance: 💵 " + fmt(bal)
        : "Net <strong>−" + fmt(self.stake) + "</strong> · Balance: 💵 " + fmt(bal);
      self.resultOverlay.hidden = false;
      self.updateEconomy();
    });
  };

  /* ---------- lifecycle ---------- */
  Game.prototype.cleanup = function () {
    this._timers.forEach(function (id) { clearTimeout(id); });
    this._timers = []; this.stopTimer();
    this._phaseResolve = null; this._humanCanDraw = false;
  };

  Game.prototype.start = function () {
    var s = this.readSettings();
    this.numPlayers = s.players; this.stake = s.stake;

    var bal = getBalance();
    if (bal < this.stake) { this.updateEconomy(); return; } // safety guard

    this.epoch++; this.cleanup();
    this.fast = false; this.spectating = false;
    this.exitSpectatorUI();

    bal = setBalance(bal - this.stake);          // ante
    this.potTotal = this.stake * this.numPlayers;
    this.balBadge.textContent = "💵 " + fmt(bal);
    this.potBadge.textContent = "💰 " + fmt(this.potTotal);

    this.arena.dataset.lcTheme = s.theme;
    this.autoPlay = s.autoPlay; this.sfx.muted = s.muteSfx;
    this.autoBtn.setAttribute("aria-pressed", String(this.autoPlay));
    this.sfxBtn.setAttribute("aria-pressed", String(!s.muteSfx));
    this.sfxBtn.textContent = s.muteSfx ? "🔇" : "🔊";
    this.speed = SPEEDS[s.speed] || SPEEDS.normal;

    // build players: human + (n-1) bots
    var pool = shuffleArr(BOT_NAMES.slice());
    this.players = [new Player(s.name, true, "🧑")];
    for (var i = 0; i < this.numPlayers - 1; i++) {
      this.players.push(new Player(pool[i % pool.length], false, AVATARS[i % AVATARS.length]));
    }
    this.human = this.players[0];
    this.active = this.players.slice();
    this.round = 0;
    this.deck.build().shuffle();

    this.buildSeats();
    this.feed.innerHTML = "";
    this.chatOnline.textContent = this.numPlayers + " online";
    this.resultOverlay.hidden = true;
    this.lobby.hidden = true;
    this.stage.hidden = false;
    this.hideTimer();

    this.sfx.ensure();
    this.chat("system", "System",
      "Welcome to the lowcard room — " + this.numPlayers + " players, pot " + fmt(this.potTotal) +
      ". You anted " + fmt(this.stake) + ". Good luck, " + this.human.name + "!");

    var self = this;
    sleep(700).then(function () { self.playRound(); });
  };

  Game.prototype.toLobby = function () {
    this.epoch++; this.cleanup();
    this.fast = false; this.spectating = false;
    this.exitSpectatorUI();
    this.resultOverlay.hidden = true;
    this.stage.hidden = true;
    this.lobby.hidden = false;
    this.updateEconomy();
  };

  Game.prototype.toggleFullscreen = function () {
    var el = this.arena;
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    } else {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  };

  /* ============================================================
     WIRING
     ============================================================ */
  var game = new Game();
  game.restoreSettings();

  ["yourName", "themeSel", "playerSel", "stakeSel", "speedSel", "autoPlay", "muteSfx"].forEach(function (id) {
    var el = $(id);
    el.addEventListener("change", function () {
      game.readSettings();
      if (id === "themeSel") game.arena.dataset.lcTheme = el.value;
      if (id === "playerSel" || id === "stakeSel") game.updateEconomy();
    });
  });

  $("topUpBtn").addEventListener("click", function () { setBalance(getBalance() + 1000); game.updateEconomy(); });
  $("startBtn").addEventListener("click", function () { game.start(); });
  $("playAgainBtn").addEventListener("click", function () { game.start(); });
  $("toLobbyBtn").addEventListener("click", function () { game.toLobby(); });
  $("quitBtn").addEventListener("click", function () { game.toLobby(); });

  game.deckBtn.addEventListener("click", function () { game.humanDraw(); });

  $("simBtn").addEventListener("click", function () {
    game.fast = true;
    game.exitSpectatorUI();
    game.setStatus("⏩ Simulating to the end…");
  });
  $("watchBtn").addEventListener("click", function () { game.exitSpectatorUI(); });

  game.sfxBtn.addEventListener("click", function () {
    game.sfx.muted = !game.sfx.muted;
    game.sfxBtn.setAttribute("aria-pressed", String(!game.sfx.muted));
    game.sfxBtn.textContent = game.sfx.muted ? "🔇" : "🔊";
    $("muteSfx").checked = game.sfx.muted;
    saveState(Object.assign(loadState(), { muteSfx: game.sfx.muted }));
    if (!game.sfx.muted) game.sfx.tick();
  });

  game.autoBtn.addEventListener("click", function () {
    game.autoPlay = !game.autoPlay;
    game.autoBtn.setAttribute("aria-pressed", String(game.autoPlay));
    $("autoPlay").checked = game.autoPlay;
    saveState(Object.assign(loadState(), { autoPlay: game.autoPlay }));
    if (game.autoPlay && game._humanCanDraw && game.human && !game.human.currentCard) {
      game.stopTimer();
      game.deckBtn.disabled = true;
      game.deckBtn.querySelector(".deck-sub").textContent = "auto";
      game.setStatus("🤖 Auto-play is drawing for you…");
      setTimeout(function () { if (game.human && !game.human.currentCard) game.doDraw(game.human); }, 500);
    }
  });

  game.fsBtn.addEventListener("click", function () { game.toggleFullscreen(); });
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      game.fsBtn.setAttribute("aria-pressed", String(on));
      game.fsBtn.textContent = on ? "🗗" : "⛶";
    });
  });

  window.__lowcard = game;
})();
