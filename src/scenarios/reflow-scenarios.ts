import type {
  ManufacturingOrderDocument,
  ReflowInput,
  WorkCenterDocument,
  WorkOrderDocument,
} from "../reflow/types.js";

export interface ScenarioDefinition {
  id: string;
  title: string;
  description: string;
  input: ReflowInput;
  expectFailure?: boolean;
}

const MON_FRI_DAY_SHIFT = [
  { dayOfWeek: 1, startHour: 8, endHour: 17 },
  { dayOfWeek: 2, startHour: 8, endHour: 17 },
  { dayOfWeek: 3, startHour: 8, endHour: 17 },
  { dayOfWeek: 4, startHour: 8, endHour: 17 },
  { dayOfWeek: 5, startHour: 8, endHour: 17 },
];

function workCenter(
  id: string,
  name: string,
  maintenanceWindows: WorkCenterDocument["data"]["maintenanceWindows"] = [],
): WorkCenterDocument {
  return {
    docId: id,
    docType: "workCenter",
    data: {
      name,
      shifts: MON_FRI_DAY_SHIFT,
      maintenanceWindows,
    },
  };
}

function manufacturingOrder(
  id: string,
  manufacturingOrderNumber: string,
  dueDate: string,
): ManufacturingOrderDocument {
  return {
    docId: id,
    docType: "manufacturingOrder",
    data: {
      manufacturingOrderNumber,
      itemId: `ITEM-${manufacturingOrderNumber}`,
      quantity: 1000,
      dueDate,
    },
  };
}

function workOrder(params: {
  id: string;
  number: string;
  manufacturingOrderId: string;
  workCenterId: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  isMaintenance?: boolean;
  dependsOn?: string[];
}): WorkOrderDocument {
  return {
    docId: params.id,
    docType: "workOrder",
    data: {
      workOrderNumber: params.number,
      manufacturingOrderId: params.manufacturingOrderId,
      workCenterId: params.workCenterId,
      startDate: params.startDate,
      endDate: params.endDate,
      durationMinutes: params.durationMinutes,
      isMaintenance: params.isMaintenance ?? false,
      dependsOnWorkOrderIds: params.dependsOn ?? [],
    },
  };
}

const scenarioDelayCascade: ScenarioDefinition = {
  id: "delay-cascade",
  title: "Delay Cascade",
  description:
    "Parent order has long duration and pushes downstream dependent orders.",
  input: {
    workCenters: [workCenter("WC-1", "Extrusion Line 1")],
    manufacturingOrders: [
      manufacturingOrder("MO-1", "MO-1001", "2026-03-05T17:00:00Z"),
      manufacturingOrder("MO-2", "MO-1002", "2026-03-06T17:00:00Z"),
      manufacturingOrder("MO-3", "MO-1003", "2026-03-06T17:00:00Z"),
    ],
    workOrders: [
      workOrder({
        id: "WO-A",
        number: "WO-A",
        manufacturingOrderId: "MO-1",
        workCenterId: "WC-1",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T12:00:00Z",
        durationMinutes: 600,
      }),
      workOrder({
        id: "WO-B",
        number: "WO-B",
        manufacturingOrderId: "MO-2",
        workCenterId: "WC-1",
        startDate: "2026-03-02T13:00:00Z",
        endDate: "2026-03-02T15:00:00Z",
        durationMinutes: 120,
        dependsOn: ["WO-A"],
      }),
      workOrder({
        id: "WO-C",
        number: "WO-C",
        manufacturingOrderId: "MO-3",
        workCenterId: "WC-1",
        startDate: "2026-03-02T16:00:00Z",
        endDate: "2026-03-02T17:00:00Z",
        durationMinutes: 60,
        dependsOn: ["WO-B"],
      }),
    ],
  },
};

