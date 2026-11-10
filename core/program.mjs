// Seeded generator for a hardware integration program in Reflow's plan format, plus
// six completed reference programs (Re:Build has many such programs). Ground truth
// (discipline slip effects, test first-pass yields) is only used to simulate actuals
// and by the tests; the model in core/schedule.mjs learns everything from history.

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
export function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const DISCIPLINES = ['Integrator lead', 'Mechanical', 'Electrical', 'Controls', 'Software', 'Quality', 'Facilities', 'Operations', 'Manufacturing engineering'];

// id, name, discipline, planned days, deps, kind, stage, test kind
// kind: task | gate | test | fix ; fix tasks hold the correction + retest cycles of their test
export const TEMPLATE = [
  ['T-001', 'Define and procure (G0 to G2)', null, 0, [], 'stage', null],
  ['G0', 'G0 Program kickoff', null, 0, [], 'gate', 'T-001'],
  ['WBS-01', 'WBS-01 Requirements and acceptance criteria', 'Integrator lead', 12, ['G0'], 'task', 'T-001'],
  ['WBS-02', 'WBS-02 Concept layout and cycle-time study', 'Manufacturing engineering', 14, ['G0'], 'task', 'T-001'],
  ['G1', 'G1 Concept approved', null, 0, ['WBS-01', 'WBS-02'], 'gate', 'T-001'],
  ['WBS-03', 'WBS-03 Long-lead procurement: robots and conveyors', 'Integrator lead', 35, ['G1'], 'task', 'T-001'],
  ['WBS-04', 'WBS-04 Electrical architecture and safety concept', 'Electrical', 12, ['G1'], 'task', 'T-001'],
  ['G2', 'G2 Design freeze authorized', null, 0, ['WBS-04'], 'gate', 'T-001'],
  ['T-002', 'Design and build (G3 to G6)', null, 0, [], 'stage', null],
  ['WBS-05', 'WBS-05 Fixture and end-effector design', 'Mechanical', 18, ['G2'], 'task', 'T-002'],
  ['WBS-06', 'WBS-06 Electrical design and panel drawings', 'Electrical', 16, ['G2'], 'task', 'T-002'],
  ['G3', 'G3 Mechanical and electrical design released', null, 0, ['WBS-05', 'WBS-06'], 'gate', 'T-002'],
  ['WBS-07', 'WBS-07 PLC and HMI software', 'Controls', 28, ['G3'], 'task', 'T-002'],
  ['WBS-08', 'WBS-08 Vision and traceability software', 'Software', 24, ['G3'], 'task', 'T-002'],
  ['WBS-09', 'WBS-09 Fixture fabrication', 'Mechanical', 21, ['G3'], 'task', 'T-002'],
  ['WBS-10', 'WBS-10 Panel build and wiring', 'Electrical', 14, ['G3'], 'task', 'T-002'],
  ['WBS-11', 'WBS-11 Mechanical assembly', 'Integrator lead', 12, ['WBS-03', 'WBS-09', 'WBS-10'], 'task', 'T-002'],
  ['WBS-12', 'WBS-12 Integration and debug', 'Controls', 15, ['WBS-07', 'WBS-08', 'WBS-11'], 'task', 'T-002'],
  ['WBS-13', 'WBS-13 FAT first execution', 'Quality', 5, ['WBS-12'], 'test', 'T-002', 'FAT'],
  ['WBS-14', 'WBS-14 FAT correction and retest', 'Integrator lead', 7, ['WBS-13'], 'fix', 'T-002', 'FAT'],
  ['G6', 'G6 FAT and dispatch authorized', null, 0, ['WBS-14'], 'gate', 'T-002'],
  ['T-003', 'Install and accept (G7 to G9)', null, 0, [], 'stage', null],
  ['WBS-15', 'WBS-15 Site utilities and route readiness', 'Facilities', 20, ['G2'], 'task', 'T-003'],
  ['WBS-16', 'WBS-16 Dispatch and receiving', 'Facilities', 6, ['G6', 'WBS-15'], 'task', 'T-003'],
  ['WBS-17', 'WBS-17 Installation and recommissioning', 'Integrator lead', 12, ['WBS-16'], 'task', 'T-003'],
  ['G7', 'G7 Controlled site commissioning authorized', null, 0, ['WBS-17'], 'gate', 'T-003'],
  ['WBS-18', 'WBS-18 SAT first execution', 'Quality', 4, ['G7'], 'test', 'T-003', 'SAT'],
  ['WBS-19', 'WBS-19 SAT data correction and retest', 'Controls', 5, ['WBS-18'], 'fix', 'T-003', 'SAT'],
  ['WBS-20', 'WBS-20 Third-party safety certification', 'Quality', 8, ['G7'], 'test', 'T-003', 'CERT'],
  ['WBS-21', 'WBS-21 Certification findings closure', 'Electrical', 6, ['WBS-20'], 'fix', 'T-003', 'CERT'],
  ['G8', 'G8 Site acceptance', null, 0, ['WBS-19', 'WBS-21'], 'gate', 'T-003'],
  ['WBS-22', 'WBS-22 Operator and maintenance training', 'Operations', 6, ['G8'], 'task', 'T-003'],
  ['WBS-23', 'WBS-23 Production ramp and capability study', 'Operations', 14, ['G8'], 'task', 'T-003'],
  ['WBS-24', 'WBS-24 Final handover review', 'Manufacturing engineering', 4, ['WBS-22', 'WBS-23'], 'task', 'T-003'],
  ['G9', 'G9 Handover to operations', null, 0, ['WBS-24'], 'gate', 'T-003'],
];

