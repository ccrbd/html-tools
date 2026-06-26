/* ============================================================
   Chess tool — UI, clocks, sound, persistence.
   Uses the engine in engine.js (window.Chess).
   ============================================================ */
(function () {
  "use strict";
  var C = window.Chess;
  var STORE = "html-tools-chess";

  /* ---------- SVG pieces (fill-only silhouettes; CSS adds outline) ---------- */
  var PIECES = {
    P: '<circle class="pc-body" cx="22.5" cy="12.5" r="4.9"/>' +
       '<path class="pc-body" d="M16.5 31C16.5 24 19 20.4 22.5 20.4S28.5 24 28.5 31Z"/>' +
       '<path class="pc-body" d="M13 39.5C13 34.4 17.2 32.4 22.5 32.4S32 34.4 32 39.5Z"/>',
    R: '<path class="pc-body" d="M12.5 11.5H16V14H19V11.5H26V14H29V11.5H32.5V18H12.5Z"/>' +
       '<path class="pc-body" d="M15 18 14 31H31L30 18Z"/>' +
       '<path class="pc-body" d="M11.5 39.5H33.5L31 31H14Z"/>' +
       '<path class="pc-line" d="M14 31H31" stroke-width="1.1" fill="none"/>',
    N: '<path class="pc-body" d="M22 10C32.5 11 38.5 18 38 39L15 39C15 30 25 32.5 23 18"/>' +
       '<path class="pc-body" d="M24 18C24.38 20.91 18.45 25.37 16 27 13 29 13.18 31.34 11 31 ' +
       '9.96 30.06 12.41 27.96 11 28 10 28 11.19 29.23 10 30 9 30 6 31 6 26 6 24 12 14 12 14 ' +
       '12 14 13.89 12.1 14 10.5 13.5 9.5 13.5 8.5 13.5 8.5 13.5 8.5 14.5 6.5 16.5 10 16.5 10 ' +
       '18.5 10 18.5 10 18.5 10 19.28 8.01 21 7 22 7 22 10 22 10"/>' +
       '<circle class="pc-line" cx="9" cy="25.5" r="0.8"/>' +
       '<ellipse class="pc-line" cx="14.2" cy="15.7" rx="0.7" ry="1.5" transform="rotate(28 14.2 15.7)"/>',
    B: '<circle class="pc-body" cx="22.5" cy="8.6" r="2.5"/>' +
       '<path class="pc-body" d="M22.5 10.8C16.8 13.4 16.2 22 22.5 26.2 28.8 22 28.2 13.4 22.5 10.8Z"/>' +
       '<path class="pc-body" d="M17.3 26.2H27.7L29.3 31H15.7Z"/>' +
       '<path class="pc-body" d="M13 39.5C13 34.4 17.2 32.4 22.5 32.4S32 34.4 32 39.5Z"/>' +
       '<path class="pc-line" d="M22.5 14.2 25 18.4" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
    Q: '<circle class="pc-body" cx="9" cy="15.8" r="2"/><circle class="pc-body" cx="15.5" cy="12.6" r="2"/>' +
       '<circle class="pc-body" cx="22.5" cy="11.7" r="2.1"/><circle class="pc-body" cx="29.5" cy="12.6" r="2"/>' +
       '<circle class="pc-body" cx="36" cy="15.8" r="2"/>' +
       '<path class="pc-body" d="M9 16.5 13 29H32L36 16.5 29.5 23.5 26 13.8 22.5 23.8 19 13.8 15.5 23.5Z"/>' +
       '<path class="pc-body" d="M13 29H32L31 33H14Z"/>' +
       '<path class="pc-body" d="M14 33C12.3 37 15.5 39.6 22.5 39.6 29.5 39.6 32.7 37 31 33Z"/>' +
       '<path class="pc-line" d="M13.6 30.8H31.4" stroke-width="1.1" fill="none"/>',
    K: '<path class="pc-body" d="M12.5 30C12.5 30 3.5 25.5 6.5 19.5 10.5 13 20 16 22.5 23.5' +
       'L22.5 27 22.5 23.5C25 16 34.5 13 38.5 19.5 41.5 25.5 32.5 30 32.5 30Z"/>' +
       '<path class="pc-body" d="M22.5 25C22.5 25 27 17.5 25.5 14.5 25.5 14.5 24.5 12 22.5 12 ' +
       '20.5 12 19.5 14.5 19.5 14.5 18 17.5 22.5 25 22.5 25Z"/>' +
       '<path class="pc-body" d="M11.5 30H33.5C33.5 36.5 30 39 22.5 39 15 39 11.5 36.5 11.5 30Z"/>' +
       '<path class="pc-body" d="M21.4 5.5H23.6V8H25.9V10.2H23.6V13.4H21.4V10.2H19.1V8H21.4Z"/>' +
       '<path class="pc-line" d="M13 32.8C18 31.1 27 31.1 32 32.8M13 35.8C18 34.1 27 34.1 32 35.8" stroke-width="1" fill="none"/>'
  };
  function pieceSVG(piece, extraClass) {
    if (!piece) return "";
    var color = piece[0], type = piece[1];
    return '<svg class="piece ' + color + ' ' + (extraClass || "") +
      '" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">' + PIECES[type] + '</svg>';
  }

  /* ---------- Sound (WebAudio, synthesised — no files) ---------- */
  var Audio = (function () {
    var ctx = null, on = true;
    function ensure() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctx = new AC();
      }
      if (ctx && ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function tone(freq, dur, type, gain, when) {
      var c = ensure(); if (!c || !on) return;
      var t0 = c.currentTime + (when || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.18, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, gain) {
      var c = ensure(); if (!c || !on) return;
      var n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = c.createBufferSource(); s.buffer = buf;
      var g = c.createGain(); g.gain.value = gain || 0.12;
      var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1100;
      s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    }
    return {
      unlock: function () { ensure(); },
      setOn: function (v) { on = v; },
      isOn: function () { return on; },
      move: function () { tone(300, 0.08, "triangle", 0.16); noise(0.05, 0.06); },
      capture: function () { noise(0.12, 0.16); tone(170, 0.12, "sawtooth", 0.12); },
      castle: function () { tone(300, 0.07, "triangle", 0.14); tone(360, 0.07, "triangle", 0.12, 0.09); },
      check: function () { tone(660, 0.1, "square", 0.12); tone(880, 0.12, "square", 0.1, 0.1); },
      win: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.16, "triangle", 0.14, i * 0.11); }); },
      lose: function () { [440, 349, 294, 220].forEach(function (f, i) { tone(f, 0.2, "sine", 0.14, i * 0.13); }); },
      draw: function () { tone(440, 0.18, "sine", 0.12); tone(440, 0.18, "sine", 0.1, 0.2); }
    };
  })();

  /* ---------- DOM refs ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $("board"), boardWrap = $("boardWrap");
  var elLevel = $("level"), elTheme = $("boardTheme"), elTime = $("timeCtl"), elSide = $("side");

  /* ---------- Persistent settings + record ---------- */
  var prefs = loadPrefs();
  function loadPrefs() {
    var d = { level: "medium", theme: "green", time: "10", side: "w", sound: true,
      record: { w: 0, l: 0, d: 0 } };
    try {
      var s = JSON.parse(localStorage.getItem(STORE));
      if (s) { for (var k in d) if (s[k] !== undefined) d[k] = s[k];
        if (s.record) d.record = s.record; }
    } catch (e) {}
    return d;
  }
  function savePrefs() {
    prefs.level = elLevel.value; prefs.theme = elTheme.value;
    prefs.time = elTime.value; prefs.side = elSide.value;
    prefs.sound = Audio.isOn();
    try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {}
  }

  // apply saved settings to controls
  elLevel.value = prefs.level; elTheme.value = prefs.theme;
  elTime.value = prefs.time; elSide.value = prefs.side;
  boardWrap.setAttribute("data-board", prefs.theme);
  Audio.setOn(prefs.sound);
  updateSoundIcon();
  renderRecord();

  /* ---------- Game state ---------- */
  var G = null;
  function freshGame() {
    var side = elSide.value;
    if (side === "r") side = Math.random() < 0.5 ? "w" : "b";
    var minutes = parseInt(elTime.value, 10);
    var ms = minutes > 0 ? minutes * 60000 : 0;
    return {
      state: C.newGame(),
      playerColor: side,
      aiColor: side === "w" ? "b" : "w",
      level: elLevel.value,
      flip: side === "b",
      selected: -1,
      legal: [],
      lastMove: null,
      capByW: [], capByB: [],
      history: [],            // snapshots for undo (player-to-move checkpoints)
      moveList: [],
      clockMs: ms,
      clock: { w: ms, b: ms },
      ticking: false,
      lastTick: 0,
      over: false,
      thinking: false
    };
  }

  /* ---------- Rendering ---------- */
  function displayOrder() {
    var order = [];
    for (var i = 0; i < 64; i++) order.push(i);
    if (G.flip) order.reverse();
    return order;
  }

  function render() {
    var b = G.state.board, order = displayOrder();
    var checkSq = -1;
    if (!G.over && C.inCheck(G.state, G.state.turn)) checkSq = C.findKing(b, G.state.turn);
    var legalTo = {};
    G.legal.forEach(function (m) { legalTo[m.to] = m.captured || m.flag === "ep" ? "cap" : "move"; });

    var html = "";
    for (var k = 0; k < 64; k++) {
      var idx = order[k];
      var r = idx >> 3, c = idx & 7;
      var isLight = (r + c) % 2 === 0;
      var cls = "sq " + (isLight ? "light" : "dark");
      if (idx === G.selected) cls += " sel";
      if (G.lastMove && (idx === G.lastMove.from || idx === G.lastMove.to)) cls += " last";
      if (idx === checkSq) cls += " check";
      if (legalTo[idx] === "cap") cls += " cap";
      var inner = "";
      if (legalTo[idx]) inner += '<span class="dot"></span>';
      inner += pieceSVG(b[idx]);
      // coordinates on edges (relative to display)
      var lastRow = G.flip ? 0 : 7, firstCol = G.flip ? 7 : 0;
      if (r === lastRow) inner += '<span class="coord file">' + "abcdefgh"[c] + '</span>';
      if (c === firstCol) inner += '<span class="coord rank">' + (8 - r) + '</span>';
      html += '<div class="' + cls + '" data-idx="' + idx + '">' + inner + '</div>';
    }
    boardEl.innerHTML = html;

    renderCaptured();
    renderClocks();
    renderBars();
    $("moveCount").textContent = G.moveList.length;
    renderMoveList();
  }

  function renderBars() {
    // top bar = whoever is NOT at the bottom; bottom is the player.
    var playerIsBottom = true;
    $("botName").textContent = "You";
    $("botAvatar").textContent = G.playerColor === "w" ? "♙" : "♟";
    $("topName").textContent = "Computer (" + cap(G.level) + ")";
    $("topAvatar").textContent = "🤖";
    function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  }

  function materialOf(list) {
    var v = { P:1, N:3, B:3, R:5, Q:9 }, s = 0;
    list.forEach(function (p) { s += v[p[1]] || 0; });
    return s;
  }
  function renderCaptured() {
    // player captures opponent pieces; show them next to the capturer.
    var playerCaps = G.playerColor === "w" ? G.capByW : G.capByB;
    var aiCaps = G.playerColor === "w" ? G.capByB : G.capByW;
    var pAdv = materialOf(playerCaps) - materialOf(aiCaps);
    $("botCaptured").innerHTML = capHTML(playerCaps) + advTag(pAdv);
    $("topCaptured").innerHTML = capHTML(aiCaps) + advTag(-pAdv);
  }
  function capHTML(list) {
    // sort by value for tidy display
    var ord = { Q:5, R:4, B:3, N:2, P:1 };
    var sorted = list.slice().sort(function (a, b) { return ord[b[1]] - ord[a[1]]; });
    return sorted.map(function (p) { return pieceSVG(p); }).join("");
  }
  function advTag(adv) { return adv > 0 ? '<span class="adv">+' + adv + '</span>' : ""; }

  function fmtClock(ms) {
    if (ms <= 0) return "0:00";
    var s = Math.ceil(ms / 1000);
    var m = Math.floor(s / 60); s = s % 60;
    if (m === 0 && ms < 20000) {
      var tenths = Math.floor((ms % 1000) / 100);
      return "0:" + (s < 10 ? "0" : "") + s + "." + tenths;
    }
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function renderClocks() {
    // bottom bar = the player; top bar = the AI
    var pc = G.playerColor, ac = G.aiColor;
    $("botBar").classList.toggle("turn", G.state.turn === pc && !G.over);
    $("topBar").classList.toggle("turn", G.state.turn === ac && !G.over);
    var botClock = $("botClock"), topClock = $("topClock");
    if (G.clockMs === 0) {
      botClock.textContent = "∞"; topClock.textContent = "∞";
      botClock.className = "clock off"; topClock.className = "clock off";
      return;
    }
    var pMs = G.clock[pc], aMs = G.clock[ac];
    botClock.textContent = fmtClock(pMs);
    topClock.textContent = fmtClock(aMs);
    botClock.className = "clock" + (G.state.turn === pc && !G.over ? " active" : "") + (pMs < 30000 ? " low" : "");
    topClock.className = "clock" + (G.state.turn === ac && !G.over ? " active" : "") + (aMs < 30000 ? " low" : "");
  }

  function renderMoveList() {
    var ml = $("movesList");
    if (!G.moveList.length) { ml.innerHTML = '<span class="empty">Moves will appear here.</span>'; return; }
    var out = "";
    for (var i = 0; i < G.moveList.length; i += 2) {
      out += '<span class="mv"><span class="mn">' + (i / 2 + 1) + '.</span>' + G.moveList[i] + '</span> ';
      if (G.moveList[i + 1]) out += '<span class="mv">' + G.moveList[i + 1] + '</span> ';
    }
    ml.innerHTML = out;
    ml.scrollTop = ml.scrollHeight;
  }

  function renderRecord() {
    $("recWins").textContent = prefs.record.w;
    $("recLosses").textContent = prefs.record.l;
    $("recDraws").textContent = prefs.record.d;
  }

  function setStatus(html, cls) {
    var s = $("status");
    s.innerHTML = cls ? '<span class="' + cls + '">' + html + '</span>' : html;
  }

  /* ---------- Move animation (FLIP: slide the piece into place) ---------- */
  function dispPos(idx) {
    var r = idx >> 3, c = idx & 7;
    return G.flip ? { r: 7 - r, c: 7 - c } : { r: r, c: c };
  }
  function slideTo(fromIdx, toIdx) {
    var cell = boardEl.clientWidth / 8;
    if (!cell) return;
    var f = dispPos(fromIdx), t = dispPos(toIdx);
    var dx = (f.c - t.c) * cell, dy = (f.r - t.r) * cell;
    var sqEl = boardEl.querySelector('.sq[data-idx="' + toIdx + '"]');
    if (!sqEl) return;
    var pc = sqEl.querySelector('.piece');
    if (!pc) return;
    pc.style.transition = "none";
    pc.style.transform = "translate(" + dx + "px," + dy + "px)";
    pc.getBoundingClientRect(); // force reflow so the start position registers
    pc.style.transition = "transform .26s cubic-bezier(.22,.61,.36,1)";
    pc.style.transform = "translate(0,0)";
  }
  function animateMove(m) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    slideTo(m.from, m.to);
    if (m.flag === "castleK") { var hr = m.to >> 3; slideTo(hr * 8 + 7, hr * 8 + 5); }
    if (m.flag === "castleQ") { var hr2 = m.to >> 3; slideTo(hr2 * 8 + 0, hr2 * 8 + 3); }
  }

  /* ---------- Move handling ---------- */
  function recomputeLegal() {
    G.legal = (G.over || G.state.turn !== G.playerColor) ? [] : C.legalMoves(G.state);
  }

  function onSquareTap(idx) {
    if (!G || G.over || G.thinking) return;
    if (G.state.turn !== G.playerColor) return;
    Audio.unlock();
    var piece = G.state.board[idx];

    // If a destination among legal moves from selected -> move
    if (G.selected >= 0) {
      // Tapping your own rook while the king is selected performs castling.
      var selPiece = G.state.board[G.selected];
      if (selPiece && selPiece[1] === "K" && idx !== G.selected) {
        var castleMv = G.legal.filter(function (m) {
          if (m.from !== G.selected) return false;
          if (m.flag === "castleK") return idx === G.selected + 3;
          if (m.flag === "castleQ") return idx === G.selected - 4;
          return false;
        })[0];
        if (castleMv) { applyMove(castleMv, true); return; }
      }
      var candidates = G.legal.filter(function (m) { return m.from === G.selected && m.to === idx; });
      if (candidates.length) {
        if (candidates.length > 1 && candidates[0].flag === "promo") {
          openPromotion(candidates);
        } else {
          applyMove(candidates[0], true);
        }
        return;
      }
    }
    // Otherwise (re)select if it's the player's own piece
    if (piece && piece[0] === G.playerColor) {
      G.selected = idx;
      render();
    } else {
      G.selected = -1;
      render();
    }
  }

  function snapshot() {
    return {
      state: C.clone(G.state),
      capByW: G.capByW.slice(), capByB: G.capByB.slice(),
      lastMove: G.lastMove ? { from: G.lastMove.from, to: G.lastMove.to } : null,
      moveList: G.moveList.slice(),
      clock: { w: G.clock.w, b: G.clock.b }
    };
  }

  function applyMove(m, isPlayer) {
    // checkpoint before the player's move (for undo)
    if (isPlayer) G.history.push(snapshot());

    var moverColor = G.state.turn;
    var captured = m.captured;
    C.makeMove(G.state, m);

    // record captures
    if (captured) {
      if (moverColor === "w") G.capByW.push(captured); else G.capByB.push(captured);
    }
    G.lastMove = { from: m.from, to: m.to };
    G.moveList.push(moveText(m, captured));
    G.selected = -1;

    // sounds
    var giveCheck = C.inCheck(G.state, G.state.turn);
    if (m.flag === "castleK" || m.flag === "castleQ") Audio.castle();
    else if (giveCheck) Audio.check();
    else if (captured) Audio.capture();
    else Audio.move();

    recomputeLegal();
    render();
    animateMove(m);

    if (checkEnd()) return;

    // hand over the clock
    G.ticking = G.clockMs > 0;
    G.lastTick = performance.now();

    if (G.state.turn === G.aiColor && !G.over) {
      scheduleAI();
    }
  }

  function moveText(m, captured) {
    var pieceLetter = m.piece[1] === "P" ? "" : m.piece[1];
    var sep = captured || m.flag === "ep" ? "x" : "";
    if (m.flag === "castleK") return "O-O";
    if (m.flag === "castleQ") return "O-O-O";
    var txt = pieceLetter + (pieceLetter && sep ? "" : "") + C.sqName(m.from) + sep + C.sqName(m.to);
    if (m.promo) txt += "=" + m.promo;
    return txt;
  }

  function scheduleAI() {
    G.thinking = true;
    setStatus("Computer is thinking…", "think");
    // Make the opponent feel human: enforce a minimum "thinking" time even when
    // the search returns instantly (especially on Easy).
    var minByLevel = { easy: 650, medium: 600, hard: 550, expert: 450 };
    var spanByLevel = { easy: 750, medium: 550, hard: 450, expert: 350 };
    var minMs = (minByLevel[G.level] || 600) + Math.random() * (spanByLevel[G.level] || 500);
    setTimeout(function () {
      if (!G || G.over) { G.thinking = false; return; }
      var t0 = performance.now();
      var mv = C.bestMove(G.state, { level: G.level });
      var elapsed = performance.now() - t0;
      setTimeout(function () {
        if (!G || G.over) { G.thinking = false; return; }
        G.thinking = false;
        if (!mv) { checkEnd(); return; }
        applyMove(mv, false);
        if (!G.over) updateTurnStatus();
      }, Math.max(0, minMs - elapsed));
    }, 40);
  }

  function updateTurnStatus() {
    if (G.over) return;
    var check = C.inCheck(G.state, G.state.turn) ? " — Check!" : "";
    if (G.state.turn === G.playerColor) setStatus("Your move" + check, check ? "lose" : null);
    else setStatus("Computer is thinking…", "think");
  }

  /* ---------- End / result ---------- */
  function checkEnd() {
    var st = C.status(G.state);
    if (st === "ongoing") return false;
    G.over = true; G.ticking = false; G.legal = []; G.selected = -1;
    var msg, cls, result;
    if (st === "checkmate") {
      var loser = G.state.turn;            // side to move is checkmated
      if (loser === G.playerColor) { msg = "Checkmate — you lost."; cls = "lose"; result = "l"; Audio.lose(); }
      else { msg = "Checkmate — you win! 🎉"; cls = "win"; result = "w"; Audio.win(); }
    } else if (st === "stalemate") { msg = "Stalemate — it's a draw."; cls = null; result = "d"; Audio.draw(); }
    else if (st === "draw-50") { msg = "Draw — 50-move rule."; cls = null; result = "d"; Audio.draw(); }
    else if (st === "draw-material") { msg = "Draw — insufficient material."; cls = null; result = "d"; Audio.draw(); }
    setStatus(msg, cls);
    recordResult(result);
    render();
    return true;
  }

  function recordResult(r) {
    if (r === "w") prefs.record.w++;
    else if (r === "l") prefs.record.l++;
    else prefs.record.d++;
    savePrefs();
    renderRecord();
  }

  function flagFall(color) {
    if (G.over) return;
    G.over = true; G.ticking = false; G.legal = [];
    if (color === G.playerColor) { setStatus("Your time ran out — you lost.", "lose"); recordResult("l"); Audio.lose(); }
    else { setStatus("Computer's time ran out — you win! 🎉", "win"); recordResult("w"); Audio.win(); }
    render();
  }

  /* ---------- Clock loop ---------- */
  function tick() {
    if (G && G.ticking && !G.over && G.clockMs > 0) {
      var now = performance.now();
      var dt = now - G.lastTick;
      G.lastTick = now;
      var turn = G.state.turn;
      G.clock[turn] -= dt;
      if (G.clock[turn] <= 0) { G.clock[turn] = 0; renderClocks(); flagFall(turn); }
      else renderClocks();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---------- Promotion modal ---------- */
  var promoModal = $("promoModal"), promoOpts = $("promoOpts");
  function openPromotion(candidates) {
    promoOpts.innerHTML = "";
    ["Q", "R", "B", "N"].forEach(function (t) {
      var m = candidates.filter(function (x) { return x.promo === t; })[0];
      if (!m) return;
      var btn = document.createElement("button");
      btn.innerHTML = pieceSVG(G.playerColor + t);
      btn.onclick = function () { closePromotion(); applyMove(m, true); };
      promoOpts.appendChild(btn);
    });
    promoModal.classList.add("open");
  }
  function closePromotion() { promoModal.classList.remove("open"); }
  promoModal.addEventListener("click", function (e) { if (e.target === promoModal) closePromotion(); });

  /* ---------- Undo ---------- */
  function undo() {
    if (!G || G.thinking || !G.history.length) return;
    var snap = G.history.pop();
    G.state = snap.state;
    G.capByW = snap.capByW; G.capByB = snap.capByB;
    G.lastMove = snap.lastMove;
    G.moveList = snap.moveList;
    G.clock = snap.clock;
    G.over = false; G.selected = -1; G.thinking = false;
    G.ticking = G.clockMs > 0;
    G.lastTick = performance.now();
    recomputeLegal();
    render();
    updateTurnStatus();
  }

  /* ---------- New game ---------- */
  function startNewGame() {
    Audio.unlock();
    savePrefs();
    boardWrap.setAttribute("data-board", elTheme.value);
    G = freshGame();
    recomputeLegal();
    G.ticking = false;
    render();
    if (G.aiColor === "w") {
      // AI plays first
      updateTurnStatus();
      G.ticking = G.clockMs > 0; G.lastTick = performance.now();
      scheduleAI();
    } else {
      updateTurnStatus();
      G.ticking = G.clockMs > 0; G.lastTick = performance.now();
    }
  }

  function resign() {
    if (!G || G.over) return;
    G.over = true; G.ticking = false; G.legal = []; G.selected = -1;
    setStatus("You resigned — Computer wins.", "lose");
    recordResult("l"); Audio.lose();
    render();
  }

  /* ---------- Fullscreen ---------- */
  function toggleFullscreen() {
    var el = $("gameWrap");
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) { req.call(el).catch(fallbackFS); }
      else fallbackFS();
    } else {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      el.classList.remove("fs-fallback");
    }
  }
  function fallbackFS() {
    // iOS Safari has no element fullscreen — emulate with a fixed overlay.
    $("gameWrap").classList.toggle("fs-fallback");
  }

  /* ---------- Sound toggle ---------- */
  function updateSoundIcon() {
    var icon = $("soundIcon");
    if (Audio.isOn()) {
      icon.innerHTML = '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M19 5a14 14 0 0 1 0 14M15.5 8.5a7 7 0 0 1 0 7"/>';
      $("soundBtn").classList.remove("muted");
    } else {
      icon.innerHTML = '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/>';
    }
  }

  /* ---------- Wire up events ---------- */
  boardEl.addEventListener("click", function (e) {
    var cell = e.target.closest(".sq");
    if (cell) onSquareTap(parseInt(cell.getAttribute("data-idx"), 10));
  });
  $("newGame").addEventListener("click", startNewGame);
  $("undoBtn").addEventListener("click", undo);
  $("resignBtn").addEventListener("click", resign);
  $("flipBtn").addEventListener("click", function () { if (G) { G.flip = !G.flip; render(); } });
  $("fsBtn").addEventListener("click", toggleFullscreen);
  $("soundBtn").addEventListener("click", function () {
    Audio.setOn(!Audio.isOn()); Audio.unlock();
    if (Audio.isOn()) Audio.move();
    updateSoundIcon(); savePrefs();
  });
  elTheme.addEventListener("change", function () {
    boardWrap.setAttribute("data-board", elTheme.value); savePrefs();
  });
  elLevel.addEventListener("change", function () { if (G && !G.over) G.level = elLevel.value; savePrefs(); });
  [elTime, elSide].forEach(function (el) { el.addEventListener("change", savePrefs); });

  document.addEventListener("fullscreenchange", function () {
    // refresh sizing-dependent layout
    setTimeout(function () { if (G) render(); }, 30);
  });

  // Boot: render an empty starting board so the page looks alive before "New Game".
  G = freshGame();
  G.over = true;             // not playable until New Game
  G.legal = [];
  render();
  setStatus("Press <b>New Game</b> to start.");
})();
