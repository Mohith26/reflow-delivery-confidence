# Delivery confidence for Reflow plans (concept demo)

**Live demo:** https://mohith26.github.io/reflow-delivery-confidence/

Reflow (a Re:Build Launchpad company) turns a hardware program's specs and requirements into a working plan, and its planning agent answers questions like *"How late can certification start and still hit the spring delivery date?"*. Today that answer comes from the plan as drawn: planned durations and float.

This demo adds **Delivery confidence** to the Plan view. It learns how work actually runs from completed tasks (this program plus past programs), simulates the rest of the plan, and answers in probabilities:

- **P50 / P80 / P95 handover dates** and the chance of hitting a target date, next to the plan's own date.
- **The same question, answered with a confidence level:** "to keep an 80% chance of handover by Apr 15, certification must start by Feb 27; the plan float says Mar 14."
- **Per-task finish ranges** (P10 to P90 band, P50 tick) in the Gantt, and a **criticality index**: how often each task is on the path that sets the handover date.
- **What drives the date**: tasks ranked by criticality times sensitivity, explained in plain terms (e.g. "FAT passes 54% of attempts", "Controls +66%").
- **Calibration you can check**: on past programs, how often the P80 date actually held (and how often the plan date held).

> Unofficial concept demo by Mohith Gajjela. Not affiliated with Re:Build Manufacturing or Reflow. **All program data is synthetic** (seeded generator below). People and program names are fictional.

## Why

Hardware plans miss for structural reasons a deterministic Gantt can't show: discipline-specific slip (controls and software run long; the plan assumes they won't), test gates that fail and loop back through correction and retest (FAT, SAT, certification), and merge points where the latest of several paths wins. Reflow already has the inputs: dependencies, owners, disciplines, statuses, and the history of what each task really took. Its roadmap item about catching changes that break something downstream is about *consistency*; this is about *time*.

## How it works (`core/schedule.mjs`)

| Step | Method |
|---|---|
| Slip model | log(actual / planned) = mu + a_discipline + b_program + e. Random effects estimated by empirical Bayes (EM for the variance components), so a discipline with few completed tasks is shrunk toward the overall mean and this program's own track record shifts everything (b_program). |
| Test loops | Each test (FAT, SAT, certification) is retried until it passes: attempts are Bernoulli(theta) with a Beta posterior from past programs (passes vs failed cycles). One correction + retest cycle is lognormal relative to its planned length. |
| Monte Carlo | 4,000 runs over the dependency network. Per run, model parameters are resampled from their posteriors (parameter uncertainty, not just noise). Done tasks are fixed at their actuals; in-progress tasks are conditioned on elapsed time; fix tasks get a geometric number of cycles. |
| Outputs | Finish distribution of G9, P(finish <= target), per-task P10/P50/P90, criticality index (fraction of runs a task is on the driving path, traced back from G9), Spearman sensitivity of handover to each task's duration. |
| Latest start at confidence c | Bisection on a start-no-earlier-than constraint for the chosen task, re-running the network on the *same* sampled durations (common random numbers), so P(on time) is monotone in the start date. Compared with the deterministic latest start (total float). |
| Backtest | Leave-one-program-out: for each past program, snapshot it at 30% and 60% of its planned duration, fit on the other programs plus the work done so far, predict, compare with the actual finish. |

Every number in the page is computed in the browser from `data/program.json` by this module. Changing the target date, confidence level, or task re-runs the analysis.

## Data

`node scripts/generate.mjs` (seed 20261110) generates a 32-task battery-module assembly cell program in Reflow's plan structure (three stages, gates G0 to G9, nine disciplines, FAT/SAT/certification test-and-fix pairs), with the first 99 days completed, plus six completed reference programs with planned and actual durations and retest counts. Ground truth (discipline slip, pass rates) lives in `core/program.mjs` and is used only to simulate actuals and in tests.

## Tests

```
node --test test/schedule.test.mjs     # 9 tests
node scripts/calibration.mjs 20        # backtest across 20 fresh seeds
```

Tests cover: slip-model recovery of discipline contrasts and noise; Beta posterior bookkeeping; Monte Carlo vs the analytic lognormal CDF for a one-task plan; criticality splitting evenly between identical parallel paths; done/in-progress conditioning; deterministic float on a hand-computed network; latest-start monotonicity and that it is earlier than float; backtest calibration; learned FAT/Controls effects.

Calibration across 20 seeds (240 snapshots of past programs):

| Forecast | Held (actual finish on or before it) |
|---|---|
| P80 date | 78.3% |
| P50 date | 50.4% |
| Plan date (deterministic) | 7.1% |

On the demo program: plan says Feb 8, 2027; P50 Mar 20, P80 Apr 7, P95 Apr 30; 88% chance of Apr 15; certification latest start for 80% is Feb 27 vs Mar 14 by float.

## Limitations

- Synthetic programs. Real Reflow data has calendars, partial progress, resource conflicts, lags and start-to-start links; the engine here is finish-to-start, calendar days, no resource leveling.
- Six reference programs is a small reference class; the discipline effects are uncertain and the posterior says so (that uncertainty is in the simulation), but a new discipline or test type needs a prior.
- Durations within a program share only the program effect; correlated risks (a supplier that is late on everything) would widen the tails.
- Retest loops assume independent attempts with a constant pass rate; in practice the second attempt passes more often.
- Statuses and actuals have to be kept current for the conditioning to mean anything; Reflow's agent already does that from status reports.

## Novelty

Checked projectreflow.com (features, roadmap: "Keep the program aligned as it changes" is change-consistency, in development), the public app bundle at app.projectreflow.com (no Monte Carlo, probability, percentile or schedule-risk code; the bundled Gantt library includes deterministic critical-path highlighting), and Re:Build's newsroom. Monte Carlo schedule risk itself is well established in dedicated tools (Oracle Primavera Risk Analysis, Safran Risk, Full Monte, @RISK SRA, and newer web tools such as Onplana and Schedulytics), which ask planners for three-point estimates per activity. What is new here is doing it inside Reflow's plan, learned from the program's own completed work and past programs instead of hand-entered ranges, with test-and-retest loops modeled from pass rates, an agent-style answer to "how late can X start" at a stated confidence, and a backtest that shows how often the stated confidence held.

## Files

- `index.html`, `styles.css`, `app.js`: the page (Reflow's warm theme tokens from the app CSS: system font stack, SF Mono, #f0ede6 / #fbfaf8 / #f59e0b; Lucide icons)
- `core/schedule.mjs`: model, simulation, latest start, backtest
- `core/program.mjs`, `scripts/generate.mjs`: seeded data
- `test/schedule.test.mjs`, `scripts/calibration.mjs`: tests and calibration