// ground truth used to simulate actuals
export const TRUTH = {
  mu0: 0.1, sigma: 0.24,
  disc: { 'Integrator lead': 0.08, Mechanical: 0.02, Electrical: 0.06, Controls: 0.3, Software: 0.36, Quality: 0.04, Facilities: 0.14, Operations: -0.02, 'Manufacturing engineering': -0.04 },
  programSd: 0.1,
  pass: { FAT: 0.5, SAT: 0.68, CERT: 0.58 },
  cycle: { FAT: 6, SAT: 3, CERT: 7 }, // planned days of one correction + retest cycle
};

function plannedVariant(rng, base) {
  return base === 0 ? 0 : Math.max(2, Math.round(base * Math.exp(gauss(rng) * 0.18)));
}

// simulate one program's actual durations under the truth
export function simulateActuals(rng, tasks, programEffect) {
  const act = {}; const cycles = {};
  for (const t of tasks) {
    if (t.kind === 'stage' || t.kind === 'gate') { act[t.id] = 0; continue; }
    if (t.kind === 'fix') {
      const p = TRUTH.pass[t.testKind];
      let k = 0; while (rng() >= p && k < 6) k++;
      cycles[t.id] = k;
      let d = 0;
      for (let j = 0; j < k; j++) d += TRUTH.cycle[t.testKind] * Math.exp(TRUTH.mu0 + TRUTH.disc[t.discipline] + programEffect + gauss(rng) * TRUTH.sigma);
      act[t.id] = Math.max(1, Math.round(d)); // sign-off day even on first pass
      continue;
    }
    const slip = TRUTH.mu0 + TRUTH.disc[t.discipline] + programEffect + gauss(rng) * TRUTH.sigma;
    act[t.id] = Math.max(1, Math.round(t.planned * Math.exp(slip)));
  }
  return { act, cycles };
}

export function buildTasks(rng, variant = true) {
  return TEMPLATE.map(([id, name, discipline, planned, deps, kind, stage, testKind]) => ({
    id, name, discipline, planned: variant ? plannedVariant(rng, planned) : planned, deps, kind, stage, testKind: testKind ?? null,
  }));
}

// forward pass with given durations, returns start/finish by id
export function forward(tasks, dur, startDay = 0) {
  const s = {}, f = {};
  for (const t of tasks) {
    if (t.kind === 'stage') continue;
    let st = startDay;
    for (const d of t.deps) st = Math.max(st, f[d]);
    s[t.id] = st; f[t.id] = st + (dur[t.id] ?? 0);
  }
  return { s, f };
}

const REF_NAMES = ['Composite Layup Cell', 'Harness Test Station', 'Weld Fixture Line', 'Battery Pack End-of-Line Tester', 'Robotic Palletizing Cell', 'Seat Frame Assembly Cell'];

export function generate(seed = 20261110) {
  const rng = mulberry32(seed);
  const history = [];
  for (let p = 0; p < REF_NAMES.length; p++) {
    const tasks = buildTasks(rng);
    const eff = gauss(rng) * TRUTH.programSd;
    const { act, cycles } = simulateActuals(rng, tasks, eff);
    const plan = forward(tasks, Object.fromEntries(tasks.map((t) => [t.id, t.planned])));
    const actual = forward(tasks, act);
    history.push({ name: REF_NAMES[p], effect: eff, tasks: tasks.map((t) => ({ ...t, actual: act[t.id], cycles: cycles[t.id] ?? null, aStart: actual.s[t.id], aFinish: actual.f[t.id] })), plannedFinish: plan.f.G9, actualFinish: actual.f.G9 });
  }
  // current program: start Aug 3 2026, today Nov 10 2026 (day 99)
  const tasks = buildTasks(rng, false);
  const eff = gauss(rng) * TRUTH.programSd;
  const sim = simulateActuals(rng, tasks, eff);
  const actual = forward(tasks, sim.act);
  const today = 99;
  const cur = tasks.map((t) => {
    if (t.kind === 'stage') return { ...t, status: null };
    const st = actual.s[t.id], fi = actual.f[t.id];
    let status = 'Not started', aStart = null, actualDur = null, elapsed = null;
    if (fi <= today && (t.kind !== 'gate' || st <= today)) { status = 'Done'; aStart = st; actualDur = sim.act[t.id]; }
    else if (st <= today) { status = 'In progress'; aStart = st; elapsed = today - st; }
    return { ...t, status, aStart, actual: actualDur, elapsed, cycles: status === 'Done' ? sim.cycles[t.id] ?? null : null };
  });
  const OWNERS = { 'Integrator lead': 'DO', Mechanical: 'DO', Electrical: 'SK', Controls: 'SK', Software: 'SK', Quality: 'AR', Facilities: 'AR', Operations: 'AR', 'Manufacturing engineering': 'DO' };
  cur.forEach((t) => { if (t.kind !== 'stage') t.owner = t.discipline ? OWNERS[t.discipline] : (t.id === 'G9' ? null : 'DO'); });
  const data = {
    program: { name: 'Battery Module Cell', chat: 'Spring delivery check', startDate: '2026-08-03', today, target: '2027-04-15', targetLabel: 'spring delivery' },
    disciplines: DISCIPLINES,
    tasks: cur,
    history: history.map((h) => ({ name: h.name, tasks: h.tasks.map((t) => ({ id: t.id, discipline: t.discipline, kind: t.kind, testKind: t.testKind, deps: t.deps, planned: t.planned, actual: t.actual, cycles: t.cycles, aStart: t.aStart })), plannedFinish: h.plannedFinish, actualFinish: h.actualFinish })),
  };
  const truth = { seed, programEffect: eff, actualFinish: actual.f.G9, actualDur: sim.act, cycles: sim.cycles, historyEffects: history.map((h) => h.effect), TRUTH };
  return { data, truth };
}
