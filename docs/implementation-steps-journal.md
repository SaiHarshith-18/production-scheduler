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
