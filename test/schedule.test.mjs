import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, DISCIPLINES, TRUTH, mulberry32 as rngOf, gauss } from '../core/program.mjs';
import { fitSlip, fitRetest, simulate, summarize, latestStart, deterministicLatestStart, deterministic, backtest, analyze, spearman } from '../core/schedule.mjs';

const day = (iso) => Math.round((Date.parse(iso) - Date.parse('2026-08-03')) / 864e5);
const { data, truth } = generate(20261110);
const target = day(data.program.target);
const A = analyze(data, { target });

const flatModel = (mu, sigma) => ({
  slip: { mu, muSe: 0, a: { X: 0 }, va: { X: 0 }, b: { current: 0 }, vb: { current: 0 }, sigma, tauB: 0 },
  retest: { FAT: { alpha: 1e6, beta: 1, cycleMu: 0, cycleSd: 0, cycleSe: 0 } },
});

test('slip model recovers discipline effects and noise from a large sample', () => {
  const rng = rngOf(5); const obs = [];
  for (let p = 0; p < 12; p++) { const b = gauss(rng) * 0.1; for (const d of DISCIPLINES) for (let k = 0; k < 15; k++) obs.push({ y: TRUTH.mu0 + TRUTH.disc[d] + b + gauss(rng) * TRUTH.sigma, d, p: 'p' + p }); }
  const fit = fitSlip(obs, DISCIPLINES);
  const est = DISCIPLINES.map((d) => fit.mu + fit.a[d]), tru = DISCIPLINES.map((d) => TRUTH.mu0 + TRUTH.disc[d]);
  assert.ok(spearman(est, tru) > 0.85, 'ordering');
  assert.ok(Math.abs(fit.sigma - TRUTH.sigma) < 0.03, `sigma ${fit.sigma}`);
  // levels are only identified up to the realized program effects, so compare contrasts
  const me = est.reduce((x, y) => x + y) / est.length, mt = tru.reduce((x, y) => x + y) / tru.length;
  est.forEach((e, i) => assert.ok(Math.abs((e - me) - (tru[i] - mt)) < 0.06, DISCIPLINES[i]));
});

test('retest posterior counts first passes and failed cycles exactly', () => {
  const r = fitRetest([{ testKind: 'FAT', cycles: 0, planned: 6, actual: 1 }, { testKind: 'FAT', cycles: 2, planned: 6, actual: 14 }, { testKind: 'FAT', cycles: 1, planned: 6, actual: 6 }]);
  assert.equal(r.FAT.alpha, 4); assert.equal(r.FAT.beta, 4); assert.equal(r.FAT.firstPass, 1);
  assert.ok(Math.abs(r.FAT.cycleMu - (Math.log(14 / 2 / 6) + Math.log(1)) / 2) < 1e-12);
});

test('Monte Carlo matches the analytic lognormal for a single task', () => {
  const tasks = [{ id: 'A', kind: 'task', discipline: 'X', planned: 10, deps: [], status: 'Not started' }, { id: 'G9', kind: 'gate', deps: ['A'], status: 'Not started' }];
  const sim = simulate(tasks, flatModel(0.1, 0.3), { n: 20000, today: 0, seed: 3 });
  const D = 12; const z = (Math.log(D / 10) - 0.1) / 0.3;
  const Phi = (x) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
  assert.ok(Math.abs(summarize(sim.finish, D).pTarget - Phi(z)) < 0.015);
});

test('criticality index splits evenly between identical parallel paths', () => {
  const tasks = [{ id: 'A', kind: 'task', discipline: 'X', planned: 10, deps: [], status: 'Not started' }, { id: 'B', kind: 'task', discipline: 'X', planned: 10, deps: [], status: 'Not started' }, { id: 'C', kind: 'task', discipline: 'X', planned: 3, deps: [], status: 'Not started' }, { id: 'G9', kind: 'gate', deps: ['A', 'B', 'C'], status: 'Not started' }];
  const sim = simulate(tasks, flatModel(0, 0.2), { n: 8000, today: 0, seed: 4 });
  assert.ok(Math.abs(sim.criticality[0] - 0.5) < 0.03 && Math.abs(sim.criticality[1] - 0.5) < 0.03);
  assert.ok(sim.criticality[2] < 0.001);
  assert.equal(sim.criticality[3], 1);
});

test('completed work is fixed and in-progress work is conditioned on elapsed time', () => {
  const T = A.sim.ctx.T; const L = T.length;
  T.forEach((t, i) => {
    if (t.status === 'Done' && t.kind !== 'gate') for (let n = 0; n < 50; n++) assert.equal(A.sim.ctx.dur[n * L + i], t.actual);
    if (t.status === 'In progress') for (let n = 0; n < A.sim.ctx.N; n++) assert.ok(A.sim.ctx.dur[n * L + i] > t.elapsed);
  });
  assert.ok(A.sum.p10 >= data.program.today);
});

test('deterministic latest start equals total float on the plan', () => {
  const tasks = [{ id: 'A', kind: 'task', planned: 5, deps: [], status: 'Not started' }, { id: 'B', kind: 'task', planned: 2, deps: [], status: 'Not started' }, { id: 'G9', kind: 'gate', deps: ['A', 'B'], status: 'Not started' }];
  assert.equal(deterministicLatestStart(tasks, 0, 'B', 20), 18);
  assert.equal(deterministicLatestStart(tasks, 0, 'A', 20), 15);
  assert.equal(deterministic(tasks, 0).f.G9, 5);
});

test('latest start moves earlier as the required confidence rises, and is earlier than the float says', () => {
  const l5 = latestStart(A.sim, 'WBS-20', target, 0.5), l7 = latestStart(A.sim, 'WBS-20', target, 0.7), l8 = latestStart(A.sim, 'WBS-20', target, 0.8);
  assert.ok(l5.day >= l7.day && l7.day >= l8.day);
  assert.ok(l8.p >= 0.8);
  assert.ok(l8.day < deterministicLatestStart(data.tasks, data.program.today, 'WBS-20', target));
  const l99 = latestStart(A.sim, 'WBS-20', target, 0.99);
  assert.equal(l99.day, null);
});

test('backtest: past P80 and P50 dates hold at roughly their stated rates; plan dates do not', () => {
  let a = 0, b = 0, c = 0, n = 0;
  for (let s = 0; s < 8; s++) { const g = generate(100 + s); const bt = backtest(g.data.history, DISCIPLINES, { n: 800 }); a += bt.held80; b += bt.held50; c += bt.detHeld; n += bt.n; }
  assert.ok(a / n > 0.68 && a / n < 0.9, `p80 ${a / n}`);
  assert.ok(b / n > 0.38 && b / n < 0.62, `p50 ${b / n}`);
  assert.ok(c / n < 0.2, `plan ${c / n}`);
});

test('the learned FAT first-pass yield and Controls slip point the same way as the simulator', () => {
  assert.ok(A.model.retest.FAT.yieldMean < A.model.retest.SAT.yieldMean);
  assert.ok(A.model.slip.a.Controls > A.model.slip.a.Mechanical);
});