const scenarioShiftMaintenance: ScenarioDefinition = {
  id: "shift-maintenance",
  title: "Shift and Maintenance Constraint",
  description:
    "Work orders navigate fixed maintenance windows and shift boundaries while maintenance order remains fixed.",
  input: {
    workCenters: [
      workCenter("WC-2", "Extrusion Line 2", [
        {
          startDate: "2026-03-03T10:00:00Z",
          endDate: "2026-03-03T12:00:00Z",
          reason: "Planned bearing replacement",
        },
      ]),
    ],
    manufacturingOrders: [
      manufacturingOrder("MO-4", "MO-2001", "2026-03-07T17:00:00Z"),
      manufacturingOrder("MO-5", "MO-2002", "2026-03-07T17:00:00Z"),
      manufacturingOrder("MO-6", "MO-2003", "2026-03-07T17:00:00Z"),
    ],
    workOrders: [
      workOrder({
        id: "WO-M1",
        number: "WO-M1",
        manufacturingOrderId: "MO-4",
        workCenterId: "WC-2",
        startDate: "2026-03-03T10:00:00Z",
        endDate: "2026-03-03T12:00:00Z",
        durationMinutes: 120,
        isMaintenance: true,
      }),
      workOrder({
        id: "WO-D",
        number: "WO-D",
        manufacturingOrderId: "MO-5",
        workCenterId: "WC-2",
        startDate: "2026-03-03T09:00:00Z",
        endDate: "2026-03-03T10:30:00Z",
        durationMinutes: 180,
      }),
      workOrder({
        id: "WO-E",
        number: "WO-E",
        manufacturingOrderId: "MO-6",
        workCenterId: "WC-2",
        startDate: "2026-03-03T11:00:00Z",
        endDate: "2026-03-03T12:00:00Z",
        durationMinutes: 60,
      }),
    ],
  },
};

const scenarioCenterConflict: ScenarioDefinition = {
  id: "center-conflict",
  title: "Work Center Conflict Resolution",
  description:
    "Competing work orders on the same center are pushed to conflict-free slots with dependency gating.",
  input: {
    workCenters: [workCenter("WC-3", "Extrusion Line 3")],
    manufacturingOrders: [
      manufacturingOrder("MO-7", "MO-3001", "2026-03-10T17:00:00Z"),
      manufacturingOrder("MO-8", "MO-3002", "2026-03-10T17:00:00Z"),
      manufacturingOrder("MO-9", "MO-3003", "2026-03-10T17:00:00Z"),
    ],
    workOrders: [
      workOrder({
        id: "WO-F",
        number: "WO-F",
        manufacturingOrderId: "MO-7",
        workCenterId: "WC-3",
        startDate: "2026-03-04T08:00:00Z",
        endDate: "2026-03-04T12:00:00Z",
        durationMinutes: 240,
      }),
      workOrder({
        id: "WO-G",
        number: "WO-G",
        manufacturingOrderId: "MO-8",
        workCenterId: "WC-3",
        startDate: "2026-03-04T09:00:00Z",
        endDate: "2026-03-04T11:00:00Z",
        durationMinutes: 120,
      }),
      workOrder({
        id: "WO-H",
        number: "WO-H",
        manufacturingOrderId: "MO-9",
        workCenterId: "WC-3",
        startDate: "2026-03-04T11:00:00Z",
        endDate: "2026-03-04T12:00:00Z",
        durationMinutes: 60,
        dependsOn: ["WO-G"],
      }),
    ],
  },
};

const scenarioImpossibleCycle: ScenarioDefinition = {
  id: "impossible-cycle",
  title: "Impossible Schedule - Circular Dependency",
  description:
    "Demonstrates unschedulable graph handling through explicit circular dependency failure.",
  expectFailure: true,
  input: {
    workCenters: [workCenter("WC-4", "Extrusion Line 4")],
    manufacturingOrders: [
      manufacturingOrder("MO-10", "MO-4001", "2026-03-08T17:00:00Z"),
      manufacturingOrder("MO-11", "MO-4002", "2026-03-08T17:00:00Z"),
    ],
    workOrders: [
      workOrder({
        id: "WO-X",
        number: "WO-X",
        manufacturingOrderId: "MO-10",
        workCenterId: "WC-4",
        startDate: "2026-03-05T08:00:00Z",
        endDate: "2026-03-05T09:00:00Z",
        durationMinutes: 60,
        dependsOn: ["WO-Y"],
      }),
      workOrder({
        id: "WO-Y",
        number: "WO-Y",
        manufacturingOrderId: "MO-11",
        workCenterId: "WC-4",
        startDate: "2026-03-05T09:00:00Z",
        endDate: "2026-03-05T10:00:00Z",
        durationMinutes: 60,
        dependsOn: ["WO-X"],
      }),
    ],
  },
};

export const scenarios: ScenarioDefinition[] = [
  scenarioDelayCascade,
  scenarioShiftMaintenance,
  scenarioCenterConflict,
  scenarioImpossibleCycle,
];
