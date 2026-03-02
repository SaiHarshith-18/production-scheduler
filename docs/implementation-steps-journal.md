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
