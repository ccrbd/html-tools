/* ============================================================
   Sudoku engine — generator, solver, helpers.
   Pure & dependency-free. Works in the browser (window.Sudoku)
   and in Node (module.exports) for unit testing.

   A grid is a flat array of 81 ints, row-major. 0 = empty.
   Internally we use 9-bit candidate masks (bit v set => digit v
   is used), with bits 1..9 (bit 0 unused).
   ============================================================ */
(function (root) {
  "use strict";

  var ALL = 0x3FE; // bits 1..9 set (0b1111111110)

  function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }
  function lowestBit(x) { return x & (-x); }
  function bitToDigit(bit) { // bit = 1<<v  -> v
    var v = 0; while (bit > 1) { bit >>= 1; v++; } return v;
  }
  function boxOf(r, c) { return ((r / 3) | 0) * 3 + ((c / 3) | 0); }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Build row/col/box used-masks for a grid.
  function buildMasks(g) {
    var rmask = new Array(9).fill(0), cmask = new Array(9).fill(0), bmask = new Array(9).fill(0);
    for (var i = 0; i < 81; i++) {
      var v = g[i];
      if (v) {
        var r = (i / 9) | 0, c = i % 9, bit = 1 << v;
        rmask[r] |= bit; cmask[c] |= bit; bmask[boxOf(r, c)] |= bit;
      }
    }
    return { rmask: rmask, cmask: cmask, bmask: bmask };
  }

  /* Count solutions up to `limit`. Returns { count, solution } where
     solution is the first full grid found (or null). Uses MRV +
     bitmask candidates for speed. Non-destructive. */
  function solutions(grid, limit) {
    limit = limit || 1;
    var g = grid.slice();
    var m = buildMasks(g);
    var rmask = m.rmask, cmask = m.cmask, bmask = m.bmask;
    var count = 0, firstSolution = null;

    function rec() {
      if (count >= limit) return;
      // Find empty cell with fewest candidates (MRV).
      var best = -1, bestCount = 99, bestCand = 0;
      for (var i = 0; i < 81; i++) {
        if (g[i]) continue;
        var r = (i / 9) | 0, c = i % 9, b = boxOf(r, c);
        var cand = ALL & ~(rmask[r] | cmask[c] | bmask[b]);
        var cnt = popcount(cand);
        if (cnt < bestCount) {
          bestCount = cnt; best = i; bestCand = cand;
          if (cnt <= 1) break;
        }
      }
      if (best === -1) { // all filled
        count++;
        if (!firstSolution) firstSolution = g.slice();
        return;
      }
      if (bestCount === 0) return; // dead end
      var rr = (best / 9) | 0, cc = best % 9, bb = boxOf(rr, cc);
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

  function solve(grid) {
    var r = solutions(grid, 1);
    return r.solution;
  }
  function hasUniqueSolution(grid) {
    return solutions(grid, 2).count === 1;
  }

  // Generate a random fully-solved grid via randomized MRV backtracking.
  function generateSolved() {
    var g = new Array(81).fill(0);
    var m = buildMasks(g);
    var rmask = m.rmask, cmask = m.cmask, bmask = m.bmask;

    function rec() {
      var best = -1, bestCount = 99, bestCand = 0;
      for (var i = 0; i < 81; i++) {
        if (g[i]) continue;
        var r = (i / 9) | 0, c = i % 9, b = boxOf(r, c);
        var cand = ALL & ~(rmask[r] | cmask[c] | bmask[b]);
        var cnt = popcount(cand);
        if (cnt < bestCount) { bestCount = cnt; best = i; bestCand = cand; if (cnt <= 1) break; }
      }
      if (best === -1) return true;
      if (bestCount === 0) return false;
      var rr = (best / 9) | 0, cc = best % 9, bb = boxOf(rr, cc);
      // randomize candidate order
      var bits = [];
      var cand = bestCand;
      while (cand) { var bit = lowestBit(cand); cand ^= bit; bits.push(bit); }
      shuffle(bits);
      for (var k = 0; k < bits.length; k++) {
        var bit = bits[k], v = bitToDigit(bit);
        g[best] = v; rmask[rr] |= bit; cmask[cc] |= bit; bmask[bb] |= bit;
        if (rec()) return true;
        g[best] = 0; rmask[rr] &= ~bit; cmask[cc] &= ~bit; bmask[bb] &= ~bit;
      }
      return false;
    }
    rec();
    return g;
  }

  var DIFF_GIVENS = { easy: 44, medium: 34, hard: 30, expert: 26 };

  /* Make a puzzle for a difficulty. Digs holes from a solved grid while
     keeping the solution unique. Removes in symmetric (180°) pairs for a
     classic look, stopping when the target number of givens is reached.
     Returns { puzzle, solution, givens }. */
  function makePuzzle(difficulty) {
    var target = DIFF_GIVENS[difficulty] != null ? DIFF_GIVENS[difficulty] : 34;
    var solution = generateSolved();
    var puzzle = solution.slice();
    var givens = 81;

    var cells = [];
    for (var i = 0; i < 81; i++) cells.push(i);
    shuffle(cells);

    for (var n = 0; n < cells.length && givens > target; n++) {
      var idx = cells[n];
      var partner = 80 - idx; // 180° rotation
      if (puzzle[idx] === 0) continue;
      var removed = [idx];
      if (partner !== idx && puzzle[partner] !== 0) removed.push(partner);
      // don't overshoot the target
      if (givens - removed.length < target) removed = [idx];

      var saved = removed.map(function (k) { return puzzle[k]; });
      removed.forEach(function (k) { puzzle[k] = 0; });

      if (hasUniqueSolution(puzzle)) {
        givens -= removed.length;
      } else {
        removed.forEach(function (k, j) { puzzle[k] = saved[j]; }); // restore
      }
    }
    return { puzzle: puzzle, solution: solution, givens: givens };
  }

  // Candidate digits (1..9 array) for cell i given current grid.
  function candidates(grid, i) {
    if (grid[i]) return [];
    var r = (i / 9) | 0, c = i % 9, b = boxOf(r, c);
    var used = 0;
    for (var k = 0; k < 9; k++) {
      if (grid[r * 9 + k]) used |= 1 << grid[r * 9 + k];   // row
      if (grid[k * 9 + c]) used |= 1 << grid[k * 9 + c];   // col
    }
    var br = ((r / 3) | 0) * 3, bc = ((c / 3) | 0) * 3;
    for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++) {
      var v = grid[(br + dr) * 9 + (bc + dc)];
      if (v) used |= 1 << v;
    }
    var out = [];
    for (var d = 1; d <= 9; d++) if (!(used & (1 << d))) out.push(d);
    return out;
  }

  // Indices that conflict with cell i's value (same row/col/box, same digit).
  function conflicts(grid, i) {
    var v = grid[i];
    if (!v) return [];
    var r = (i / 9) | 0, c = i % 9;
    var out = [];
    for (var k = 0; k < 9; k++) {
      var ri = r * 9 + k, ci = k * 9 + c;
      if (ri !== i && grid[ri] === v) out.push(ri);
      if (ci !== i && grid[ci] === v) out.push(ci);
    }
    var br = ((r / 3) | 0) * 3, bc = ((c / 3) | 0) * 3;
    for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++) {
      var bi = (br + dr) * 9 + (bc + dc);
      if (bi !== i && grid[bi] === v) out.push(bi);
    }
    return out;
  }

  function isComplete(grid) {
    for (var i = 0; i < 81; i++) if (!grid[i]) return false;
    for (var j = 0; j < 81; j++) if (conflicts(grid, j).length) return false;
    return true;
  }

  var API = {
    ALL: ALL, boxOf: boxOf,
    solutions: solutions, solve: solve, hasUniqueSolution: hasUniqueSolution,
    generateSolved: generateSolved, makePuzzle: makePuzzle,
    candidates: candidates, conflicts: conflicts, isComplete: isComplete,
    DIFF_GIVENS: DIFF_GIVENS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Sudoku = API;

})(typeof window !== "undefined" ? window : this);
