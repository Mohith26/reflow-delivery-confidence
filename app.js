import { analyze, summarize, latestStart, deterministicLatestStart, backtest } from './core/schedule.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const START = Date.parse('2026-08-03T00:00:00Z');
const toDate = (d) => new Date(START + Math.round(d) * 864e5);
const dayOf = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - START) / 864e5);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d) => { const x = toDate(d); return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}`; };
const fmtY = (d) => { const x = toDate(d); return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`; };
const iso = (d) => toDate(d).toISOString().slice(0, 10);
const AV = { DO: ['Dana Ortiz', '#7336ec'], SK: ['Sam Kim', '#43a87a'], AR: ['Ana Ruiz', '#1d5fbf'] };
const icons = () => window.lucide && window.lucide.createIcons();

let DATA, A, BT, target, conf = 0.8, askTask = 'WBS-20', showConf = true, selected = null;
const collapsed = new Set(['T-001']);

function compute() {
  A = analyze(DATA, { target, n: 4000 });
}

function stats() {
  const sum = summarize(A.sim.finish, target);
  const ls = latestStart(A.sim, askTask, target, conf);
  const dls = deterministicLatestStart(DATA.tasks, DATA.program.today, askTask, target);
  return { sum, ls, dls };
}

function programSlip() {
  const done = DATA.tasks.filter((t) => t.status === 'Done' && (t.kind === 'task' || t.kind === 'test'));
  const m = done.reduce((s, t) => s + Math.log(t.actual / t.planned), 0) / done.length;
  return Math.round((Math.exp(m) - 1) * 100);
}
function discSlip(d) { const s = A.model.slip; return Math.round((Math.exp(s.mu + s.a[d] + (s.b.current ?? 0)) - 1) * 100); }
const taskName = (id) => DATA.tasks.find((t) => t.id === id).name;
const shortName = (id) => taskName(id).replace(/^WBS-\d+ /, '');

function renderChat(st) {
  const p = DATA.program;
  const r = A.model.retest.FAT;
  const N = A.sim.ctx.N;
  const ask = DATA.tasks.find((t) => t.id === askTask);
  const pct = Math.round(conf * 100);
  const lsTxt = st.ls.day === null
    ? `There is no start date that gives ${pct}%: even if ${shortName(askTask).toLowerCase()} starts as soon as its predecessors allow, the chance is ${Math.round(st.ls.pAtToday * 100)}%.`
    : `To keep an ${pct}% chance of handing over by ${fmt(target)}, ${shortName(askTask).toLowerCase()} needs to start by <b>${fmt(st.ls.day)}</b>, ${Math.max(0, st.dls - st.ls.day)} days earlier than the float suggests.`;
  const w10 = DATA.tasks.find((t) => t.id === 'WBS-10');
  $('msgs').innerHTML = `
    <div class="m-user"><div class="who">${AV.DO[0]} <span class="av" style="background:${AV.DO[1]}">DO</span></div>
      <div class="bubble">Panel build wrapped up today. Can you mark it and update the plan?</div><div class="time">9:12 AM</div></div>
    <div class="m-bot"><div class="bot-h"><span class="bot-mark"><img src="assets/reflow-mark-white.svg" alt="" /></span>Reflow</div>
      <div class="bot-b"><div class="performed"><i class="ok" data-lucide="check"></i>Performed 2 actions<i data-lucide="chevron-down"></i></div>
      <p>Done. WBS-10 Panel build and wiring is marked done: ${w10.actual} days against ${w10.planned} planned. Mechanical assembly can start once fixture fabrication finishes.</p></div></div>
    <div class="m-user"><div class="who">${AV.DO[0]} <span class="av" style="background:${AV.DO[1]}">DO</span></div>
      <div class="bubble">How late can certification start and still hit the ${esc(p.targetLabel)} date?</div><div class="time">9:20 AM</div></div>
    <div class="m-bot"><div class="bot-h"><span class="bot-mark"><img src="assets/reflow-mark-white.svg" alt="" /></span>Reflow</div>
      <div class="bot-b"><div class="thinking">Thinking <u>Show</u></div>
      <div class="performed"><i class="ok" data-lucide="check"></i>Performed 3 actions<i data-lucide="chevron-down"></i></div>
      <p>On the plan as drawn, ${esc(ask.name)} can start as late as ${fmt(st.dls)} and still make ${fmt(target)}. That assumes every remaining task runs to its planned duration; completed work on this program has run ${programSlip()}% over plan.</p>
      <p>I simulated the rest of the plan ${N.toLocaleString()} times using ${A.obsCount} completed tasks from this program and six past Re:Build programs. FAT needed at least one retest in ${r.tests - r.firstPass} of ${r.tests} past programs, and Controls tasks on this program are expected to run about ${discSlip('Controls')}% long.</p>
      <p>${lsTxt} Handover lands ${fmt(st.sum.p50)} at P50 and ${fmt(st.sum.p80)} at P80; the chance of making ${fmt(target)} is ${Math.round(st.sum.pTarget * 100)}%.</p>
      <div class="artifact"><i data-lucide="activity"></i>Delivery confidence — updated<span class="open">Open</span></div></div></div>`;
}

