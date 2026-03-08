import { describe, expect, it } from "vitest";
import { ImpossibleScheduleError, ReflowService } from "../reflow/reflow.service.js";
import type {
  ReflowInput,
  WorkCenterDocument,
  WorkOrderDocument,
} from "../reflow/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MON_FRI_8_17 = [
  { dayOfWeek: 1, startHour: 8, endHour: 17 },
  { dayOfWeek: 2, startHour: 8, endHour: 17 },
  { dayOfWeek: 3, startHour: 8, endHour: 17 },
  { dayOfWeek: 4, startHour: 8, endHour: 17 },
  { dayOfWeek: 5, startHour: 8, endHour: 17 },
];

function wc(
  id: string,
  maintenanceWindows: WorkCenterDocument["data"]["maintenanceWindows"] = [],
): WorkCenterDocument {
  return {
    docId: id,
    docType: "workCenter",
    data: { name: id, shifts: MON_FRI_8_17, maintenanceWindows },
  };
}

function wo(params: {
  id: string;
  wcId: string;
  start: string;
  end: string;
  duration: number;
  isMaintenance?: boolean;
  dependsOn?: string[];
}): WorkOrderDocument {
  return {
    docId: params.id,
    docType: "workOrder",
    data: {
      workOrderNumber: params.id,
      manufacturingOrderId: `MO-${params.id}`,
      workCenterId: params.wcId,
      startDate: params.start,
      endDate: params.end,
      durationMinutes: params.duration,
      isMaintenance: params.isMaintenance ?? false,
      dependsOnWorkOrderIds: params.dependsOn ?? [],
    },
  };
}

const service = new ReflowService();

function reflow(input: ReflowInput) {
  return service.reflow(input);
}

