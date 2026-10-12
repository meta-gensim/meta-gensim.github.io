/*
 * Animated walkthrough of Algorithm 1 (Appendix D): meta-learning the rater R_eta.
 *
 * Everything (canvas, pseudo-code highlight, caption, controls) is driven by a single
 * clock, so every frame is a pure function of time and can be reached by scrubbing.
 * Sample thumbnails come from static/images/alg1_tiles.jpg: an 8x8 grid of 128px probing-
 * dataset frames followed by one row of four 256px real stackCube frames.
 */
(() => {
  'use strict';

  const root = document.getElementById('alg-anim');
  if (!root) return;

  const canvas = root.querySelector('.alg-canvas');
  const ctx = canvas.getContext('2d');
  const lineEls = new Map();
  root.querySelectorAll('.alg-line').forEach(el => lineEls.set(Number(el.dataset.line), el));
  const hl = root.querySelector('.alg-hl');
  const capTitle = root.querySelector('.alg-caption-title');
  const capText = root.querySelector('.alg-caption-text');
  const playBtn = root.querySelector('.alg-play');
  const restartBtn = root.querySelector('.alg-restart');
  const speedBtn = root.querySelector('.alg-speed');
  const track = root.querySelector('.alg-progress');
  const fill = root.querySelector('.alg-progress-fill');
  const varEls = { k: root.querySelector('[data-var="k"]'), t: root.querySelector('[data-var="t"]') };

  // ------------------------------------------------------------------ helpers
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeBack = t => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2));
  const bump = t => Math.sin(Math.PI * clamp(t));
  // Progress of phase p over the sub-window [a, b] of its duration (0 before, 1 after).
  const prog = (clock, p, a = 0, b = 1) => clamp(((clock - p.start) / p.dur - a) / (b - a));

  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
  const mix = (a, b, t) => {
    const x = hexRgb(a), y = hexRgb(b);
    return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], clamp(t)))).join(',')})`;
  };

  // ------------------------------------------------------------------ palette & layout
  const W = 1000, H = 860;
  const SANS = '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
  const MATH = '"Times New Roman", "STIX Two Text", "Cambria Math", serif';
  const C = {
    ink: '#1e293b', muted: '#64748b', faint: '#94a3b8', rule: '#cbd5e1',
    sim: '#3b8fd0', simDark: '#1f6fae', simLight: '#e6f2fb',
    real: '#ee8a4f', realDark: '#c95f22', realLight: '#fdebe0',
    rater: '#2f7d32', raterNode: '#bfe6ab', raterFlash: '#5cc046',
    policy: '#1d4f7a', policyNode: '#3d7cb2', policyFlash: '#8cc4f0',
    grad: '#1f5d7e', loss: '#ef7b3d', meta: '#2f9e44',
    good: '#1a9850', bad: '#d73027',
  };
  const RDYLGN = ['#d73027', '#fc8d59', '#fee08b', '#91cf60', '#1a9850'];
  const scoreColor = v => {
    const x = ((clamp(v, -1, 1) + 1) / 2) * (RDYLGN.length - 1);
    const i = Math.min(RDYLGN.length - 2, Math.floor(x));
    return mix(RDYLGN[i], RDYLGN[i + 1], x - i);
  };

  const L = {
    probe: { x: 30, y: 50, tile: 56, gap: 5, pad: 8 },
    real: { x: 790, y: 82, size: 128, off: 9 },
    chart: { x: 330, y: 98, w: 340, h: 104 },
    rater: { x: 112, y: 610, w: 150, h: 100 },
    chipX0: 252, chipY: 404, chip: 62, step: 74,
    scoreY: 491, barBase: 600, barMax: 84, barW: 26,
    sigma: { x: 548, y: 658, r: 18 },
    tapeY: 774, tapeXs: [252, 382, 512, 642, 772], node: { w: 64, h: 40 },
    badgeY: 736, laneY: 804,
    loss: { x: 848, y: 748, w: 124, h: 56 },
  };
  const SIM_SRC = [127, 147];
  const REAL_SRC = [854, 146];
  const RATER_OUT = [L.rater.x + L.rater.w / 2, L.rater.y];
  const chipCenter = i => [L.chipX0 + i * L.step + L.chip / 2, L.chipY + L.chip / 2];
  const badgeX = j => (L.tapeXs[j] + L.tapeXs[j + 1]) / 2;

  // ------------------------------------------------------------------ data: probing tiles
  // Task / table color of each probing frame: S=stackCube, B=bowlTray, M=mugBin, H=mugHang;
  // w=white, k=black, b=blue, r=red. The real target is stackCube on a white table.
  const TILE = ('Bw Mb Hb Sw Br Bb Mw Mr Mw Hk Hr Mk Sw Hr Hk Mk Bw Hr Mb Bb Hk Mr Sr Mw ' +
    'Sb Sb Mk Bb Mr Mr Hk Sk Mk Hw Sr Mb Sw Br Bb Sk Hb Bk Bw Mk Sk Mr Hw Mw ' +
    'Br Sk Bk Sk Bk Bk Hr Hw Sk Mk Sb Sk Br Hk Sw Sk').split(' ');
  const STACK_WHITE = [36, 62, 3, 12];
  const STACK_OTHER = [], OTHER_TASK = [];
  TILE.forEach((c, i) => {
    if (c[0] !== 'S') OTHER_TASK.push(i);
    else if (c[1] !== 'w') STACK_OTHER.push(i);
  });
  const MOSAIC = [0, 2, 22, 9, 25, 6, 13, 31, 19];
  // How well a sample matches the real target; drives the (illustrative) learned scores.
  const affinity = i => {
    const c = TILE[i];
    if (c[0] === 'S') return c[1] === 'w' ? (i === 36 || i === 62 ? 0.95 : 0.8) : 0.35;
    return c[1] === 'w' ? -0.45 : -0.8;
  };

  const N_SIM = 6, N_REAL = 2;
  const W_REF = 0.36; // weight that fills a bar
  // A co-training batch scored by a rater whose training progress is `skill` in [0, 1].
  function makeBatch(seed, skill) {
    const r = mulberry32(seed);
    const used = new Set();
    const pick = (arr, n) => {
      const out = [];
      while (out.length < n) {
        const v = arr[Math.floor(r() * arr.length)];
        if (!used.has(v)) { used.add(v); out.push(v); }
      }
      return out;
    };
    const sim = [...pick(STACK_WHITE, 1), ...pick(STACK_OTHER, 1), ...pick(OTHER_TASK, 4)];
    for (let i = sim.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [sim[i], sim[j]] = [sim[j], sim[i]];
    }
    const real = [];
    while (real.length < N_REAL) {
      const v = Math.floor(r() * 4);
      if (!real.includes(v)) real.push(v);
    }
    const items = sim.map(idx => ({ real: false, idx, aff: affinity(idx) }))
      .concat(real.map(idx => ({ real: true, idx, aff: 1 })));
    items.forEach(it => { it.s = 2 * skill * it.aff + (0.45 - 0.25 * skill) * gauss(r); });
    const mx = Math.max(...items.map(it => it.s));
    const z = items.reduce((a, it) => a + Math.exp(it.s - mx), 0);
    items.forEach(it => { it.w = Math.exp(it.s - mx) / z; });
    return items;
  }

  // ------------------------------------------------------------------ timeline
  const PH = [];
  let TOTAL = 0;
  const add = (type, dur, extra) => {
    const p = Object.assign({ type, start: TOTAL, dur }, extra);
    PH.push(p);
    TOTAL += dur;
    return p;
  };

  const P = {};
  P.intro = add('intro', 2.8, { lines: [1], cap: 'inputs' });
  P.initRater = add('initRater', 1.5, { lines: [2], cap: 'init' });
  P.initPolicy = add('initPolicy', 1.3, { lines: [3], cap: 'init' });

  // Outer step k = 0, shown in detail (inner steps get faster after the first one).
  const O = { inner: [] };
  O.outerFor = add('outerFor', 1.1, { lines: [4], cap: 'outer', k: 0 });
  O.call = add('call', 1.5, { lines: [5, 11], cap: 'outer', k: 0 });
  const INNER_SPEED = [1, 0.36, 0.22, 0.24];
  const T_LABEL = ['0', '1', '…', 'T−1'];
  INNER_SPEED.forEach((s, t) => {
    const cap = key => (t === 0 ? key : 'unroll');
    const g = { t, batch: makeBatch(101 + 17 * t, 0) };
    const meta = { k: 0, t };
    g.innerFor = add('innerFor', 0.7 * s, { lines: [12], cap: cap('sample'), ...meta });
    g.sample = add('sample', 1.9 * s, { lines: [13], cap: cap('sample'), ...meta });
    g.merge = add('merge', 0.9 * s, { lines: [14], cap: cap('sample'), ...meta });
    g.score = add('score', 2.1 * s, { lines: [15], cap: cap('score'), ...meta });
    g.softmax = add('softmax', 1.7 * s, { lines: [16], cap: cap('softmax'), ...meta });
    g.grad = add('grad', 1.6 * s, { lines: [17], cap: cap('update'), ...meta });
    g.update = add('update', 1.5 * s, { lines: [18], cap: cap('update'), ...meta });
    g.start = g.innerFor.start;
    g.end = g.update.start + g.update.dur;
    O.inner.push(g);
  });
  O.ret = add('ret', 1.6, { lines: [19, 20, 21, 5], cap: 'unroll', k: 0 });
  O.sampleReal = add('sampleReal', 1.5, { lines: [6], cap: 'realLoss', k: 0 });
  O.loss = add('loss', 1.5, { lines: [7], cap: 'realLoss', k: 0 });
  O.meta = add('meta', 4.2, { lines: [8], cap: 'meta', k: 0 });
  O.carry = add('carry', 1.8, { lines: [9, 4], cap: 'carry', k: 0 });
  O.start = O.outerFor.start;
  O.end = O.carry.start + O.carry.dur;

  // Remaining outer steps as a fast montage; the rater sharpens as meta-training proceeds.
  const MONT_SKILL = [0.08, 0.22, 0.4, 0.58, 0.74, 0.88];
  const MONT_K = ['1', '2', '3', '…', '…', 'K−1'];
  const ETA_BEFORE = ['η_1', 'η_2', 'η_3', 'η_…', 'η_…', 'η_{K−1}'];
  const ETA_AFTER = ['η_2', 'η_3', 'η_…', 'η_…', 'η_{K−1}', 'η_K'];
  const MONT_BATCH = MONT_SKILL.map((s, c) => makeBatch(501 + 31 * c, s));
  const CYCLE = 1.3;
  P.montage = add('montage', CYCLE * MONT_SKILL.length, { cap: 'loop' });
  P.final = add('final', 5.5, { lines: [10], cap: 'return' });
  P.outro = add('outro', 0.9, { lines: [10], cap: 'return' });
  const FINAL_BATCH = makeBatch(907, 1);

  const innerAt = clock => O.inner.find(g => clock >= g.start && clock < g.end) || null;
  const montageAt = clock => {
    if (clock < P.montage.start || clock >= P.montage.start + P.montage.dur) return null;
    const x = (clock - P.montage.start) / CYCLE;
    const c = Math.min(MONT_SKILL.length - 1, Math.floor(x));
    return { c, u: x - c };
  };
  const phaseAt = clock => {
    for (let i = PH.length - 1; i >= 0; i--) if (clock >= PH[i].start) return PH[i];
    return PH[0];
  };

  // ------------------------------------------------------------------ canvas primitives
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(str, x, y, o = {}) {
    const size = o.size || 15;
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    ctx.font = `${o.weight || 500} ${size}px ${SANS}`;
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y + size * 0.36);
    ctx.restore();
  }

  function textWidth(str, size, weight = 500) {
    ctx.save();
    ctx.font = `${weight} ${size}px ${SANS}`;
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  // Tiny TeX-like math: x_i, x_{t+1}, x^2. Latin and lowercase Greek letters are italic,
  // multi-letter sub/superscripts (e.g. _{real}) and `backticked` text are upright.
  const GREEK = /[α-ωϕϑ]/;
  function parseMath(s) {
    const out = [];
    const push = (ch, lvl, upright) => {
      const it = !upright && (/[A-Za-z]/.test(ch) || GREEK.test(ch));
      const last = out[out.length - 1];
      if (last && last.lvl === lvl && last.it === it) last.t += ch;
      else out.push({ t: ch, lvl, it });
    };
    const cs = Array.from(s);
    let roman = false;
    for (let i = 0; i < cs.length; i++) {
      const ch = cs[i];
      if (ch === '`') {
        roman = !roman;
      } else if (roman) {
        push(ch, 0, true);
      } else if ((ch === '_' || ch === '^') && i + 1 < cs.length) {
        let grp;
        if (cs[i + 1] === '{') {
          let j = i + 2;
          while (j < cs.length && cs[j] !== '}') j++;
          grp = cs.slice(i + 2, j);
          i = j;
        } else {
          grp = [cs[i + 1]];
          i += 1;
        }
        const upright = grp.length > 1 && grp.every(c => /[A-Za-z]/.test(c));
        grp.forEach(c => push(c, ch === '_' ? -1 : 1, upright));
      } else {
        push(ch, 0, false);
      }
    }
    return out;
  }

  const mathCache = new Map();
  function mathRuns(s, size) {
    const key = `${size}|${s}`;
    if (!mathCache.has(key)) {
      ctx.save();
      const runs = parseMath(s).map(r => {
        const sz = r.lvl ? size * 0.68 : size;
        const font = `${r.it ? 'italic ' : ''}${sz}px ${MATH}`;
        ctx.font = font;
        return {
          t: r.t, font,
          w: ctx.measureText(r.t).width + (r.it ? sz * 0.05 : 0),
          dy: r.lvl < 0 ? size * 0.24 : r.lvl > 0 ? -size * 0.4 : 0,
        };
      });
      ctx.restore();
      mathCache.set(key, runs);
    }
    return mathCache.get(key);
  }
  const mathWidth = (s, size) => mathRuns(s, size).reduce((a, r) => a + r.w, 0);

  function math(s, x, y, o = {}) {
    const size = o.size || 20;
    const runs = mathRuns(s, size);
    const total = runs.reduce((a, r) => a + r.w, 0);
    let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const r of runs) {
      ctx.font = r.font;
      ctx.fillText(r.t, cx, y + size * 0.33 + r.dy);
      cx += r.w;
    }
    ctx.restore();
    return total;
  }

  // Mixed label; parts starting with '$' are math, the others sans-serif text.
  function label(parts, x, y, o = {}) {
    const size = o.size || 15, msize = o.msize || Math.round(size * 1.3), weight = o.weight || 600;
    const ws = parts.map(p => (p[0] === '$' ? mathWidth(p.slice(1), msize) : textWidth(p, size, weight)));
    let cx = o.align === 'left' ? x : x - ws.reduce((a, b) => a + b, 0) / 2;
    parts.forEach((p, i) => {
      if (p[0] === '$') math(p.slice(1), cx, y, { size: msize, color: o.color, alpha: o.alpha, align: 'left' });
      else text(p, cx, y, { size, weight, color: o.color, alpha: o.alpha, align: 'left' });
      cx += ws[i];
    });
  }

  function arrowHead(x, y, ang, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(-size, -size * 0.55);
    ctx.lineTo(-size * 0.72, 0);
    ctx.lineTo(-size, size * 0.55);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  const qpt = (p0, p1, p2, t) => {
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
  };

  // Quadratic curve p0 -> p2 (control p1), drawn up to fraction f.
  function curve(p0, p1, p2, f, o) {
    if (f <= 0) return;
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    if (ctx.globalAlpha <= 0) { ctx.restore(); return; }
    const end = o.head ? Math.max(0, f - 0.025) : f;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    for (let i = 1; i <= 32; i++) {
      const q = qpt(p0, p1, p2, (i / 32) * end);
      ctx.lineTo(q[0], q[1]);
    }
    ctx.lineWidth = o.w || 2;
    ctx.strokeStyle = o.color;
    ctx.lineCap = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.stroke();
    ctx.setLineDash([]);
    if (o.head && f > 0.04) {
      const a = qpt(p0, p1, p2, f - 0.04), b = qpt(p0, p1, p2, f);
      arrowHead(b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), o.head, o.color);
    }
    ctx.restore();
  }
  const line = (p0, p2, f, o) => curve(p0, [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2], p2, f, o);

  function glowDot(x, y, r, color, a = 1) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= a;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, rgba(color, 0.5));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.restore();
  }

  const RATER_NET = { layers: [3, 4, 3, 1], node: C.raterNode, flash: C.raterFlash, stroke: C.rater, edge: 'rgba(47,125,50,0.42)', ew: 1.6, sw: 2.2, r: 8.5 };
  const POLICY_NET = { layers: [3, 4, 3], node: C.policyNode, flash: C.policyFlash, stroke: C.policy, edge: 'rgba(29,79,122,0.4)', ew: 1.2, sw: 1.5, r: 5.2 };

  function drawNet(cx, cy, w, h, sty, glow = 0, alpha = 1) {
    if (alpha <= 0) return;
    const ls = sty.layers, gap = h / (Math.max(...ls) - 1);
    const pts = ls.map((n, li) => Array.from({ length: n }, (_, ni) =>
      [cx - w / 2 + (w * li) / (ls.length - 1), cy + (ni - (n - 1) / 2) * gap]));
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (glow > 0) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.8);
      g.addColorStop(0, rgba(sty.flash, 0.42 * glow));
      g.addColorStop(1, rgba(sty.flash, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - w, cy - w, 2 * w, 2 * w);
    }
    ctx.beginPath();
    for (let l = 0; l + 1 < pts.length; l++) {
      for (const a of pts[l]) for (const b of pts[l + 1]) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    }
    ctx.lineWidth = sty.ew;
    ctx.strokeStyle = sty.edge;
    ctx.stroke();
    const nodeFill = glow > 0 ? mix(sty.node, sty.flash, glow) : sty.node;
    for (const layer of pts) {
      for (const p of layer) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], sty.r, 0, Math.PI * 2);
        ctx.fillStyle = nodeFill;
        ctx.fill();
        ctx.lineWidth = sty.sw;
        ctx.strokeStyle = sty.stroke;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  const sprite = new Image();
  let spriteReady = false;
  sprite.onload = () => { spriteReady = true; requestDraw(); };
  sprite.src = root.dataset.sprite || 'static/images/alg1_tiles.jpg';

  function drawTile(real, idx, x, y, s, o = {}) {
    const r = o.r == null ? 7 : o.r;
    ctx.save();
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    if (ctx.globalAlpha <= 0) { ctx.restore(); return; }
    if (o.glow > 0) {
      ctx.shadowColor = rgba(o.glowColor || C.good, 0.85 * o.glow);
      ctx.shadowBlur = 18 * o.glow;
    } else if (o.shadow) {
      ctx.shadowColor = 'rgba(15,23,42,0.22)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
    }
    rrect(x, y, s, s, r);
    ctx.fillStyle = real ? C.realLight : C.simLight;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (spriteReady) {
      ctx.save();
      rrect(x, y, s, s, r);
      ctx.clip();
      if (real) ctx.drawImage(sprite, idx * 256, 1024, 256, 256, x, y, s, s);
      else ctx.drawImage(sprite, (idx % 8) * 128, Math.floor(idx / 8) * 128, 128, 128, x, y, s, s);
      if (o.dim > 0) {
        ctx.fillStyle = `rgba(248,250,252,${o.dim})`;
        ctx.fillRect(x, y, s, s);
      }
      ctx.restore();
    }
    if (o.stroke !== false) {
      rrect(x, y, s, s, r);
      ctx.lineWidth = o.lw || 2.4;
      ctx.strokeStyle = o.stroke || (real ? C.real : C.sim);
      ctx.stroke();
    }
    ctx.restore();
  }

  function scorePill(cx, cy, s, scale, alpha) {
    if (alpha <= 0 || scale <= 0) return;
    const v = s / 2.2;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    rrect(-29, -14, 58, 28, 14);
    ctx.fillStyle = scoreColor(v);
    ctx.fill();
    ctx.restore();
    const str = `${s < 0 ? '−' : '+'}${Math.abs(s).toFixed(1)}`;
    text(str, cx, cy, { size: 16 * scale, weight: 700, color: Math.abs(v) > 0.55 ? '#fff' : C.ink, alpha });
  }

  // ------------------------------------------------------------------ scene pieces
  function sourcePulse(clock) {
    let sim = 0, real = 0;
    for (const g of O.inner) {
      sim = Math.max(sim, bump(prog(clock, g.sample, 0, 0.6)));
      real = Math.max(real, bump(prog(clock, g.sample, 0.3, 0.85)));
    }
    real = Math.max(real, bump(prog(clock, O.sampleReal, 0, 0.7)));
    return { sim, real };
  }

  function drawSources(clock) {
    const a = easeOut(prog(clock, P.intro, 0, 0.3));
    if (a <= 0) return;
    const pulse = sourcePulse(clock);
    const f = L.probe, fs = 3 * f.tile + 2 * f.gap + 2 * f.pad, cx = f.x + fs / 2;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.shadowColor = rgba(C.sim, 0.6 * pulse.sim);
    ctx.shadowBlur = 22 * pulse.sim;
    rrect(f.x, f.y, fs, fs, 14);
    ctx.fillStyle = C.simLight;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.sim;
    ctx.stroke();
    ctx.restore();
    MOSAIC.forEach((idx, i) => {
      const p = easeBack(prog(clock, P.intro, 0.08 + i * 0.035, 0.3 + i * 0.035));
      if (p <= 0) return;
      const tx = f.x + f.pad + (i % 3) * (f.tile + f.gap) + f.tile / 2;
      const ty = f.y + f.pad + Math.floor(i / 3) * (f.tile + f.gap) + f.tile / 2;
      const s = f.tile * p;
      drawTile(false, idx, tx - s / 2, ty - s / 2, s, { stroke: false, alpha: clamp(p), r: 6 });
    });
    text('Sim probing dataset', cx, 26, { size: 18, weight: 600, color: C.simDark, alpha: a });
    math('𝒟_{probe}', cx, f.y + fs + 26, { size: 25, color: C.simDark, alpha: a });

    const r = L.real;
    for (let i = 0; i < 3; i++) {
      const p = easeOut(prog(clock, P.intro, 0.25 + i * 0.08, 0.5 + i * 0.08));
      if (p <= 0) continue;
      const off = (2 - i) * r.off;
      const front = i === 2;
      drawTile(true, [2, 1, 0][i], r.x + off, r.y - off + (1 - p) * 16, r.size, {
        alpha: p, r: 10, lw: 2.5, shadow: front,
        glow: front ? pulse.real : 0, glowColor: C.real,
      });
    }
    text('Real demos (target task)', r.x + r.size / 2 + r.off - 4, 26, { size: 18, weight: 600, color: C.realDark, alpha: a });
    math('𝒟_R', r.x + r.size / 2, r.y + r.size + 26, { size: 25, color: C.realDark, alpha: a });
  }

  function chartSkill(clock) {
    if (clock < O.meta.start) return 0;
    if (clock < P.montage.start) return MONT_SKILL[0] * easeIO(prog(clock, O.meta, 0.82, 1));
    const m = montageAt(clock);
    if (m) {
      const to = m.c + 1 < MONT_SKILL.length ? MONT_SKILL[m.c + 1] : 1;
      return lerp(MONT_SKILL[m.c], to, easeIO(clamp((m.u - 0.8) / 0.12)));
    }
    return 1;
  }

  const CHART_GROUPS = [
    { name: 'sim: other tasks', color: '#d73027', mu: s => -0.1 - 1.6 * s, sd: s => 0.5 + 0.22 * s },
    { name: 'sim: stackCube', color: '#1a9850', mu: s => 0.95 * s, sd: s => 0.5 + 0.2 * s },
    { name: 'real', color: C.real, mu: s => 0.1 + 1.95 * s, sd: s => 0.5 - 0.1 * s },
  ];

  function drawChart(clock) {
    const a = easeOut(prog(clock, P.initRater, 0.4, 1));
    if (a <= 0) return;
    const s = chartSkill(clock), c = L.chart;
    const X = v => c.x + ((v + 3.2) / 6.4) * c.w;
    const base = c.y + c.h;
    ctx.save();
    ctx.globalAlpha *= a;
    label(['Rater scores ', '$s = R_η(o, a)'], c.x + c.w / 2, c.y - 24, { size: 17, msize: 21, color: C.muted });
    for (const g of CHART_GROUPS) {
      const mu = g.mu(s), sd = g.sd(s), peak = c.h * 0.9 * Math.min(1, 0.5 / sd);
      const ys = [];
      for (let i = 0; i <= 90; i++) {
        const v = -3.2 + (6.4 * i) / 90;
        ys.push([X(v), base - peak * Math.exp(-0.5 * ((v - mu) / sd) ** 2)]);
      }
      ctx.beginPath();
      ys.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.lineTo(X(3.2), base);
      ctx.lineTo(X(-3.2), base);
      ctx.closePath();
      ctx.fillStyle = rgba(g.color, 0.14);
      ctx.fill();
      ctx.beginPath();
      ys.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.lineWidth = 2;
      ctx.strokeStyle = g.color;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c.x, base + 0.5);
    ctx.lineTo(c.x + c.w, base + 0.5);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = C.rule;
    ctx.stroke();
    text('low', c.x, base + 13, { size: 14, color: C.faint, align: 'left' });
    text('high', c.x + c.w, base + 13, { size: 14, color: C.faint, align: 'right' });
    // Legend.
    const items = [CHART_GROUPS[2], CHART_GROUPS[1], CHART_GROUPS[0]];
    const ws = items.map(g => textWidth(g.name, 15, 500) + 30);
    let lx = c.x + c.w / 2 - ws.reduce((x, y) => x + y, 0) / 2;
    items.forEach((g, i) => {
      rrect(lx, base + 27, 13, 13, 3);
      ctx.fillStyle = g.color;
      ctx.fill();
      text(g.name, lx + 19, base + 33.5, { size: 15, color: C.muted, align: 'left' });
      lx += ws[i];
    });
    ctx.restore();
  }

  function raterGlow(clock) {
    let g = 0;
    for (const gr of O.inner) g = Math.max(g, 0.4 * bump(prog(clock, gr.score, 0, 1)));
    g = Math.max(g, bump(prog(clock, O.meta, 0.8, 1)));
    const m = montageAt(clock);
    if (m) g = Math.max(g, bump((m.u - 0.8) / 0.14));
    if (clock >= P.final.start) {
      g = Math.max(g, easeOut(prog(clock, P.final, 0, 0.2)) * (0.5 + 0.18 * Math.sin((clock - P.final.start) * 3.2)));
    }
    return g;
  }

  function etaText(clock) {
    if (clock < O.meta.start + O.meta.dur * 0.86) return 'η_0';
    if (clock < P.montage.start) return 'η_1';
    const m = montageAt(clock);
    if (m) return m.u < 0.86 ? ETA_BEFORE[m.c] : ETA_AFTER[m.c];
    return 'η_K';
  }

  function drawRater(clock) {
    const p = prog(clock, P.initRater, 0, 0.55);
    if (p <= 0) return;
    const R = L.rater, sc = easeBack(p);
    ctx.save();
    ctx.translate(R.x, R.y);
    ctx.scale(sc, sc);
    ctx.translate(-R.x, -R.y);
    drawNet(R.x, R.y, R.w, R.h, RATER_NET, raterGlow(clock), clamp(p * 2));
    ctx.restore();
    const a = prog(clock, P.initRater, 0.3, 0.8);
    label(['Rater ', '$R_η'], 88, 530, { size: 19, msize: 25, color: C.rater, alpha: a });
    let flash = bump(prog(clock, O.meta, 0.84, 1));
    const m = montageAt(clock);
    if (m) flash = Math.max(flash, bump((m.u - 0.84) / 0.12));
    ctx.save();
    ctx.globalAlpha *= a;
    rrect(146, 514, 66, 32, 16);
    ctx.fillStyle = mix('#ecf8ec', C.meta, flash);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = C.rater;
    ctx.stroke();
    ctx.restore();
    math(etaText(clock), 179, 530, { size: 22, color: flash > 0.5 ? '#fff' : C.rater, alpha: a });
  }

  // Tape of unrolled policy parameters theta_0 -> ... -> theta_T.
  const TAPE_LABELS = ['θ_0', 'θ_1', 'θ_2', null, 'θ_T'];

  function metaFront(u) {
    return lerp(L.loss.x - 2, L.tapeXs[0] - L.node.w / 2 - 6, easeIO(clamp((u - 0.12) / 0.5)));
  }

  function tapeState(clock) {
    const st = {
      node: [0, 0, 0, 0, 0], edge: [0, 0, 0, 0], badge: [0, 0, 0, 0],
      lit: [0, 0, 0, 0], glow: [0, 0, 0, 0, 0], carry: 0, alpha: 1, bracket: 0,
    };
    st.node[0] = easeOut(prog(clock, P.initPolicy, 0, 0.6));
    const metaLit = u => {
      const fade = 1 - clamp((u - 0.88) / 0.12);
      const front = metaFront(u);
      for (let j = 0; j < 4; j++) st.lit[j] = u > 0.12 ? clamp((badgeX(j) - front) / 30) * fade : 0;
      for (let j = 0; j < 5; j++) st.glow[j] = Math.max(st.glow[j], u > 0.12 && u < 0.7 ? clamp(1 - Math.abs(front - L.tapeXs[j]) / 70) : 0);
    };
    if (clock >= O.start && clock < O.end) {
      O.inner.forEach((g, t) => {
        st.node[t + 1] = easeOut(prog(clock, g.update, 0.45, 0.85));
        st.edge[t] = easeIO(prog(clock, g.update, 0.3, 0.7));
        st.badge[t] = easeBack(prog(clock, g.update, 0.25, 0.55));
      });
      st.glow[4] = bump(prog(clock, O.ret, 0, 0.6)) + bump(prog(clock, O.loss, 0.05, 0.6));
      st.glow[0] = Math.max(st.glow[0], bump(prog(clock, O.call, 0.2, 1)));
      if (clock >= O.meta.start && clock < O.meta.start + O.meta.dur) metaLit(prog(clock, O.meta));
      st.carry = easeIO(prog(clock, O.carry, 0.1, 0.8));
      st.bracket = prog(clock, O.call, 0.2, 0.6) * (1 - prog(clock, O.ret, 0.5, 1));
    } else {
      const m = montageAt(clock);
      if (m) {
        const u = m.u;
        [0.14, 0.22, 0.3, 0.38].forEach((t0, t) => {
          st.node[t + 1] = easeOut(clamp((u - t0) / 0.07));
          st.edge[t] = easeIO(clamp((u - t0 + 0.04) / 0.06));
          st.badge[t] = easeOut(clamp((u - t0 + 0.03) / 0.06));
        });
        st.glow[4] = bump((u - 0.42) / 0.14);
        if (u >= 0.58 && u < 0.86) metaLit((u - 0.58) / 0.28);
        st.carry = easeIO(clamp((u - 0.87) / 0.11));
      } else if (clock >= P.final.start) {
        st.alpha = 1 - 0.72 * prog(clock, P.final, 0, 0.15);
      }
    }
    return st;
  }

  function drawTape(clock) {
    if (clock < P.initPolicy.start) return;
    const st = tapeState(clock);
    const y = L.tapeY, xs = L.tapeXs, keep = 1 - st.carry;
    ctx.save();
    ctx.globalAlpha *= st.alpha;

    if (st.bracket > 0) {
      ctx.save();
      ctx.globalAlpha *= st.bracket;
      const x0 = xs[0] - 30, x1 = xs[4] + 30, by = 840;
      ctx.beginPath();
      ctx.moveTo(x0, by - 6);
      ctx.lineTo(x0, by);
      ctx.lineTo(x1, by);
      ctx.lineTo(x1, by - 6);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = C.faint;
      ctx.stroke();
      ctx.restore();
      label(['UpdatePolicy: unroll ', '$T', ' weighted inner steps'], (x0 + x1) / 2, 851, { size: 15, msize: 19, weight: 500, color: C.muted, alpha: st.bracket });
    }

    for (let j = 0; j < 4; j++) {
      const ea = keep;
      const x0 = xs[j] + (j === 3 ? 24 : L.node.w / 2 + 5);
      const x1 = xs[j + 1] - (j === 2 ? 24 : L.node.w / 2 + 5);
      line([x0, y - 7], [x1, y - 7], st.edge[j], { color: C.grad, w: 2.2, head: 9, alpha: ea });
      if (st.badge[j] > 0 && ea > 0) {
        const bx = badgeX(j), lit = st.lit[j], sc = st.badge[j];
        ctx.save();
        ctx.globalAlpha *= ea;
        if (lit > 0) glowDot(bx, L.badgeY, 7, C.meta, lit * 0.6);
        ctx.beginPath();
        ctx.arc(bx, L.badgeY, 11 * sc, 0, Math.PI * 2);
        ctx.fillStyle = mix('#ecf8ec', C.meta, lit);
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = C.meta;
        ctx.stroke();
        ctx.restore();
        math('w', bx, L.badgeY - 1, { size: 18 * sc, color: lit > 0.5 ? '#fff' : C.meta, alpha: ea * clamp(sc) });
      }
    }

    for (let j = 0; j < 5; j++) {
      let a = st.node[j], x = xs[j];
      if (j === 4) x = lerp(xs[4], xs[0], st.carry);
      else a *= keep;
      if (j === 0 && st.carry > 0) a *= 1 - clamp(st.carry * 3);
      if (a <= 0) continue;
      if (j === 3) {
        for (let d = -1; d <= 1; d++) {
          ctx.beginPath();
          ctx.arc(x + d * 13, y, 4 * clamp(a * 1.5), 0, Math.PI * 2);
          ctx.fillStyle = rgba(C.policy, a);
          ctx.fill();
        }
        continue;
      }
      drawNet(x, y, L.node.w, L.node.h, POLICY_NET, clamp(st.glow[j]), a);
      let lbl = TAPE_LABELS[j];
      if (j === 4 && st.carry > 0.5) lbl = 'θ_0';
      math(lbl, x, y + 45, { size: 22, color: C.policy, alpha: a });
    }
    ctx.restore();
  }

  function drawLoss(clock) {
    const a = easeOut(prog(clock, O.sampleReal, 0, 0.35));
    if (a <= 0) return;
    let act = prog(clock, O.loss, 0.4, 0.75) * (1 - prog(clock, O.meta, 0.2, 0.6));
    let arrowF = easeIO(prog(clock, O.loss, 0.05, 0.45));
    let arrowA = 1 - prog(clock, O.carry, 0, 0.5);
    const m = montageAt(clock);
    if (m) {
      act = bump((m.u - 0.44) / 0.24);
      arrowF = easeIO(clamp((m.u - 0.4) / 0.06));
      arrowA = 1 - clamp((m.u - 0.86) / 0.1);
    }
    let dim = 1;
    if (clock >= P.final.start) {
      act = 0;
      arrowA = 0;
      dim = 1 - 0.72 * prog(clock, P.final, 0, 0.15);
    }
    const B = L.loss, y = L.tapeY - 7;
    line([L.tapeXs[4] + L.node.w / 2 + 5, y], [B.x - 4, y], arrowF, { color: C.grad, w: 2.2, head: 9, alpha: arrowA * a * dim });
    ctx.save();
    ctx.globalAlpha *= a * dim;
    if (act > 0) {
      ctx.shadowColor = rgba(C.loss, 0.6 * act);
      ctx.shadowBlur = 20 * act;
    }
    rrect(B.x, B.y, B.w, B.h, 12);
    ctx.fillStyle = mix('#fdebe0', C.loss, act);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.loss;
    ctx.stroke();
    ctx.restore();
    math('L_{real}', B.x + B.w / 2, B.y + B.h / 2 - 1, { size: 27, color: act > 0.5 ? '#fff' : C.realDark, alpha: a * dim });
    text('BC loss on real data', B.x + B.w / 2 - 6, B.y + B.h + 18, { size: 15, color: C.realDark, alpha: a * dim * 0.9 });
  }

  const REAL_LOSS_IDX = [1, 3, 2];
  function drawRealLossBatch(clock) {
    for (let i = 0; i < 3; i++) {
      const f = easeOut(prog(clock, O.sampleReal, 0.1 + i * 0.12, 0.62 + i * 0.12));
      if (f <= 0) continue;
      const into = easeIO(prog(clock, O.loss, 0.1 + i * 0.06, 0.55 + i * 0.06));
      if (into >= 1) continue;
      const tx = L.loss.x + 22 + i * 40, ty = 702;
      const q = qpt(REAL_SRC, [tx + 10, 330], [tx, ty], f);
      const yy = lerp(q[1], L.loss.y + L.loss.h / 2, into);
      const s = lerp(70, 34, f) * (1 - 0.45 * into);
      drawTile(true, REAL_LOSS_IDX[i], q[0] - s / 2, yy - s / 2, s, { alpha: 1 - into, r: 5, lw: 2, shadow: f < 1 });
    }
  }

  function drawMetaPass(u) {
    if (u <= 0 || u >= 1) return;
    const fade = 1 - clamp((u - 0.9) / 0.1);
    const y = L.laneY, x0 = L.loss.x - 2;
    const fb = clamp((u - 0.12) / 0.5);
    const front = metaFront(u);
    if (fb > 0) {
      ctx.save();
      ctx.globalAlpha *= fade;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(front, y);
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.meta;
      ctx.lineCap = 'round';
      ctx.stroke();
      const marks = [0, 1, 2, 3].map(badgeX).concat([(L.tapeXs[4] + L.loss.x) / 2 + 12]);
      marks.forEach(mx => { if (front < mx - 8) arrowHead(mx - 8, y, Math.PI, 10, C.meta); });
      ctx.restore();
      if (fb < 1) glowDot(front, y, 6.5, C.meta, fade);
    }
    const fc = clamp((u - 0.62) / 0.2);
    if (fc > 0) {
      const p0 = [L.tapeXs[0] - L.node.w / 2 - 6, y], p1 = [L.rater.x, y], p2 = [L.rater.x, L.rater.y + L.rater.h / 2 + 14];
      curve(p0, p1, p2, easeIO(fc), { color: C.meta, w: 3.5, head: 12, alpha: fade });
      if (fc < 1) {
        const q = qpt(p0, p1, p2, easeIO(fc));
        glowDot(q[0], q[1], 8, C.meta, fade);
      }
    }
    const la = clamp((u - 0.18) / 0.15) * fade;
    math('∇_η L_{real}', 128, 700, { align: 'left', size: 24, color: C.meta, alpha: la });
    text('meta-gradient', 128, 728, { align: 'left', size: 15, weight: 600, color: C.meta, alpha: la });
  }

  // One batch row: chips, raw scores, softmax weights (bars).
  function drawChips(items, place, alpha) {
    items.forEach((it, i) => {
      const pl = place(it, i);
      if (!pl) return;
      drawTile(it.real, it.idx, pl.x - pl.s / 2, pl.y - pl.s / 2, pl.s, {
        alpha: pl.a * alpha, shadow: pl.flying, r: 7, glow: pl.glow, glowColor: C.good, dim: pl.dim,
        stroke: pl.ring || null, lw: pl.ring ? 3 : 2.4,
      });
    });
  }

  function drawBars(items, grow, alpha) {
    if (alpha <= 0) return;
    items.forEach((it, i) => {
      const p = grow(i);
      if (p <= 0) return;
      const wn = Math.min(1, it.w / W_REF), h = Math.max(2, L.barMax * wn * p);
      const cx = chipCenter(i)[0];
      ctx.save();
      ctx.globalAlpha *= alpha;
      rrect(cx - L.barW / 2, L.barBase - h, L.barW, h, Math.min(5, h / 2));
      ctx.fillStyle = mix('#cdebc5', '#1a9850', wn);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawBarAxis(a, sA) {
    if (sA > 0) math('s_i', L.chipX0 - 14, L.scoreY, { align: 'right', size: 24, color: C.ink, alpha: sA });
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.beginPath();
    ctx.moveTo(L.chipX0 - 4, L.barBase + 0.5);
    ctx.lineTo(chipCenter(7)[0] + 30, L.barBase + 0.5);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = C.rule;
    ctx.stroke();
    ctx.restore();
    math('w_i', L.chipX0 - 14, L.barBase - 48, { align: 'right', size: 24, color: C.good, alpha: a });
    text('softmax', L.chipX0 - 14, L.barBase - 22, { align: 'right', size: 14, color: C.muted, alpha: a });
  }

  function drawBatchLabels(la1, la2) {
    const simMid = (chipCenter(0)[0] + chipCenter(5)[0]) / 2;
    const realMid = (chipCenter(6)[0] + chipCenter(7)[0]) / 2;
    if (la1 > 0) {
      math('ℬ_{sim} ∼ 𝒟_{probe}', simMid, 376, { size: 23, color: C.simDark, alpha: la1 });
      math('ℬ_{real} ∼ 𝒟_R', realMid, 376, { size: 23, color: C.realDark, alpha: la1 });
    }
    if (la2 > 0) {
      ctx.save();
      ctx.globalAlpha *= la2;
      rrect(L.chipX0 - 8, L.chipY - 8, chipCenter(7)[0] + L.chip / 2 + 8 - (L.chipX0 - 8), L.chip + 16, 12);
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.faint;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      label(['batch  ', '$ℬ = ℬ_{sim} ∪ ℬ_{real}'], (L.chipX0 + chipCenter(7)[0] + L.chip / 2) / 2, 376, { size: 17, msize: 23, color: C.ink, alpha: la2 });
    }
  }

  function drawBeam(i, b, alpha) {
    if (b <= 0.02 || alpha <= 0) return;
    const [cx] = chipCenter(i);
    line([RATER_OUT[0] + 8, RATER_OUT[1]], [cx - 27, L.scoreY + 6], 1, { color: C.meta, w: 2, alpha: 0.7 * b * alpha, dash: [5, 5] });
  }

  function drawInner(clock, g) {
    const items = g.batch;
    const fadeAll = 1 - prog(clock, g.update, 0.15, 0.55);

    drawBatchLabels(
      prog(clock, g.sample, 0.15, 0.45) * (1 - prog(clock, g.merge, 0, 0.45)),
      prog(clock, g.merge, 0.35, 0.8) * fadeAll,
    );

    drawChips(items, (it, i) => {
      const d = it.real ? 0.32 + (i - N_SIM) * 0.1 : i * 0.06;
      const f = easeOut(prog(clock, g.sample, d, d + 0.5));
      if (f <= 0) return null;
      const [tx, ty] = chipCenter(i);
      const src = it.real ? REAL_SRC : SIM_SRC;
      const q = qpt(src, it.real ? [870, ty] : [150, ty], [tx, ty], f);
      return { x: q[0], y: q[1], s: lerp(it.real ? 80 : 56, L.chip, f), a: clamp(f * 4), flying: f < 1 };
    }, fadeAll);

    // Raw scores, scanned one sample at a time by the rater.
    items.forEach((it, i) => {
      const p = prog(clock, g.score, 0.04 + i * 0.105, 0.2 + i * 0.105);
      if (p <= 0) return;
      drawBeam(i, bump(p), fadeAll);
      scorePill(chipCenter(i)[0], L.scoreY, it.s, easeBack(clamp(p * 1.7)), fadeAll);
    });
    drawBarAxis(prog(clock, g.softmax, 0, 0.3) * fadeAll, prog(clock, g.score, 0, 0.15) * fadeAll);
    drawBars(items, i => easeOut(prog(clock, g.softmax, 0.12 + i * 0.035, 0.7 + i * 0.035)), fadeAll);

    // Weighted gradient: streams with width proportional to w_i merge into the sum.
    const sg = L.sigma;
    const sigmaFade = 1 - prog(clock, g.update, 0.45, 0.8);
    items.forEach((it, i) => {
      const p = easeIO(prog(clock, g.grad, 0.04 + i * 0.03, 0.5 + i * 0.03));
      if (p <= 0) return;
      const [cx] = chipCenter(i);
      const wn = Math.min(1, it.w / W_REF);
      const ang = Math.atan2(L.barBase - sg.y, cx - sg.x);
      const end = [sg.x + sg.r * Math.cos(ang), sg.y + sg.r * Math.sin(ang)];
      curve([cx, L.barBase + 3], [cx, sg.y - 4], end, p, { color: rgba(C.grad, 0.25 + 0.55 * wn), w: 1.2 + 7 * wn, alpha: fadeAll });
    });
    const sa = easeBack(prog(clock, g.grad, 0.3, 0.6));
    if (sa > 0 && sigmaFade > 0) {
      ctx.save();
      ctx.globalAlpha *= sigmaFade;
      ctx.beginPath();
      ctx.arc(sg.x, sg.y, sg.r * sa, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = C.grad;
      ctx.stroke();
      ctx.restore();
      math('Σ', sg.x, sg.y - 1, { size: 24 * sa, color: C.grad, alpha: sigmaFade });
      const la = prog(clock, g.grad, 0.55, 0.85) * sigmaFade;
      math('g_t', sg.x + 26, sg.y + 31, { align: 'left', size: 26, color: C.grad, alpha: la });
      text('weighted BC gradient', sg.x + 57, sg.y + 32, { align: 'left', size: 15, color: C.muted, alpha: la });
    }
    // The step theta_t -> theta_{t+1} (its weights depend on eta, marked by the badge).
    const ga = easeIO(prog(clock, g.update, 0, 0.42));
    const gFade = 1 - prog(clock, g.update, 0.6, 0.95);
    if (ga > 0 && gFade > 0) {
      const bx = badgeX(g.t);
      curve([sg.x, sg.y + sg.r + 2], [sg.x, L.badgeY - 12], [bx + (bx < sg.x ? 13 : -13), L.badgeY - 8], ga, { color: C.grad, w: 3, head: 11, alpha: gFade });
    }
  }

  function drawMontage(clock, m) {
    const items = MONT_BATCH[m.c], u = m.u;
    const a = easeOut(clamp(u / 0.08)) * (1 - clamp((u - 0.46) / 0.1));
    if (a <= 0) return;
    drawChips(items, (it, i) => {
      const [x, y] = chipCenter(i);
      const p = easeBack(clamp(u / 0.08 - i * 0.05));
      return { x, y, s: L.chip * Math.max(0.6, p), a: clamp(p * 2), flying: false };
    }, a);
    items.forEach((it, i) => scorePill(chipCenter(i)[0], L.scoreY, it.s, 1, a * clamp((u - 0.02) / 0.06)));
    drawBarAxis(a, a);
    drawBars(items, () => easeOut(clamp((u - 0.03) / 0.1)), a);
  }

  function drawFinal(clock) {
    const p = P.final, items = FINAL_BATCH;
    const a = 1;
    drawChips(items, (it, i) => {
      const [x, y] = chipCenter(i);
      const q = easeBack(prog(clock, p, 0.04 + i * 0.015, 0.14 + i * 0.015));
      if (q <= 0) return null;
      const hi = it.w >= 0.1, r = prog(clock, p, 0.5, 0.62);
      return {
        x, y, s: L.chip * Math.max(0.6, q), a: clamp(q * 2), flying: false,
        glow: hi ? r * (0.75 + 0.25 * Math.sin((clock - p.start) * 4)) : 0,
        ring: hi && r > 0 ? C.good : null, dim: hi ? 0 : 0.55 * r,
      };
    }, a);
    items.forEach((it, i) => {
      const q = prog(clock, p, 0.16 + i * 0.03, 0.24 + i * 0.03);
      if (q <= 0) return;
      drawBeam(i, bump(q), a);
      scorePill(chipCenter(i)[0], L.scoreY, it.s, easeBack(clamp(q * 1.7)), a);
    });
    drawBarAxis(prog(clock, p, 0.3, 0.4), prog(clock, p, 0.14, 0.2));
    drawBars(items, i => easeOut(prog(clock, p, 0.32 + i * 0.012, 0.48 + i * 0.012)), a);
    const la = prog(clock, p, 0.55, 0.7);
    label(['Trained rater ', '$R_{η}', ': real and target-aligned sim samples dominate'],
      (L.chipX0 + chipCenter(7)[0] + L.chip / 2) / 2, 376, { size: 16, msize: 21, color: C.good, alpha: la });
  }

  // The bilevel meta-objective, shown while the outer step evaluates and differentiates it.
  function drawObjective(clock) {
    const a = easeOut(prog(clock, O.ret, 0.35, 0.9)) * (1 - prog(clock, O.carry, 0, 0.45));
    if (a <= 0) return;
    const cx = (L.chipX0 + chipCenter(7)[0] + L.chip / 2) / 2;
    text('Meta-objective', cx, 370, { size: 16, weight: 600, color: C.muted, alpha: a });
    math('η^* = `arg min`_η  L_{real}(θ_T(η))', cx, 418, { size: 35, color: C.ink, alpha: a });
    label(['$θ_T', ' depends on ', '$η', ' through the weights ', '$w', ' used in every inner step'],
      cx, 468, { size: 16, msize: 21, weight: 500, color: C.muted, alpha: a });
  }

  function statusText(clock) {
    if (clock < O.outerFor.start) return null;
    const m = montageAt(clock);
    if (m) return `Outer step k = ${MONT_K[m.c]}`;
    if (clock >= P.final.start) return 'Meta-training complete';
    const g = innerAt(clock);
    let s = `Outer step k = ${clock >= O.carry.start + O.carry.dur * 0.5 ? 1 : 0}`;
    if (g) s += `   ·   Inner step t = ${T_LABEL[g.t]}`;
    return s;
  }

  function drawStatus(clock) {
    const s = statusText(clock);
    if (!s) return;
    const a = clock < O.outerFor.start + 0.5 ? prog(clock, O.outerFor, 0, 0.45) : 1;
    const w = textWidth(s, 16, 600) + 34;
    ctx.save();
    ctx.globalAlpha *= a;
    rrect(W / 2 - w / 2, 10, w, 34, 17);
    ctx.fillStyle = '#eef2ff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#c7d2fe';
    ctx.stroke();
    ctx.restore();
    text(s, W / 2, 27, { size: 16, weight: 600, color: '#3730a3', alpha: a });
  }

  function drawScene(clock) {
    drawSources(clock);
    drawChart(clock);
    drawStatus(clock);
    drawTape(clock);
    drawLoss(clock);
    drawRater(clock);
    drawObjective(clock);

    if (clock >= O.meta.start && clock < O.meta.start + O.meta.dur) drawMetaPass(prog(clock, O.meta));
    const m = montageAt(clock);
    if (m && m.u >= 0.58 && m.u < 0.86) drawMetaPass((m.u - 0.58) / 0.28);

    const g = innerAt(clock);
    if (g) drawInner(clock, g);
    if (m) drawMontage(clock, m);
    if (clock >= P.final.start) drawFinal(clock);
    if (clock >= O.sampleReal.start && clock < O.loss.start + O.loss.dur) drawRealLossBatch(clock);
  }

  // ------------------------------------------------------------------ DOM sync
  const CAPS = {
    inputs: ['Inputs.', 'A sim probing dataset 𝒟<sub>probe</sub>, generated from uniformly sampled simulation parameters, and a few real demonstrations 𝒟<sub>R</sub> of the target task (here, <em>stackCube</em>).'],
    init: ['Initialize.', 'The rater <i>R</i><sub><i>η</i></sub> maps an observation–action pair to a scalar score; <i>π</i><sub><i>θ</i></sub> is a lightweight proxy policy (BC-RNN).'],
    outer: ['Outer loop.', 'Each outer step unrolls <i>T</i> inner steps of policy training, starting from the current policy.'],
    sample: ['Sample a co-training batch.', 'Draw sim samples from 𝒟<sub>probe</sub> and real samples from 𝒟<sub>R</sub> according to the co-training ratio <i>α</i>, and combine them into one batch ℬ.'],
    score: ['Score every sample.', 'The rater assigns a raw score <i>s<sub>i</sub></i> = <i>R</i><sub><i>η</i></sub>(<i>o<sub>i</sub></i>, <i>a<sub>i</sub></i>) to each observation–action pair in the batch.'],
    softmax: ['Normalize into weights.', 'A softmax over the batch turns the scores into weights <i>w<sub>i</sub></i>. Real samples are weighted too.'],
    update: ['Weighted policy update.', 'Step along the weighted BC gradient <i>g<sub>t</sub></i> = Σ<sub><i>i</i></sub> <i>w<sub>i</sub></i> ∇<sub><i>θ</i></sub>ℓ<sub>BC</sub> to get <i>θ</i><sub><i>t</i>+1</sub>. The step depends on <i>η</i> through the weights.'],
    unroll: ['Unroll <i>T</i> inner steps.', 'Repeat the weighted update <i>T</i> times while keeping the computation graph, so that <i>θ<sub>T</sub></i> is a differentiable function of <i>η</i>.'],
    realLoss: ['Loss on real data.', 'Sample a batch of real demonstrations and compute the BC loss <i>L</i><sub>real</sub> of the updated policy.'],
    meta: ['Meta-gradient step.', 'Backpropagate <i>L</i><sub>real</sub> through all <i>T</i> inner updates to obtain ∇<sub><i>η</i></sub><i>L</i><sub>real</sub>, then update the rater with the outer optimizer.'],
    carry: ['Next outer step.', 'The policy is not re-initialized: the next unroll continues from <i>θ</i><sub><i>k</i>+1</sub>.'],
    loop: ['Repeat for <i>K</i> outer steps.', 'Over meta-training, the rater learns to up-weight sim samples whose gradients reduce prediction error on real demonstrations, and to down-weight misaligned ones.'],
    return: ['Return the trained rater.', 'The rater now favors real data and simulation samples that match the target task, and suppresses misaligned ones (compare <em>What Does the Rater Learn?</em> below).'],
  };

  const dom = { line: undefined, cap: undefined, k: undefined, t: undefined, pct: -1 };

  function domState(clock) {
    const ph = phaseAt(clock);
    const u = clamp((clock - ph.start) / ph.dur);
    if (ph.type === 'montage') {
      const m = montageAt(clock) || { c: MONT_SKILL.length - 1, u: 1 };
      const line = m.u < 0.42 ? 5 : m.u < 0.58 ? 7 : m.u < 0.86 ? 8 : 4;
      return { line, cap: ph.cap, k: MONT_K[m.c], t: null };
    }
    const line = ph.lines[Math.min(ph.lines.length - 1, Math.floor(u * ph.lines.length))];
    let k = ph.k == null ? null : String(ph.k);
    if (ph.type === 'carry' && line === 4) k = '1';
    const t = ph.t == null ? null : T_LABEL[ph.t];
    return { line, cap: ph.cap, k, t };
  }

  function placeHighlight() {
    const el = lineEls.get(dom.line);
    if (!el) { hl.style.opacity = '0'; return; }
    hl.style.opacity = '1';
    hl.style.transform = `translateY(${el.offsetTop}px)`;
    hl.style.height = `${el.offsetHeight}px`;
  }

  function syncDom() {
    const s = domState(clock);
    if (s.line !== dom.line) {
      lineEls.forEach(el => el.classList.remove('is-active'));
      dom.line = s.line;
      const el = lineEls.get(s.line);
      if (el) el.classList.add('is-active');
      placeHighlight();
    }
    if (s.cap !== dom.cap) {
      dom.cap = s.cap;
      const c = CAPS[s.cap];
      capTitle.innerHTML = c[0];
      capText.innerHTML = c[1];
    }
    for (const key of ['k', 't']) {
      if (s[key] !== dom[key]) {
        dom[key] = s[key];
        if (s[key] != null) varEls[key].textContent = `${key} = ${s[key]}`;
        varEls[key].classList.toggle('is-on', s[key] != null);
      }
    }
    const pct = Math.round((clock / TOTAL) * 1000) / 10;
    if (pct !== dom.pct) {
      dom.pct = pct;
      fill.style.transform = `scaleX(${clock / TOTAL})`;
      track.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
  }

  // ------------------------------------------------------------------ playback
  let clock = 0, playing = false, userPaused = false, visible = false, speed = 1, last = 0, raf = 0;

  function render() {
    if (!canvas.width) return;
    const k = canvas.width / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 1 - prog(clock, P.outro);
    drawScene(clock);
    ctx.restore();
    syncDom();
  }

  function frame(now) {
    raf = 0;
    if (playing) {
      if (last) clock += (Math.min(100, now - last) / 1000) * speed;
      last = now;
      if (clock >= TOTAL) clock %= TOTAL;
      raf = requestAnimationFrame(frame);
    }
    render();
  }

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function setPlaying(p) {
    playing = p;
    last = 0;
    root.classList.toggle('is-playing', p);
    playBtn.setAttribute('aria-label', p ? 'Pause animation' : 'Play animation');
    requestDraw();
  }

  function seek(t) {
    clock = clamp(t, 0, TOTAL - 1e-3);
    last = 0;
    requestDraw();
  }

  playBtn.addEventListener('click', () => {
    userPaused = playing;
    setPlaying(!userPaused);
  });
  restartBtn.addEventListener('click', () => {
    userPaused = false;
    seek(0);
    setPlaying(true);
  });
  const SPEEDS = [1, 0.5, 2];
  speedBtn.addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    speedBtn.textContent = `${speed}×`;
  });

  let dragging = false;
  const seekFromPointer = e => {
    const r = track.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * TOTAL);
  };
  track.addEventListener('pointerdown', e => {
    dragging = true;
    seekFromPointer(e);
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  });
  track.addEventListener('pointermove', e => { if (dragging) seekFromPointer(e); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });
  track.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(clock + (e.key === 'ArrowRight' ? 2 : -2));
    }
  });

  // Clicking a line of the pseudo-code jumps to the first time it executes.
  lineEls.forEach((el, n) => {
    el.addEventListener('click', () => {
      const ph = PH.find(p => p.lines && p.lines.includes(n));
      if (ph) seek(ph.start + (ph.dur * ph.lines.indexOf(n)) / ph.lines.length + 0.01);
    });
  });

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    userPaused = true;
    const g0 = O.inner[0];
    clock = g0.grad.start + g0.grad.dur * 0.98;
  }

  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!userPaused) setPlaying(visible && !document.hidden);
  }, { threshold: 0.35 }).observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (!userPaused) setPlaying(visible && !document.hidden);
  });

  function resize() {
    const w = canvas.clientWidth;
    if (!w) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(((w * H) / W) * dpr);
    placeHighlight();
    requestDraw();
  }
  new ResizeObserver(resize).observe(canvas);
  new ResizeObserver(placeHighlight).observe(root.querySelector('.alg-lines'));

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { mathCache.clear(); requestDraw(); });
  }
  resize();
})();
