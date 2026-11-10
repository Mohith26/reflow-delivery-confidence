// Leave-one-program-out backtest across many seeds: how often past P50/P80 dates held.
import { generate, DISCIPLINES } from '../core/program.mjs';
import { backtest } from '../core/schedule.mjs';
const S = Number(process.argv[2] ?? 20);
let a = 0, b = 0, c = 0, n = 0;
for (let s = 0; s < S; s++) { const { data } = generate(100 + s); const bt = backtest(data.history, DISCIPLINES, { n: 1000 }); a += bt.held80; b += bt.held50; c += bt.detHeld; n += bt.n; }
console.log(JSON.stringify({ snapshots: n, p80_held: +(a / n).toFixed(3), p50_held: +(b / n).toFixed(3), plan_date_held: +(c / n).toFixed(3) }));
