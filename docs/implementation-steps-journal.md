# Implementation Steps Journal

This file is the single source of record for implementation progress.  
After each executed step, add one new section using the same format:

- `What`: exactly what was created/changed
- `How`: how it was implemented (files, structure, approach)
- `Why`: why this step was needed and what problem it solves

---

## Step 1 - Project Structure Setup (Executed)
In Step 1, we created the foundational folder and file structure to enforce clear separation of concerns before writing logic. We grouped scheduling logic under src/reflow, shared time utilities under src/utils, runnable entry flow in src/index.ts, and scenario fixtures under src/scenarios so implementation and demonstrations stay organized. We also added README.md to keep setup/run/approach documentation in one standard place and created this step note in docs to track what was done with reasoning. This structure was chosen to match the technical test’s suggested layout and evaluation focus on readability and maintainable organization.


### What
Created the baseline folders and starter files for the project:
- `src/reflow/reflow.service.ts`
- `src/reflow/constraint-checker.ts`
- `src/reflow/types.ts`
- `src/utils/date-utils.ts`
- `src/index.ts`
- `src/scenarios/`
- `README.md`
- `docs/`

### How
Set up the structure first, before adding logic, to separate core scheduling logic, utility logic, execution entrypoint, and scenario data into dedicated locations.

### Why
This keeps the project maintainable from the beginning and aligns with clean separation of concerns expected in the test (readable code, clear ownership of files, easier step-by-step implementation).

---

## Step 2 - Type Contracts and Data Models (Executed)

### What
Implemented the complete contract layer in:
- `src/reflow/types.ts`

Added:
- Base document envelope type (`BaseDocument`)
- Core schema types:
  - `WorkOrderData` / `WorkOrderDocument`
  - `WorkCenterData` / `WorkCenterDocument`
  - `ShiftDefinition`
  - `MaintenanceWindow`
  - `ManufacturingOrderData` / `ManufacturingOrderDocument`
- Reflow contracts:
  - `ReflowInput`
  - `WorkOrderScheduleChange`
  - `ReflowResult`
- Shared alias: `ISODateString`

### How
Mapped every required field from the technical test into strict TypeScript interfaces/types, then validated compilation with `npx tsc --noEmit`.

### Why
Locking contracts early prevents schema drift and reduces downstream bugs.  
All next steps (date utilities, reflow algorithm, constraint checks, scenarios) now build against one consistent and type-safe model.

### Use Case
If input data misses required fields (for example, `dependsOnWorkOrderIds`), TypeScript flags it immediately during development instead of failing at runtime during scheduling.

---

## Step 3 - UTC Date Utilities and Shift-Aware Scheduling Helpers (Executed)

### What
Implemented date utility functions in:
- `src/utils/date-utils.ts`
- `src/luxon.d.ts`

Added:
- UTC helpers:
  - `parseUtcDate`
  - `formatUtcDate`
- Shift/maintenance checks:
  - `isWithinShift`
  - `isDuringMaintenance`
- Availability helper:
  - `getNextWorkingMoment`
- Core shift-aware end-date calculator:
  - `calculateEndDateWithShifts(startDate, durationMinutes, shifts, maintenanceWindows?)`
- Module compatibility update:
  - `package.json` set to `"type": "module"` for ESM-friendly exports/imports

### How
Used Luxon to normalize all calculations to UTC, built helpers to find current/next valid shift windows by `dayOfWeek` and hour ranges, and layered maintenance-window blocking on top of shift logic.  
The end-date function now consumes only working minutes, pauses outside shifts, skips maintenance intervals, and resumes at the next valid working moment.
Added a local Luxon type declaration file so TypeScript can type-check utility code in this environment.

### Why
Shift and maintenance handling is the most error-prone part of the scheduler, so this was isolated into dedicated utilities before implementing the main reflow algorithm.  
This keeps the service logic simpler and ensures time calculations are consistent and reusable across scheduling and validation.

### Use Case
For a 120-minute job starting Monday 4:00 PM with a Monday-Friday 8:00 AM-5:00 PM shift, the utility can consume 60 minutes on Monday, pause overnight, resume Tuesday 8:00 AM, and complete at 9:00 AM (while also skipping any maintenance window that intersects that execution window).

---

## Step 4 - Baseline Reflow Service Pipeline (Executed)

### What
Implemented baseline reflow orchestration in:
- `src/reflow/reflow.service.ts`

Added:
- `ReflowService` class with `reflow(input: ReflowInput): ReflowResult`
- Work center lookup map for scheduling by `workCenterId`
- Scheduling path for non-maintenance work orders using Step 3 utilities
- Explicit skip behavior for maintenance work orders (unchanged)
- Change-tracking records (`changes`) with moved minutes and reason text
- Baseline explanation output summarizing what was adjusted

