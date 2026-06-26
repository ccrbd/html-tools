/* ============================================================
   Chess engine — rules, move generation, and AI.
   Pure, dependency-free. Works in the browser (window.Chess)
   and in Node (module.exports) so it can be unit-tested.

   Board: flat array of 64. index = rank*8 + file,
   index 0 = a8 (top-left), index 63 = h1 (bottom-right).
   White starts at the bottom. Pieces are 2-char strings
   like "wP", "bK"; empty squares are null.
   ============================================================ */
(function (root) {
  "use strict";

  var WHITE = "w", BLACK = "b";

  function makeInitial() {
    var b = new Array(64).fill(null);
    var back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
    for (var c = 0; c < 8; c++) {
      b[c] = "b" + back[c];        // rank 8 (black back rank)
      b[8 + c] = "bP";             // rank 7
      b[48 + c] = "wP";            // rank 2
      b[56 + c] = "w" + back[c];   // rank 1 (white back rank)
    }
    return b;
  }

  function newGame() {
    return {
      board: makeInitial(),
      turn: WHITE,
      castle: { wK: true, wQ: true, bK: true, bQ: true },
      ep: -1,         // en-passant target square index, or -1
      half: 0,        // halfmove clock (for 50-move rule)
      full: 1
    };
  }

  function clone(s) {
    return {
      board: s.board.slice(),
      turn: s.turn,
      castle: { wK: s.castle.wK, wQ: s.castle.wQ, bK: s.castle.bK, bQ: s.castle.bQ },
      ep: s.ep, half: s.half, full: s.full
    };
  }

  var rowOf = function (i) { return i >> 3; };
  var colOf = function (i) { return i & 7; };
  var sq = function (r, c) { return r * 8 + c; };
  var onBoard = function (r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; };
  var colorOf = function (p) { return p ? p[0] : null; };
  var typeOf = function (p) { return p ? p[1] : null; };
  var enemy = function (col) { return col === WHITE ? BLACK : WHITE; };

  var KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING_D = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var BISHOP_D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ROOK_D = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // Is square `target` attacked by any piece of color `by`?
  function isAttacked(board, target, by) {
    var tr = rowOf(target), tc = colOf(target), i, r, c, p;

    // Pawn attacks: a `by` pawn attacks diagonally "forward".
    // White pawns move up (row -1), so they attack squares one row below them.
    var pr = by === WHITE ? tr + 1 : tr - 1;
    for (var dc = -1; dc <= 1; dc += 2) {
      c = tc + dc;
      if (onBoard(pr, c)) {
        p = board[sq(pr, c)];
        if (p === by + "P") return true;
      }
    }
    // Knight
    for (i = 0; i < 8; i++) {
      r = tr + KNIGHT_D[i][0]; c = tc + KNIGHT_D[i][1];
      if (onBoard(r, c) && board[sq(r, c)] === by + "N") return true;
    }
    // King
    for (i = 0; i < 8; i++) {
      r = tr + KING_D[i][0]; c = tc + KING_D[i][1];
      if (onBoard(r, c) && board[sq(r, c)] === by + "K") return true;
    }
    // Bishop / Queen diagonals
    for (i = 0; i < 4; i++) {
      r = tr + BISHOP_D[i][0]; c = tc + BISHOP_D[i][1];
      while (onBoard(r, c)) {
        p = board[sq(r, c)];
        if (p) {
          if (p[0] === by && (p[1] === "B" || p[1] === "Q")) return true;
          break;
        }
        r += BISHOP_D[i][0]; c += BISHOP_D[i][1];
      }
    }
    // Rook / Queen straights
    for (i = 0; i < 4; i++) {
      r = tr + ROOK_D[i][0]; c = tc + ROOK_D[i][1];
      while (onBoard(r, c)) {
        p = board[sq(r, c)];
        if (p) {
          if (p[0] === by && (p[1] === "R" || p[1] === "Q")) return true;
          break;
        }
        r += ROOK_D[i][0]; c += ROOK_D[i][1];
      }
    }
    return false;
  }

  function findKing(board, color) {
    var k = color + "K";
    for (var i = 0; i < 64; i++) if (board[i] === k) return i;
    return -1;
  }

  function inCheck(s, color) {
    var k = findKing(s.board, color);
    return k >= 0 && isAttacked(s.board, k, enemy(color));
  }

  // Generate pseudo-legal moves (may leave own king in check).
  function pseudoMoves(s) {
    var board = s.board, color = s.turn, moves = [];
    var fwd = color === WHITE ? -1 : 1;
    var startRow = color === WHITE ? 6 : 1;
    var promoRow = color === WHITE ? 0 : 7;

    function add(from, to, opts) {
      var m = { from: from, to: to, piece: board[from], captured: board[to] || null,
        promo: null, flag: null, epCap: -1 };
      if (opts) for (var k in opts) m[k] = opts[k];
      moves.push(m);
    }
    function addPawn(from, to, captured, epCap) {
      var r = rowOf(to);
      if (r === promoRow) {
        ["Q", "R", "B", "N"].forEach(function (pr) {
          moves.push({ from: from, to: to, piece: board[from], captured: captured || null,
            promo: pr, flag: "promo", epCap: epCap == null ? -1 : epCap });
        });
      } else {
        moves.push({ from: from, to: to, piece: board[from], captured: captured || null,
          promo: null, flag: epCap != null ? "ep" : null, epCap: epCap == null ? -1 : epCap });
      }
    }

    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (!p || p[0] !== color) continue;
      var t = p[1], r = rowOf(i), c = colOf(i), j, nr, nc, np;

      if (t === "P") {
        // one forward
        nr = r + fwd;
        if (onBoard(nr, c) && !board[sq(nr, c)]) {
          addPawn(i, sq(nr, c), null, null);
          // two forward
          if (r === startRow && !board[sq(r + 2 * fwd, c)]) {
            moves.push({ from: i, to: sq(r + 2 * fwd, c), piece: p, captured: null,
              promo: null, flag: "double", epCap: -1 });
          }
        }
        // captures
        for (var dc = -1; dc <= 1; dc += 2) {
          nc = c + dc;
          if (!onBoard(nr, nc)) continue;
          var dest = sq(nr, nc), dp = board[dest];
          if (dp && dp[0] !== color) addPawn(i, dest, dp, null);
          else if (dest === s.ep && s.ep >= 0) {
            // en passant: captured pawn sits on the mover's row, capture file
            addPawn(i, dest, color === WHITE ? "bP" : "wP", sq(r, nc));
          }
        }
      } else if (t === "N") {
        for (j = 0; j < 8; j++) {
          nr = r + KNIGHT_D[j][0]; nc = c + KNIGHT_D[j][1];
          if (!onBoard(nr, nc)) continue;
          np = board[sq(nr, nc)];
          if (!np || np[0] !== color) add(i, sq(nr, nc));
        }
      } else if (t === "K") {
        for (j = 0; j < 8; j++) {
          nr = r + KING_D[j][0]; nc = c + KING_D[j][1];
          if (!onBoard(nr, nc)) continue;
          np = board[sq(nr, nc)];
          if (!np || np[0] !== color) add(i, sq(nr, nc));
        }
        // castling (legality of passing squares checked later)
        var rights = s.castle, homeRow = color === WHITE ? 7 : 0;
        if (r === homeRow && c === 4) {
          var kSide = color === WHITE ? rights.wK : rights.bK;
          var qSide = color === WHITE ? rights.wQ : rights.bQ;
          if (kSide && !board[sq(homeRow, 5)] && !board[sq(homeRow, 6)] &&
              board[sq(homeRow, 7)] === color + "R") {
            add(i, sq(homeRow, 6), { flag: "castleK" });
          }
          if (qSide && !board[sq(homeRow, 3)] && !board[sq(homeRow, 2)] &&
              !board[sq(homeRow, 1)] && board[sq(homeRow, 0)] === color + "R") {
            add(i, sq(homeRow, 2), { flag: "castleQ" });
          }
        }
      } else {
        var dirs = t === "B" ? BISHOP_D : t === "R" ? ROOK_D : BISHOP_D.concat(ROOK_D);
        for (j = 0; j < dirs.length; j++) {
          nr = r + dirs[j][0]; nc = c + dirs[j][1];
          while (onBoard(nr, nc)) {
            np = board[sq(nr, nc)];
            if (!np) add(i, sq(nr, nc));
            else { if (np[0] !== color) add(i, sq(nr, nc)); break; }
            nr += dirs[j][0]; nc += dirs[j][1];
          }
        }
      }
    }
    return moves;
  }

  // Apply a move, mutating state; return undo info.
  function makeMove(s, m) {
    var board = s.board, color = s.turn;
    var undo = { ep: s.ep, half: s.half, full: s.full,
      castle: { wK: s.castle.wK, wQ: s.castle.wQ, bK: s.castle.bK, bQ: s.castle.bQ },
      captured: m.captured, capSq: m.to, rookFrom: -1, rookTo: -1, rookPiece: null };

    var movingPawn = m.piece[1] === "P";
    s.half = (m.captured || movingPawn) ? 0 : s.half + 1;

    board[m.to] = m.piece;
    board[m.from] = null;

    if (m.flag === "ep") { undo.capSq = m.epCap; board[m.epCap] = null; }
    if (m.flag === "promo") board[m.to] = color + m.promo;

    if (m.flag === "castleK") {
      var hr = rowOf(m.from);
      undo.rookFrom = sq(hr, 7); undo.rookTo = sq(hr, 5);
      undo.rookPiece = board[undo.rookFrom];
      board[undo.rookTo] = board[undo.rookFrom]; board[undo.rookFrom] = null;
    } else if (m.flag === "castleQ") {
      var hr2 = rowOf(m.from);
      undo.rookFrom = sq(hr2, 0); undo.rookTo = sq(hr2, 3);
      undo.rookPiece = board[undo.rookFrom];
      board[undo.rookTo] = board[undo.rookFrom]; board[undo.rookFrom] = null;
    }

    // Update en-passant target
    s.ep = m.flag === "double" ? sq((rowOf(m.from) + rowOf(m.to)) / 2, colOf(m.from)) : -1;

    // Update castling rights
    if (m.piece === "wK") { s.castle.wK = false; s.castle.wQ = false; }
    if (m.piece === "bK") { s.castle.bK = false; s.castle.bQ = false; }
    if (m.from === 63 || m.to === 63) s.castle.wK = false;
    if (m.from === 56 || m.to === 56) s.castle.wQ = false;
    if (m.from === 7 || m.to === 7) s.castle.bK = false;
    if (m.from === 0 || m.to === 0) s.castle.bQ = false;

    if (color === BLACK) s.full++;
    s.turn = enemy(color);
    return undo;
  }

  function unmakeMove(s, m, undo) {
    s.turn = enemy(s.turn);
    var color = s.turn, board = s.board;

    board[m.from] = m.piece;
    board[m.to] = null;
    if (m.flag === "ep") {
      board[undo.capSq] = undo.captured; // captured pawn restored on its square
    } else if (m.captured) {
      board[m.to] = m.captured;
    }
    if (undo.rookPiece) { board[undo.rookFrom] = undo.rookPiece; board[undo.rookTo] = null; }

    s.ep = undo.ep; s.half = undo.half; s.full = undo.full;
    s.castle = undo.castle;
  }

  // Fully legal moves (king not left in check; castling squares safe).
  function legalMoves(s) {
    var pseudo = pseudoMoves(s), legal = [], color = s.turn;
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      // Castling: king must not be in check now, nor pass through an attacked square.
      if (m.flag === "castleK" || m.flag === "castleQ") {
        if (inCheck(s, color)) continue;
        var hr = rowOf(m.from);
        var passCol = m.flag === "castleK" ? 5 : 3;
        if (isAttacked(s.board, sq(hr, passCol), enemy(color))) continue;
        // destination safety handled by the general test below
      }
      var undo = makeMove(s, m);
      if (!inCheck(s, color)) legal.push(m);
      unmakeMove(s, m, undo);
    }
    return legal;
  }

  // Game status from the side-to-move's perspective.
  function status(s) {
    var moves = legalMoves(s);
    if (moves.length === 0) {
      return inCheck(s, s.turn) ? "checkmate" : "stalemate";
    }
    if (s.half >= 100) return "draw-50";
    if (insufficientMaterial(s.board)) return "draw-material";
    return "ongoing";
  }

  function insufficientMaterial(board) {
    var pieces = [];
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p && p[1] !== "K") pieces.push(p[1]);
    }
    if (pieces.length === 0) return true;                 // K vs K
    if (pieces.length === 1 && (pieces[0] === "B" || pieces[0] === "N")) return true; // K+minor
    if (pieces.length === 2 && pieces[0] === "B" && pieces[1] === "B") return true;   // K+B vs K+B (approx)
    return false;
  }

  // ---------- Notation helpers ----------
  var FILES = "abcdefgh";
  function sqName(i) { return FILES[colOf(i)] + (8 - rowOf(i)); }

  // ============================================================
  //  AI — alpha-beta negamax with material + piece-square eval
  // ============================================================
  var VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  // Piece-square tables (white's view, index 0 = a8). Black mirrors.
  var PST = {
    P: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
        5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
        5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40,
        -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
        -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
        -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10,
        -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
        -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
        -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    R: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5,
        -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
        -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10,
        -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5,
        -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    K: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
        -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
        20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
  };

  function mirror(i) { return (7 - rowOf(i)) * 8 + colOf(i); }

  // Evaluation from the perspective of side `s.turn` (positive = good for it).
  function evaluate(s) {
    var score = 0, board = s.board;
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (!p) continue;
      var t = p[1], v = VAL[t] + PST[t][p[0] === WHITE ? i : mirror(i)];
      score += p[0] === WHITE ? v : -v;
    }
    return s.turn === WHITE ? score : -score;
  }

  // MVV-LVA ordering: try captures of valuable pieces by cheap pieces first.
  function orderMoves(moves) {
    moves.sort(function (a, b) {
      var sa = a.captured ? VAL[a.captured[1]] * 10 - VAL[a.piece[1]] : 0;
      var sb = b.captured ? VAL[b.captured[1]] * 10 - VAL[b.piece[1]] : 0;
      if (a.promo) sa += 800;
      if (b.promo) sb += 800;
      return sb - sa;
    });
    return moves;
  }

  function negamax(s, depth, alpha, beta) {
    if (depth === 0) return evaluate(s);
    var moves = legalMoves(s);
    if (moves.length === 0) {
      return inCheck(s, s.turn) ? -100000 - depth : 0; // mate (prefer faster) or stalemate
    }
    orderMoves(moves);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var undo = makeMove(s, moves[i]);
      var val = -negamax(s, depth - 1, -beta, -alpha);
      unmakeMove(s, moves[i], undo);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // cutoff
    }
    return best;
  }

  /* Pick a move for the side to move.
     opts.level: "easy" | "medium" | "hard" | "expert"
     opts.maxMs: optional time budget for iterative deepening (default 1200). */
  function bestMove(state, opts) {
    opts = opts || {};
    var level = opts.level || "medium";
    var s = clone(state);
    var moves = legalMoves(s);
    if (moves.length === 0) return null;

    // Easy: mostly material-greedy depth 1, with frequent random choice (beatable).
    if (level === "easy") {
      if (Math.random() < 0.35) return moves[(Math.random() * moves.length) | 0];
    }

    var depthByLevel = { easy: 1, medium: 2, hard: 3, expert: 4 };
    var targetDepth = depthByLevel[level] || 2;
    var maxMs = opts.maxMs || (level === "expert" ? 2000 : 1200);
    var start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    var now = function () { return (typeof performance !== "undefined" ? performance.now() : Date.now()); };

    orderMoves(moves);
    var bestMoveSoFar = moves[0], bestScore = -Infinity;

    // Iterative deepening so we can stop on the time budget (keeps mobile snappy).
    for (var d = 1; d <= targetDepth; d++) {
      var localBest = -Infinity, localMove = bestMoveSoFar, scored = [];
      var alpha = -Infinity, beta = Infinity, aborted = false;
      for (var i = 0; i < moves.length; i++) {
        var undo = makeMove(s, moves[i]);
        var val = -negamax(s, d - 1, -beta, -alpha);
        unmakeMove(s, moves[i], undo);
        scored.push({ m: moves[i], v: val });
        if (val > localBest) { localBest = val; localMove = moves[i]; }
        if (val > alpha) alpha = val;
        if (now() - start > maxMs) { aborted = true; break; }
      }
      // Re-order root moves by this iteration's scores for better pruning next depth.
      scored.sort(function (a, b) { return b.v - a.v; });
      if (scored.length) moves = scored.map(function (x) { return x.m; });
      bestMoveSoFar = localMove; bestScore = localBest;
      if (aborted) break;
    }

    // Add a little human-like variety on lower levels: among near-best moves, pick one.
    if (level === "easy" || level === "medium") {
      var tol = level === "easy" ? 80 : 30;
      // Recompute shallow scores for top moves to add slight randomness.
      var pool = [];
      var sc = [];
      for (var k = 0; k < moves.length; k++) {
        var u = makeMove(s, moves[k]);
        var vv = -negamax(s, (targetDepth - 1) || 0, -Infinity, Infinity);
        unmakeMove(s, moves[k], u);
        sc.push({ m: moves[k], v: vv });
      }
      sc.sort(function (a, b) { return b.v - a.v; });
      var top = sc[0].v;
      for (var z = 0; z < sc.length; z++) if (sc[z].v >= top - tol) pool.push(sc[z].m);
      return pool[(Math.random() * pool.length) | 0];
    }

    return bestMoveSoFar;
  }

  var API = {
    WHITE: WHITE, BLACK: BLACK,
    newGame: newGame, clone: clone,
    rowOf: rowOf, colOf: colOf, sq: sq, colorOf: colorOf, typeOf: typeOf, enemy: enemy,
    pseudoMoves: pseudoMoves, legalMoves: legalMoves,
    makeMove: makeMove, unmakeMove: unmakeMove,
    isAttacked: isAttacked, inCheck: inCheck, findKing: findKing,
    status: status, insufficientMaterial: insufficientMaterial,
    sqName: sqName, evaluate: evaluate, bestMove: bestMove, VAL: VAL
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Chess = API;

})(typeof window !== "undefined" ? window : this);
