/* ============================================================
   Sudoku tool — UI, input, notes, hints, timer, persistence.
   Supports any box size via engine.js (window.Sudoku):
     2×2 -> 4×4,  3×2 -> 6×6,  3×3 -> 9×9,  4×4 -> 16×16
   Digits above 9 are shown as letters A–G (10–16).
   ============================================================ */
(function () {
  "use strict";
  var S = window.Sudoku;
  var STORE = "html-tools-sudoku";

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $("board"), boardWrap = $("boardWrap"), padEl = $("pad");
  var elDiff = $("difficulty"), elTheme = $("boardTheme"), elGrid = $("gridSel");

  /* ---------- Digit display (1..9, then A..G) ---------- */
  function digChar(d) { return d <= 9 ? String(d) : String.fromCharCode(64 + (d - 9)); }
  function keyToDigit(k, N) {
    if (k >= "1" && k <= "9") { var d = +k; return d <= N ? d : 0; }
    var u = (k || "").toUpperCase();
    if (u >= "A" && u <= "G") { var e = 9 + (u.charCodeAt(0) - 64); return e <= N ? e : 0; }
    return 0;
  }

  /* ---------- Persistent prefs ---------- */
  var prefs = loadPrefs();
  function loadPrefs() {
    var d = { difficulty: "medium", theme: "classic", grid: "3,3", check: false,
      best: {}, won: 0, game: null };
    try {
      var s = JSON.parse(localStorage.getItem(STORE));
      if (s) { for (var k in d) if (s[k] !== undefined) d[k] = s[k]; }
    } catch (e) {}
    if (!d.best || typeof d.best !== "object") d.best = {};
    return d;
  }
  function savePrefs() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {} }

  elDiff.value = prefs.difficulty; elTheme.value = prefs.theme; elGrid.value = prefs.grid;
  boardWrap.setAttribute("data-board", prefs.theme);

  function cfgFromValue(v) { var p = v.split(","); return S.config(+p[0], +p[1]); }
  function bestKey(cfg, diff) { return cfg.N + "-" + diff; }
  function gridLabel(cfg) { return cfg.N + "×" + cfg.N; }

  /* ---------- Game state ---------- */
  var G = null;

  function applyCfg(cfg) {
    var nc = Math.ceil(Math.sqrt(cfg.N)), nr = Math.ceil(cfg.N / nc);
    boardWrap.style.setProperty("--n", cfg.N);
    boardWrap.style.setProperty("--nc", nc);
    boardWrap.style.setProperty("--nr", nr);
    boardEl.style.gridTemplateColumns = "repeat(" + cfg.N + ",1fr)";
    boardEl.style.gridTemplateRows = "repeat(" + cfg.N + ",1fr)";
    var padCols = cfg.N <= 9 ? cfg.N : Math.ceil(cfg.N / 2);
    padEl.style.gridTemplateColumns = "repeat(" + padCols + ",1fr)";
  }

  function newGame(diff, cfg) {
    var p = S.makePuzzle(cfg, diff);
    G = {
      cfg: cfg, difficulty: diff,
      puzzle: p.puzzle.slice(),
      given: p.puzzle.map(function (v) { return v !== 0; }),
      value: p.puzzle.slice(),
      notes: new Array(cfg.cells).fill(0),
      hintCells: new Array(cfg.cells).fill(false),
      solution: p.solution.slice(),
      selected: -1, notesMode: false, check: prefs.check,
      mistakes: 0, hints: 0, history: [],
      elapsed: 0, running: true, paused: false, won: false, lastTick: performance.now()
    };
    applyCfg(cfg);
    saveGame();
  }

  function restoreGame(s) {
    var cfg = S.config(s.boxW, s.boxH);
    G = {
      cfg: cfg, difficulty: s.difficulty,
      puzzle: s.puzzle.slice(),
      given: s.puzzle.map(function (v) { return v !== 0; }),
      value: s.value.slice(),
      notes: s.notes.slice(),
      hintCells: s.hintCells ? s.hintCells.slice() : new Array(cfg.cells).fill(false),
      solution: s.solution.slice(),
      selected: -1, notesMode: false, check: prefs.check,
      mistakes: s.mistakes || 0, hints: s.hints || 0, history: [],
      elapsed: s.elapsed || 0, running: true, paused: false, won: false, lastTick: performance.now()
    };
    applyCfg(cfg);
  }

  function saveGame() {
    if (!G || G.won) { prefs.game = null; savePrefs(); return; }
    prefs.game = {
      boxW: G.cfg.boxW, boxH: G.cfg.boxH, difficulty: G.difficulty,
      puzzle: G.puzzle, value: G.value, notes: G.notes, hintCells: G.hintCells,
      solution: G.solution, mistakes: G.mistakes, hints: G.hints, elapsed: Math.round(G.elapsed)
    };
    savePrefs();
  }

  /* ---------- Rendering ---------- */
  function render() {
    var cfg = G.cfg, N = cfg.N;
    var sel = G.selected;
    var selVal = sel >= 0 ? G.value[sel] : 0;
    var selR = sel >= 0 ? (sel / N | 0) : -1, selC = sel >= 0 ? sel % N : -1;
    var selB = sel >= 0 ? S.boxOf(cfg, selR, selC) : -1;

    var html = "";
    for (var i = 0; i < cfg.cells; i++) {
      var r = i / N | 0, c = i % N, b = S.boxOf(cfg, r, c);
      var cls = "cell";
      if (c === N - 1) cls += " cr9"; else if ((c + 1) % cfg.boxW === 0) cls += " br";
      if (r === N - 1) cls += " rb9"; else if ((r + 1) % cfg.boxH === 0) cls += " bb";
      if (G.given[i]) cls += " given"; else if (G.value[i]) cls += (G.hintCells[i] ? " hint" : " user");

      if (sel >= 0) {
        if (i === sel) cls += " sel";
        else if (r === selR || c === selC || b === selB) cls += " peer";
        if (selVal && G.value[i] === selVal) cls += " same";
      }
      if (G.check && !G.given[i] && G.value[i] && S.conflicts(cfg, G.value, i).length) cls += " conflict";

      var inner = "";
      if (G.value[i]) {
        inner = '<span class="num">' + digChar(G.value[i]) + "</span>";
      } else if (G.notes[i]) {
        inner = '<div class="notes">';
        for (var d = 1; d <= N; d++) inner += "<span>" + ((G.notes[i] & (1 << d)) ? digChar(d) : "") + "</span>";
        inner += "</div>";
      }
      html += '<div class="' + cls + '" data-i="' + i + '">' + inner + "</div>";
    }
    boardEl.innerHTML = html;
    renderPad();
    renderInfo();
  }

  function renderPad() {
    var cfg = G.cfg, N = cfg.N;
    var counts = new Array(N + 1).fill(0);
    for (var i = 0; i < cfg.cells; i++) if (G.value[i]) counts[G.value[i]]++;
    var html = "";
    for (var d = 1; d <= N; d++) {
      var done = counts[d] >= N ? " done" : "";
      html += '<button class="num-btn' + done + '" data-d="' + d + '">' + digChar(d) +
        '<span class="left">' + Math.max(0, N - counts[d]) + "</span></button>";
    }
    padEl.innerHTML = html;
  }

  function renderInfo() {
    $("diffChip").textContent = gridLabel(G.cfg) + " · " + cap(G.difficulty);
    $("notesState").textContent = G.notesMode ? "On" : "Off";
    $("notesBtn").classList.toggle("on", G.notesMode);
    $("checkBtn").classList.toggle("on", G.check);
    var mc = $("mistakeChip");
    mc.style.display = G.check ? "" : "none";
    $("mistakeCount").textContent = G.mistakes;
    mc.classList.toggle("bad", G.mistakes > 0);
    renderRecords();
  }

  function renderRecords() {
    var best = prefs.best[bestKey(G.cfg, G.difficulty)];
    $("recBest").textContent = best ? fmtTime(best) : "—";
    $("recWon").textContent = prefs.won;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    var two = function (n) { return (n < 10 ? "0" : "") + n; };
    return h > 0 ? h + ":" + two(m) + ":" + two(s) : m + ":" + two(s);
  }

  /* ---------- Input ---------- */
  function selectCell(i) {
    if (!G || G.won || G.paused) return;
    G.selected = i; render();
  }
  function snapshot() {
    return { value: G.value.slice(), notes: G.notes.slice(),
      hintCells: G.hintCells.slice(), mistakes: G.mistakes };
  }
  function pushHistory() { G.history.push(snapshot()); if (G.history.length > 300) G.history.shift(); }

  function inputDigit(d) {
    if (!G || G.won || G.paused) return;
    if (d < 1 || d > G.cfg.N) return;
    var i = G.selected;
    if (i < 0 || G.given[i]) return;

    if (G.notesMode) {
      if (G.value[i]) return;
      pushHistory();
      G.notes[i] ^= (1 << d);
    } else {
      pushHistory();
      if (G.value[i] === d) { G.value[i] = 0; G.hintCells[i] = false; }
      else {
        G.value[i] = d; G.notes[i] = 0; G.hintCells[i] = false;
        if (S.conflicts(G.cfg, G.value, i).length) G.mistakes++;
        clearPeerNotes(i, d);
      }
    }
    render(); saveGame(); checkWin();
  }

  function clearPeerNotes(i, d) {
    var cfg = G.cfg, N = cfg.N, r = i / N | 0, c = i % N, bit = 1 << d;
    for (var k = 0; k < N; k++) { G.notes[r * N + k] &= ~bit; G.notes[k * N + c] &= ~bit; }
    var br = (r / cfg.boxH | 0) * cfg.boxH, bc = (c / cfg.boxW | 0) * cfg.boxW;
    for (var dr = 0; dr < cfg.boxH; dr++) for (var dc = 0; dc < cfg.boxW; dc++)
      G.notes[(br + dr) * N + (bc + dc)] &= ~bit;
  }

  function eraseCell() {
    if (!G || G.won || G.paused) return;
    var i = G.selected;
    if (i < 0 || G.given[i]) return;
    if (!G.value[i] && !G.notes[i]) return;
    pushHistory();
    G.value[i] = 0; G.notes[i] = 0; G.hintCells[i] = false;
    render(); saveGame();
  }

  function undo() {
    if (!G || G.won || G.paused || !G.history.length) return;
    var s = G.history.pop();
    G.value = s.value; G.notes = s.notes; G.hintCells = s.hintCells; G.mistakes = s.mistakes;
    render(); saveGame();
  }

  function hint() {
    if (!G || G.won || G.paused) return;
    var i = G.selected;
    if (i < 0 || G.given[i] || G.value[i]) {
      var empties = [];
      for (var k = 0; k < G.cfg.cells; k++) if (!G.value[k]) empties.push(k);
      if (!empties.length) return;
      i = empties[(Math.random() * empties.length) | 0];
      G.selected = i;
    }
    pushHistory();
    G.value[i] = G.solution[i]; G.notes[i] = 0; G.hintCells[i] = true; G.hints++;
    clearPeerNotes(i, G.value[i]);
    render(); saveGame(); checkWin();
  }

  function checkWin() {
    if (S.isComplete(G.cfg, G.value)) {
      G.won = true; G.running = false;
      var key = bestKey(G.cfg, G.difficulty);
      var best = prefs.best[key];
      var isBest = !best || G.elapsed < best;
      if (isBest) prefs.best[key] = Math.round(G.elapsed);
      prefs.won = (prefs.won || 0) + 1;
      prefs.game = null; savePrefs();
      G.selected = -1; render();
      var msg = "Solved in " + fmtTime(G.elapsed) +
        (G.hints ? " · " + G.hints + " hint" + (G.hints > 1 ? "s" : "") : "") +
        (isBest ? " — new best! 🎉" : " 🎉");
      setStatus(msg, "win");
    }
  }

  function setStatus(html, cls) {
    $("status").innerHTML = cls ? '<span class="' + cls + '">' + html + "</span>" : html;
  }

  /* ---------- Pause / timer ---------- */
  function setPaused(p) {
    if (!G || G.won) return;
    G.paused = p;
    $("pauseVeil").classList.toggle("show", p);
    $("pauseBtn").classList.toggle("on", p);
    if (!p) G.lastTick = performance.now();
  }
  function tick() {
    if (G && G.running && !G.paused && !G.won) {
      var now = performance.now();
      G.elapsed += now - G.lastTick; G.lastTick = now;
      $("timer").textContent = fmtTime(G.elapsed);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---------- Fullscreen ---------- */
  function toggleFullscreen() {
    var el = $("gameWrap");
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el).catch(fallbackFS); else fallbackFS();
    } else {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      el.classList.remove("fs-fallback");
    }
  }
  function fallbackFS() { $("gameWrap").classList.toggle("fs-fallback"); }

  /* ---------- New game ---------- */
  function startNew() {
    prefs.difficulty = elDiff.value; prefs.grid = elGrid.value; savePrefs();
    newGame(elDiff.value, cfgFromValue(elGrid.value));
    setStatus("Good luck!"); render();
  }

  /* ---------- Events ---------- */
  boardEl.addEventListener("click", function (e) {
    if (G && G.paused) { setPaused(false); return; }
    var cell = e.target.closest(".cell");
    if (cell) selectCell(parseInt(cell.getAttribute("data-i"), 10));
  });
  padEl.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (b) inputDigit(parseInt(b.getAttribute("data-d"), 10));
  });
  $("newGame").addEventListener("click", startNew);
  $("undoBtn").addEventListener("click", undo);
  $("eraseBtn").addEventListener("click", eraseCell);
  $("hintBtn").addEventListener("click", hint);
  $("notesBtn").addEventListener("click", function () { G.notesMode = !G.notesMode; render(); });
  $("checkBtn").addEventListener("click", function () { G.check = !G.check; prefs.check = G.check; savePrefs(); render(); });
  $("pauseBtn").addEventListener("click", function () { setPaused(!G.paused); });
  $("fsBtn").addEventListener("click", toggleFullscreen);
  $("pauseVeil").addEventListener("click", function () { setPaused(false); });

  elTheme.addEventListener("change", function () {
    boardWrap.setAttribute("data-board", elTheme.value); prefs.theme = elTheme.value; savePrefs();
  });
  elDiff.addEventListener("change", function () { prefs.difficulty = elDiff.value; savePrefs(); });
  elGrid.addEventListener("change", function () { prefs.grid = elGrid.value; savePrefs(); });

  document.addEventListener("keydown", function (e) {
    if (!G) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    var k = e.key;
    var d = keyToDigit(k, G.cfg.N);
    if (d) { inputDigit(d); e.preventDefault(); }
    else if (k === "Backspace" || k === "Delete" || k === "0") { eraseCell(); e.preventDefault(); }
    else if (k === "n" || k === "N") { G.notesMode = !G.notesMode; render(); }
    else if (k === " ") { setPaused(!G.paused); e.preventDefault(); }
    else if (k.indexOf("Arrow") === 0 && G.selected >= 0) {
      var N = G.cfg.N, r = G.selected / N | 0, c = G.selected % N;
      if (k === "ArrowUp") r = (r + N - 1) % N;
      if (k === "ArrowDown") r = (r + 1) % N;
      if (k === "ArrowLeft") c = (c + N - 1) % N;
      if (k === "ArrowRight") c = (c + 1) % N;
      selectCell(r * N + c); e.preventDefault();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && G && !G.won) setPaused(true);
  });
  document.addEventListener("fullscreenchange", function () { setTimeout(render, 30); });

  /* ---------- Boot ---------- */
  if (prefs.game && prefs.game.value && prefs.game.boxW) {
    restoreGame(prefs.game);
    setStatus("Welcome back — resume where you left off.");
  } else {
    newGame(prefs.difficulty, cfgFromValue(prefs.grid));
    setStatus("Good luck!");
  }
  render();
})();