// ---------------------------------------------------------------------------
// Scenario 1 – Delay Cascade
// WO-A: Mon 08:00, 600 min (10 h) → spans overnight → ends Tue 09:00
// WO-B: depends on WO-A, starts after WO-A completes (Tue 09:00), 120 min → ends Tue 11:00
// WO-C: depends on WO-B, 60 min → starts Tue 11:00, ends Tue 12:00
// ---------------------------------------------------------------------------
describe("Delay Cascade", () => {
  const input: ReflowInput = {
    workCenters: [wc("WC-1")],
    workOrders: [
      wo({ id: "WO-A", wcId: "WC-1", start: "2026-03-02T08:00:00Z", end: "2026-03-02T12:00:00Z", duration: 600 }),
      wo({ id: "WO-B", wcId: "WC-1", start: "2026-03-02T13:00:00Z", end: "2026-03-02T15:00:00Z", duration: 120, dependsOn: ["WO-A"] }),
      wo({ id: "WO-C", wcId: "WC-1", start: "2026-03-02T16:00:00Z", end: "2026-03-02T17:00:00Z", duration: 60, dependsOn: ["WO-B"] }),
    ],
  };

  it("returns SUCCESS status with 3 changes (WO-A end corrected, WO-B and WO-C cascade)", () => {
    const result = reflow(input);
    // WO-A's original endDate (12:00) was wrong for 600 min, so it also appears in changes.
    expect(result.changes).toHaveLength(3);
    expect(result.changes.map((c) => c.workOrderId)).toContain("WO-A");
    expect(result.changes.map((c) => c.workOrderId)).toContain("WO-B");
    expect(result.changes.map((c) => c.workOrderId)).toContain("WO-C");
  });

  it("WO-A is not rescheduled — its original dates are already correct for 600 min from Mon 08:00", () => {
    const result = reflow(input);
    const woA = result.updatedWorkOrders.find((o) => o.docId === "WO-A");
    // WO-A keeps its original start (Mon 08:00) and gets a recalculated end (Tue 09:00)
    expect(woA?.data.startDate).toBe("2026-03-02T08:00:00Z");
    expect(woA?.data.endDate).toBe("2026-03-03T09:00:00Z");
  });

  it("WO-B starts no earlier than WO-A end (Tue 09:00)", () => {
    const result = reflow(input);
    const woB = result.updatedWorkOrders.find((o) => o.docId === "WO-B");
    expect(woB?.data.startDate).toBe("2026-03-03T09:00:00Z");
    expect(woB?.data.endDate).toBe("2026-03-03T11:00:00Z");
  });

  it("WO-C starts no earlier than WO-B end (Tue 11:00)", () => {
    const result = reflow(input);
    const woC = result.updatedWorkOrders.find((o) => o.docId === "WO-C");
    expect(woC?.data.startDate).toBe("2026-03-03T11:00:00Z");
    expect(woC?.data.endDate).toBe("2026-03-03T12:00:00Z");
  });

  it("metrics: totalDelayMinutes > 0, affectedWorkOrderCount = 3", () => {
    const result = reflow(input);
    expect(result.metrics.totalDelayMinutes).toBeGreaterThan(0);
    expect(result.metrics.affectedWorkOrderCount).toBe(3);
  });

  it("metrics: utilization reported for WC-1", () => {
    const result = reflow(input);
    const u = result.metrics.utilizationByWorkCenter.find((x) => x.workCenterId === "WC-1");
    expect(u).toBeDefined();
    expect(u?.scheduledMinutes).toBe(780); // 600 + 120 + 60
    expect(u?.utilizationPercent).toBeGreaterThan(0);
    expect(u?.utilizationPercent).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 – Shift and Maintenance Constraint
// WC-2 has maintenance window Tue 10:00–12:00
// WO-M1: maintenance, fixed at Tue 10:00–12:00
// WO-D: starts Tue 09:00, 180 min → blocked by maintenance → pushed to start 12:00, end 15:00
// WO-E: starts Tue 11:00 (inside maintenance), 60 min → pushed after WO-D to 15:00–16:00
// ---------------------------------------------------------------------------
describe("Shift and Maintenance Constraint", () => {
  const maintenanceWindow = { startDate: "2026-03-03T10:00:00Z", endDate: "2026-03-03T12:00:00Z", reason: "Planned maintenance" };

  const input: ReflowInput = {
    workCenters: [wc("WC-2", [maintenanceWindow])],
    workOrders: [
      wo({ id: "WO-M1", wcId: "WC-2", start: "2026-03-03T10:00:00Z", end: "2026-03-03T12:00:00Z", duration: 120, isMaintenance: true }),
      wo({ id: "WO-D", wcId: "WC-2", start: "2026-03-03T09:00:00Z", end: "2026-03-03T10:30:00Z", duration: 180 }),
      wo({ id: "WO-E", wcId: "WC-2", start: "2026-03-03T11:00:00Z", end: "2026-03-03T12:00:00Z", duration: 60 }),
    ],
  };

  it("WO-M1 (maintenance) is never rescheduled", () => {
    const result = reflow(input);
    const m1 = result.updatedWorkOrders.find((o) => o.docId === "WO-M1");
    expect(m1?.data.startDate).toBe("2026-03-03T10:00:00Z");
    expect(m1?.data.endDate).toBe("2026-03-03T12:00:00Z");
    expect(result.changes.map((c) => c.workOrderId)).not.toContain("WO-M1");
  });

  it("WO-D is pushed out of the maintenance overlap, starts at 12:00 and ends at 15:00", () => {
    const result = reflow(input);
    const d = result.updatedWorkOrders.find((o) => o.docId === "WO-D");
    expect(d?.data.startDate).toBe("2026-03-03T12:00:00Z");
    expect(d?.data.endDate).toBe("2026-03-03T15:00:00Z");
  });

  it("WO-E starts after WO-D finishes (15:00) and ends at 16:00", () => {
    const result = reflow(input);
    const e = result.updatedWorkOrders.find((o) => o.docId === "WO-E");
    expect(e?.data.startDate).toBe("2026-03-03T15:00:00Z");
    expect(e?.data.endDate).toBe("2026-03-03T16:00:00Z");
  });

  it("no two non-maintenance orders overlap on WC-2", () => {
    const result = reflow(input);
    const sorted = result.updatedWorkOrders
      .filter((o) => !o.data.isMaintenance)
      .sort((a, b) => new Date(a.data.startDate).getTime() - new Date(b.data.startDate).getTime());

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr) {
        expect(new Date(prev.data.endDate).getTime()).toBeLessThanOrEqual(
          new Date(curr.data.startDate).getTime(),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 – Work Center Conflict Resolution
// WO-F and WO-G both start on the same center (WC-3) at overlapping times.
// WO-G is pushed after WO-F. WO-H (depends on WO-G) follows.
// ---------------------------------------------------------------------------
describe("Work Center Conflict Resolution", () => {
  const input: ReflowInput = {
    workCenters: [wc("WC-3")],
    workOrders: [
      wo({ id: "WO-F", wcId: "WC-3", start: "2026-03-04T08:00:00Z", end: "2026-03-04T12:00:00Z", duration: 240 }),
      wo({ id: "WO-G", wcId: "WC-3", start: "2026-03-04T09:00:00Z", end: "2026-03-04T11:00:00Z", duration: 120 }),
      wo({ id: "WO-H", wcId: "WC-3", start: "2026-03-04T11:00:00Z", end: "2026-03-04T12:00:00Z", duration: 60, dependsOn: ["WO-G"] }),
    ],
  };

  it("WO-F keeps its original start (already valid at 08:00, 240 min → ends 12:00)", () => {
    const result = reflow(input);
    const f = result.updatedWorkOrders.find((o) => o.docId === "WO-F");
    expect(f?.data.startDate).toBe("2026-03-04T08:00:00Z");
    expect(f?.data.endDate).toBe("2026-03-04T12:00:00Z");
  });

  it("WO-G is pushed after WO-F (12:00) and runs for 120 min → ends 14:00", () => {
    const result = reflow(input);
    const g = result.updatedWorkOrders.find((o) => o.docId === "WO-G");
    expect(g?.data.startDate).toBe("2026-03-04T12:00:00Z");
    expect(g?.data.endDate).toBe("2026-03-04T14:00:00Z");
  });

  it("WO-H starts after WO-G completes (14:00) and runs 60 min → ends 15:00", () => {
    const result = reflow(input);
    const h = result.updatedWorkOrders.find((o) => o.docId === "WO-H");
    expect(h?.data.startDate).toBe("2026-03-04T14:00:00Z");
    expect(h?.data.endDate).toBe("2026-03-04T15:00:00Z");
  });

  it("no work orders overlap on WC-3", () => {
    const result = reflow(input);
    const sorted = [...result.updatedWorkOrders].sort(
      (a, b) => new Date(a.data.startDate).getTime() - new Date(b.data.startDate).getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr) {
        expect(new Date(prev.data.endDate).getTime()).toBeLessThanOrEqual(
          new Date(curr.data.startDate).getTime(),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 – Impossible: Circular Dependency
// WO-X depends on WO-Y and WO-Y depends on WO-X → unschedulable.
// ---------------------------------------------------------------------------
describe("Impossible Schedule – Circular Dependency", () => {
  const input: ReflowInput = {
    workCenters: [wc("WC-4")],
    workOrders: [
      wo({ id: "WO-X", wcId: "WC-4", start: "2026-03-05T08:00:00Z", end: "2026-03-05T09:00:00Z", duration: 60, dependsOn: ["WO-Y"] }),
      wo({ id: "WO-Y", wcId: "WC-4", start: "2026-03-05T09:00:00Z", end: "2026-03-05T10:00:00Z", duration: 60, dependsOn: ["WO-X"] }),
    ],
  };

  it("throws ImpossibleScheduleError", () => {
    expect(() => reflow(input)).toThrowError(ImpossibleScheduleError);
  });

  it("error message mentions circular dependency", () => {
    expect(() => reflow(input)).toThrow(/circular/i);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 – Already Valid Schedule (no changes expected)
// Two orders on the same center with no overlap, correctly placed.
// ---------------------------------------------------------------------------
describe("Already Valid Schedule", () => {
  const input: ReflowInput = {
    workCenters: [wc("WC-5")],
    workOrders: [
      wo({ id: "WO-1", wcId: "WC-5", start: "2026-03-02T08:00:00Z", end: "2026-03-02T10:00:00Z", duration: 120 }),
      wo({ id: "WO-2", wcId: "WC-5", start: "2026-03-02T10:00:00Z", end: "2026-03-02T12:00:00Z", duration: 120 }),
    ],
  };

  it("returns zero changes when schedule is already valid", () => {
    const result = reflow(input);
    expect(result.changes).toHaveLength(0);
  });

  it("explanation indicates no changes were required", () => {
    const result = reflow(input);
    expect(result.explanation).toMatch(/no schedule changes/i);
  });

  it("metrics: totalDelayMinutes = 0, affectedWorkOrderCount = 0", () => {
    const result = reflow(input);
    expect(result.metrics.totalDelayMinutes).toBe(0);
    expect(result.metrics.affectedWorkOrderCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 – Multi-Parent Dependency
// WO-child depends on both WO-P1 and WO-P2.
// Child must start after the LATER of the two parents.
// WO-P1 ends at 10:00, WO-P2 ends at 12:00 → child starts at 12:00.
// ---------------------------------------------------------------------------
describe("Multi-Parent Dependency", () => {
  const input: ReflowInput = {
    workCenters: [wc("WC-6")],
    workOrders: [
      wo({ id: "WO-P1", wcId: "WC-6", start: "2026-03-02T08:00:00Z", end: "2026-03-02T10:00:00Z", duration: 120 }),
      wo({ id: "WO-P2", wcId: "WC-6", start: "2026-03-02T08:00:00Z", end: "2026-03-02T12:00:00Z", duration: 240 }),
      wo({ id: "WO-CHILD", wcId: "WC-6", start: "2026-03-02T08:00:00Z", end: "2026-03-02T09:00:00Z", duration: 60, dependsOn: ["WO-P1", "WO-P2"] }),
    ],
  };

  it("child starts after the latest parent end (12:00, from WO-P2)", () => {
    const result = reflow(input);
    const child = result.updatedWorkOrders.find((o) => o.docId === "WO-CHILD");
    // WO-P2 ends at 12:00 (after WO-P1 ends at 10:00), child must start at 12:00
    const childStart = new Date(child?.data.startDate ?? "").getTime();
    const p2End = new Date("2026-03-02T12:00:00Z").getTime();
    expect(childStart).toBeGreaterThanOrEqual(p2End);
  });

  it("child duration is preserved at 60 min", () => {
    const result = reflow(input);
    const child = result.updatedWorkOrders.find((o) => o.docId === "WO-CHILD");
    expect(child?.data.durationMinutes).toBe(60);
    const startMs = new Date(child?.data.startDate ?? "").getTime();
    const endMs = new Date(child?.data.endDate ?? "").getTime();
    // End should be 60 min after start (within shift, no maintenance)
    expect(endMs - startMs).toBe(60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 – Shift Boundary Crossing (overnight span)
// One order with 600 min starting at Mon 4PM — shift ends at 5PM (60 min).
// Remaining 540 min resume Tue 8AM → end Tue 5PM (540 min = 9 h within shift).
// ---------------------------------------------------------------------------
describe("Shift Boundary Crossing", () => {
  const input: ReflowInput = {
    workCenters: [wc("WC-7")],
    workOrders: [
      wo({ id: "WO-LONG", wcId: "WC-7", start: "2026-03-02T16:00:00Z", end: "2026-03-02T17:00:00Z", duration: 600 }),
    ],
  };

  it("order starts at Mon 16:00 and ends at Tue 17:00 after crossing shift boundary", () => {
    const result = reflow(input);
    const long = result.updatedWorkOrders.find((o) => o.docId === "WO-LONG");
    // Mon 16:00 → shift ends 17:00 (60 min) → resume Tue 08:00 → 540 min → Tue 17:00
    expect(long?.data.startDate).toBe("2026-03-02T16:00:00Z");
    expect(long?.data.endDate).toBe("2026-03-03T17:00:00Z");
  });

  it("duration (600 min) is preserved across shift boundary", () => {
    const result = reflow(input);
    const long = result.updatedWorkOrders.find((o) => o.docId === "WO-LONG");
    expect(long?.data.durationMinutes).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 – Missing Work Center throws ImpossibleScheduleError
// ---------------------------------------------------------------------------
describe("Missing Work Center", () => {
  const input: ReflowInput = {
    workCenters: [], // intentionally empty
    workOrders: [
      wo({ id: "WO-ORPHAN", wcId: "WC-MISSING", start: "2026-03-02T08:00:00Z", end: "2026-03-02T09:00:00Z", duration: 60 }),
    ],
  };

  it("throws ImpossibleScheduleError when work center does not exist", () => {
    expect(() => reflow(input)).toThrowError(ImpossibleScheduleError);
  });
});

// ---------------------------------------------------------------------------
// Scenario 9 – Maintenance immutability enforced even when dependency violated
// A maintenance order that starts before its declared parent should throw.
// ---------------------------------------------------------------------------
describe("Maintenance Immutability – Dependency Conflict", () => {
  const input: ReflowInput = {
    workCenters: [wc("WC-8")],
    workOrders: [
      wo({ id: "WO-PARENT", wcId: "WC-8", start: "2026-03-02T08:00:00Z", end: "2026-03-02T10:00:00Z", duration: 120 }),
      // Maintenance order that DEPENDS on WO-PARENT but is fixed BEFORE it finishes
      wo({ id: "WO-MAINT", wcId: "WC-8", start: "2026-03-02T08:30:00Z", end: "2026-03-02T09:30:00Z", duration: 60, isMaintenance: true, dependsOn: ["WO-PARENT"] }),
    ],
  };

  it("throws ImpossibleScheduleError because maintenance cannot move to satisfy dependency", () => {
    expect(() => reflow(input)).toThrowError(ImpossibleScheduleError);
  });
});