function renderCard(st) {
  const det = A.det.f.G9;
  $('planSub').textContent = `${DATA.tasks.filter((t) => t.kind !== 'stage').length} tasks · ${DATA.disciplines.length} disciplines`;
  $('dcMeta').textContent = `Learned from ${A.obsCount} completed tasks and ${A.fixCount} test cycles · past P80 dates held ${BT.held80} of ${BT.n} times (plan dates ${BT.detHeld} of ${BT.n})`;
  $('sPlan').textContent = fmt(det);
  $('sPlanSub').textContent = `if every task runs to plan`;
  $('sP50').textContent = fmt(st.sum.p50);
  $('sP50Sub').textContent = `+${Math.round(st.sum.p50 - det)} days vs plan`;
  $('sP80').textContent = fmt(st.sum.p80);
  $('sP80Sub').textContent = `P95 ${fmt(st.sum.p95)}`;
  $('sTargetK').textContent = `By ${fmt(target)}`;
  $('sTarget').textContent = `${Math.round(st.sum.pTarget * 100)}%`;
  $('sTargetSub').textContent = st.sum.pTarget >= conf ? `meets ${Math.round(conf * 100)}% bar` : `below ${Math.round(conf * 100)}% bar`;
  // CDF
  const W = 300, H = 74, L = 6, R = 6, T = 6, B = 16;
  const s = st.sum.sorted, x0 = Math.min(det, s[0]) - 3, x1 = Math.max(s[s.length - 1], target) + 3;
  const X = (d) => L + (d - x0) / (x1 - x0) * (W - L - R), Y = (p) => T + (1 - p) * (H - T - B);
  let path = ''; const step = Math.max(1, Math.floor(s.length / 160));
  for (let i = 0; i < s.length; i += step) path += `${i ? 'L' : 'M'}${X(s[i]).toFixed(1)},${Y(i / (s.length - 1)).toFixed(1)}`;
  path += `L${X(s[s.length - 1]).toFixed(1)},${Y(1)}`;
  const area = path + `L${X(s[s.length - 1]).toFixed(1)},${Y(0)}L${X(s[0]).toFixed(1)},${Y(0)}Z`;
  const ticks = [det, st.sum.p50, st.sum.p80, target];
  let g = `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#ccd3db"/>`;
  g += `<path d="${area}" fill="#fcf0da"/><path d="${path}" fill="none" stroke="#f59e0b" stroke-width="2"/>`;
  g += `<line x1="${X(det)}" x2="${X(det)}" y1="${T}" y2="${Y(0)}" stroke="#505c6b" stroke-dasharray="2 2"/>`;
  g += `<line x1="${X(target)}" x2="${X(target)}" y1="${T}" y2="${Y(0)}" stroke="#8a5a00" stroke-width="1.2"/>`;
  g += `<circle cx="${X(target)}" cy="${Y(st.sum.pTarget)}" r="3.2" fill="#8a5a00"/>`;
  g += `<text x="${X(det)}" y="${H - 3}" text-anchor="middle">plan</text><text x="${X(target)}" y="${H - 3}" text-anchor="middle">${fmt(target)}</text>`;
  g += `<text x="${X(target) - 5}" y="${Y(st.sum.pTarget) + 3}" text-anchor="end" fill="#8a5a00">${Math.round(st.sum.pTarget * 100)}%</text>`;
  $('cdf').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
  // ask
  const pct = Math.round(conf * 100);
  $('askOut').innerHTML = st.ls.day === null
    ? `No start date reaches ${pct}% (best ${Math.round(st.ls.pAtToday * 100)}%) · plan float says ${fmt(st.dls)}`
    : `Start by <b>${fmt(st.ls.day)}</b> for ${pct}% · plan float says ${fmt(st.dls)}`;
  // drivers
  const T2 = A.sim.ctx.T;
  const score = T2.map((t, i) => ({ t, i, s: A.sim.criticality[i] * Math.max(0, A.sens[i]) })).filter((x) => x.t.status !== 'Done' && x.t.kind !== 'gate').sort((a, b) => b.s - a.s).slice(0, 3);
  $('drivers').innerHTML = `<span class="drv" style="cursor:default;border:0;background:none;padding-left:0;color:var(--text2)">Driving the date</span>` + score.map((x, k) => {
    let d;
    if (x.t.kind === 'fix') { const r = A.model.retest[x.t.testKind]; d = `${x.t.testKind} passes ${Math.round(r.yieldMean * 100)}% of attempts`; }
    else if (x.t.status === 'In progress') d = `in progress · ${x.t.discipline} +${discSlip(x.t.discipline)}%`;
    else d = `${x.t.discipline} +${discSlip(x.t.discipline)}%`;
    return `<span class="drv" data-id="${x.t.id}"><span class="n">${Math.round(A.sim.criticality[x.i] * 100)}% crit</span>${esc(x.t.name)}<span class="d">· ${esc(d)}</span></span>`;
  }).join('');
  $('drivers').querySelectorAll('.drv[data-id]').forEach((el) => el.onclick = () => { selected = el.dataset.id; renderGantt(); });
}

