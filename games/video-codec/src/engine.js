/* ============================================================================
   engine.js — a small but real block-based hybrid video codec.

   Nothing in this file is faked. Every number the game shows the player is
   produced here by actually doing the thing:
     · the DCT is a real separable 8x8 DCT-II
     · quantization is a real deadzone quantizer with an H.264-style step ladder
     · bit counts come from a real Exp-Golomb run/level coder (the CAVLC family)
     · distortion is measured against a real reconstruction, so drift is real
     · motion compensation predicts from the *reconstructed* reference, exactly
       as a real encoder must, which is why error propagation happens by itself
   ========================================================================= */

const W = 160, H = 96;            // luma resolution of the toy sequence
const BS = 8;                     // transform block size
const MBS = 16;                   // macroblock size
const BW = W / BS, BH = H / BS;   // blocks across / down
const MBW = W / MBS, MBH = H / MBS;

/* ---------------------------------------------------------------- random --- */
// Seeded so every run of the game is identical. An unseeded game cannot be
// reasoned about: the player would never know if the change was theirs.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- the scene --- */
// A "world" larger than the frame, so panning the camera across it produces
// genuine translational motion that motion compensation can actually find.
function valueNoise(rnd, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(w * h);
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const gy = y / cell, y0 = Math.floor(gy), fy = sm(gy - y0);
    for (let x = 0; x < w; x++) {
      const gx = x / cell, x0 = Math.floor(gx), fx = sm(gx - x0);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1];
      const c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    }
  }
  return out;
}

function buildWorld(seed, style) {
  const WW = 260, WH = 170;
  const rnd = mulberry32(seed);
  const img = new Float32Array(WW * WH);

  // A smooth vertical gradient: the easy, flat part of the picture.
  for (let y = 0; y < WH; y++)
    for (let x = 0; x < WW; x++)
      img[y * WW + x] = 70 + 90 * (y / WH) + 18 * Math.sin(x * 0.012 + y * 0.004);

  // Low-frequency texture everywhere.
  const n1 = valueNoise(rnd, WW, WH, 26);
  for (let i = 0; i < img.length; i++) img[i] += (n1[i] - 0.5) * 55;

  // A high-detail region: fine noise the transform cannot compact away.
  const n2 = valueNoise(rnd, WW, WH, 3.4);
  for (let y = 0; y < WH; y++)
    for (let x = 0; x < WW; x++) {
      const inDetail = style === 0
        ? (x > WW * 0.52 && y > WH * 0.30)
        : (x < WW * 0.46 && y > WH * 0.22);
      if (inDetail) img[y * WW + x] += (n2[y * WW + x] - 0.5) * 62;
    }

  // Hard edges: structure with strong high-frequency content in one direction.
  const bars = style === 0 ? 7 : 5;
  for (let b = 0; b < bars; b++) {
    const bx = 14 + Math.floor(rnd() * (WW - 60));
    const by = 10 + Math.floor(rnd() * (WH - 50));
    const bw = 10 + Math.floor(rnd() * 34), bh = 6 + Math.floor(rnd() * 30);
    const v = rnd() > 0.5 ? 215 : 35;
    for (let y = by; y < Math.min(WH, by + bh); y++)
      for (let x = bx; x < Math.min(WW, bx + bw); x++) img[y * WW + x] = v;
  }

  const out = new Uint8ClampedArray(WW * WH);
  for (let i = 0; i < img.length; i++) out[i] = img[i];
  return { data: out, w: WW, h: WH };
}

const WORLD_A = buildWorld(1337, 0);
const WORLD_B = buildWorld(90210, 1);

// A disc with its own internal texture, so it is not merely a flat blob that
// any prediction mode handles for free.
function drawDisc(frame, cx, cy, r, phase) {
  for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++)
    for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const shade = 150 + 70 * Math.sin((dx * 0.55) + phase) * Math.cos(dy * 0.5);
      frame[y * W + x] = Math.max(0, Math.min(255, shade));
    }
}

const CUT_AT = 14;      // the scene cut: frame 14 belongs to a different shot
const N_FRAMES = 24;

// Camera pans right over world A, then after the cut, left over world B.
function cameraFor(t) {
  return t < CUT_AT
    ? { world: WORLD_A, ox: 6 + t * 3, oy: 10 + Math.round(t * 0.8) }
    : { world: WORLD_B, ox: 70 - (t - CUT_AT) * 3, oy: 40 + Math.round((t - CUT_AT) * 1.2) };
}

