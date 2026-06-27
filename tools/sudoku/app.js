/* ============================================================
   Sudoku tool — UI, input, notes, hints, timer, persistence.
   Uses engine.js (window.Sudoku).
   ============================================================ */
(function () {
  "use strict";
  var S = window.Sudoku;
  var STORE = "html-tools-sudoku";

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $("board"), boardWrap = $("boardWrap"), padEl = $("pad");
  var elDiff = $("difficulty"), elTheme = $("boardTheme"), elSize = $("sizeSel");

  /* ---------- Persistent prefs ---------- */
  var prefs = loadPrefs();
  function loadPrefs() {
    var d = { difficulty: "medium", theme: "classic", size: "460", check: false,
      best: { easy: null, medium: null, hard: null, expert: null }, won: 0, game: null };
    try {
      var s = JSON.parse(localStorage.getItem(STORE));
      if (s) { for (var k in d) if (s[k] !== undefined) d[k] = s[k]; }
    } catch (e) {}
    return d;
  }
  function savePrefs() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {} }

  // apply saved UI settings
  elDiff.value = prefs.difficulty; elTheme.value = prefs.theme; elSize.value = prefs.size;
  boardWrap.setAttribute("data-board", prefs.theme);
  boardWrap.style.setProperty("--board-size", prefs.size + "px");

  /* ---------- Game state ---------- */
  var G = null;

  function newGame(diff) {
    var p = S.makePuzzle(diff);
    G = {
      difficulty: diff,
      puzzle: p.puzzle.slice(),
      given: p.puzzle.map(function (v) { return v !== 0; }),
      value: p.puzzle.slice(),
      notes: new Array(81).fill(0),
      hintCells: new Array(81).fill(false),
      solution: p.solution.slice(),
      selected: -1,
      notesMode: false,
      check: prefs.check,
      mistakes: 0,
      hints: 0,
      history: [],
      elapsed: 0,
      running: true,
      paused: false,
      won: false,
      lastTick: performance.now()
    };
    saveGame();
  }

  function restoreGame(s) {
    G = {
      difficulty: s.difficulty,
      puzzle: s.puzzle.slice(),
      given: s.puzzle.map(function (v) { return v !== 0; }),
      value: s.value.slice(),
      notes: s.notes.slice(),
      hintCells: s.hintCells ? s.hintCells.slice() : new Array(81).fill(false),
      solution: s.solution.slice(),
      selected: -1,
      notesMode: false,
      check: prefs.check,
      mistakes: s.mistakes || 0,
      hints: s.hints || 0,
      history: [],
      elapsed: s.elapsed || 0,
      running: true,
      paused: false,
      won: false,
      lastTick: performance.now()
    };
  }

  function saveGame() {
    if (!G || G.won) { prefs.game = null; savePrefs(); return; }
    prefs.game = {
      difficulty: G.difficulty, puzzle: G.puzzle, value: G.value, notes: G.notes,
      hintCells: G.hintCells, solution: G.solution, mistakes: G.mistakes,
      hints: G.hints, elapsed: Math.round(G.elapsed)
    };
    savePrefs();
  }

  /* ---------- Rendering ---------- */
  function render() {
    var sel = G.selected;
    var selVal = sel >= 0 ? G.value[sel] : 0;
    var selR = sel >= 0 ? (sel / 9 | 0) : -1, selC = sel >= 0 ? sel % 9 : -1;
    var selB = sel >= 0 ? S.boxOf(selR, selC) : -1;

    var html = "";
    for (var i = 0; i < 81; i++) {
      var r = i / 9 | 0, c = i % 9, b = S.boxOf(r, c);
      var cls = "cell";
      if (c === 8) cls += " cr9"; else if (c % 3 === 2) cls += " br";
      if (r === 8) cls += " rb9"; else if (r % 3 === 2) cls += " bb";
      if (G.given[i]) cls += " given"; else if (G.value[i]) cls += (G.hintCells[i] ? " hint" : " user");

      // highlights
      if (sel >= 0) {
        if (i === sel) cls += " sel";
        else if (r === selR || c === selC || b === selB) cls += " peer";
        if (selVal && G.value[i] === selVal) cls += " same";
      }
      // conflicts (only user-entered cells, when check is on)
      if (G.check && !G.given[i] && G.value[i] && S.conflicts(G.value, i).length) cls += " conflict";

      var inner = "";
      if (G.value[i]) {
        inner = '<span class="num">' + G.value[i] + "</span>";
      } else if (G.notes[i]) {
        inner = '<div class="notes">';
        for (var d = 1; d <= 9; d++) inner += "<span>" + ((G.notes[i] & (1 << d)) ? d : "") + "</span>";
        inner += "</div>";
      }
      html += '<div class="' + cls + '" data-i="' + i + '">' + inner + "</div>";
    }
    boardEl.innerHTML = html;
    renderPad();
    renderInfo();
  }

  function renderPad() {
    var counts = new Array(10).fill(0);
    for (var i = 0; i < 81; i++) if (G.value[i]) counts[G.value[i]]++;
    var html = "";
    for (var d = 1; d <= 9; d++) {
      var done = counts[d] >= 9 ? " done" : "";
      html += '<button class="num-btn' + done + '" data-d="' + d + '">' + d +
        '<span class="left">' + Math.max(0, 9 - counts[d]) + "</span></button>";
    }
    padEl.innerHTML = html;
  }

  function renderInfo() {
    $("diffChip").textContent = cap(G.difficulty);
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
    var best = prefs.best[G.difficulty];
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
    G.selected = i;
    render();
  }

  function snapshot() {
    return { value: G.value.slice(), notes: G.notes.slice(),
      hintCells: G.hintCells.slice(), mistakes: G.mistakes };
  }
  function pushHistory() {
    G.history.push(snapshot());
    if (G.history.length > 200) G.history.shift();
  }

  function inputDigit(d) {
    if (!G || G.won || G.paused) return;
    var i = G.selected;
    if (i < 0 || G.given[i]) return;

    if (G.notesMode) {
      if (G.value[i]) return; // can't note a filled cell
      pushHistory();
      G.notes[i] ^= (1 << d);
    } else {
      pushHistory();
      if (G.value[i] === d) { // tap same digit to clear
        G.value[i] = 0; G.hintCells[i] = false;
      } else {
        G.value[i] = d; G.notes[i] = 0; G.hintCells[i] = false;
        // count a mistake if this creates a conflict
        if (S.conflicts(G.value, i).length) G.mistakes++;
        // auto-clear this candidate from peers' notes
        clearPeerNotes(i, d);
      }
    }
    render();
    saveGame();
    checkWin();
  }

  function clearPeerNotes(i, d) {
    var r = i / 9 | 0, c = i % 9, bit = 1 << d;
    for (var k = 0; k < 9; k++) {
      G.notes[r * 9 + k] &= ~bit;
      G.notes[k * 9 + c] &= ~bit;
    }
    var br = (r / 3 | 0) * 3, bc = (c / 3 | 0) * 3;
    for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++)
      G.notes[(br + dr) * 9 + (bc + dc)] &= ~bit;
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
      // pick a random empty cell
      var empties = [];
      for (var k = 0; k < 81; k++) if (!G.value[k]) empties.push(k);
      if (!empties.length) return;
      i = empties[(Math.random() * empties.length) | 0];
      G.selected = i;
    }
    pushHistory();
    G.value[i] = G.solution[i];
    G.notes[i] = 0;
    G.hintCells[i] = true;
    G.hints++;
    clearPeerNotes(i, G.value[i]);
    render(); saveGame();
    checkWin();
  }

  function checkWin() {
    if (S.isComplete(G.value)) {
      G.won = true; G.running = false;
      var best = prefs.best[G.difficulty];
      var isBest = !best || G.elapsed < best;
      if (isBest) prefs.best[G.difficulty] = Math.round(G.elapsed);
      prefs.won = (prefs.won || 0) + 1;
      prefs.game = null;
      savePrefs();
      G.selected = -1;
      render();
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
      G.elapsed += now - G.lastTick;
      G.lastTick = now;
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

  /* ---------- Start a new game ---------- */
  function startNew() {
    prefs.difficulty = elDiff.value; savePrefs();
    newGame(elDiff.value);
    setStatus("Good luck!");
    render();
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
  $("checkBtn").addEventListener("click", function () {
    G.check = !G.check; prefs.check = G.check; savePrefs(); render();
  });
  $("pauseBtn").addEventListener("click", function () { setPaused(!G.paused); });
  $("fsBtn").addEventListener("click", toggleFullscreen);
  $("pauseVeil").addEventListener("click", function () { setPaused(false); });

  elTheme.addEventListener("change", function () {
    boardWrap.setAttribute("data-board", elTheme.value); prefs.theme = elTheme.value; savePrefs();
  });
  elSize.addEventListener("change", function () {
    boardWrap.style.setProperty("--board-size", elSize.value + "px"); prefs.size = elSize.value; savePrefs();
  });
  elDiff.addEventListener("change", function () { prefs.difficulty = elDiff.value; savePrefs(); });

  // keyboard
  document.addEventListener("keydown", function (e) {
    if (!G) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return; // don't hijack form fields
    var k = e.key;
    if (k >= "1" && k <= "9") { inputDigit(parseInt(k, 10)); e.preventDefault(); }
    else if (k === "Backspace" || k === "Delete" || k === "0") { eraseCell(); e.preventDefault(); }
    else if (k === "n" || k === "N") { G.notesMode = !G.notesMode; render(); }
    else if (k === "h" || k === "H") { hint(); }
    else if (k === " ") { setPaused(!G.paused); e.preventDefault(); }
    else if (k.indexOf("Arrow") === 0 && G.selected >= 0) {
      var r = G.selected / 9 | 0, c = G.selected % 9;
      if (k === "ArrowUp") r = (r + 8) % 9;
      if (k === "ArrowDown") r = (r + 1) % 9;
      if (k === "ArrowLeft") c = (c + 8) % 9;
      if (k === "ArrowRight") c = (c + 1) % 9;
      selectCell(r * 9 + c); e.preventDefault();
    }
  });

  // auto-pause when the tab is hidden
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && G && !G.won) setPaused(true);
  });
  document.addEventListener("fullscreenchange", function () { setTimeout(render, 30); });

  /* ---------- Boot: resume saved game or start fresh ---------- */
  if (prefs.game && prefs.game.value) {
    restoreGame(prefs.game);
    setStatus("Welcome back — resume where you left off.");
  } else {
    newGame(prefs.difficulty);
    setStatus("Good luck!");
  }
  render();
})();