### How
The service iterates all work orders in input order.  
For each non-maintenance work order, it:
1. Resolves the referenced work center
2. Aligns start time to the next valid working moment
3. Recalculates end time using shift/maintenance-aware duration logic
4. Compares old vs new schedule and records a change entry if needed

Maintenance work orders are passed through unchanged.

### Why
This establishes a runnable end-to-end baseline pipeline that uses the time engine from Step 3 and produces required output contracts (`updatedWorkOrders`, `changes`, `explanation`).  
It keeps dependency resolution and work-center conflict resolution for upcoming steps while still delivering a valid service structure.

### Use Case
If a work order starts outside shift hours, Step 4 now automatically shifts it to the next valid shift time and recalculates completion time around maintenance windows, then records what changed and why.

---

## Step 5 - Dependency-Aware Scheduling (Executed)

### What
Extended `src/reflow/reflow.service.ts` to enforce dependency constraints:
- Added dependency graph ordering (topological scheduling order)
- Added validation for missing parent references
- Added circular dependency detection with explicit error
- Added parent-completion gating (child starts only after latest parent end)
- Added maintenance-order dependency guard (fixed maintenance cannot violate dependency timing)
- Updated change reason and explanation text to reflect dependency-aware behavior

### How
Built a topological sort over `dependsOnWorkOrderIds` so parents are always scheduled before children.  
For each work order, resolved the latest parent end time from already scheduled parent results and used `max(originalStart, latestParentEnd)` as scheduling start input before shift/maintenance alignment.  
If a maintenance work order has unmet dependency timing, the service now throws a clear error because maintenance cannot be moved.

### Why
Dependencies are a hard requirement, and Step 4 did not yet enforce parent completion.  
This step makes scheduling order and start-time gating dependency-safe while keeping work-center conflict handling for the next step.

### Use Case
If `B` depends on `A`, and `A` ends later than `B` originally planned start, Step 5 now pushes `B` to start after `A` completes, then still aligns `B` to valid shift/maintenance working windows.

---

## Step 6 - Work Center Conflict Resolution (Executed)

### What
Extended `src/reflow/reflow.service.ts` with work-center non-overlap enforcement:
- Added center occupancy interval model
- Added fixed maintenance interval seeding on work centers
- Added overlap detection between candidate schedule and existing center intervals
- Added iterative push-forward conflict resolution for non-maintenance work orders
- Added center-interval insertion after successful scheduling to block future overlaps
- Updated change reason and explanation strings to include work-center conflict handling

### How
Before scheduling loop execution, fixed maintenance work orders are registered as occupied intervals per work center.  
When scheduling each non-maintenance work order, the service now:
1. Computes dependency-gated earliest start
2. Calculates candidate start/end using shift + maintenance-aware utilities
3. Checks overlap with existing center intervals
4. If overlap exists, pushes candidate start to overlap end and retries
5. Once no overlap exists, commits scheduled interval to center occupancy list

### Why
A hard constraint requires one active order per work center (no overlaps).  
This step enforces that constraint directly in scheduling behavior while preserving previously implemented dependency and shift/maintenance logic.

### Use Case
If two work orders are planned to run at overlapping times on the same work center, Step 6 now shifts the later-scheduled order forward until its execution window no longer intersects any existing center interval.

---

## Step 7 - Shift Logic Hardening and Validation (Executed)

### What
Extended `src/utils/date-utils.ts` with strict shift-definition validation:
- Added `validateShiftDefinitions(shifts)` utility
- Integrated validation into:
  - `isWithinShift`
  - `getNextWorkingMoment`
  - `calculateEndDateWithShifts`
- Tightened shift filtering to rely on validated shift data

### How
Validation now checks each shift for:
1. `dayOfWeek` integer in range `0..6`
2. `startHour` integer in range `0..23`
3. `endHour` integer in range `0..23`
4. `endHour > startHour` (same-day shift model)

If invalid, scheduling throws clear errors before attempting pause/resume calculations.

### Why
Step 3 introduced shift pause/resume logic, but malformed shift config could still produce ambiguous behavior.  
This step makes shift handling deterministic and fail-fast, which improves reliability and debuggability of the scheduler.

### Use Case
If a work center is configured with `dayOfWeek: 8` or `endHour <= startHour`, Step 7 now fails immediately with a descriptive error instead of producing confusing scheduling results.

---

## Template For Next Steps

Copy this block for every new completed step:

```md
## Step N - <Title> (Executed)

### What
- ...

### How
- ...

### Why
- ...

### Use Case
- ...
```