function makeFrame(t) {
  const { world, ox, oy } = cameraFor(t);
  const f = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(world.h - 1, oy + y);
    for (let x = 0; x < W; x++) f[y * W + x] = world.data[sy * world.w + Math.min(world.w - 1, ox + x)];
  }
  // Several objects, each with its own velocity. This matters: a macroblock that
  // straddles two different motions cannot be predicted by a single vector, which
  // is the entire reason codecs can split a block into smaller partitions.
  if (t < CUT_AT) {
    drawDisc(f, 26 + t * 4, 20 + t * 2, 12, t * 0.35);
    drawDisc(f, 126 - t * 5, 62 - t, 10, 1.4 + t * 0.5);
    drawDisc(f, 78 + Math.round(t * 1.5), 14 + t * 5, 7, 2.2 + t * 0.3);
  } else {
    drawDisc(f, 130 - (t - CUT_AT) * 5, 70 - (t - CUT_AT) * 2, 10, t * 0.4);
    drawDisc(f, 30 + (t - CUT_AT) * 6, 30 + (t - CUT_AT) * 3, 8, 1.1 + t * 0.45);
    drawDisc(f, 96, 66 - (t - CUT_AT) * 4, 7, 3.0 + t * 0.25);
  }
  return f;
}

const SHOT = [];
for (let t = 0; t < N_FRAMES; t++) SHOT.push(makeFrame(t));

/* ------------------------------------------------------- transform & quant --- */
// Separable 8x8 DCT-II, the same transform family every block-based codec uses.
const DCT_C = new Float32Array(64);
for (let u = 0; u < 8; u++)
  for (let x = 0; x < 8; x++)
    DCT_C[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

const _tmp = new Float32Array(64);

function fdct8(src, dst) {
  for (let y = 0; y < 8; y++)
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += src[y * 8 + x] * DCT_C[u * 8 + x];
      _tmp[y * 8 + u] = s;
    }
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += _tmp[y * 8 + u] * DCT_C[v * 8 + y];
      dst[v * 8 + u] = s;
    }
}

function idct8(src, dst) {
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += src[y * 8 + u] * DCT_C[u * 8 + x];
      _tmp[y * 8 + x] = s;
    }
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += _tmp[v * 8 + x] * DCT_C[v * 8 + y];
      dst[y * 8 + x] = s;
    }
}

// H.264's step ladder: the step doubles every 6 QP, so QP is a logarithmic
// control. This is why the quality/bitrate curve feels so non-linear.
function qstep(qp) { return Math.pow(2, (qp - 4) / 6); }

// Deadzone quantizer: values near zero are pulled to zero more aggressively
// than rounding would. Real codecs do this; it is why detail vanishes first.
// level = sign(c) * floor(|c|/q + f). With f = 1/3 anything below two thirds of
// a step becomes exactly zero, which is where most of the compression comes from.
const DEADZONE = 1 / 3;
function quantize(c, q) {
  const a = Math.floor(Math.abs(c) / q + DEADZONE);
  return a === 0 ? 0 : (c < 0 ? -a : a);
}

/* --------------------------------------------------------- entropy coding --- */
// Exp-Golomb: the codes H.264's CAVLC is built from. Short codes for small
// numbers, longer for big ones. Not CABAC — see the fidelity note in the page.
function ueBits(v) { return 2 * Math.floor(Math.log2(v + 1)) + 1; }
function seBits(v) { return ueBits(v <= 0 ? -2 * v : 2 * v - 1); }

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

// Cost of one quantized block, run/level coded along the zigzag.
function coefBits(levels) {
  let last = -1;
  for (let i = 63; i >= 0; i--) if (levels[ZIGZAG[i]] !== 0) { last = i; break; }
  if (last < 0) return 1;                     // coded-block flag says "empty"
  let bits = 1, run = 0;
  for (let i = 0; i <= last; i++) {
    const l = levels[ZIGZAG[i]];
    if (l === 0) { run++; continue; }
    bits += ueBits(run) + seBits(l);
    run = 0;
  }
  return bits + 2;                            // end-of-block
}

/* ----------------------------------------------------------- block helpers --- */
function getBlock(frame, x, y, out, w = W) {
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) out[j * 8 + i] = frame[(y + j) * w + (x + i)];
}