function renderGantt() {
  const el = $('gantt');
  const W = el.getBoundingClientRect().width || 1000;
  const TL = Math.round(Math.max(360, W * 0.42));
  const cols = `minmax(0,1fr) 138px 50px 96px ${showConf ? '76px ' : ''}${TL}px`;
  el.style.setProperty('--cols', cols);
  const d0 = 0, d1 = 302;
  const X = (d) => (Math.max(d0, Math.min(d1, d)) - d0) / (d1 - d0) * TL;
  const head = `<div class="g-head"><div class="h" style="padding-left:46px"></div><div class="h">Discipline</div><div class="h">Owner</div><div class="h">Status</div>${showConf ? '<div class="h">Crit.</div>' : ''}<div class="g-tl" id="tlHead"></div></div>`;
  const qMap = Object.fromEntries(A.taskQ.map((q) => [q.id, q]));
  const crit = Object.fromEntries(A.sim.ctx.T.map((t, i) => [t.id, A.sim.criticality[i]]));
  const det = A.det;
  const rows = DATA.tasks.map((t) => {
    if (t.kind === 'stage') return `<div class="g-row stage" data-id="${t.id}"><div class="cell c-name"><i data-lucide="${collapsed.has(t.id) ? 'chevron-right' : 'chevron-down'}"></i>${esc(t.name)}</div><div class="cell"><span class="dash">—</span></div><div class="cell">${stageOwner(t)}</div><div class="cell">${stageStatus(t)}</div>${showConf ? '<div class="cell"></div>' : ''}<div class="cell g-tl"></div></div>`;
    const ownerCell = t.owner ? `<span class="av" style="background:${AV[t.owner][1]}" data-tip="${AV[t.owner][0]}">${t.owner}</span>` : '<span class="av-empty"></span>';
    const disc = t.discipline ? `<span class="chip">${esc(t.discipline)}</span>` : '<span class="dash">—</span>';
    const status = t.status === 'Done' ? '<span class="st-done">Done</span>' : t.status === 'In progress' ? '<span class="st-prog">In progress</span>' : '<span class="st-not">Not started</span>';
    const c = crit[t.id];
    const critCell = !showConf ? '' : (t.status === 'Done' || t.kind === 'gate') ? '<div class="cell"><span class="dash">—</span></div>' : `<div class="cell"><span class="crit ${c >= 0.5 ? 'hot' : ''}"><span class="b"><i style="width:${Math.round(c * 100)}%"></i></span>${Math.round(c * 100)}%</span></div>`;
    return `<div class="g-row ${selected === t.id ? 'sel' : ''} ${collapsed.has(t.stage) ? 'hidden' : ''}" data-id="${t.id}"><div class="cell c-name" title="${esc(t.name)}">${esc(t.name)}</div><div class="cell">${disc}</div><div class="cell">${ownerCell}</div><div class="cell">${status}</div>${critCell}<div class="cell g-tl"></div></div>`;
  }).join('');
  el.innerHTML = head + rows + `<svg class="g-svg" id="gsvg" width="${TL}"></svg>`;
  // timeline svg
  const vis = DATA.tasks.filter((t) => !(t.stage && collapsed.has(t.stage)));
  const H = 50 + vis.length * 36;
  const svg = $('gsvg'); svg.setAttribute('height', H); svg.style.height = H + 'px';
  let g = '';
  // month grid (rows svg) + month/year labels (sticky header svg)
  let hg = '';
  for (let m = 0; m < 11; m++) {
    const dt = new Date(Date.UTC(2026, 7 + m, 1)); const d = Math.round((dt - START) / 864e5);
    if (d > d1) break;
    const x = X(d);
    g += `<line x1="${x}" x2="${x}" y1="50" y2="${H}" stroke="#05365912"/>`;
    hg += `<line x1="${x}" x2="${x}" y1="${m === 0 || dt.getUTCMonth() === 0 ? 0 : 25}" y2="50" stroke="#0536591a"/>`;
    hg += `<text x="${x + 5}" y="42" font-family="SF Mono, Monaco, Menlo, monospace" font-size="11.5" fill="#4e606f">${MON[dt.getUTCMonth()]}</text>`;
    if (m === 0 || dt.getUTCMonth() === 0) hg += `<text x="${x + 5}" y="17" font-family="SF Mono, Monaco, Menlo, monospace" font-size="12.5" font-weight="600" fill="#0a1317">${MON[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</text>`;
  }
  hg += `<line x1="0" x2="${TL}" y1="25" y2="25" stroke="#0536591a"/>`;
  const rowY = {}; vis.forEach((t, k) => { rowY[t.id] = 50 + k * 36 + 18; });
  // dependency elbows (plan)
  DATA.tasks.forEach((t) => {
    if (t.kind === 'stage') return;
    if (rowY[t.id] === undefined) return;
    t.deps.forEach((dId) => {
      if (rowY[dId] === undefined) return;
      const x0 = X(det.f[dId]), y0 = rowY[dId], x1 = X(det.s[t.id]), y1 = rowY[t.id];
      if (x1 - x0 > 40 || y1 <= y0) return;
      g += `<path d="M${x0 + 1},${y0} L${x0 + 6},${y0} L${x0 + 6},${y1} L${x1 - 2},${y1}" fill="none" stroke="#c4c7cc" stroke-width="1"/>`;
      g += `<path d="M${x1 - 6},${y1 - 3} L${x1 - 1},${y1} L${x1 - 6},${y1 + 3}Z" fill="#c4c7cc"/>`;
    });
  });
  // stage bars
  DATA.tasks.forEach((t) => {
    if (t.kind !== 'stage') return;
    if (rowY[t.id] === undefined) return;
    const kids = DATA.tasks.filter((k) => k.stage === t.id);
    const s = Math.min(...kids.map((k) => det.s[k.id])), f = Math.max(...kids.map((k) => (showConf && qMap[k.id] && k.status !== 'Done' ? qMap[k.id].p50 : det.f[k.id])));
    g += `<rect x="${X(s)}" y="${rowY[t.id] - 3}" width="${Math.max(2, X(f) - X(s))}" height="6" rx="3" fill="#aeb3b9"/>`;
  });
  DATA.tasks.forEach((t) => {
    if (t.kind === 'stage' || rowY[t.id] === undefined) return;
    const y = rowY[t.id], q = qMap[t.id];
    const future = t.status !== 'Done';
    if (showConf && future && q) {
      g += `<rect class="hit" x="${X(q.p10)}" y="${y - 10}" width="${Math.max(3, X(q.p90) - X(q.p10))}" height="20" rx="5" fill="#fcf0da" stroke="#ebce9a" data-tip="${esc(t.name)} · plan ${fmt(det.f[t.id])} · P10 ${fmt(q.p10)} · P50 ${fmt(q.p50)} · P90 ${fmt(q.p90)} · critical in ${Math.round(crit[t.id] * 100)}% of runs"/>`;
    }
    if (t.kind === 'gate') {
      const x = X(det.f[t.id]);
      g += `<path d="M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y}Z" fill="#505c6b"/>`;
      if (showConf && future && q) { const xm = X(q.p50); g += `<path d="M${xm},${y - 6} L${xm + 6},${y} L${xm},${y + 6} L${xm - 6},${y}Z" fill="#fff" stroke="#8a5a00" stroke-width="1.5"/>`; }
    } else {
      const x0 = X(det.s[t.id]), x1 = X(det.f[t.id]);
      g += `<rect x="${x0}" y="${y - 8}" width="${Math.max(3, x1 - x0)}" height="16" rx="4" fill="${t.status === 'Done' ? '#505c6b' : t.status === 'In progress' ? '#505c6b' : '#6b7684'}"/>`;
      if (showConf && future && q) g += `<line x1="${X(q.p50)}" x2="${X(q.p50)}" y1="${y - 10}" y2="${y + 10}" stroke="#8a5a00" stroke-width="2"/>`;
    }
  });
  // today + target
  const xt = X(DATA.program.today), xg = X(target);
  g += `<line x1="${xt}" x2="${xt}" y1="50" y2="${H}" stroke="#c4442a" stroke-width="1.2"/>`;
  g += `<line x1="${xg}" x2="${xg}" y1="50" y2="${H}" stroke="#8a5a00" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  hg += `<line x1="${xt}" x2="${xt}" y1="44" y2="50" stroke="#c4442a" stroke-width="1.2"/><rect x="${xt - 19}" y="5" width="38" height="15" rx="7.5" fill="#c4442a"/><text x="${xt}" y="15.8" text-anchor="middle" font-size="9.5" font-weight="600" fill="#fff" font-family="-apple-system, Segoe UI, sans-serif">Today</text>`;
  hg += `<line x1="${xg}" x2="${xg}" y1="44" y2="50" stroke="#8a5a00" stroke-width="1.2"/><rect x="${xg - 24}" y="5" width="48" height="15" rx="7.5" fill="#fcf0da" stroke="#ebce9a"/><text x="${xg}" y="15.8" text-anchor="middle" font-size="9.5" font-weight="600" fill="#8a5a00" font-family="-apple-system, Segoe UI, sans-serif">${fmt(target)}</text>`;
  svg.innerHTML = g;
  el.querySelector('#tlHead').innerHTML = `<svg width="${TL}" height="50" style="display:block">${hg}</svg>`;
  // position svg over timeline column
  const head1 = el.querySelector('#tlHead');
  svg.style.left = (head1.getBoundingClientRect().left - el.getBoundingClientRect().left) + 'px';
  el.querySelectorAll('.g-row').forEach((r) => r.onclick = () => {
    const id = r.dataset.id;
    if (r.classList.contains('stage')) { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); } else selected = id;
    renderGantt();
  });
  icons();
}
function stageOwner(t) { const kids = DATA.tasks.filter((k) => k.stage === t.id && k.owner); const o = kids.find((k) => k.status !== 'Done')?.owner ?? kids[0]?.owner; return o ? `<span class="av" style="background:${AV[o][1]}">${o}</span>` : ''; }
function stageStatus(t) {
  const kids = DATA.tasks.filter((k) => k.stage === t.id);
  if (kids.every((k) => k.status === 'Done')) return '<span class="st-done">Done</span>';
  if (kids.some((k) => k.status !== 'Not started')) return '<span class="st-prog">In progress</span>';
  return '<span class="st-not">Not started</span>';
}

function renderAll() {
  const st = stats();
  renderChat(st); renderCard(st); renderGantt(); icons();
}

document.addEventListener('mousemove', (e) => {
  const t = e.target.closest('[data-tip]'); const tip = $('tip');
  if (!t) { tip.style.display = 'none'; return; }
  tip.textContent = t.getAttribute('data-tip'); tip.style.display = 'block';
  tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
});

async function main() {
  DATA = await (await fetch('data/program.json')).json();
  target = dayOf(DATA.program.target);
  $('projName').textContent = DATA.program.name; $('threadName').textContent = DATA.program.chat;
  compute();
  BT = backtest(DATA.history, DATA.disciplines, { n: 1200 });
  const opts = DATA.tasks.filter((t) => t.status === 'Not started' && t.kind !== 'gate' && t.kind !== 'stage');
  $('inTask').innerHTML = opts.map((t) => `<option value="${t.id}" ${t.id === askTask ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  $('inTarget').value = iso(target);
  $('inTarget').onchange = (e) => { if (!e.target.value) return; target = dayOf(e.target.value); renderAll(); };
  $('inConf').onchange = (e) => { conf = +e.target.value; renderAll(); };
  $('inTask').onchange = (e) => { askTask = e.target.value; renderAll(); };
  $('confToggle').onclick = () => { showConf = !showConf; $('confToggle').classList.toggle('on', showConf); $('dc').classList.toggle('hide', !showConf); renderGantt(); };
  renderAll();
  window.addEventListener('resize', () => renderGantt());
}
main();
