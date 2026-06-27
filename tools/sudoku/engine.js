/* ============================================================
   Sudoku engine — generalised to any box size.
   Pure & dependency-free. Works in the browser (window.Sudoku)
   and in Node (module.exports) for unit testing.

   A "config" describes the variant:
     cfg = Sudoku.config(boxW, boxH)
       boxW, boxH : box width & height (cols × rows of a box)
       N          : grid side = boxW * boxH (also the digit range 1..N)
       cells      : N*N
       ALL        : candidate bitmask with bits 1..N set
     Standard variants:
       2×2 -> 4×4,  3×2 -> 6×6,  3×3 -> 9×9,  4×4 -> 16×16

   A grid is a flat array of `cells` ints, row-major. 0 = empty.
   ============================================================ */
(function (root) {
  "use strict";

  function config(boxW, boxH) {
    var N = boxW * boxH;
    var ALL = 0;
    for (var d = 1; d <= N; d++) ALL |= (1 << d);
    return {
      boxW: boxW, boxH: boxH, N: N, cells: N * N, ALL: ALL,
      boxesPerRow: N / boxW   // = boxH
    };
  }

  function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }
  function lowestBit(x) { return x & (-x); }
  function bitToDigit(bit) { var v = 0; while (bit > 1) { bit >>= 1; v++; } return v; }
  function boxOf(cfg, r, c) {
    return ((r / cfg.boxH) | 0) * cfg.boxesPerRow + ((c / cfg.boxW) | 0);
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function buildMasks(cfg, g) {
    var N = cfg.N;
    var rmask = new Array(N).fill(0), cmask = new Array(N).fill(0), bmask = new Array(N).fill(0);
    for (var i = 0; i < cfg.cells; i++) {
      var v = g[i];
      if (v) {
        var r = (i / N) | 0, c = i % N, bit = 1 << v;
        rmask[r] |= bit; cmask[c] |= bit; bmask[boxOf(cfg, r, c)] |= bit;
      }
    }
    return { rmask: rmask, cmask: cmask, bmask: bmask };
  }

  /* Count solutions up to `limit`; returns { count, solution }. MRV + bitmasks. */
  function solutions(cfg, grid, limit) {
    limit = limit || 1;
    var N = cfg.N, cells = cfg.cells, ALL = cfg.ALL;
    var g = grid.slice();
    var m = buildMasks(cfg, g);
    var rmask = m.rmask, cmask = m.cmask, bmask = m.bmask;
    var count = 0, firstSolution = null;

    function rec() {
      if (count >= limit) return;
      var best = -1, bestCount = 1e9, bestCand = 0;
      for (var i = 0; i < cells; i++) {
        if (g[i]) continue;
        var r = (i / N) | 0, c = i % N, b = boxOf(cfg, r, c);
        var cand = ALL & ~(rmask[r] | cmask[c] | bmask[b]);
        var cnt = popcount(cand);
        if (cnt < bestCount) { bestCount = cnt; best = i; bestCand = cand; if (cnt <= 1) break; }
      }
      if (best === -1) { count++; if (!firstSolution) firstSolution = g.slice(); return; }
      if (bestCount === 0) return;
      var rr = (best / N) | 0, cc = best % N, bb = boxOf(cfg, rr, cc);
      var cand = bestCand;
      while (cand) {
        var bit = lowestBit(cand); cand ^= bit;
        var v = bitToDigit(bit);
        g[best] = v; rmask[rr] |= bit; cmask[cc] |= bit; bmask[bb] |= bit;
        rec();
        g[best] = 0; rmask[rr] &= ~bit; cmask[cc] &= ~bit; bmask[bb] &= ~bit;
        if (count >= limit) return;
      }
    }
    rec();
    return { count: count, solution: firstSolution };
  }

  function solve(cfg, grid) { return solutions(cfg, grid, 1).solution; }
  function hasUniqueSolution(cfg, grid) { return solutions(cfg, grid, 2).count === 1; }

  /* Build a random fully-solved grid using the "pattern + shuffle" method —
     fast and valid for any box size (avoids slow backtracking on 16×16). */
  function generateSolved(cfg) {
    var boxW = cfg.boxW, boxH = cfg.boxH, N = cfg.N;
    function pattern(r, c) { return (boxW * (r % boxH) + ((r / boxH) | 0) + c) % N; }

    function shuffledRange(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return shuffle(a); }
    var bandRows = []; // row order: shuffle bands (groups of boxH rows), then rows within each band
    var bands = shuffledRange(N / boxH);
    bands.forEach(function (band) {
      shuffledRange(boxH).forEach(function (r) { bandRows.push(band * boxH + r); });
    });
    var stackCols = [];
    var stacks = shuffledRange(N / boxW);
    stacks.forEach(function (stack) {
      shuffledRange(boxW).forEach(function (c) { stackCols.push(stack * boxW + c); });
    });
    var digits = shuffledRange(N).map(function (x) { return x + 1; }); // labels 1..N permuted

    var g = new Array(cfg.cells).fill(0);
    for (var ri = 0; ri < N; ri++) for (var ci = 0; ci < N; ci++) {
      var r = bandRows[ri], c = stackCols[ci];
      g[r * N + c] = digits[pattern(ri, ci)];
    }
    return g;
  }

  // Target number of givens for a variant + difficulty.
  function targetGivens(cfg, difficulty) {
    var tables = {
      4:  { easy: 8,   medium: 7,   hard: 6,   expert: 5 },
      6:  { easy: 22,  medium: 18,  hard: 16,  expert: 14 },
      9:  { easy: 44,  medium: 34,  hard: 30,  expert: 26 },
      16: { easy: 160, medium: 145, hard: 130, expert: 118 }
    };
    var t = tables[cfg.N];
    if (t && t[difficulty] != null) return t[difficulty];
    // fallback: fraction of cells
    var frac = { easy: 0.56, medium: 0.47, hard: 0.41, expert: 0.36 }[difficulty] || 0.45;
    return Math.max(cfg.N, Math.round(cfg.cells * frac));
  }

  /* Dig holes from a solved grid keeping the solution unique. Symmetric (180°)
     removal for nicer look on smaller boards; stops at the target givens. */
  function makePuzzle(cfg, difficulty) {
    var target = targetGivens(cfg, difficulty);
    var solution = generateSolved(cfg);
    var puzzle = solution.slice();
    var givens = cfg.cells;
    var last = cfg.cells - 1;

    var cells = [];
    for (var i = 0; i < cfg.cells; i++) cells.push(i);
    shuffle(cells);

    for (var n = 0; n < cells.length && givens > target; n++) {
      var idx = cells[n];
      if (puzzle[idx] === 0) continue;
      var partner = last - idx; // 180° rotation
      var removed = [idx];
      if (partner !== idx && puzzle[partner] !== 0) removed.push(partner);
      if (givens - removed.length < target) removed = [idx];

      var saved = removed.map(function (k) { return puzzle[k]; });
      removed.forEach(function (k) { puzzle[k] = 0; });

      if (hasUniqueSolution(cfg, puzzle)) givens -= removed.length;
      else removed.forEach(function (k, j) { puzzle[k] = saved[j]; });
    }
    return { puzzle: puzzle, solution: solution, givens: givens };
  }

  function candidates(cfg, grid, i) {
    if (grid[i]) return [];
    var N = cfg.N, r = (i / N) | 0, c = i % N, used = 0, k;
    for (k = 0; k < N; k++) {
      if (grid[r * N + k]) used |= 1 << grid[r * N + k];
      if (grid[k * N + c]) used |= 1 << grid[k * N + c];
    }
    var br = ((r / cfg.boxH) | 0) * cfg.boxH, bc = ((c / cfg.boxW) | 0) * cfg.boxW;
    for (var dr = 0; dr < cfg.boxH; dr++) for (var dc = 0; dc < cfg.boxW; dc++) {
      var v = grid[(br + dr) * N + (bc + dc)];
      if (v) used |= 1 << v;
    }
    var out = [];
    for (var d = 1; d <= N; d++) if (!(used & (1 << d))) out.push(d);
    return out;
  }

  function conflicts(cfg, grid, i) {
    var v = grid[i];
    if (!v) return [];
    var N = cfg.N, r = (i / N) | 0, c = i % N, out = [], k;
    for (k = 0; k < N; k++) {
      var ri = r * N + k, ci = k * N + c;
      if (ri !== i && grid[ri] === v) out.push(ri);
      if (ci !== i && grid[ci] === v) out.push(ci);
    }
    var br = ((r / cfg.boxH) | 0) * cfg.boxH, bc = ((c / cfg.boxW) | 0) * cfg.boxW;
    for (var dr = 0; dr < cfg.boxH; dr++) for (var dc = 0; dc < cfg.boxW; dc++) {
      var bi = (br + dr) * N + (bc + dc);
      if (bi !== i && grid[bi] === v) out.push(bi);
    }
    return out;
  }

  function isComplete(cfg, grid) {
    for (var i = 0; i < cfg.cells; i++) if (!grid[i]) return false;
    for (var j = 0; j < cfg.cells; j++) if (conflicts(cfg, grid, j).length) return false;
    return true;
  }

  var API = {
    config: config, boxOf: boxOf,
    solutions: solutions, solve: solve, hasUniqueSolution: hasUniqueSolution,
    generateSolved: generateSolved, makePuzzle: makePuzzle, targetGivens: targetGivens,
    candidates: candidates, conflicts: conflicts, isComplete: isComplete
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Sudoku = API;

})(typeof window !== "undefined" ? window : this);