function putBlock(frame, x, y, src, w = W) {
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) {
      const v = src[j * 8 + i];
      frame[(y + j) * w + (x + i)] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
}

const _res = new Float32Array(64), _coef = new Float32Array(64);
const _deq = new Float32Array(64), _rec = new Float32Array(64);
const _lev = new Int16Array(64);

/* Code one 8x8 residual block. Returns {bits, sse} and writes the
   reconstruction (prediction + decoded residual) into recon at (x,y). */
function codeBlock(src, pred, q, recon, x, y) {
  for (let i = 0; i < 64; i++) _res[i] = src[i] - pred[i];
  fdct8(_res, _coef);
  for (let i = 0; i < 64; i++) _lev[i] = quantize(_coef[i], q);
  const bits = coefBits(_lev);
  for (let i = 0; i < 64; i++) _deq[i] = _lev[i] * q;
  idct8(_deq, _rec);
  let sse = 0, nz = 0;
  for (let i = 0; i < 64; i++) {
    if (_lev[i] !== 0) nz++;
    let v = pred[i] + _rec[i];
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    _rec[i] = v;
    const d = v - src[i];
    sse += d * d;
  }
  if (recon) putBlock(recon, x, y, _rec);
  return { bits, sse, nz, levels: Int16Array.from(_lev), coef: Float32Array.from(_coef) };
}

const ZERO64 = new Float32Array(64);

/* ----------------------------------------------------------- intra modes --- */
const INTRA_NAMES = ['DC', 'Vertical', 'Horizontal'];

// Predict an 8x8 block from the already-reconstructed pixels above and left of
// it. Unavailable neighbours fall back to 128, exactly as a real codec does.
function intraPred(recon, x, y, mode, out) {
  const haveTop = y >= 8, haveLeft = x >= 8;
  const top = new Float32Array(8), left = new Float32Array(8);
  for (let i = 0; i < 8; i++) {
    top[i] = haveTop ? recon[(y - 1) * W + x + i] : 128;
    left[i] = haveLeft ? recon[(y + i) * W + x - 1] : 128;
  }
  if (mode === 1) {                                   // vertical
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) out[j * 8 + i] = top[i];
  } else if (mode === 2) {                            // horizontal
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) out[j * 8 + i] = left[j];
  } else {                                            // DC
    let s = 0;
    for (let i = 0; i < 8; i++) s += top[i] + left[i];
    const dc = s / 16;
    for (let i = 0; i < 64; i++) out[i] = dc;
  }
}

/* ------------------------------------------------- motion compensation --- */
// Predict from the reconstructed reference, clamping at the picture edge.
function mcBlock(ref, x, y, mvx, mvy, out, size = 8) {
  for (let j = 0; j < size; j++) {
    const sy = Math.max(0, Math.min(H - 1, y + j + mvy));
    for (let i = 0; i < size; i++) {
      const sx = Math.max(0, Math.min(W - 1, x + i + mvx));
      out[j * size + i] = ref[sy * W + sx];
    }
  }
}

function sadAt(cur, ref, x, y, mvx, mvy, size) {
  let s = 0;
  for (let j = 0; j < size; j++) {
    const sy = Math.max(0, Math.min(H - 1, y + j + mvy));
    for (let i = 0; i < size; i++) {
      const sx = Math.max(0, Math.min(W - 1, x + i + mvx));
      s += Math.abs(cur[(y + j) * W + x + i] - ref[sy * W + sx]);
    }
  }
  return s;
}

function mvBits(mvx, mvy, px, py) { return seBits(mvx - px) + seBits(mvy - py); }

// Rate-constrained full search: minimise SAD + lambda_motion * mv bits. A plain
// SAD search picks noisy vectors that cost more to transmit than they save.
const SEARCH_RANGE = 8;
function motionSearch(cur, ref, x, y, size, lamMot, px = 0, py = 0) {
  let best = { mvx: px, mvy: py, cost: Infinity, sad: 0 };
  for (let my = -SEARCH_RANGE; my <= SEARCH_RANGE; my++)
    for (let mx = -SEARCH_RANGE; mx <= SEARCH_RANGE; mx++) {
      const sad = sadAt(cur, ref, x, y, mx, my, size);
      const cost = sad + lamMot * mvBits(mx, my, px, py);
      if (cost < best.cost) best = { mvx: mx, mvy: my, cost, sad };
    }
  return best;
}

