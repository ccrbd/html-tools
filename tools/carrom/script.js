/* ============================================================
   Carrom — physics-based board game vs an AI bot
   Modular vanilla JS.

   Testable, DOM-free cores:
     * Physics      — sub-stepped circle solver (friction, walls,
                      pockets). No tunneling (capped strike speed,
                      dt small enough that step move < coin radius).
     * CarromEngine — board setup + full turn/foul/queen/scoring
                      state machine.
     * CarromAI     — geometric candidate shots, simulated headless
                      with Physics, scored, plus difficulty noise.
   Browser-only: Renderer (canvas), AudioController, CarromGame.
   Settings persist under "html-tools-carrom".
   ============================================================ */

(function (root) {
  "use strict";

  /* ---------------- geometry / tuning ---------------- */
  var GEO = {
    L: 720, FRAME: 42,
    minX: 42, maxX: 678, minY: 42, maxY: 678,
    coinR: 15, strikerR: 18.5,
    coinMass: 1, strikerMass: 1.7,
    pocketR: 30, pocketCap: 24,
    baseOff: 66, baseInset: 96,
    center: { x: 360, y: 360 },
    pockets: [{ x: 42, y: 42 }, { x: 678, y: 42 }, { x: 42, y: 678 }, { x: 678, y: 678 }],
    maxSpeed: 2600,
    friction: 1.9,
    wallRest: 0.55,
    coinRest: 0.92,
    stopEps: 9
  };
  GEO.humanBaseY = GEO.maxY - GEO.baseOff; // 612 (bottom)
  GEO.botBaseY = GEO.minY + GEO.baseOff;   // 108 (top)
  GEO.strikerXmin = GEO.minX + GEO.baseInset + GEO.strikerR;
  GEO.strikerXmax = GEO.maxX - GEO.baseInset - GEO.strikerR;

  /* ---------------- utils ---------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function gauss() { return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2; }
  function hypot(x, y) { return Math.sqrt(x * x + y * y); }
  function cloneBody(b) { return { id: b.id, type: b.type, color: b.color, x: b.x, y: b.y, vx: 0, vy: 0, r: b.r, mass: b.mass, potted: false }; }

  /* ============================================================
     Physics
     ============================================================ */
  function Physics(geo) { this.geo = geo || GEO; }

  Physics.prototype.substep = function (bodies, dt, ev) {
    var g = this.geo, n = bodies.length, i, j, a, b;
    var fr = Math.exp(-g.friction * dt);
    for (i = 0; i < n; i++) {
      a = bodies[i]; if (a.potted) continue;
      a.x += a.vx * dt; a.y += a.vy * dt;
      a.vx *= fr; a.vy *= fr;
      if (a.vx * a.vx + a.vy * a.vy < g.stopEps * g.stopEps) { a.vx = 0; a.vy = 0; }
    }
    // collisions
    for (i = 0; i < n; i++) {
      a = bodies[i]; if (a.potted) continue;
      for (j = i + 1; j < n; j++) {
        b = bodies[j]; if (b.potted) continue;
        var dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 < rs * rs && d2 > 1e-9) {
          var d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          var overlap = rs - d, im = 1 / a.mass, jm = 1 / b.mass, tot = im + jm;
          a.x -= nx * overlap * (im / tot); a.y -= ny * overlap * (im / tot);
          b.x += nx * overlap * (jm / tot); b.y += ny * overlap * (jm / tot);
          var rvx = b.vx - a.vx, rvy = b.vy - a.vy, sep = rvx * nx + rvy * ny;
          if (sep < 0) {
            var imp = -(1 + g.coinRest) * sep / tot;
            a.vx -= imp * im * nx; a.vy -= imp * im * ny;
            b.vx += imp * jm * nx; b.vy += imp * jm * ny;
            if (ev) {
              ev.impact = Math.max(ev.impact || 0, -sep);
              if (a.type === "striker" || b.type === "striker") ev.contacted = true;
            }
          }
        }
      }
    }
    // walls
    for (i = 0; i < n; i++) {
      a = bodies[i]; if (a.potted) continue;
      if (a.x - a.r < g.minX) { a.x = g.minX + a.r; a.vx = -a.vx * g.wallRest; if (ev) ev.wall = true; }
      else if (a.x + a.r > g.maxX) { a.x = g.maxX - a.r; a.vx = -a.vx * g.wallRest; if (ev) ev.wall = true; }
      if (a.y - a.r < g.minY) { a.y = g.minY + a.r; a.vy = -a.vy * g.wallRest; if (ev) ev.wall = true; }
      else if (a.y + a.r > g.maxY) { a.y = g.maxY - a.r; a.vy = -a.vy * g.wallRest; if (ev) ev.wall = true; }
    }
    // pockets
    for (i = 0; i < n; i++) {
      a = bodies[i]; if (a.potted) continue;
      for (var p = 0; p < g.pockets.length; p++) {
        var pk = g.pockets[p], ex = a.x - pk.x, ey = a.y - pk.y;
        if (ex * ex + ey * ey < g.pocketCap * g.pocketCap) {
          a.potted = true; a.vx = 0; a.vy = 0;
          if (ev && ev.potted) ev.potted.push(a);
          break;
        }
      }
    }
  };

  Physics.prototype.atRest = function (bodies) {
    for (var i = 0; i < bodies.length; i++) { var a = bodies[i]; if (!a.potted && (a.vx !== 0 || a.vy !== 0)) return false; }
    return true;
  };

  Physics.prototype.settle = function (bodies, maxSteps) {
    var ev = { potted: [], contacted: false, impact: 0 };
    var dt = 1 / 360, steps = 0; maxSteps = maxSteps || 3000;
    while (steps < maxSteps) { this.substep(bodies, dt, ev); steps++; if (this.atRest(bodies)) break; }
    return ev;
  };

  /* ============================================================
     CarromEngine — rules + state
     ============================================================ */
  function CarromEngine(opts) {
    opts = opts || {};
    this.geo = GEO;
    this.humanColor = opts.humanColor || "white";
    this.botColor = this.humanColor === "white" ? "black" : "white";
    this.target = opts.target || 21;
    this.scores = { white: 0, black: 0 };
    this.board = 0;
    this.coins = [];
    this.pocketed = { white: [], black: [] };
    this.turnColor = "white";
    this.pendingQueen = null;
    this._queenHeld = null;
    this.queenOwner = null;
    this.queenCovered = false;
    this._id = 0;
  }

  CarromEngine.prototype._mk = function (type, color, x, y) {
    var r = type === "striker" ? this.geo.strikerR : this.geo.coinR;
    var m = type === "striker" ? this.geo.strikerMass : this.geo.coinMass;
    return { id: "b" + (this._id++), type: type, color: color, x: x, y: y, vx: 0, vy: 0, r: r, mass: m, potted: false };
  };

  CarromEngine.prototype.newBoard = function (breakColor) {
    this.coins = []; this.pocketed = { white: [], black: [] };
    this.pendingQueen = null; this._queenHeld = null; this.queenOwner = null; this.queenCovered = false;
    var c = this.geo.center, inR = 30, outR = 61, i;
    this.coins.push(this._mk("queen", "red", c.x, c.y));
    for (i = 0; i < 6; i++) {
      var a1 = Math.PI / 6 + i * Math.PI / 3;
      this.coins.push(this._mk("coin", i % 2 === 0 ? "white" : "black", c.x + inR * Math.cos(a1), c.y + inR * Math.sin(a1)));
    }
    for (i = 0; i < 12; i++) {
      var a2 = i * Math.PI / 6;
      this.coins.push(this._mk("coin", i % 2 === 0 ? "white" : "black", c.x + outR * Math.cos(a2), c.y + outR * Math.sin(a2)));
    }
    this.turnColor = breakColor || "white";
    this.board++;
  };

  CarromEngine.prototype.coinsLeft = function (color) {
    return this.coins.filter(function (c) { return c.type === "coin" && c.color === color; }).length;
  };
  CarromEngine.prototype.queenOnBoard = function () {
    return this.coins.some(function (c) { return c.type === "queen"; });
  };

  CarromEngine.prototype._placeAtCenter = function (coin) {
    var c = this.geo.center, step = this.geo.coinR * 2 + 3, spots = [[0, 0]], ring, k;
    for (ring = 1; ring < 9; ring++) for (k = 0; k < ring * 6; k++) {
      var ang = k / (ring * 6) * Math.PI * 2;
      spots.push([ring * step * Math.cos(ang), ring * step * Math.sin(ang)]);
    }
    for (var s = 0; s < spots.length; s++) {
      var x = c.x + spots[s][0], y = c.y + spots[s][1];
      if (x < this.geo.minX + coin.r || x > this.geo.maxX - coin.r || y < this.geo.minY + coin.r || y > this.geo.maxY - coin.r) continue;
      var ok = true;
      for (var i = 0; i < this.coins.length; i++) {
        var o = this.coins[i], dx = o.x - x, dy = o.y - y, rr = o.r + coin.r;
        if (dx * dx + dy * dy < rr * rr) { ok = false; break; }
      }
      if (ok) { coin.x = x; coin.y = y; coin.vx = 0; coin.vy = 0; coin.potted = false; this.coins.push(coin); return true; }
    }
    coin.x = c.x; coin.y = c.y; coin.vx = 0; coin.vy = 0; coin.potted = false; this.coins.push(coin); return true;
  };

  CarromEngine.prototype._returnDue = function (color) {
    if (this.pocketed[color].length) { this._placeAtCenter(this.pocketed[color].pop()); return true; }
    return false;
  };

  // evt = { strikerPotted, contacted }; reads potted flags on this.coins
  CarromEngine.prototype.resolveStroke = function (evt) {
    var self = this, color = this.turnColor, opp = color === "white" ? "black" : "white";
    var potted = this.coins.filter(function (c) { return c.potted; });
    var ownPotted = [], oppPotted = [], queenPotted = null;
    potted.forEach(function (c) {
      if (c.type === "queen") queenPotted = c;
      else if (c.color === color) ownPotted.push(c);
      else oppPotted.push(c);
    });
    this.coins = this.coins.filter(function (c) { return !c.potted; });
    ownPotted.forEach(function (c) { self.pocketed[color].push(c); });

    var msgs = [], foul = false;
    if (evt.strikerPotted) { foul = true; msgs.push("Striker pocketed — foul"); }
    if (oppPotted.length) { foul = true; msgs.push("Potted opponent’s coin — foul"); oppPotted.forEach(function (c) { self._placeAtCenter(c); }); }
    if (!evt.contacted) { foul = true; msgs.push("Struck no coin — foul"); }

    if (queenPotted) {
      if (!foul && ownPotted.length > 0) { this.queenOwner = color; this.queenCovered = true; this.pendingQueen = null; this._queenHeld = null; msgs.push("Queen potted and covered!"); }
      else if (!foul) { this.pendingQueen = color; this._queenHeld = queenPotted; msgs.push("Queen potted — cover her!"); }
      else { this._placeAtCenter(queenPotted); msgs.push("Queen returns"); }
    }
    if (this.pendingQueen === color && !queenPotted && !foul && ownPotted.length > 0) {
      this.queenOwner = color; this.queenCovered = true; this.pendingQueen = null; this._queenHeld = null; msgs.push("Queen covered!");
    }

    if (foul) { if (this._returnDue(color)) msgs.push("Penalty: a coin returned"); }

    var continueTurn = !foul && (ownPotted.length > 0 || !!queenPotted);
    var ownLeft = this.coinsLeft(color);
    var boardOver = false, winner = null, points = 0, matchOver = false, matchWinner = null;

    if (!foul && ownLeft === 0 && ownPotted.length > 0) {
      if (this.pendingQueen === color) { this.queenOwner = color; this.queenCovered = true; this.pendingQueen = null; this._queenHeld = null; }
      boardOver = true; winner = color;
      points = this.coinsLeft(opp) + ((this.queenOwner === color && this.queenCovered) ? 3 : 0);
      this.scores[color] += points;
      if (this.scores[color] >= this.target) { matchOver = true; matchWinner = color; }
      msgs.push((color === this.humanColor ? "You" : "Bot") + " cleared the board! +" + points);
    }

    if (!continueTurn && !boardOver) {
      if (this.pendingQueen && this._queenHeld) { this._placeAtCenter(this._queenHeld); this.pendingQueen = null; this._queenHeld = null; msgs.push("Queen returns (not covered)"); }
      this.turnColor = opp;
    }

    return {
      color: color, foul: foul, ownPotted: ownPotted.length, oppPotted: oppPotted.length,
      queenPotted: !!queenPotted, continueTurn: continueTurn, boardOver: boardOver, winner: winner,
      points: points, matchOver: matchOver, matchWinner: matchWinner, messages: msgs, ownLeft: ownLeft
    };
  };

  /* ============================================================
     CarromAI
     ============================================================ */
  function CarromAI(difficulty) {
    this.difficulty = difficulty || "medium";
    this.physics = new Physics(GEO);
    this.baseY = GEO.botBaseY;
    this.xmin = GEO.strikerXmin;
    this.xmax = GEO.strikerXmax;
  }
  CarromAI.prototype.thinkTime = function () {
    return this.difficulty === "easy" ? 1100 : this.difficulty === "medium" ? 850 : 650;
  };

  CarromAI.prototype._score = function (engine, cand, color) {
    var clones = engine.coins.map(cloneBody);
    var st = { id: "S", type: "striker", color: null, x: cand.sx, y: cand.baseY, r: GEO.strikerR, mass: GEO.strikerMass,
      vx: cand.dir.x * cand.power * GEO.maxSpeed, vy: cand.dir.y * cand.power * GEO.maxSpeed, potted: false };
    var bodies = clones.concat(st);
    var ev = this.physics.settle(bodies, 2500);
    var own = 0, oppN = 0, queen = false;
    ev.potted.forEach(function (b) {
      if (b.type === "striker") return;
      if (b.type === "queen") queen = true;
      else if (b.color === color) own++; else oppN++;
    });
    var s = own * 100;
    if (queen) s += (own > 0 || engine.pendingQueen === color) ? 130 : 25;
    if (st.potted) s -= 320;
    s -= oppN * 90;
    if (!ev.contacted) s -= 220;
    return { score: s, contacted: ev.contacted, own: own };
  };

  CarromAI.prototype.chooseShot = function (engine) {
    var color = engine.turnColor, geo = GEO, self = this;
    var baseY = this.baseY, xmin = this.xmin, xmax = this.xmax;
    var own = engine.coins.filter(function (c) { return c.type === "coin" && c.color === color; });
    var targets = own.slice();
    if (this.difficulty !== "easy" && engine.queenOnBoard() && !engine.queenOwner) {
      var q = engine.coins.filter(function (c) { return c.type === "queen"; })[0];
      if (q) targets.push(q);
    }
    var cands = [];
    targets.forEach(function (coin) {
      geo.pockets.forEach(function (pk) {
        var dirx = pk.x - coin.x, diry = pk.y - coin.y, dl = hypot(dirx, diry);
        if (dl < 1) return; dirx /= dl; diry /= dl;
        if (Math.abs(diry) < 0.15) return;
        var t = (coin.y - baseY) / diry;
        if (t <= 0) return;
        var sx = coin.x - t * dirx;
        if (sx < xmin || sx > xmax) return;
        var aimx = coin.x - sx, aimy = coin.y - baseY, al = hypot(aimx, aimy);
        if (al < 1) return; aimx /= al; aimy /= al;
        cands.push({ sx: sx, baseY: baseY, dir: { x: aimx, y: aimy }, power: clamp(0.3 + (al + dl) / 900, 0.2, 1) });
      });
    });
    // random candidates aimed near the cluster (robustness / easy)
    var rc = this.difficulty === "hard" ? 10 : this.difficulty === "medium" ? 8 : 10;
    for (var i = 0; i < rc; i++) {
      var sx = xmin + Math.random() * (xmax - xmin);
      var tx = geo.center.x + (Math.random() * 2 - 1) * 90, ty = geo.center.y + (Math.random() * 2 - 1) * 90;
      var ax = tx - sx, ay = ty - baseY, al = hypot(ax, ay);
      cands.push({ sx: sx, baseY: baseY, dir: { x: ax / al, y: ay / al }, power: 0.45 + Math.random() * 0.5 });
    }
    // cap evaluations by difficulty
    var cap = this.difficulty === "easy" ? 14 : this.difficulty === "medium" ? 36 : 64;
    if (cands.length > cap) cands = cands.slice(0, cap);

    var best = null, bestContacted = null;
    cands.forEach(function (c) {
      var r = self._score(engine, c, color);
      c._eval = r;
      if (!best || r.score > best._eval.score) best = c;
      if (r.contacted && (!bestContacted || r.score > bestContacted._eval.score)) bestContacted = c;
    });
    if (!best) { // safety: gentle tap at cluster
      best = { sx: (xmin + xmax) / 2, baseY: baseY, dir: { x: (geo.center.x - (xmin + xmax) / 2), y: geo.center.y - baseY }, power: 0.5 };
      var bl = hypot(best.dir.x, best.dir.y); best.dir.x /= bl; best.dir.y /= bl;
    } else if (best._eval && !best._eval.contacted && bestContacted) {
      best = bestContacted; // never intentionally foul by missing everything
    }

    // execution noise by difficulty (easy is clearly weakest but still functional)
    var na = this.difficulty === "easy" ? 0.085 : this.difficulty === "medium" ? 0.045 : 0.015;
    var np = this.difficulty === "easy" ? 0.11 : this.difficulty === "medium" ? 0.07 : 0.025;
    var nx = this.difficulty === "easy" ? 20 : this.difficulty === "medium" ? 11 : 4;
    var ang = Math.atan2(best.dir.y, best.dir.x) + gauss() * na;
    var pow = clamp(best.power * (1 + gauss() * np), 0.16, 1);
    var fsx = clamp(best.sx + gauss() * nx, xmin, xmax);
    return { sx: fsx, baseY: baseY, dir: { x: Math.cos(ang), y: Math.sin(ang) }, power: pow };
  };

  /* ============================================================
     THEMES (canvas palette)
     ============================================================ */
  var THEMES = {
    classic: { frame: "#6b4a2b", frameEdge: "#4a3018", wood: "#e9c98f", line: "#7a5a2e", circle: "#a8471f", arrow: "#a8471f", white: "#f4ead2", whiteEdge: "#c7b083", black: "#2c2c30", blackEdge: "#0e0e12", queen: "#c62030", queenEdge: "#7e0f18", striker: "#f7f4e8", strikerRing: "#cc3333", pocket: "#160f04", label: "#3a2a12", glow: 0 },
    cyber: { frame: "#0c0c14", frameEdge: "#000000", wood: "#0e0e1a", line: "#1f6f7a", circle: "#00e5ff", arrow: "#ff2e88", white: "#00e5ff", whiteEdge: "#0891a3", black: "#ff2e88", blackEdge: "#a01d59", queen: "#b6ff00", queenEdge: "#6f9e00", striker: "#eef2ff", strikerRing: "#00e5ff", pocket: "#000000", label: "#7fe9ff", glow: 12 },
    matte: { frame: "#cfd8dc", frameEdge: "#aab6bc", wood: "#eef1f3", line: "#b7c2c8", circle: "#8fa3ad", arrow: "#8fa3ad", white: "#fbfbfb", whiteEdge: "#d3dbdf", black: "#546e7a", blackEdge: "#39505a", queen: "#ef9a9a", queenEdge: "#cf7f7f", striker: "#ffffff", strikerRing: "#90caf9", pocket: "#8fa3ad", label: "#5b6b73", glow: 0 },
    gold: { frame: "#191919", frameEdge: "#000000", wood: "#2a2a2e", line: "#8a6d2f", circle: "#d8b25a", arrow: "#d8b25a", white: "#efe6cf", whiteEdge: "#b3a37d", black: "#141414", blackEdge: "#000000", queen: "#e0be6a", queenEdge: "#8a6d2f", striker: "#f0e6c8", strikerRing: "#d8b25a", pocket: "#000000", label: "#d8b25a", glow: 6 }
  };

  /* ============================================================
     Renderer (canvas)
     ============================================================ */
  function Renderer(canvas, wrap) {
    this.canvas = canvas; this.wrap = wrap;
    this.ctx = canvas.getContext("2d");
    this.theme = THEMES.classic;
    this.scale = 1;
  }
  Renderer.prototype.setTheme = function (name) { this.theme = THEMES[name] || THEMES.classic; };
  Renderer.prototype.resize = function () {
    var rect = this.wrap.getBoundingClientRect();
    var dpr = root.devicePixelRatio || 1;
    var size = Math.max(1, rect.width);
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.scale = this.canvas.width / GEO.L;
    this.cssSize = size;
  };
  Renderer.prototype.toLogical = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * GEO.L, y: (clientY - rect.top) / rect.height * GEO.L };
  };

  Renderer.prototype._coin = function (ctx, c) {
    var t = this.theme, fill, edge;
    if (c.type === "queen") { fill = t.queen; edge = t.queenEdge; }
    else if (c.type === "striker") { fill = t.striker; edge = t.strikerRing; }
    else if (c.color === "white") { fill = t.white; edge = t.whiteEdge; }
    else { fill = t.black; edge = t.blackEdge; }
    ctx.save();
    // shadow
    ctx.beginPath(); ctx.arc(c.x, c.y + 2.5, c.r, 0, 7); ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fill();
    if (t.glow) { ctx.shadowColor = fill; ctx.shadowBlur = t.glow; }
    var g = ctx.createRadialGradient(c.x - c.r * 0.35, c.y - c.r * 0.4, c.r * 0.2, c.x, c.y, c.r);
    g.addColorStop(0, "rgba(255,255,255,.35)"); g.addColorStop(0.25, fill); g.addColorStop(1, fill);
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.stroke();
    if (c.type === "striker") { ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.55, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.stroke(); }
    if (c.type === "queen") { ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.4, 0, 7); ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fill(); }
    ctx.restore();
  };

  Renderer.prototype.draw = function (state) {
    var ctx = this.ctx, t = this.theme, g = GEO;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, g.L, g.L);
    // frame
    ctx.fillStyle = t.frameEdge; this._round(ctx, 0, 0, g.L, g.L, 16); ctx.fill();
    ctx.fillStyle = t.frame; this._round(ctx, 6, 6, g.L - 12, g.L - 12, 12); ctx.fill();
    // playing surface
    ctx.fillStyle = t.wood; ctx.fillRect(g.minX, g.minY, g.maxX - g.minX, g.maxY - g.minY);
    // border lines
    ctx.strokeStyle = t.line; ctx.lineWidth = 3;
    ctx.strokeRect(g.minX + 6, g.minY + 6, g.maxX - g.minX - 12, g.maxY - g.minY - 12);
    ctx.lineWidth = 1.5; ctx.strokeRect(g.minX + 12, g.minY + 12, g.maxX - g.minX - 24, g.maxY - g.minY - 24);

    if (t.glow) { ctx.shadowColor = t.circle; ctx.shadowBlur = 6; }
    // center circle + sun
    ctx.strokeStyle = t.circle; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(g.center.x, g.center.y, 84, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(g.center.x, g.center.y, 20, 0, 7); ctx.stroke();
    // diagonal arrows toward pockets
    ctx.strokeStyle = t.arrow; ctx.lineWidth = 3;
    g.pockets.forEach(function (pk) {
      var dx = pk.x - g.center.x, dy = pk.y - g.center.y, d = hypot(dx, dy); dx /= d; dy /= d;
      var x1 = g.center.x + dx * 96, y1 = g.center.y + dy * 96, x2 = pk.x - dx * 44, y2 = pk.y - dy * 44;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // arrowhead
      var ah = 9; ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - dx * ah - dy * ah * 0.6, y2 - dy * ah + dx * ah * 0.6);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - dx * ah + dy * ah * 0.6, y2 - dy * ah - dx * ah * 0.6);
      ctx.stroke();
    });
    ctx.shadowBlur = 0;

    // baselines (top + bottom) with end circles
    [g.humanBaseY, g.botBaseY].forEach(function (by) {
      ctx.strokeStyle = t.circle; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(g.minX + g.baseInset, by); ctx.lineTo(g.maxX - g.baseInset, by); ctx.stroke();
      [g.minX + g.baseInset, g.maxX - g.baseInset].forEach(function (bx) {
        ctx.beginPath(); ctx.arc(bx, by, 13, 0, 7); ctx.stroke();
      });
    });

    // pockets
    g.pockets.forEach(function (pk) {
      var rg = ctx.createRadialGradient(pk.x, pk.y, 4, pk.x, pk.y, g.pocketR);
      rg.addColorStop(0, "#000"); rg.addColorStop(0.7, t.pocket); rg.addColorStop(1, t.frameEdge);
      ctx.beginPath(); ctx.arc(pk.x, pk.y, g.pocketR, 0, 7); ctx.fillStyle = rg; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = t.line; ctx.stroke();
    });

    // coins
    if (state.coins) state.coins.forEach(this._coin.bind(this, ctx));

    // striker (in-play or preview)
    if (state.striker) this._coin(ctx, state.striker);

    // aim guide
    if (state.aim) {
      var a = state.aim;
      ctx.save();
      ctx.strokeStyle = t.glow ? t.circle : "rgba(255,255,255,.85)";
      ctx.lineWidth = 3; ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.tx, a.ty); ctx.stroke();
      ctx.setLineDash([]);
      // reticle
      ctx.beginPath(); ctx.arc(a.tx, a.ty, 7, 0, 7); ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2; ctx.stroke();
      // pull indicator (behind striker)
      ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.px, a.py); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };
  Renderer.prototype._round = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };

  /* ============================================================
     AudioController (Web Audio, synthesised)
     ============================================================ */
  function AudioController() {
    this.ctx = null; this.mute = false; this.theme = "classic";
  }
  AudioController.prototype.resume = function () {
    if (!this.ctx) { var AC = root.AudioContext || root.webkitAudioContext; if (AC) this.ctx = new AC(); }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  };
  AudioController.prototype.setTheme = function (t) { this.theme = t; };
  AudioController.prototype._tone = function (f, dur, opt) {
    if (this.mute || !this.ctx) return; opt = opt || {};
    var t0 = this.ctx.currentTime, o = this.ctx.createOscillator(), gn = this.ctx.createGain();
    o.type = opt.type || (this.theme === "cyber" ? "sawtooth" : this.theme === "matte" ? "sine" : "triangle");
    o.frequency.setValueAtTime(f, t0);
    if (opt.slideTo) o.frequency.exponentialRampToValueAtTime(opt.slideTo, t0 + dur);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(opt.gain || 0.16, t0 + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn); gn.connect(this.ctx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  };
  AudioController.prototype._noise = function (dur, opt) {
    if (this.mute || !this.ctx) return; opt = opt || {};
    var t0 = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var f = this.ctx.createBiquadFilter(); f.type = opt.type || "bandpass"; f.frequency.value = opt.freq || 1400;
    var gn = this.ctx.createGain(); gn.gain.setValueAtTime(opt.gain || 0.2, t0); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(gn); gn.connect(this.ctx.destination); src.start(t0);
  };
  AudioController.prototype.strike = function (power) { this._noise(0.06, { freq: 2600, gain: 0.25 }); this._tone(150 + power * 120, 0.09, { gain: 0.18, type: "square" }); };
  AudioController.prototype.click = function (v) { this._tone(520 + v * 900, 0.05, { gain: 0.05 + v * 0.16, type: this.theme === "cyber" ? "square" : "triangle" }); };
  AudioController.prototype.wall = function () { this._tone(220, 0.05, { gain: 0.06, type: "sine" }); };
  AudioController.prototype.pot = function () { this._tone(600, 0.14, { gain: 0.2, slideTo: 200 }); this._tone(300, 0.16, { gain: 0.12, slideTo: 120, type: "sine" }); };
  AudioController.prototype.foul = function () { this._tone(180, 0.28, { gain: 0.24, type: "sawtooth", slideTo: 90 }); };
  AudioController.prototype.win = function () { var n = [523, 659, 784, 1047], self = this; n.forEach(function (f, i) { setTimeout(function () { self._tone(f, 0.28, { gain: 0.2, type: "triangle" }); }, i * 110); }); };

  /* ============================================================
     CarromGame — orchestration + input (browser)
     ============================================================ */
  function CarromGame(dom, engine, renderer, audio, ai, opts) {
    this.dom = dom; this.engine = engine; this.renderer = renderer; this.audio = audio; this.ai = ai;
    this.physics = new Physics(GEO);
    this.aimAssist = opts.aimAssist !== false;
    this.phase = "idle";       // idle | aim | shoot | botthink | over
    this.strikerPos = { x: (GEO.strikerXmin + GEO.strikerXmax) / 2, y: GEO.humanBaseY };
    this.strikerBody = null;
    this.aim = null;
    this.dragMode = null;
    this.nextBreak = "white";
    this._raf = this.frame.bind(this);
  }

  CarromGame.prototype.startMatch = function () {
    this.engine.scores = { white: 0, black: 0 };
    this.nextBreak = "white";
    this.startBoard();
  };
  CarromGame.prototype.startBoard = function () {
    this.engine.newBoard(this.nextBreak);
    this.nextBreak = this.nextBreak === "white" ? "black" : "white";
    this.hideResult();
    this.renderer.resize();
    this.updateHUD();
    this.render();
    this.beginTurn(true);
  };

  CarromGame.prototype.beginTurn = function (isBreak) {
    var turn = this.engine.turnColor, isHuman = (turn === this.engine.humanColor);
    var side = isHuman ? GEO.humanBaseY : GEO.botBaseY;
    this.strikerPos = { x: (GEO.strikerXmin + GEO.strikerXmax) / 2, y: side };
    this.aim = null; this.dragMode = null; this.setPower(0);
    this.updateHUD();
    if (isHuman) {
      this.phase = "aim";
      this.strikerBody = null;
      this.render();
      this.setMsg(isBreak ? "Your break — position &amp; flick" : "Your turn");
      this.setHint("Drag striker to slide · pull back anywhere to aim");
    } else {
      this.phase = "botthink";
      this.strikerBody = { type: "striker", color: null, x: this.strikerPos.x, y: side, r: GEO.strikerR };
      this.render();
      this.setMsg("Bot is thinking…");
      this.setHint("");
      var self = this;
      this.ai.baseY = GEO.botBaseY;
      setTimeout(function () { if (self.phase === "botthink") self.botShoot(); }, this.ai.thinkTime());
    }
  };

  CarromGame.prototype.botShoot = function () {
    var shot = this.ai.chooseShot(this.engine);
    this.shoot(shot.sx, shot.baseY, shot.dir, shot.power);
  };

  CarromGame.prototype.shoot = function (x, y, dir, power) {
    this.strikerBody = this.engine._mk("striker", null, x, y);
    this.strikerBody.vx = dir.x * power * GEO.maxSpeed;
    this.strikerBody.vy = dir.y * power * GEO.maxSpeed;
    this.world = this.engine.coins.concat(this.strikerBody);
    this.stroke = { potted: [], contacted: false, impact: 0 };
    this._prevPot = 0;
    this.aim = null; this.dragMode = null;
    this.audio.strike(power);
    this.phase = "shoot";
    this.setHint("");
    root.requestAnimationFrame(this._raf);
  };

  CarromGame.prototype.frame = function () {
    if (this.phase !== "shoot") return;
    var ev = this.stroke; ev.impact = 0; ev.wall = false;
    for (var s = 0; s < 6; s++) this.physics.substep(this.world, 1 / 360, ev);
    if (ev.potted.length > this._prevPot) { this.audio.pot(); this._prevPot = ev.potted.length; }
    else if (ev.impact > 55) this.audio.click(Math.min(1, ev.impact / 1500));
    else if (ev.wall) this.audio.wall();
    this.render();
    if (this.physics.atRest(this.world)) { this.onStrokeEnd(); return; }
    root.requestAnimationFrame(this._raf);
  };

  CarromGame.prototype.onStrokeEnd = function () {
    var evt = { strikerPotted: this.strikerBody.potted, contacted: this.stroke.contacted };
    var out = this.engine.resolveStroke(evt);
    this.strikerBody = null; this.world = null;
    if (out.foul) this.audio.foul();
    this.updateHUD(); this.render();
    if (out.messages.length) this.setMsg(out.messages[out.messages.length - 1]);
    var self = this;
    if (out.matchOver) { this.phase = "over"; this.audio.win(); setTimeout(function () { self.showResult(out, true); }, 700); return; }
    if (out.boardOver) { this.phase = "over"; this.audio.win(); setTimeout(function () { self.showResult(out, false); }, 700); return; }
    setTimeout(function () { self.beginTurn(false); }, 700);
  };

  /* ---- input ---- */
  CarromGame.prototype.bindInput = function () {
    var canvas = this.dom.canvas, self = this;
    canvas.addEventListener("pointerdown", function (e) { self._down(e); });
    canvas.addEventListener("pointermove", function (e) { self._move(e); });
    root.addEventListener("pointerup", function (e) { self._up(e); });
  };
  CarromGame.prototype._humanTurn = function () {
    return this.phase === "aim" && this.engine.turnColor === this.engine.humanColor;
  };
  CarromGame.prototype._down = function (e) {
    if (!this._humanTurn()) return;
    e.preventDefault();
    var p = this.renderer.toLogical(e.clientX, e.clientY);
    var dx = p.x - this.strikerPos.x, dy = p.y - this.strikerPos.y;
    if (hypot(dx, dy) < GEO.strikerR + 16) { this.dragMode = "move"; }
    else { this.dragMode = "aim"; this._updateAim(p); }
  };
  CarromGame.prototype._move = function (e) {
    if (!this._humanTurn() || !this.dragMode) return;
    e.preventDefault();
    var p = this.renderer.toLogical(e.clientX, e.clientY);
    if (this.dragMode === "move") {
      this.strikerPos.x = clamp(p.x, GEO.strikerXmin, GEO.strikerXmax);
      this.render();
    } else { this._updateAim(p); }
  };
  CarromGame.prototype._up = function () {
    if (!this._humanTurn() || !this.dragMode) return;
    if (this.dragMode === "aim" && this.aim && this.aim.power > 0.05) {
      this.shoot(this.strikerPos.x, this.strikerPos.y, this.aim.dir, this.aim.power);
    } else {
      this.dragMode = null; this.aim = null; this.setPower(0); this.render();
    }
  };
  CarromGame.prototype._updateAim = function (p) {
    var sx = this.strikerPos.x, sy = this.strikerPos.y;
    var pullx = p.x - sx, pully = p.y - sy, pl = hypot(pullx, pully);
    if (pl < 1) { this.aim = null; this.setPower(0); this.render(); return; }
    var dir = { x: -pullx / pl, y: -pully / pl };
    var maxPull = 240, power = clamp(pl / maxPull, 0, 1);
    // predicted travel end (aim assist): to first coin/wall hit, else power length
    var end = this._predict(sx, sy, dir, this.aimAssist ? 900 : 120 + power * 260);
    this.aim = {
      x: sx, y: sy, dir: dir, power: power,
      tx: end.x, ty: end.y,
      px: sx + pullx, py: sy + pully
    };
    this.setPower(power);
    this.render();
  };
  CarromGame.prototype._predict = function (x, y, dir, maxLen) {
    // straight ray; stop at first coin circle or wall within maxLen
    var g = GEO, best = maxLen, coins = this.engine.coins;
    for (var i = 0; i < coins.length; i++) {
      var c = coins[i];
      var fx = c.x - x, fy = c.y - y;
      var proj = fx * dir.x + fy * dir.y;
      if (proj <= 0) continue;
      var perp = Math.abs(fx * dir.y - fy * dir.x);
      var rr = c.r + g.strikerR;
      if (perp < rr) { var back = Math.sqrt(Math.max(0, rr * rr - perp * perp)); var hit = proj - back; if (hit > 0 && hit < best) best = hit; }
    }
    // walls
    var wallHits = [];
    if (dir.x > 0) wallHits.push((g.maxX - g.strikerR - x) / dir.x);
    if (dir.x < 0) wallHits.push((g.minX + g.strikerR - x) / dir.x);
    if (dir.y > 0) wallHits.push((g.maxY - g.strikerR - y) / dir.y);
    if (dir.y < 0) wallHits.push((g.minY + g.strikerR - y) / dir.y);
    wallHits.forEach(function (h) { if (h > 0 && h < best) best = h; });
    return { x: x + dir.x * best, y: y + dir.y * best };
  };

  /* ---- rendering + HUD ---- */
  CarromGame.prototype.render = function () {
    var st = { coins: this.engine.coins, striker: this.strikerBody, aim: this.aim };
    if (!this.strikerBody && this.phase === "aim") st.striker = { type: "striker", color: null, x: this.strikerPos.x, y: this.strikerPos.y, r: GEO.strikerR };
    this.renderer.draw(st);
  };
  CarromGame.prototype.updateHUD = function () {
    var e = this.engine, d = this.dom, human = e.humanColor;
    d.youScore.textContent = e.scores[human];
    d.botScore.textContent = e.scores[e.botColor];
    d.youDot.textContent = human === "white" ? "⚪" : "⚫";
    d.botDot.textContent = e.botColor === "white" ? "⚪" : "⚫";
    var isHuman = e.turnColor === human;
    d.turnBadge.textContent = isHuman ? "Your turn" : "Bot’s turn";
    d.turnBadge.className = "badge turn-badge " + (isHuman ? "you" : "bot");
    d.sideYou.classList.toggle("active", isHuman);
    d.sideBot.classList.toggle("active", !isHuman);
    // queen
    var qb = d.queenBadge, qtext, qcov = false;
    if (e.queenOwner) { qtext = "Queen: " + (e.queenOwner === human ? "yours" : "bot’s"); qcov = true; }
    else if (e.pendingQueen) { qtext = "Queen: cover her!"; }
    else if (e.queenOnBoard()) { qtext = "Queen: on board"; }
    else { qtext = "Queen: off"; }
    qb.textContent = qtext; qb.className = "badge queen-badge" + (qcov ? " covered" : "");
    d.targetLabel.textContent = e.target;
  };
  CarromGame.prototype.setMsg = function (t) { this.dom.boardMsg.innerHTML = t; };
  CarromGame.prototype.setHint = function (t) {
    var h = this.dom.hintOverlay; if (!h) return;
    if (t) { h.innerHTML = t; h.classList.add("show"); } else { h.classList.remove("show"); }
  };
  CarromGame.prototype.setPower = function (r) { if (this.dom.powerFill) this.dom.powerFill.style.width = Math.round(r * 100) + "%"; };

  CarromGame.prototype.showResult = function (out, matchOver) {
    var d = this.dom, human = this.engine.humanColor, youWon = out.winner === human;
    if (matchOver) {
      d.resultTitle.textContent = youWon ? "You win the match! 🏆" : "Bot wins the match";
      d.resultBody.textContent = "Final score — You " + this.engine.scores[human] + " · Bot " + this.engine.scores[this.engine.botColor] + ".";
      d.nextBtn.textContent = "New match";
      d._matchOver = true;
    } else {
      d.resultTitle.textContent = youWon ? "You won the board! 🎉" : "Bot won the board";
      d.resultBody.textContent = (youWon ? "You" : "Bot") + " scored " + out.points + ". Match: You " +
        this.engine.scores[human] + " · Bot " + this.engine.scores[this.engine.botColor] + ".";
      d.nextBtn.textContent = "Next board";
      d._matchOver = false;
    }
    d.resultOverlay.hidden = false;
  };
  CarromGame.prototype.hideResult = function () { this.dom.resultOverlay.hidden = true; };

  /* ============================================================
     Bootstrap (browser only)
     ============================================================ */
  var STORE_KEY = "html-tools-carrom";
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }

  function initApp() {
    var $ = function (id) { return document.getElementById(id); };
    var lobby = $("lobby"), stage = $("stage");
    var el = {
      colorSeg: $("colorSeg"), difficulty: $("difficulty"), themeSel: $("themeSel"), targetSel: $("targetSel"),
      muteSfx: $("muteSfx"), aimAssist: $("aimAssist"), startBtn: $("startBtn"),
      newBoardBtn: $("newBoardBtn"), lobbyBtn: $("lobbyBtn"), sfxBtn: $("sfxBtn"), assistBtn: $("assistBtn"),
      nextBtn: $("nextBtn"), toLobbyBtn: $("toLobbyBtn")
    };
    var dom = {
      canvas: $("board"), wrap: $("boardWrap"),
      youScore: $("youScore"), botScore: $("botScore"), youDot: $("youDot"), botDot: $("botDot"),
      youName: $("youName"), botName: $("botName"), sideYou: $("sideYou"), sideBot: $("sideBot"),
      turnBadge: $("turnBadge"), queenBadge: $("queenBadge"), boardMsg: $("boardMsg"),
      targetLabel: $("targetLabel"), powerFill: $("powerFill"), hintOverlay: $("hintOverlay"),
      resultOverlay: $("resultOverlay"), resultTitle: $("resultTitle"), resultBody: $("resultBody"),
      nextBtn: $("nextBtn")
    };

    // restore settings
    var s = load(), color = s.color || "white";
    if (s.difficulty) el.difficulty.value = s.difficulty;
    if (s.theme) el.themeSel.value = s.theme;
    if (s.target) el.targetSel.value = s.target;
    if (typeof s.muteSfx === "boolean") el.muteSfx.checked = s.muteSfx;
    if (typeof s.aimAssist === "boolean") el.aimAssist.checked = s.aimAssist;
    function setColorSeg(c) {
      color = c;
      el.colorSeg.querySelectorAll(".seg-btn").forEach(function (b) {
        var on = b.dataset.color === c; b.classList.toggle("active", on); b.setAttribute("aria-checked", String(on));
      });
    }
    setColorSeg(color);
    el.colorSeg.querySelectorAll(".seg-btn").forEach(function (b) {
      b.addEventListener("click", function () { setColorSeg(b.dataset.color); persist(); });
    });
    function persist() {
      save({ color: color, difficulty: el.difficulty.value, theme: el.themeSel.value, target: el.targetSel.value, muteSfx: el.muteSfx.checked, aimAssist: el.aimAssist.checked });
    }
    [el.difficulty, el.themeSel, el.targetSel, el.muteSfx, el.aimAssist].forEach(function (n) { n.addEventListener("change", persist); });

    var renderer = new Renderer(dom.canvas, dom.wrap);
    var audio = new AudioController();
    var game = null;

    function syncButtons() {
      el.sfxBtn.setAttribute("aria-pressed", String(!audio.mute));
      el.sfxBtn.textContent = audio.mute ? "🔇 SFX" : "🔊 SFX";
      if (game) { el.assistBtn.setAttribute("aria-pressed", String(game.aimAssist)); el.assistBtn.textContent = "🎯 Guide"; }
    }

    function startMatch() {
      audio.resume();
      audio.mute = el.muteSfx.checked;
      audio.setTheme(el.themeSel.value);
      renderer.setTheme(el.themeSel.value);
      var engine = new CarromEngine({ humanColor: color, target: parseInt(el.targetSel.value, 10) });
      var ai = new CarromAI(el.difficulty.value);
      game = new CarromGame(dom, engine, renderer, audio, ai, { aimAssist: el.aimAssist.checked });
      window._carrom = game;
      game.bindInput();
      lobby.hidden = true; stage.hidden = false;
      renderer.resize();
      game.startMatch();
      syncButtons();
    }

    el.startBtn.addEventListener("click", startMatch);
    el.newBoardBtn.addEventListener("click", function () { if (game) game.startBoard(); });
    el.lobbyBtn.addEventListener("click", function () { stage.hidden = true; lobby.hidden = false; });
    el.toLobbyBtn.addEventListener("click", function () { if (game) game.hideResult(); stage.hidden = true; lobby.hidden = false; });
    el.nextBtn.addEventListener("click", function () {
      if (!game) return;
      if (dom.nextBtn._matchOver) game.startMatch(); else game.startBoard();
    });
    el.sfxBtn.addEventListener("click", function () { audio.mute = !audio.mute; if (!audio.mute) audio.resume(); syncButtons(); });
    el.assistBtn.addEventListener("click", function () { if (game) { game.aimAssist = !game.aimAssist; syncButtons(); } });

    var rz;
    root.addEventListener("resize", function () {
      if (!game || stage.hidden) return;
      clearTimeout(rz); rz = setTimeout(function () { renderer.resize(); game.render(); }, 120);
    });
  }

  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", initApp);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Physics: Physics, CarromEngine: CarromEngine, CarromAI: CarromAI, GEO: GEO, cloneBody: cloneBody };
  }

})(typeof window !== "undefined" ? window : globalThis);
