# Production Reflow Scheduler

TypeScript implementation of a production schedule reflow algorithm for manufacturing work orders.

The scheduler recalculates work order timing while enforcing:
- parent dependencies
- one-order-at-a-time work center usage
- shift boundaries with pause/resume execution
- maintenance windows and fixed maintenance work orders

## Tech Stack

- TypeScript
- Luxon (UTC date/time handling)

## Project Structure

```text
src/
├── index.ts                        # Scenario runner
├── scenarios/
│   └── reflow-scenarios.ts         # Sample scenario inputs (3+ plus impossible-case demo)
├── reflow/
│   ├── reflow.service.ts           # Main reflow orchestration
│   ├── constraint-checker.ts       # Hard-constraint validation on output schedule
│   └── types.ts                    # Domain/input/output types
└── utils/
    └── date-utils.ts               # Shift + maintenance-aware date calculations
```

## Setup

```bash
npm install
```

## Run

Option 1 (local dev runner):

```bash
npm run dev
```

Option 2 (compile then run JS):

```bash
npx tsc -p tsconfig.json --rootDir src --outDir dist
node dist/index.js
```

## What the Runner Does

`src/index.ts` executes all scenarios and prints:
- scenario status (`SUCCESS` / expected failure)
- explanation summary
- per-order change list (`what moved`, `how much`, `why`)
- final updated schedule per work order

## Scenarios Included

1. Delay Cascade
- Parent order duration pushes dependent downstream orders.

2. Shift and Maintenance Constraint
- Work spans shifts and avoids maintenance windows.
- Fixed maintenance work order remains unchanged.

3. Work Center Conflict Resolution
- Competing orders on same center are shifted to non-overlapping windows.

4. Impossible Schedule (Expected Failure)
- Circular dependency scenario demonstrating explicit unschedulable error output.

## High-Level Algorithm Approach

1. Build dependency graph from `dependsOnWorkOrderIds`.
2. Compute dependency-safe order with topological sorting.
3. Seed fixed maintenance intervals into each work center occupancy timeline.
4. For each non-maintenance work order:
- compute earliest possible start (`max(originalStart, latestParentEnd)`).
- align start to next valid shift/non-maintenance moment.
- compute end by consuming `durationMinutes` across shifts and around maintenance.
- resolve work-center overlaps by iteratively pushing to next available slot.
5. Record changes (`before/after`, moved minutes, reason).
6. Validate result against hard constraints before returning.
7. If unschedulable, throw `ImpossibleScheduleError` with clear reason.

## Output Contract

`ReflowService.reflow(input)` returns:
- `updatedWorkOrders`
- `changes`
- `explanation`

If constraints cannot be satisfied:
- throws `ImpossibleScheduleError` with `No valid schedule: <reason>`.

## Notes

- All date handling is in UTC.
- Scheduler currently runs deterministic sample scenarios from static fixtures.
- Constraint checks are integrated into service execution to fail fast on invalid output.