/* --------------------------------------------------------- lambda, PSNR --- */
// The price of a bit, in units of squared error. Every mode decision in every
// modern encoder is this one comparison: J = D + lambda * R.
function lambdaFor(qp) { return 0.85 * Math.pow(2, (qp - 12) / 3); }
function lambdaMotion(qp) { return Math.sqrt(lambdaFor(qp)); }

function psnrOf(a, b) {
  let sse = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sse += d * d; }
  if (sse === 0) return 99;
  return 10 * Math.log10((255 * 255 * a.length) / sse);
}
function sseOf(a, b) {
  let sse = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sse += d * d; }
  return sse;
}

/* ============================= frame encoders ============================ */

/* Level 1-2: transform-only coding of a whole frame, no prediction at all.
   Every block is coded against a flat 128 so the player sees the transform and
   the quantizer by themselves, with nothing else helping. */
function encodeTransformOnly(src, qp) {
  const q = qstep(qp);
  const recon = new Uint8ClampedArray(W * H);
  const blk = new Float32Array(64);
  const flat = new Float32Array(64).fill(128);
  let bits = 0, nz = 0;
  const blockInfo = [];
  for (let by = 0; by < BH; by++)
    for (let bx = 0; bx < BW; bx++) {
      getBlock(src, bx * 8, by * 8, blk);
      const r = codeBlock(blk, flat, q, recon, bx * 8, by * 8);
      bits += r.bits; nz += r.nz;
      blockInfo.push(r);
    }
  bits += 40;                                   // picture header
  return { bits, recon, nz, blockInfo, psnr: psnrOf(src, recon) };
}

/* Level 2's control condition: throw away precision on the raw pixels instead
   of on transform coefficients, coded with the identical entropy coder so the
   comparison is fair. */
function encodePixelDomain(src, step) {
  const recon = new Uint8ClampedArray(W * H);
  const lev = new Int16Array(64);
  let bits = 0;
  for (let by = 0; by < BH; by++)
    for (let bx = 0; bx < BW; bx++) {
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const p = src[(by * 8 + j) * W + bx * 8 + i] - 128;
          lev[j * 8 + i] = quantize(p, step);
        }
      bits += coefBits(lev);
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++)
          recon[(by * 8 + j) * W + bx * 8 + i] = lev[j * 8 + i] * step + 128;
    }
  bits += 40;
  return { bits, recon, psnr: psnrOf(src, recon) };
}

// Find the pixel-domain step that spends the same bits as the DCT path, so the
// two pictures can be compared at matched cost rather than matched "setting".
// The pixel-domain rate is not a smooth function of the step: past the point
// where every pixel falls inside the deadzone, the cost collapses to nothing at
// once. So keep the closest probe actually seen rather than trusting the search
// to land on the target, and let the caller report the real figure either way.
function matchPixelBits(src, targetBits) {
  let lo = 0.5, hi = 3000, best = null, bestD = Infinity;
  for (let it = 0; it < 26; it++) {
    const mid = (lo + hi) / 2;
    const r = encodePixelDomain(src, mid);
    const d = Math.abs(r.bits - targetBits);
    if (d < bestD) { bestD = d; best = r; }
    if (r.bits > targetBits) lo = mid; else hi = mid;
  }
  return best;
}

/* Level 3: one 8x8 block, one prediction choice, everything exposed.
   mode: {kind:'none'} | {kind:'intra', m:0|1|2} | {kind:'inter', mvx, mvy} */
function codeOneBlock(src, recon, ref, bx, by, qp, mode) {
  const q = qstep(qp);
  const x = bx * 8, y = by * 8;
  const blk = new Float32Array(64), pred = new Float32Array(64);
  getBlock(src, x, y, blk);
  let sideBits = 0;
  if (mode.kind === 'none') { pred.fill(128); sideBits = 1; }
  else if (mode.kind === 'intra') { intraPred(recon, x, y, mode.m, pred); sideBits = 1 + ueBits(mode.m); }
  else { mcBlock(ref, x, y, mode.mvx, mode.mvy, pred); sideBits = 1 + mvBits(mode.mvx, mode.mvy, 0, 0); }
  const r = codeBlock(blk, pred, q, null, x, y);
  const resid = new Float32Array(64);
  for (let i = 0; i < 64; i++) resid[i] = blk[i] - pred[i];
  return { ...r, sideBits, total: r.bits + sideBits, pred, resid, src: blk };
}

