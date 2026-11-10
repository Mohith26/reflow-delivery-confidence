// Writes data/program.json (the plan as Reflow stores it: tasks, deps, owners, statuses,
// actuals for completed work, plus six completed reference programs) and data/truth.json.
import { writeFileSync } from 'node:fs';
import { generate } from '../core/program.mjs';
const seed = Number(process.argv[2] ?? 20261110);
const { data, truth } = generate(seed);
writeFileSync(new URL('../data/program.json', import.meta.url), JSON.stringify(data));
writeFileSync(new URL('../data/truth.json', import.meta.url), JSON.stringify(truth, null, 1));
console.log(`seed ${seed}: ${data.tasks.length} plan rows, ${data.history.length} reference programs`);
