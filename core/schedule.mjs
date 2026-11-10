// Delivery confidence for a Reflow plan. Pure functions, no DOM; used by app.js and tests.
//
// 1. fitSlip       Hierarchical (empirical Bayes) model of log(actual / planned) duration:
//                  y = mu0 + a_discipline + b_program + e, random effects shrunk by EM.
//                  Learned from completed tasks in reference programs and this program.
// 2. fitRetest     First-pass yield per test kind (FAT, SAT, CERT) as a Beta posterior
//                  from how many correction cycles past tests needed, plus a lognormal
//                  model of one correction + retest cycle relative to its planned length.
// 3. simulate      Monte Carlo over the dependency network: done tasks fixed, in-progress
//                  tasks conditioned on elapsed time, parameter uncertainty resampled per
//                  iteration, geometric retest loops. Finish distribution, criticality
//                  index, sensitivity, per-task quantiles.
// 4. latestStart   Latest start of a task that keeps P(finish <= target) >= confidence
//                  (bisection with common random numbers), vs. the deterministic float.
// 5. backtest      Leave-one-program-out snapshots of past programs: did their P80 hold?

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function gammaSample(rng, k) {
  // Marsaglia-Tsang
  if (k < 1) return gammaSample(rng, k + 1) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gauss(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function betaSample(rng, a, b) { const x = gammaSample(rng, a), y = gammaSample(rng, b); return x / (x + y); }

// ---------- 1. slip model
// obs: [{ y, d (discipline), p (program key) }]
export function fitSlip(obs, disciplines, opts = {}) {
  const iters = opts.iters ?? 60;
  const D = disciplines, P = [...new Set(obs.map((o) => o.p))];
  let mu = obs.reduce((s, o) => s + o.y, 0) / obs.length;
  const a = Object.fromEntries(D.map((d) => [d, 0])), b = Object.fromEntries(P.map((p) => [p, 0]));
  let s2 = 0.06, ta2 = 0.02, tb2 = 0.01;
  const nd = Object.fromEntries(D.map((d) => [d, obs.filter((o) => o.d === d).length]));
  const np = Object.fromEntries(P.map((p) => [p, obs.filter((o) => o.p === p).length]));
  let va = {}, vb = {};
  for (let it = 0; it < iters; it++) {
    mu = obs.reduce((s, o) => s + o.y - a[o.d] - b[o.p], 0) / obs.length;
    for (const d of D) {
      const r = obs.filter((o) => o.d === d).reduce((s, o) => s + o.y - mu - b[o.p], 0);
      const prec = nd[d] / s2 + 1 / ta2; a[d] = (r / s2) / prec; va[d] = 1 / prec;
    }
    for (const p of P) {
      const r = obs.filter((o) => o.p === p).reduce((s, o) => s + o.y - mu - a[o.d], 0);
      const prec = np[p] / s2 + 1 / tb2; b[p] = (r / s2) / prec; vb[p] = 1 / prec;
    }
    // EM updates of variance components
    let rss = 0; for (const o of obs) rss += (o.y - mu - a[o.d] - b[o.p]) ** 2;
    const lever = D.reduce((s, d) => s + nd[d] * va[d], 0) + P.reduce((s, p) => s + np[p] * vb[p], 0);
    s2 = Math.max(1e-4, (rss + lever) / obs.length);
    ta2 = Math.max(1e-4, D.reduce((s, d) => s + a[d] ** 2 + va[d], 0) / D.length);
    tb2 = Math.max(1e-4, P.reduce((s, p) => s + b[p] ** 2 + vb[p], 0) / P.length);
  }
  const muSe = Math.sqrt(s2 / obs.length);
  return { mu, muSe, a, va, b, vb, sigma: Math.sqrt(s2), tauA: Math.sqrt(ta2), tauB: Math.sqrt(tb2), nd, np };
}

// ---------- 2. retest loops
// fixes: [{ testKind, cycles, planned, actual }]
export function fitRetest(fixes, kinds = ['FAT', 'SAT', 'CERT']) {
  const out = {};
  for (const k of kinds) {
    const f = fixes.filter((x) => x.testKind === k);
    const fails = f.reduce((s, x) => s + x.cycles, 0);
    const alpha = 1 + f.length, beta = 1 + fails; // passes = tests observed to pass
    const ys = f.filter((x) => x.cycles > 0).map((x) => Math.log(x.actual / x.cycles / x.planned));
    const m = ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : 0;
    const sd = ys.length > 1 ? Math.sqrt(ys.reduce((s, y) => s + (y - m) ** 2, 0) / (ys.length - 1)) : 0.3;
    const firstPass = f.filter((x) => x.cycles === 0).length;
    out[k] = { alpha, beta, yieldMean: alpha / (alpha + beta), tests: f.length, firstPass, fails, cycleMu: m, cycleSd: sd, cycleSe: sd / Math.sqrt(Math.max(1, ys.length)) };
  }
  return out;
}

// ---------- learning set from history + current program
export function learningSet(history, current, programKey = 'current') {
  const obs = [], fixes = [];
  history.forEach((h, hi) => h.tasks.forEach((t) => {
    if (t.kind === 'task' || t.kind === 'test') obs.push({ y: Math.log(t.actual / t.planned), d: t.discipline, p: 'h' + hi });
    if (t.kind === 'fix') fixes.push({ testKind: t.testKind, cycles: t.cycles, planned: t.planned, actual: t.actual });
  }));
  if (current) current.forEach((t) => {
    if (t.status !== 'Done') return;
    if (t.kind === 'task' || t.kind === 'test') obs.push({ y: Math.log(t.actual / t.planned), d: t.discipline, p: programKey });
    if (t.kind === 'fix' && t.cycles !== null) fixes.push({ testKind: t.testKind, cycles: t.cycles, planned: t.planned, actual: t.actual });
  });
  return { obs, fixes };
}

// ---------- 3. Monte Carlo
// tasks: plan rows with status ('Done' | 'In progress' | 'Not started'), aStart, actual, elapsed
export function simulate(tasks, model, opts = {}) {
  const N = opts.n ?? 4000, today = opts.today ?? 0;
  const rng = mulberry32(opts.seed ?? 11);
  const T = tasks.filter((t) => t.kind !== 'stage');
  const idx = Object.fromEntries(T.map((t, i) => [t.id, i]));
  const depIdx = T.map((t) => t.deps.map((d) => idx[d]));
  const endI = idx[opts.end ?? 'G9'];
  const dur = new Float32Array(N * T.length);
  const disc = Object.keys(model.slip.a);
  const progKey = opts.programKey ?? 'current';
  const bMean = model.slip.b[progKey] ?? 0, bVar = model.slip.vb[progKey] ?? model.slip.tauB ** 2;
  for (let n = 0; n < N; n++) {
    const mu = model.slip.mu + gauss(rng) * model.slip.muSe;
    const ad = {}; for (const d of disc) ad[d] = model.slip.a[d] + gauss(rng) * Math.sqrt(model.slip.va[d]);
    const bp = bMean + gauss(rng) * Math.sqrt(bVar);
    const theta = {}, cyc = {};
    for (const k of Object.keys(model.retest)) { const r = model.retest[k]; theta[k] = betaSample(rng, r.alpha, r.beta); cyc[k] = r.cycleMu + gauss(rng) * r.cycleSe; }
    const sig = model.slip.sigma;
    for (let i = 0; i < T.length; i++) {
      const t = T[i]; let d;
      if (t.kind === 'gate') d = 0;
      else if (t.status === 'Done') d = t.actual;
      else if (t.kind === 'fix') {
        const r = model.retest[t.testKind]; let k = 0; while (rng() >= theta[t.testKind] && k < 8) k++;
        d = 0; for (let j = 0; j < k; j++) d += t.planned * Math.exp(cyc[t.testKind] + gauss(rng) * r.cycleSd);
        d = Math.max(1, d);
      } else {
        const m = mu + ad[t.discipline] + bp;
        d = t.planned * Math.exp(m + gauss(rng) * sig);
        if (t.status === 'In progress') { let tries = 0; while (d <= t.elapsed && tries++ < 40) d = t.planned * Math.exp(m + gauss(rng) * sig); if (d <= t.elapsed) d = t.elapsed + 1; }
      }
      dur[n * T.length + i] = d;
    }
  }
  const ctx = { T, idx, depIdx, endI, dur, N, today };
  const run = runForward(ctx, opts.snet ?? null, true);
  return { ...run, ctx };
}

// forward passes over stored durations; snet: {i, day} start-no-earlier-than for one task
export function runForward(ctx, snet, detail = false) {
  const { T, depIdx, endI, dur, N, today } = ctx;
  const L = T.length;
  const finish = new Float64Array(N);
  const crit = new Float64Array(L);
  const st = new Float64Array(L), fi = new Float64Array(L), drv = new Int32Array(L);
  const fins = detail ? T.map(() => new Float32Array(N)) : null;
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < L; i++) {
      const t = T[i];
      if (t.status === 'Done' || t.status === 'In progress') { st[i] = t.aStart; drv[i] = -1; }
      else {
        let s = today, dv = -1;
        for (const j of depIdx[i]) if (fi[j] > s) { s = fi[j]; dv = j; }
        if (snet && snet.i === i && snet.day > s) { s = snet.day; dv = -2; }
        st[i] = s; drv[i] = dv;
      }
      fi[i] = st[i] + dur[n * L + i];
      if (t.kind === 'gate' && t.status === 'Done') fi[i] = st[i];
      if (fins) fins[i][n] = fi[i];
    }
    finish[n] = fi[endI];
    if (detail) { let k = endI; while (k >= 0) { crit[k]++; k = drv[k]; } }
  }
  const out = { finish };
  if (detail) {
    out.criticality = Array.from(crit, (c) => c / N);
    out.taskFinish = fins;
  }
  return out;
}