/* Levels 5-7: the full encoder. Per macroblock it tries every mode it is
   allowed and keeps the one with the lowest J = D + lambda*R. Prediction comes
   from reconstructed references, so any error made here is inherited by every
   frame that predicts from this one. That is error propagation, not a metaphor. */
function encodeFrame(src, refs, opts) {
  const qp = opts.qp;
  const type = opts.type || 'I';
  const q = qstep(qp);
  const lam = opts.lambda !== undefined ? opts.lambda : lambdaFor(qp);
  const lamMot = Math.sqrt(Math.max(0.01, lam));
  const recon = new Uint8ClampedArray(W * H);
  const blk = new Float32Array(64), pred = new Float32Array(64);
  const perMB = [];
  let coefBitsTotal = 0, mvBitsTotal = 0, modeBitsTotal = 0;
  let predMVx = 0, predMVy = 0;

  const ref0 = refs && refs[0], ref1 = refs && refs[1];

  for (let my = 0; my < MBH; my++) {
    predMVx = 0; predMVy = 0;
    for (let mx = 0; mx < MBW; mx++) {
      const X = mx * 16, Y = my * 16;
      const forced = opts.forceSplit ? opts.forceSplit[my * MBW + mx] : undefined;
      const candidates = [];

      // --- intra, four 8x8 blocks, best mode each -------------------------
      if (type === 'I' || opts.allowIntra !== false) {
        candidates.push({ name: 'Intra', run: () => tryIntra(src, recon, X, Y, q, lam) });
      }
      // --- inter from the past reference ----------------------------------
      if (ref0 && type !== 'I') {
        candidates.push({ name: 'Skip', run: () => tryInter(src, [ref0], recon, X, Y, q, lam, 16, { fixed: [predMVx, predMVy], skip: true }) });
        candidates.push({ name: 'Inter 16', run: () => tryInter(src, [ref0], recon, X, Y, q, lam, 16, { lamMot, predMVx, predMVy }) });
        candidates.push({ name: 'Inter 8', run: () => tryInter(src, [ref0], recon, X, Y, q, lam, 8, { lamMot, predMVx, predMVy }) });
      }
      // --- bidirectional: average of a past and a future reference --------
      if (ref1 && type === 'B') {
        candidates.push({ name: 'Bi', run: () => tryInter(src, [ref0, ref1], recon, X, Y, q, lam, 16, { lamMot, predMVx, predMVy, bi: true }) });
      }

      let best = null;
      for (const c of candidates) {
        if (opts.only && !opts.only.includes(c.name)) continue;   // level restricts the menu
        if (forced === 1 && c.name === 'Inter 16') continue;      // player forced a split
        if (forced === 0 && c.name === 'Inter 8') continue;       // player forced no split
        const r = c.run();
        r.name = c.name;
        if (!best || r.J < best.J) best = r;
      }
      if (!best) { best = tryIntra(src, recon, X, Y, q, lam); best.name = 'Intra'; }

      // Commit the winner: write its reconstruction into the frame.
      for (let b = 0; b < 4; b++) {
        const ox = X + (b % 2) * 8, oy = Y + Math.floor(b / 2) * 8;
        putBlock(recon, ox, oy, best.recons[b]);
      }
      coefBitsTotal += best.coefBits;
      mvBitsTotal += best.mvBits;
      modeBitsTotal += best.modeBits;
      predMVx = best.mvx || 0; predMVy = best.mvy || 0;
      perMB.push({
        mx, my, mode: best.name, bits: best.coefBits + best.mvBits + best.modeBits,
        coefBits: best.coefBits, mvBits: best.mvBits, modeBits: best.modeBits,
        sse: best.sse, mvx: best.mvx || 0, mvy: best.mvy || 0, split: best.split || false,
      });
    }
  }

  const headerBits = 36;
  const bits = coefBitsTotal + mvBitsTotal + modeBitsTotal + headerBits;
  return {
    bits, coefBits: coefBitsTotal, mvBits: mvBitsTotal, modeBits: modeBitsTotal,
    headerBits, recon, perMB, type, qp,
    psnr: psnrOf(src, recon), sse: sseOf(src, recon),
  };
}

