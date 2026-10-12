/* ============================================================================
   game.js — the seven levels.

   Every readout in here is produced by engine.js actually encoding something.
   No level fabricates a number to make a bar move.
   ========================================================================= */

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------- rendering --- */
function putGray(cv, data) {
  const ctx = cv.getContext('2d');
  const im = ctx.createImageData(cv.width, cv.height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const v = data[i];
    im.data[j] = im.data[j + 1] = im.data[j + 2] = v;
    im.data[j + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}

// A residual is signed. Mid-grey means "the guess was right", and a residual
// that is flat grey all over costs essentially nothing to transmit.
function putSigned(cv, data, gain = 1.6) {
  const ctx = cv.getContext('2d');
  const im = ctx.createImageData(cv.width, cv.height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const v = Math.max(0, Math.min(255, 128 + data[i] * gain));
    im.data[j] = im.data[j + 1] = im.data[j + 2] = v;
    im.data[j + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}

// Error heat: white where the decoder got it right, deepening orange-red where
// the quantizer threw the picture away.
function putHeat(cv, a, b, gain = 7) {
  const ctx = cv.getContext('2d');
  const im = ctx.createImageData(cv.width, cv.height);
  for (let i = 0, j = 0; i < a.length; i++, j += 4) {
    const d = Math.min(255, Math.abs(a[i] - b[i]) * gain);
    im.data[j] = 255;
    im.data[j + 1] = 255 - d * 0.75;
    im.data[j + 2] = 255 - d;
    im.data[j + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}

function box(cv, x, y, w, h, color, width = 1) {
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function svgEl(name, attrs, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

// Clear only the dedicated layer. Clearing the <svg> itself would delete the
// <title> that aria-labelledby points at and strip the figure's accessible name.
function clearLayer(id) {
  const g = $(id);
  while (g.firstChild) g.removeChild(g.firstChild);
  return g;
}

const fmt = (n) => n.toLocaleString('en-US');

/* ------------------------------------------------- prediction-hook helper --- */
// Commitment before reveal: the option is locked the moment it is chosen, and
// the verdict is only then written. Re-guessing after seeing the answer would
// make the whole beat worthless.
function predictHook(rootId, correct, verdicts, onCommit) {
  const root = $(rootId);
  const buttons = [...root.querySelectorAll('.opts button')];
  const out = root.querySelector('.verdict');
  buttons.forEach((b) => b.addEventListener('click', () => {
    if (root.dataset.done === '1') return;
    root.dataset.done = '1';
    buttons.forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.disabled = x !== b; });
    const v = b.dataset.v;
    out.innerHTML = (v === correct ? '<strong>Right.</strong> ' : '<strong>Not quite.</strong> ')
      + verdicts[v];
    out.style.color = v === correct ? 'var(--quality)' : 'var(--bad)';
    if (onCommit) onCommit(v, v === correct);
  }));
}

/* ------------------------------------------------- shared reference chain --- */
// Levels 3-6 need a believable decoded history to predict from. Build it once,
// the same way a real encoder would: every frame predicts from the previous
// *reconstruction*, never from the original.
const CHAIN_QP = 28;
const chain = [];
{
  let prev = null;
  for (let t = 0; t < 8; t++) {
    const r = encodeFrame(SHOT[t], prev ? [prev] : null, { qp: CHAIN_QP, type: t === 0 ? 'I' : 'P' });
    chain.push(r.recon);
    prev = r.recon;
  }
}

/* ========================================================================== */
/* LEVEL 1 — the quantizer                                                    */
/* ========================================================================== */
(function level1() {
  const L1_BITS = 7000, L1_PSNR = 33.5;
  const st = { qp: 26, tries: 3, done: false, last: null };
  const cache = new Map();
  const run = (qp) => {
    if (!cache.has(qp)) cache.set(qp, encodeTransformOnly(SHOT[0], qp));
    return cache.get(qp);
  };

  putGray($('l1-src'), SHOT[0]);

  // One representative block, drawn as its quantized coefficient magnitudes:
  // the player can watch the high frequencies (bottom-right) die off first.
  const COEF_BLOCK = 7 * BW + 5;
  function drawCoefs(info) {
    const cv = $('l1-coef'), ctx = cv.getContext('2d');
    const im = ctx.createImageData(8, 8);
    const lv = info.levels;
    let peak = 1;
    for (let i = 0; i < 64; i++) peak = Math.max(peak, Math.abs(lv[i]));
    for (let i = 0, j = 0; i < 64; i++, j += 4) {
      const m = Math.abs(lv[i]);
      const v = m === 0 ? 24 : 70 + 185 * Math.sqrt(m / peak);
      im.data[j] = v; im.data[j + 1] = m === 0 ? 24 : v * 0.92; im.data[j + 2] = m === 0 ? 30 : v * 0.6;
      im.data[j + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  }

  function render() {
    const r = run(st.qp);
    st.last = r;
    putGray($('l1-rec'), r.recon);
    putHeat($('l1-err'), SHOT[0], r.recon);
    drawCoefs(r.blockInfo[COEF_BLOCK]);
    $('l1-qp-val').textContent = st.qp;
    $('l1-step').textContent = qstep(st.qp).toFixed(1);
    $('l1-bits').textContent = fmt(r.bits);
    $('l1-psnr').textContent = r.psnr.toFixed(1);
    const zeroed = r.blockInfo.reduce((a, b) => a + (64 - b.nz), 0);
    $('l1-zero').textContent = Math.round((100 * zeroed) / (r.blockInfo.length * 64)) + '%';
    $('l1-tries').textContent = st.tries;
  }

  $('l1-qp').addEventListener('input', (e) => { st.qp = +e.target.value; render(); });

  $('l1-commit').addEventListener('click', () => {
    if (st.done) return;
    const r = st.last;
    st.tries -= 1;
    const ok = r.bits <= L1_BITS && r.psnr >= L1_PSNR;
    const m = $('l1-msg');
    if (ok) {
      st.done = true;
      m.className = 'msg ok';
      m.textContent = `Sent. ${fmt(r.bits)} bits at ${r.psnr.toFixed(1)} dB — inside both limits. `
        + `Notice how narrow that window was: one or two QP values out of twenty-nine.`;
      $('l1-commit').disabled = true;
    } else if (st.tries <= 0) {
      m.className = 'msg no';
      m.textContent = `Out of commits — level lost. ${fmt(r.bits)} bits at ${r.psnr.toFixed(1)} dB. `
        + (r.bits > L1_BITS ? 'Too many bits. ' : 'Quality too low. ')
        + 'Reload the page to try the shot again.';
      $('l1-commit').disabled = true;
      $('l1-qp').disabled = true;
    } else {
      m.className = 'msg no';
      m.textContent = r.bits > L1_BITS
        ? `${fmt(r.bits)} bits — over budget by ${fmt(r.bits - L1_BITS)}. Raise QP.`
        : `${r.psnr.toFixed(1)} dB — below the quality floor. Lower QP.`;
    }
    render();
  });

  predictHook('l1-predict', 'b', {
    a: 'The step doubles every six QP, so twelve QP is a factor of four in step size. '
      + 'That is not a nudge. Drag the slider from 24 to 36 and read the quality figure.',
    b: 'Around 10 dB — roughly 43.5 down to 33.9 here. Halving the file is never cheap, '
      + 'and the cost is not linear in QP: the step size is exponential in it.',
    c: 'Less than that. 25 dB would be unwatchable; the picture at QP 36 is degraded but still legible. '
      + 'The real figure is about 10 dB.',
  });

  render();
})();

/* ========================================================================== */
/* LEVEL 2 — the transform                                                    */
/* ========================================================================== */
(function level2() {
  // Find the QP that spends closest to a requested budget, then give the
  // pixel-domain path exactly the same number of bits to work with.
  const ladder = [];
  for (let qp = 14; qp <= 50; qp++) ladder.push({ qp, r: encodeTransformOnly(SHOT[0], qp) });
  const pixCache = new Map();
  function qpForBudget(budget) {
    return ladder.reduce((a, b) =>
      Math.abs(b.r.bits - budget) < Math.abs(a.r.bits - budget) ? b : a).qp;
  }

  function run() {
    const budget = +$('l2-budget').value;
    const qp = qpForBudget(budget);
    const dct = ladder.find((l) => l.qp === qp).r;
    if (!pixCache.has(qp)) pixCache.set(qp, matchPixelBits(SHOT[0], dct.bits));
    const px = pixCache.get(qp);
    putGray($('l2-dct'), dct.recon);
    putGray($('l2-px'), px.recon);
    $('l2-dct-r').textContent = `${fmt(dct.bits)} bits, ${dct.psnr.toFixed(1)} dB`;
    $('l2-px-r').textContent = `${fmt(px.bits)} bits, ${px.psnr.toFixed(1)} dB`;
    const gap = dct.psnr - px.psnr;
    const extra = px.bits - dct.bits;
    $('l2-msg').className = 'msg ok';
    // Report what actually happened. Below about 8,000 bits the pixel path cannot
    // be squeezed to match at all — every pixel falls inside the deadzone at once —
    // so it ends up spending *more* and still losing, which is the better lesson.
    $('l2-msg').textContent = Math.abs(extra) > dct.bits * 0.05
      ? `The pixel path has no setting that lands exactly here, so it spent ${fmt(px.bits)} bits `
        + `against the transform path's ${fmt(dct.bits)} — and still came out ${gap.toFixed(1)} dB worse.`
      : `Same coder, same quantizer, ${fmt(dct.bits)} against ${fmt(px.bits)} bits. `
        + `The transform is worth ${gap.toFixed(1)} dB. Drag the budget — the gap survives everywhere.`;
  }

  predictHook('l2-predict', 'c', {
    a: 'Run it. The transform does not move information around for tidiness; it changes '
      + 'how many numbers you need to describe the block at all.',
    b: 'Bigger than that, and the reason is worth sitting with.',
    c: 'Around 17 dB at the default budget, which is the difference between "compressed" and "ruined". '
      + 'A natural block is smooth, so in the DCT domain almost all of its energy lands in a '
      + 'few low-frequency coefficients and the other sixty quantize to exactly zero — free. '
      + 'In the pixel domain all 64 numbers matter equally, so the same budget buys 64 crude '
      + 'values instead of 6 precise ones.',
  }, () => {
    $('l2-run').disabled = false;
    $('l2-budget').disabled = false;
    $('l2-msg').className = 'msg';
    $('l2-msg').textContent = 'Guess locked. Run it.';
  });

  $('l2-run').addEventListener('click', run);
  $('l2-budget').addEventListener('input', (e) => {
    $('l2-budget-val').textContent = fmt(+e.target.value);
    if ($('l2-predict').dataset.done === '1') run();
  });
})();

/* ========================================================================== */
/* LEVEL 3 — prediction                                                       */
/* ========================================================================== */
(function level3() {
  const BUDGET = 330, FRAME = 1, QP = 28;
  const src = SHOT[FRAME];
  const ref = chain[FRAME - 1];
  // Intra prediction must read decoded neighbours *of this frame*. Coding the
  // frame intra-only once gives those neighbours honestly, instead of quietly
  // handing intra the previous frame's pixels, which would be a different mode.
  const recon = encodeFrame(src, null, { qp: QP, type: 'I' }).recon;
  const MODES = {
    none: { kind: 'none' }, dc: { kind: 'intra', m: 0 },
    v: { kind: 'intra', m: 1 }, h: { kind: 'intra', m: 2 },
    inter: { kind: 'inter', mvx: 0, mvy: 0 },
  };
  const MODE_KEYS = Object.keys(MODES);

  // Choose five blocks that genuinely disagree about what they want, so the
  // level cannot be beaten by picking one mode and sticking to it.
  function pickBlocks() {
    const byWinner = {};
    for (let by = 1; by < BH - 1; by++)
      for (let bx = 1; bx < BW - 1; bx++) {
        let best = null, baseline = 0;
        for (const k of MODE_KEYS) {
          const r = codeOneBlock(src, recon, ref, bx, by, QP, MODES[k]);
          const J = r.sse + lambdaFor(QP) * r.total;
          if (k === 'none') baseline = r.total;
          if (!best || J < best.J) best = { J, k, total: r.total };
        }
        const margin = baseline - best.total;
        if (!byWinner[best.k] || margin > byWinner[best.k].margin)
          byWinner[best.k] = { bx, by, margin, k: best.k };
      }
    const picks = [];
    for (const k of ['v', 'h', 'inter', 'dc', 'none']) if (byWinner[k]) picks.push(byWinner[k]);
    // Top up from whatever had the strongest preference if a mode never won.
    while (picks.length < 5) {
      const extra = Object.values(byWinner).sort((a, b) => b.margin - a.margin)[picks.length % 3];
      picks.push({ ...extra, bx: extra.bx, by: Math.min(BH - 2, extra.by + picks.length) });
    }
    return picks.slice(0, 5);
  }

  const blocks = pickBlocks().map((b, i) => ({ ...b, i, committed: null }));
  const st = { sel: 0, spent: 0, lost: false };

  const sel = $('l3-block');
  blocks.forEach((b, i) => sel.appendChild(new Option(`Block ${i + 1} — at (${b.bx * 8}, ${b.by * 8})`, String(i))));

  function drawFrame() {
    putGray($('l3-frame'), src);
    blocks.forEach((b, i) => {
      const colour = b.committed ? '#2f7a52' : (i === st.sel ? '#2f6f9f' : '#b4541e');
      box($('l3-frame'), b.bx * 8 - 1, b.by * 8 - 1, 10, 10, colour, 1);
    });
  }

  function render() {
    const b = blocks[st.sel];
    const mode = b.committed || $('l3-mode').value;
    const r = codeOneBlock(src, recon, ref, b.bx, b.by, QP, MODES[mode]);
    putSigned($('l3-b-res'), r.resid, 1.8);
    putGray($('l3-b-src'), Uint8ClampedArray.from(r.src));
    putGray($('l3-b-pred'), Uint8ClampedArray.from(r.pred));
    putGray($('l3-b-rec'), reconOf(r));
    $('l3-bits').textContent = r.total;
    let energy = 0; for (let i = 0; i < 64; i++) energy += r.resid[i] * r.resid[i];
    $('l3-err').textContent = Math.round(Math.sqrt(energy / 64));
    $('l3-total').textContent = st.spent;
    $('l3-done').textContent = `${blocks.filter((x) => x.committed).length}/5`;
    $('l3-commit').disabled = !!b.committed || st.lost;
    $('l3-mode').disabled = !!b.committed || st.lost;
    if (b.committed) $('l3-mode').value = b.committed;
    drawFrame();
  }

  // prediction + the *decoded* residual: exactly what the viewer gets back.
  function reconOf(r) {
    const q = qstep(QP);
    const res = new Float32Array(64), coef = new Float32Array(64);
    const deq = new Float32Array(64), dec = new Float32Array(64);
    for (let i = 0; i < 64; i++) res[i] = r.src[i] - r.pred[i];
    fdct8(res, coef);
    for (let i = 0; i < 64; i++) deq[i] = quantize(coef[i], q) * q;
    idct8(deq, dec);
    const out = new Uint8ClampedArray(64);
    for (let i = 0; i < 64; i++) out[i] = r.pred[i] + dec[i];
    return out;
  }

  putGray($('l3-prev'), ref);
  sel.addEventListener('change', (e) => { st.sel = +e.target.value; render(); });
  $('l3-mode').addEventListener('change', render);
  $('l3-frame').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W, y = ((e.clientY - rect.top) / rect.height) * H;
    let bestI = -1, bestD = 14;
    blocks.forEach((b, i) => {
      const d = Math.hypot(x - (b.bx * 8 + 4), y - (b.by * 8 + 4));
      if (d < bestD) { bestD = d; bestI = i; }
    });
    if (bestI >= 0) { st.sel = bestI; sel.value = String(bestI); render(); }
  });

  $('l3-commit').addEventListener('click', () => {
    const b = blocks[st.sel];
    if (b.committed || st.lost) return;
    const mode = $('l3-mode').value;
    const r = codeOneBlock(src, recon, ref, b.bx, b.by, QP, MODES[mode]);
    b.committed = mode;
    st.spent += r.total;
    const left = blocks.filter((x) => !x.committed);
    const m = $('l3-msg');
    if (st.spent > BUDGET) {
      st.lost = true;
      m.className = 'msg no';
      m.textContent = `Over budget at ${st.spent} bits. Level lost — reload to retry. `
        + `The block that hurt you was probably one where the previous frame had already moved on.`;
    } else if (left.length === 0) {
      m.className = 'msg ok';
      m.textContent = `All five committed for ${st.spent} bits. Every block wanted a different guess — `
        + `that is why mode decision is per block, not per frame.`;
    } else {
      m.className = 'msg';
      m.textContent = `Committed at ${r.total} bits. ${st.spent} spent, ${BUDGET - st.spent} left for ${left.length} block(s).`;
      st.sel = left[0].i; sel.value = String(st.sel);
    }
    render();
  });

  render();
})();

/* ========================================================================== */
/* LEVEL 4 — motion                                                           */
/* ========================================================================== */
(function level4() {
  const BUDGET = 230, FRAME = 5, QP = 28;
  const src = SHOT[FRAME], ref = chain[FRAME - 1];

  // Four blocks: three where motion compensation earns its keep, and one that the
  // previous frame already predicts perfectly without moving — where any vector the
  // player dials in is pure cost. That fourth block is the point of the level.
  function pick() {
    const scored = [];
    for (let by = 1; by < BH - 1; by++)
      for (let bx = 1; bx < BW - 1; bx++) {
        const z = sadAt(src, ref, bx * 8, by * 8, 0, 0, 8);
        const best = motionSearch(src, ref, bx * 8, by * 8, 8, 0);
        const zeroCost = codeOneBlock(src, ref, ref, bx, by, QP, { kind: 'inter', mvx: 0, mvy: 0 }).total;
        scored.push({ bx, by, gain: z - best.sad, zeroCost, mv: [best.mvx, best.mvy] });
      }
    const movers = scored.filter((s) => s.gain > 260)
      .sort((a, b) => b.gain - a.gain);
    const chosen = [];
    for (const m of movers) {
      if (chosen.every((c) => Math.hypot(c.bx - m.bx, c.by - m.by) > 3)
        && chosen.every((c) => Math.hypot(c.mv[0] - m.mv[0], c.mv[1] - m.mv[1]) > 1.5)) chosen.push(m);
      if (chosen.length === 3) break;
    }
    while (chosen.length < 3) chosen.push(movers[chosen.length] || scored[0]);
    // The block the past frame already nails: standing still is already almost free,
    // so every bit of motion vector the player spends here buys nothing.
    const settled = scored.filter((s) => chosen.every((c) => Math.hypot(c.bx - s.bx, c.by - s.by) > 3))
      .sort((a, b) => a.zeroCost - b.zeroCost)[0] || scored[0];
    chosen.push(settled);
    return chosen;
  }

  const blocks = pick().map((b, i) => ({ ...b, i, committed: null }));
  const st = { sel: 0, spent: 0, lost: false, mvx: 0, mvy: 0 };

  const sel = $('l4-block');
  blocks.forEach((b, i) => sel.appendChild(new Option(`Block ${i + 1} — at (${b.bx * 8}, ${b.by * 8})`, String(i))));

  function bar(resBits, mvBitsN) {
    const g = clearLayer('l4-bar-layer');
    const total = resBits + mvBitsN;
    const scale = 170 / Math.max(60, total);
    g.appendChild(svgEl('rect', { x: 15, y: 30, width: Math.max(1, resBits * scale), height: 22, fill: 'var(--bits)' }));
    g.appendChild(svgEl('rect', { x: 15 + resBits * scale, y: 30, width: Math.max(1, mvBitsN * scale), height: 22, fill: 'var(--mv)' }));
    g.appendChild(svgEl('text', { x: 15, y: 24, 'font-size': 11, fill: '#6a6a5e', 'font-family': 'ui-sans-serif,system-ui,sans-serif' }, `${total} bits total`));
    g.appendChild(svgEl('text', { x: 15, y: 70, 'font-size': 10, fill: 'var(--bits)', 'font-family': 'ui-sans-serif,system-ui,sans-serif' }, `residual ${resBits}`));
    g.appendChild(svgEl('text', { x: 15, y: 86, 'font-size': 10, fill: 'var(--mv)', 'font-family': 'ui-sans-serif,system-ui,sans-serif' }, `vector ${mvBitsN}`));
  }

  function render() {
    const b = blocks[st.sel];
    const mv = b.committed || { mvx: st.mvx, mvy: st.mvy };
    const r = codeOneBlock(src, chain[FRAME - 1], ref, b.bx, b.by, QP, { kind: 'inter', mvx: mv.mvx, mvy: mv.mvy });
    putGray($('l4-frame'), src);
    blocks.forEach((x, i) => box($('l4-frame'), x.bx * 8 - 1, x.by * 8 - 1, 10, 10,
      x.committed ? '#2f7a52' : (i === st.sel ? '#2f6f9f' : '#b4541e')));
    putGray($('l4-ref'), ref);
    box($('l4-ref'), b.bx * 8 + mv.mvx, b.by * 8 + mv.mvy, 8, 8, '#7a4fa3', 1);
    box($('l4-ref'), b.bx * 8 - SEARCH_RANGE, b.by * 8 - SEARCH_RANGE, 8 + 2 * SEARCH_RANGE, 8 + 2 * SEARCH_RANGE, '#9a9a8c', 1);
    putGray($('l4-b-src'), Uint8ClampedArray.from(r.src));
    putGray($('l4-b-pred'), Uint8ClampedArray.from(r.pred));
    putSigned($('l4-b-res'), r.resid, 1.8);
    const sad = sadAt(src, ref, b.bx * 8, b.by * 8, mv.mvx, mv.mvy, 8);
    const mb = r.sideBits;
    $('l4-sad').textContent = fmt(sad);
    $('l4-rbits').textContent = r.bits;
    $('l4-mbits').textContent = mb;
    $('l4-total').textContent = st.spent;
    $('l4-done').textContent = `${blocks.filter((x) => x.committed).length}/4`;
    bar(r.bits, mb);
    $('l4-mvx-val').textContent = mv.mvx;
    $('l4-mvy-val').textContent = mv.mvy;
    $('l4-commit').disabled = !!b.committed || st.lost;
    $('l4-mvx').disabled = !!b.committed || st.lost;
    $('l4-mvy').disabled = !!b.committed || st.lost;
  }

  $('l4-mvx').addEventListener('input', (e) => { st.mvx = +e.target.value; render(); });
  $('l4-mvy').addEventListener('input', (e) => { st.mvy = +e.target.value; render(); });
  sel.addEventListener('change', (e) => {
    st.sel = +e.target.value;
    const b = blocks[st.sel];
    st.mvx = b.committed ? b.committed.mvx : 0; st.mvy = b.committed ? b.committed.mvy : 0;
    $('l4-mvx').value = st.mvx; $('l4-mvy').value = st.mvy;
    render();
  });

  $('l4-commit').addEventListener('click', () => {
    const b = blocks[st.sel];
    if (b.committed || st.lost) return;
    const r = codeOneBlock(src, chain[FRAME - 1], ref, b.bx, b.by, QP, { kind: 'inter', mvx: st.mvx, mvy: st.mvy });
    b.committed = { mvx: st.mvx, mvy: st.mvy };
    st.spent += r.total;
    const zero = codeOneBlock(src, chain[FRAME - 1], ref, b.bx, b.by, QP, { kind: 'inter', mvx: 0, mvy: 0 });
    const left = blocks.filter((x) => !x.committed);
    const m = $('l4-msg');
    if (st.spent > BUDGET) {
      st.lost = true; m.className = 'msg no';
      m.textContent = `Over budget at ${st.spent} bits — level lost. Reload to retry.`;
    } else if (left.length === 0) {
      m.className = 'msg ok';
      m.textContent = `Shot coded for ${st.spent} bits. The encoder's own search minimises `
        + `SAD + λ·(vector bits), not SAD — which is why its vectors are sometimes "worse" and cheaper.`;
    } else {
      m.className = 'msg';
      const delta = zero.total - r.total;
      m.textContent = delta > 0
        ? `Committed: ${r.total} bits, ${delta} fewer than standing still. ${BUDGET - st.spent} left.`
        : `Committed: ${r.total} bits — that vector cost you ${-delta} bits more than a vector of zero would have. `
          + `A perfect match is not worth paying for when there was nothing to fix. ${BUDGET - st.spent} left.`;
      st.sel = left[0].i; sel.value = String(st.sel);
      st.mvx = 0; st.mvy = 0; $('l4-mvx').value = 0; $('l4-mvy').value = 0;
    }
    render();
  });

  render();
})();

/* ========================================================================== */
/* LEVEL 5 — partitioning                                                     */
/* ========================================================================== */
(function level5() {
  const FRAME = 5, QP = 26, ONLY = ['Inter 16', 'Inter 8'];
  const src = SHOT[FRAME], ref = chain[FRAME - 1];
  const n = MBW * MBH;
  const st = { split: new Array(n).fill(0), tries: 3, done: false, reveal: null };

  const baseNo = encodeFrame(src, [ref], { qp: QP, type: 'P', only: ONLY, forceSplit: new Array(n).fill(0) });
  const optimal = encodeFrame(src, [ref], { qp: QP, type: 'P', only: ONLY });

  function draw() {
    const cv = $('l5-frame');
    putGray(cv, src);
    const ctx = cv.getContext('2d');
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < n; i++) {
      const mx = i % MBW, my = (i / MBW) | 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(mx * 16 + 0.5, my * 16 + 0.5, 15, 15);
      if (st.reveal && st.reveal[i]) {
        ctx.strokeStyle = '#9a9a8c'; ctx.lineWidth = 2;
        ctx.strokeRect(mx * 16 + 2, my * 16 + 2, 12, 12);
      }
      if (st.split[i]) {
        ctx.strokeStyle = '#2f6f9f'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx * 16 + 8.5, my * 16 + 1); ctx.lineTo(mx * 16 + 8.5, my * 16 + 15);
        ctx.moveTo(mx * 16 + 1, my * 16 + 8.5); ctx.lineTo(mx * 16 + 15, my * 16 + 8.5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    $('l5-split').textContent = st.split.reduce((a, b) => a + b, 0);
    $('l5-tries').textContent = st.tries;
  }

  $('l5-frame').addEventListener('click', (e) => {
    if (st.done || st.tries <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = Math.floor((((e.clientX - rect.left) / rect.width) * W) / 16);
    const my = Math.floor((((e.clientY - rect.top) / rect.height) * H) / 16);
    if (mx < 0 || my < 0 || mx >= MBW || my >= MBH) return;
    const i = my * MBW + mx;
    st.split[i] = st.split[i] ? 0 : 1;
    draw();
  });

  $('l5-none').addEventListener('click', () => { st.split.fill(0); draw(); });
  $('l5-all').addEventListener('click', () => { st.split.fill(1); draw(); });

  $('l5-run').addEventListener('click', () => {
    if (st.done || st.tries <= 0) return;
    st.tries -= 1;
    const r = encodeFrame(src, [ref], { qp: QP, type: 'P', only: ONLY, forceSplit: st.split.slice() });
    $('l5-bits').textContent = fmt(r.bits);
    $('l5-mv').textContent = fmt(r.mvBits);
    $('l5-psnr').textContent = r.psnr.toFixed(2);
    const m = $('l5-msg');
    const beat = r.bits < baseNo.bits && r.psnr > baseNo.psnr;
    const allSplit = st.split.every((x) => x === 1);
    if (beat) {
      st.done = true;
      st.reveal = optimal.perMB.map((p) => (p.split ? 1 : 0));
      const agree = st.split.reduce((a, v, i) => a + (v === st.reveal[i] ? 1 : 0), 0);
      m.className = 'msg ok';
      m.textContent = `${fmt(r.bits)} bits at ${r.psnr.toFixed(2)} dB — cheaper and better than `
        + `split-nothing (${fmt(baseNo.bits)} bits, ${baseNo.psnr.toFixed(2)} dB). The encoder's own `
        + `rate–distortion choice is now drawn in grey: it splits ${st.reveal.reduce((a, b) => a + b, 0)} `
        + `macroblocks and you agreed with it on ${agree} of ${n}.`;
    } else if (st.tries <= 0) {
      st.reveal = optimal.perMB.map((p) => (p.split ? 1 : 0));
      m.className = 'msg no';
      m.textContent = `Out of encodes — level lost. Yours: ${fmt(r.bits)} bits at ${r.psnr.toFixed(2)} dB. `
        + `Split-nothing: ${fmt(baseNo.bits)} at ${baseNo.psnr.toFixed(2)}. The encoder's answer is now in grey — `
        + `it splits only where two different motions meet inside one block.`;
      $('l5-run').disabled = true;
    } else {
      m.className = 'msg no';
      m.textContent = allSplit
        ? `Splitting everything costs ${fmt(r.bits)} bits (${fmt(r.mvBits)} of them just vectors) at `
          + `${r.psnr.toFixed(2)} dB, against ${fmt(baseNo.bits)} at ${baseNo.psnr.toFixed(2)} for splitting nothing. `
          + `Four vectors describing one motion is three wasted vectors.`
        : `${fmt(r.bits)} bits at ${r.psnr.toFixed(2)} dB. Target: under ${fmt(baseNo.bits)} bits `
          + `AND over ${baseNo.psnr.toFixed(2)} dB. Look for blocks where an object edge crosses the square.`;
    }
    draw();
  });

  draw();
  $('l5-msg').className = 'msg';
  $('l5-msg').textContent = `Baseline — split nothing: ${fmt(baseNo.bits)} bits at ${baseNo.psnr.toFixed(2)} dB. Beat both numbers at once.`;
})();

/* ========================================================================== */
/* LEVEL 6 — J = D + lambda R                                                 */
/* ========================================================================== */
(function level6() {
  const FRAME = 3, TGT_BITS = 2800, TGT_PSNR = 38.0;
  const src = SHOT[FRAME], ref = chain[FRAME - 1];
  const st = { tries: 5, done: false, points: [] };
  const lamMult = (v) => Math.pow(2, v / 4);

  function drawRD() {
    const g = clearLayer('l6-rd-layer');
    const X0 = 52, Y0 = 212, X1 = 400, Y1 = 22;
    const bMin = 400, bMax = 6000, pMin = 31, pMax = 42;
    const sx = (b) => X0 + ((b - bMin) / (bMax - bMin)) * (X1 - X0);
    const sy = (p) => Y0 + ((p - pMin) / (pMax - pMin)) * (Y1 - Y0);
    const F = { 'font-size': 10, fill: '#6a6a5e', 'font-family': 'ui-sans-serif,system-ui,sans-serif' };

    // target box, drawn first so points land on top
    g.appendChild(svgEl('rect', {
      x: sx(bMin), y: sy(pMax), width: sx(TGT_BITS) - sx(bMin), height: sy(TGT_PSNR) - sy(pMax),
      fill: 'rgba(47,122,82,.12)', stroke: '#2f7a52', 'stroke-dasharray': '4 3',
    }));
    g.appendChild(svgEl('text', { ...F, x: sx(bMin) + 6, y: sy(pMax) + 14, fill: '#2f7a52' }, 'target'));

    g.appendChild(svgEl('line', { x1: X0, y1: Y0, x2: X1, y2: Y0, stroke: '#bbb' }));
    g.appendChild(svgEl('line', { x1: X0, y1: Y0, x2: X0, y2: Y1, stroke: '#bbb' }));
    for (let b = 1000; b <= 6000; b += 1000) {
      g.appendChild(svgEl('line', { x1: sx(b), y1: Y0, x2: sx(b), y2: Y0 + 4, stroke: '#bbb' }));
      g.appendChild(svgEl('text', { ...F, x: sx(b), y: Y0 + 16, 'text-anchor': 'middle' }, String(b / 1000) + 'k'));
    }
    for (let p = 32; p <= 42; p += 2) {
      g.appendChild(svgEl('line', { x1: X0 - 4, y1: sy(p), x2: X0, y2: sy(p), stroke: '#bbb' }));
      g.appendChild(svgEl('text', { ...F, x: X0 - 8, y: sy(p) + 3, 'text-anchor': 'end' }, String(p)));
    }
    g.appendChild(svgEl('text', { ...F, x: (X0 + X1) / 2, y: Y0 + 32, 'text-anchor': 'middle' }, 'bits spent (R)'));
    g.appendChild(svgEl('text', { ...F, x: 14, y: (Y0 + Y1) / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(Y0 + Y1) / 2})` }, 'quality, dB (lower D)'));

    st.points.forEach((pt, i) => {
      const last = i === st.points.length - 1;
      g.appendChild(svgEl('circle', {
        cx: sx(Math.min(bMax, pt.bits)), cy: sy(Math.max(pMin, Math.min(pMax, pt.psnr))),
        r: last ? 5 : 3.2, fill: last ? 'var(--lever)' : 'rgba(47,111,159,.4)',
      }));
      if (last) g.appendChild(svgEl('text', {
        ...F, x: sx(Math.min(bMax, pt.bits)) + 9, y: sy(pt.psnr) + 3, fill: 'var(--lever)',
      }, `QP ${pt.qp}, λ×${pt.mult.toFixed(2)}`));
    });
  }

  function render() {
    $('l6-qp-val').textContent = $('l6-qp').value;
    $('l6-lam-val').textContent = lamMult(+$('l6-lam').value).toFixed(2);
    $('l6-tries').textContent = st.tries;
    drawRD();
  }

  $('l6-qp').addEventListener('input', render);
  $('l6-lam').addEventListener('input', render);

  $('l6-run').addEventListener('click', () => {
    if (st.done || st.tries <= 0) return;
    st.tries -= 1;
    const qp = +$('l6-qp').value, mult = lamMult(+$('l6-lam').value);
    const r = encodeFrame(src, [ref], { qp, type: 'P', lambda: lambdaFor(qp) * mult });
    st.points.push({ bits: r.bits, psnr: r.psnr, qp, mult });
    putGray($('l6-rec'), r.recon);
    const mix = {};
    r.perMB.forEach((p) => { mix[p.mode] = (mix[p.mode] || 0) + 1; });
    const top = Object.entries(mix).sort((a, b) => b[1] - a[1])[0];
    $('l6-bits').textContent = fmt(r.bits);
    $('l6-psnr').textContent = r.psnr.toFixed(2);
    $('l6-modes').textContent = `${top[0]} ×${top[1]}`;
    $('l6-cap').textContent = `QP ${qp}, λ ×${mult.toFixed(2)}`;
    const m = $('l6-msg');
    if (r.bits <= TGT_BITS && r.psnr >= TGT_PSNR) {
      st.done = true; m.className = 'msg ok';
      m.textContent = `Inside the box: ${fmt(r.bits)} bits at ${r.psnr.toFixed(2)} dB. `
        + `QP set how much precision you were willing to destroy; λ set how hard the encoder `
        + `argued about spending bits at all. Two dials, one objective function.`;
      $('l6-run').disabled = true;
    } else if (st.tries <= 0) {
      m.className = 'msg no';
      m.textContent = `Out of encodes — level lost. Your curve is still on the plot: every point `
        + `you made is a real operating point of this encoder, and the frontier they trace is `
        + `the rate–distortion curve.`;
      $('l6-run').disabled = true;
    } else {
      m.className = 'msg no';
      m.textContent = r.bits > TGT_BITS
        ? `${fmt(r.bits)} bits — ${fmt(r.bits - TGT_BITS)} too many, at ${r.psnr.toFixed(2)} dB. `
          + `You can buy that back with QP, with λ, or with both; they do different things.`
        : `${r.psnr.toFixed(2)} dB — under the floor, at ${fmt(r.bits)} bits. You have bits to spare.`;
    }
    render();
  });

  predictHook('l6-predict', 'c', {
    a: 'Intra is the most expensive mode there is — raising the price of bits is the last thing '
      + 'that would make an encoder choose it.',
    b: 'Splitting buys accuracy with four vectors. When bits are expensive, accuracy is the first '
      + 'thing to go.',
    c: 'Skip, which sends no residual and no new vector at all: "the previous frame, shifted; nothing '
      + 'to add". At twenty times the textbook λ, most of this frame becomes Skip and the picture '
      + 'visibly stops updating. That is what a starved encoder looks like.',
  });

  render();
})();

/* ========================================================================== */
/* LEVEL 7 — ship the shot                                                    */
/* ========================================================================== */
(function level7() {
  const RATE = 3200, BUF0 = 10000, BUFMAX = 13000;
  const PSNR_FLOOR = 34, MAX_STRIKES = 2, AVG_TARGET = 36.6;
  const st = {};

  function reset() {
    Object.assign(st, {
      t: 0, buffer: BUF0, prev: null, next: null, strikes: 0, total: 0,
      delay: 3, over: false, history: [], guess: null,
    });
    $('l7-send').disabled = false;
    $('l7-type').disabled = false;
    $('l7-qp').disabled = false;
    const p = $('l7-predict');
    p.dataset.done = '0';
    p.querySelectorAll('.opts button').forEach((b) => { b.disabled = false; b.setAttribute('aria-pressed', 'false'); });
    p.querySelector('.verdict').textContent = 'A correct call earns you 600 bits of buffer. A wrong one costs nothing but the information.';
    p.querySelector('.verdict').style.color = '';
    $('l7-msg').className = 'msg';
    $('l7-msg').textContent = 'Frame 0 has nothing behind it, so it has to be an I frame — and an '
      + 'I frame at a low QP can empty the buffer on its own before the shot has started.';
    render();
  }

  function timeline() {
    const g = clearLayer('l7-tl-layer');
    const X0 = 40, X1 = 640, Y0 = 130, YT = 26;
    const colW = (X1 - X0) / N_FRAMES;
    const maxBits = Math.max(11000, ...st.history.map((h) => h.bits));
    const F = { 'font-size': 9, fill: '#6a6a5e', 'font-family': 'ui-sans-serif,system-ui,sans-serif' };
    g.appendChild(svgEl('line', { x1: X0, y1: Y0, x2: X1, y2: Y0, stroke: '#bbb' }));
    g.appendChild(svgEl('text', { ...F, x: X0, y: 16 }, 'bits per frame'));

    st.history.forEach((h) => {
      const x = X0 + h.t * colW;
      const hh = ((h.bits / maxBits) * (Y0 - YT));
      g.appendChild(svgEl('rect', { x: x + 1, y: Y0 - hh, width: colW - 2, height: hh, fill: 'var(--bits)', opacity: 0.85 }));
      g.appendChild(svgEl('text', { ...F, x: x + colW / 2, y: Y0 + 11, 'text-anchor': 'middle', fill: '#444' }, h.type));
    });
    if (!st.over && st.t < N_FRAMES) {
      g.appendChild(svgEl('rect', { x: X0 + st.t * colW + 1, y: YT, width: colW - 2, height: Y0 - YT, fill: 'rgba(47,111,159,.13)' }));
      g.appendChild(svgEl('text', { ...F, x: X0 + st.t * colW + colW / 2, y: Y0 + 11, 'text-anchor': 'middle', fill: 'var(--lever)' }, 'now'));
    }

    // buffer trace
    const BY0 = 182, BY1 = 142;
    g.appendChild(svgEl('line', { x1: X0, y1: BY0, x2: X1, y2: BY0, stroke: 'var(--bad)', 'stroke-dasharray': '3 3' }));
    g.appendChild(svgEl('text', { ...F, x: 2, y: BY0 + 4, fill: 'var(--bad)' }, 'stall'));
    g.appendChild(svgEl('text', { ...F, x: 2, y: BY1 + 4 }, 'full'));
    const by = (b) => BY0 + (Math.max(0, Math.min(BUFMAX, b)) / BUFMAX) * (BY1 - BY0);
    let d = `M ${X0} ${by(BUF0)}`;
    st.history.forEach((h) => { d += ` L ${X0 + (h.t + 1) * colW} ${by(h.buffer)}`; });
    g.appendChild(svgEl('path', { d, fill: 'none', stroke: 'var(--quality)', 'stroke-width': 2 }));
  }

  function render() {
    $('l7-t').textContent = st.t < N_FRAMES ? st.t : N_FRAMES - 1;
    putGray($('l7-src'), SHOT[Math.min(st.t, N_FRAMES - 1)]);
    putGray($('l7-rec'), st.prev || SHOT[0]);
    $('l7-buf').textContent = fmt(Math.round(st.buffer));
    $('l7-strikes').textContent = `${st.strikes}/${MAX_STRIKES}`;
    $('l7-delay').textContent = st.delay;
    $('l7-avg').textContent = st.history.length
      ? (st.history.reduce((a, h) => a + h.psnr, 0) / st.history.length).toFixed(2) : '—';
    $('l7-qp-val').textContent = $('l7-qp').value;
    const last = st.history[st.history.length - 1];
    $('l7-last').textContent = last ? fmt(last.bits) : '—';
    $('l7-lastq').textContent = last ? last.psnr.toFixed(1) : '—';
    $('l7-buf').parentElement.className = st.buffer < 3000 ? 'ro fail' : 'ro';
    timeline();
  }

  function bucket(bits) { return bits < 2500 ? 'cheap' : bits <= 6000 ? 'mid' : 'dear'; }

  function finish(won, why) {
    st.over = true;
    $('l7-send').disabled = true;
    $('l7-type').disabled = true;
    $('l7-qp').disabled = true;
    const avg = st.history.reduce((a, h) => a + h.psnr, 0) / Math.max(1, st.history.length);
    const iCount = st.history.filter((h) => h.type === 'I').length;
    const m = $('l7-msg');
    m.className = won ? 'msg ok' : 'msg no';
    m.textContent = `${why} ${fmt(st.total)} bits for ${st.history.length} frame`
      + `${st.history.length === 1 ? '' : 's'} `
      + `(${iCount} of them coded from scratch), average ${avg.toFixed(2)} dB. `
      + (won ? 'Read the debrief — then go run ffprobe on something real.'
        : 'Restart and try again: the shot is identical every time, so what you learned transfers exactly.');
    render();
  }

  function sendOne(type, qp, isSecondOfPair) {
    const t = st.t;
    const refs = type === 'I' ? null
      : type === 'B' ? [st.prev, st.next]
        : [st.prev];
    const r = encodeFrame(SHOT[t], refs, { qp, type });
    st.total += r.bits;
    st.buffer = Math.min(BUFMAX, st.buffer + RATE - r.bits);
    if (r.psnr < PSNR_FLOOR) st.strikes += 1;
    st.history.push({ t, type, bits: r.bits, psnr: r.psnr, buffer: st.buffer, qp });
    if (type !== 'B') st.prev = r.recon;
    st.t += 1;
    return r;
  }

  $('l7-send').addEventListener('click', () => {
    if (st.over || st.t >= N_FRAMES) return;
    let type = $('l7-type').value;
    const qp = +$('l7-qp').value;
    if (st.t === 0) type = 'I';
    if (type === 'B' && (st.delay <= 0 || st.t === 0 || st.t >= N_FRAMES - 1)) {
      $('l7-msg').className = 'msg no';
      $('l7-msg').textContent = st.delay <= 0
        ? 'No delay budget left — a B frame needs the next frame coded first, and you have spent all three frames of delay.'
        : 'A B frame needs a frame on each side; there is none here.';
      return;
    }

    let note = '';
    let r;
    if (type === 'B') {
      // Reorder: code the future anchor first, then the B that sits between.
      // This is exactly why B frames cost latency rather than being free.
      st.delay -= 1;
      const futureT = st.t + 1;
      const fr = encodeFrame(SHOT[futureT], [st.prev], { qp, type: 'P' });
      st.next = fr.recon;
      r = sendOne('B', qp);
      // now commit the anchor we already coded, in its own frame slot
      st.total += fr.bits;
      st.buffer = Math.min(BUFMAX, st.buffer + RATE - fr.bits);
      if (fr.psnr < PSNR_FLOOR) st.strikes += 1;
      st.history.push({ t: futureT, type: 'P', bits: fr.bits, psnr: fr.psnr, buffer: st.buffer, qp });
      st.prev = fr.recon;
      st.t = futureT + 1;
      note = ` Two frames went out: the B (${fmt(r.bits)} bits) and the P anchor it needed (${fmt(fr.bits)}).`;
    } else {
      r = sendOne(type, qp);
    }

    // Score the prediction, then re-arm it for the next frame.
    const p = $('l7-predict');
    if (st.guess) {
      const truth = bucket(r.bits);
      const right = st.guess === truth;
      if (right) st.buffer = Math.min(BUFMAX, st.buffer + 600);
      const v = p.querySelector('.verdict');
      v.textContent = right
        ? `Called it — ${fmt(r.bits)} bits. +600 buffer.`
        : `It came in at ${fmt(r.bits)} bits. You said ${st.guess === 'cheap' ? 'cheap' : st.guess === 'mid' ? 'normal' : 'expensive'}.`;
      v.style.color = right ? 'var(--quality)' : 'var(--bad)';
      st.guess = null;
    }
    p.dataset.done = '0';
    p.querySelectorAll('.opts button').forEach((b) => { b.disabled = false; b.setAttribute('aria-pressed', 'false'); });

    const m = $('l7-msg');
    if (st.buffer <= 0) { render(); finish(false, 'The buffer hit zero — playback stalled.'); return; }
    if (st.strikes >= MAX_STRIKES) { render(); finish(false, `${MAX_STRIKES} frames fell below ${PSNR_FLOOR} dB — visibly broken.`); return; }
    if (st.t >= N_FRAMES) {
      render();
      const avg = st.history.reduce((a, h) => a + h.psnr, 0) / st.history.length;
      finish(avg >= AVG_TARGET, avg >= AVG_TARGET
        ? 'Shot delivered, buffer intact, quality held.'
        : `Shot delivered without a stall, but the average came in at ${avg.toFixed(2)} dB, `
          + `under the ${AVG_TARGET} dB the brief asked for. Surviving the channel is not the `
          + `same as using it.`);
      return;
    }
    m.className = 'msg';
    m.textContent = `Frame ${st.t - 1} cost ${fmt(r.bits)} bits at ${r.psnr.toFixed(1)} dB; `
      + `buffer ${st.buffer > 0 ? 'at ' + fmt(Math.round(st.buffer)) : 'empty'}.` + note;
    render();
  });

  $('l7-qp').addEventListener('input', render);
  $('l7-type').addEventListener('change', render);
  $('l7-restart').addEventListener('click', reset);

  // The per-frame prediction beat re-arms every frame, so it is a habit, not a quiz.
  $('l7-predict').querySelectorAll('.opts button').forEach((b) => {
    b.addEventListener('click', () => {
      if ($('l7-predict').dataset.done === '1' || st.over) return;
      $('l7-predict').dataset.done = '1';
      st.guess = b.dataset.v;
      $('l7-predict').querySelectorAll('.opts button').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b)); x.disabled = true;
      });
      const v = $('l7-predict').querySelector('.verdict');
      v.textContent = 'Locked. Send the frame.';
      v.style.color = '';
    });
  });

  reset();
})();