export function quantile(sorted, p) { const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1)))); return sorted[i]; }
export function summarize(finish, target) {
  const s = Array.from(finish).sort((x, y) => x - y);
  let hit = 0; for (const f of finish) if (f <= target) hit++;
  return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p80: quantile(s, 0.8), p95: quantile(s, 0.95), pTarget: hit / finish.length, sorted: s };
}

function ranks(arr) { const o = Array.from(arr, (v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Float64Array(arr.length); o.forEach(([, i], k) => { r[i] = k; }); return r; }
export function spearman(x, y) {
  const rx = ranks(x), ry = ranks(y), n = x.length; const m = (n - 1) / 2;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (rx[i] - m) * (ry[i] - m); sxx += (rx[i] - m) ** 2; syy += (ry[i] - m) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
export function sensitivity(sim) {
  const { T, dur, N } = sim.ctx; const L = T.length;
  return T.map((t, i) => {
    if (t.kind === 'gate' || t.status === 'Done') return 0;
    const x = new Float64Array(N); for (let n = 0; n < N; n++) x[n] = dur[n * L + i];
    return spearman(x, sim.finish);
  });
}

// deterministic plan: planned durations, actuals for done, planned remaining for in-progress
export function deterministic(tasks, today) {
  const T = tasks.filter((t) => t.kind !== 'stage');
  const s = {}, f = {};
  for (const t of T) {
    if (t.status === 'Done' || t.status === 'In progress') s[t.id] = t.aStart;
    else { let x = today; for (const d of t.deps) x = Math.max(x, f[d]); s[t.id] = x; }
    let d = t.kind === 'gate' ? 0 : t.status === 'Done' ? t.actual : t.status === 'In progress' ? Math.max(t.elapsed + 1, t.planned) : t.planned;
    f[t.id] = s[t.id] + d;
  }
  return { s, f };
}
// latest start of task id under the deterministic plan so that end <= target (total float)
export function deterministicLatestStart(tasks, today, id, target) {
  const det = deterministic(tasks, today);
  const T = tasks.filter((t) => t.kind !== 'stage');
  const succ = Object.fromEntries(T.map((t) => [t.id, []]));
  T.forEach((t) => t.deps.forEach((d) => succ[d].push(t.id)));
  const lf = {};
  for (let i = T.length - 1; i >= 0; i--) {
    const t = T[i]; const ss = succ[t.id];
    lf[t.id] = ss.length ? Math.min(...ss.map((x) => lf[x] - (det.f[x] - det.s[x]))) : target;
  }
  return lf[id] - (det.f[id] - det.s[id]);
}

// ---------- 4. latest start at a confidence level (common random numbers)
export function latestStart(sim, id, target, conf) {
  const i = sim.ctx.idx[id];
  const p = (day) => { const r = runForward(sim.ctx, { i, day }); let h = 0; for (const f of r.finish) if (f <= target) h++; return h / r.finish.length; };
  let lo = sim.ctx.today, hi = Math.ceil(target);
  if (p(lo) < conf) return { day: null, pAtToday: p(lo) };
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (p(mid) >= conf) lo = mid; else hi = mid; }
  return { day: lo, p: p(lo) };
}

// ---------- 5. backtest on past programs
export function snapshot(hTasks, day) {
  return hTasks.map((t) => {
    if (t.kind === 'stage') return { ...t, status: null };
    const fin = t.aStart + t.actual;
    if (fin <= day) return { ...t, status: 'Done' };
    if (t.aStart <= day && t.kind !== 'gate') return { ...t, status: 'In progress', elapsed: day - t.aStart };
    return { ...t, status: 'Not started' };
  });
}

export function backtest(history, disciplines, opts = {}) {
  const fracs = opts.fracs ?? [0.3, 0.6];
  const rows = [];
  history.forEach((h, hi) => {
    const others = history.filter((_, j) => j !== hi);
    for (const q of fracs) {
      const day = Math.round(q * h.plannedFinish);
      const snap = snapshot(h.tasks.map((t) => ({ ...t, deps: t.deps })), day);
      const ls = learningSet(others, snap, 'snap');
      const slip = fitSlip(ls.obs, disciplines);
      const retest = fitRetest(ls.fixes);
      const sim = simulate(snap, { slip, retest }, { n: opts.n ?? 1500, today: day, programKey: 'snap', seed: 100 + hi * 10 + Math.round(q * 10) });
      const sm = summarize(sim.finish, h.actualFinish);
      const det = deterministic(snap, day).f.G9;
      rows.push({ program: h.name, q, day, p50: sm.p50, p80: sm.p80, actual: h.actualFinish, det, in80: h.actualFinish <= sm.p80, in50: h.actualFinish <= sm.p50, detHeld: h.actualFinish <= det });
    }
  });
  const c = (k) => rows.filter((r) => r[k]).length;
  return { rows, held80: c('in80'), held50: c('in50'), detHeld: c('detHeld'), n: rows.length };
}

// ---------- orchestration for the page
export function analyze(data, opts = {}) {
  const today = data.program.today;
  const ls = learningSet(data.history, data.tasks, 'current');
  const slip = fitSlip(ls.obs, data.disciplines);
  const retest = fitRetest(ls.fixes);
  const model = { slip, retest };
  const sim = simulate(data.tasks, model, { n: opts.n ?? 4000, today, seed: opts.seed ?? 11 });
  const target = opts.target;
  const sum = summarize(sim.finish, target);
  const sens = sensitivity(sim);
  const det = deterministic(data.tasks, today);
  const taskQ = sim.ctx.T.map((t, i) => { const s = Array.from(sim.taskFinish[i]).sort((x, y) => x - y); return { id: t.id, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) }; });
  return { model, sim, sum, sens, det, taskQ, obsCount: ls.obs.length, fixCount: ls.fixes.length };
}