function tryIntra(src, recon, X, Y, q, lam) {
  const blk = new Float32Array(64), pred = new Float32Array(64);
  const recons = [], scratch = Uint8ClampedArray.from(recon);
  let coefB = 0, modeB = 1, sse = 0;
  for (let b = 0; b < 4; b++) {
    const ox = X + (b % 2) * 8, oy = Y + Math.floor(b / 2) * 8;
    getBlock(src, ox, oy, blk);
    let bestB = null;
    for (let m = 0; m < 3; m++) {
      intraPred(scratch, ox, oy, m, pred);
      const r = codeBlock(blk, pred, q, null, ox, oy);
      const J = r.sse + lam * (r.bits + ueBits(m));
      if (!bestB || J < bestB.J) bestB = { J, m, r, rec: Float32Array.from(_rec) };
    }
    coefB += bestB.r.bits; modeB += ueBits(bestB.m); sse += bestB.r.sse;
    recons.push(bestB.rec);
    putBlock(scratch, ox, oy, bestB.rec);     // later blocks predict from earlier ones
  }
  return { J: sse + lam * (coefB + modeB), coefBits: coefB, mvBits: 0, modeBits: modeB, sse, recons };
}

function tryInter(src, refs, recon, X, Y, q, lam, size, o) {
  const blk = new Float32Array(64), pred = new Float32Array(64);
  const big = new Float32Array(size * size);
  const recons = [null, null, null, null];
  let coefB = 0, mvB = 0, modeB = 1, sse = 0, mvx = 0, mvy = 0;

  const searchOne = (ref, x, y, sz) => o.fixed
    ? { mvx: o.fixed[0], mvy: o.fixed[1] }
    : motionSearch(src, ref, x, y, sz, o.lamMot, o.predMVx, o.predMVy);

  if (size === 16) {
    const m0 = searchOne(refs[0], X, Y, 16);
    mvx = m0.mvx; mvy = m0.mvy;
    let m1 = null;
    if (o.bi && refs[1]) m1 = motionSearch(src, refs[1], X, Y, 16, o.lamMot, 0, 0);
    if (!o.skip) mvB += mvBits(mvx, mvy, o.predMVx || 0, o.predMVy || 0);
    if (m1) mvB += mvBits(m1.mvx, m1.mvy, 0, 0);
    for (let b = 0; b < 4; b++) {
      const ox = X + (b % 2) * 8, oy = Y + Math.floor(b / 2) * 8;
      getBlock(src, ox, oy, blk);
      mcBlock(refs[0], ox, oy, mvx, mvy, pred);
      if (m1) {
        const p2 = new Float32Array(64);
        mcBlock(refs[1], ox, oy, m1.mvx, m1.mvy, p2);
        for (let i = 0; i < 64; i++) pred[i] = (pred[i] + p2[i]) / 2;
      }
      if (o.skip) {
        // Skip sends no residual at all: the prediction *is* the reconstruction.
        let s = 0;
        for (let i = 0; i < 64; i++) { const d = pred[i] - blk[i]; s += d * d; }
        sse += s; recons[b] = Float32Array.from(pred);
      } else {
        const r = codeBlock(blk, pred, q, null, ox, oy);
        coefB += r.bits; sse += r.sse; recons[b] = Float32Array.from(_rec);
      }
    }
    if (o.skip) modeB = 1;
  } else {
    // Four independent 8x8 vectors: more accurate, four times the side info.
    for (let b = 0; b < 4; b++) {
      const ox = X + (b % 2) * 8, oy = Y + Math.floor(b / 2) * 8;
      const m = motionSearch(src, refs[0], ox, oy, 8, o.lamMot, o.predMVx, o.predMVy);
      mvB += mvBits(m.mvx, m.mvy, o.predMVx || 0, o.predMVy || 0);
      getBlock(src, ox, oy, blk);
      mcBlock(refs[0], ox, oy, m.mvx, m.mvy, pred);
      const r = codeBlock(blk, pred, q, null, ox, oy);
      coefB += r.bits; sse += r.sse; recons[b] = Float32Array.from(_rec);
      if (b === 0) { mvx = m.mvx; mvy = m.mvy; }
    }
    modeB = 2;
  }
  return {
    J: sse + lam * (coefB + mvB + modeB),
    coefBits: coefB, mvBits: mvB, modeBits: modeB, sse, recons, mvx, mvy,
    split: size === 8,
  };
}
