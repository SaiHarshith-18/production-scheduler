import {
  calculateAvailableShiftMinutes,
  calculateEndDateWithShifts,
  formatUtcDate,
  getNextWorkingMoment,
  parseUtcDate,
} from "../utils/date-utils.js";
import { validateReflowResult } from "./constraint-checker.js";
import type {
  ISODateString,
  ReflowInput,
  ReflowMetrics,
  ReflowResult,
  WorkCenterDocument,
  WorkOrderDocument,
  WorkOrderScheduleChange,
} from "./types.js";

interface CenterScheduleInterval {
  workOrderId: string;
  startDate: ISODateString;
  endDate: ISODateString;
  isFixed: boolean;
}

export class ImpossibleScheduleError extends Error {
  constructor(reason: string) {
    super(`No valid schedule: ${reason}`);
    this.name = "ImpossibleScheduleError";
  }
}

function getWorkCenterById(workCenters: WorkCenterDocument[]): Map<string, WorkCenterDocument> {
  return new Map(workCenters.map((workCenter) => [workCenter.docId, workCenter]));
}

function getWorkOrderById(workOrders: WorkOrderDocument[]): Map<string, WorkOrderDocument> {
  return new Map(workOrders.map((workOrder) => [workOrder.docId, workOrder]));
}

function calculateMovedMinutes(previousIso: string, nextIso: string): number {
  const previous = parseUtcDate(previousIso);
  const next = parseUtcDate(nextIso);

  return Math.round((next.toMillis() - previous.toMillis()) / 60000);
}

function maxIsoDate(a: ISODateString, b: ISODateString): ISODateString {
  return parseUtcDate(a).toMillis() >= parseUtcDate(b).toMillis() ? a : b;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isOverlapping(
  startDate: ISODateString,
  endDate: ISODateString,
  interval: CenterScheduleInterval,
): boolean {
  const startMillis = parseUtcDate(startDate).toMillis();
  const endMillis = parseUtcDate(endDate).toMillis();
  const intervalStartMillis = parseUtcDate(interval.startDate).toMillis();
  const intervalEndMillis = parseUtcDate(interval.endDate).toMillis();

  return startMillis < intervalEndMillis && endMillis > intervalStartMillis;
}

function getCenterIntervals(
  centerScheduleById: Map<string, CenterScheduleInterval[]>,
  workCenterId: string,
): CenterScheduleInterval[] {
  const existing = centerScheduleById.get(workCenterId);
  if (existing) {
    return existing;
  }

  const created: CenterScheduleInterval[] = [];
  centerScheduleById.set(workCenterId, created);
  return created;
}

function insertCenterInterval(
  centerScheduleById: Map<string, CenterScheduleInterval[]>,
  workCenterId: string,
  interval: CenterScheduleInterval,
): void {
  const intervals = getCenterIntervals(centerScheduleById, workCenterId);
  intervals.push(interval);
  intervals.sort(
    (left, right) =>
      parseUtcDate(left.startDate).toMillis() - parseUtcDate(right.startDate).toMillis(),
  );
}

function findOverlappingInterval(
  centerIntervals: CenterScheduleInterval[],
  startDate: ISODateString,
  endDate: ISODateString,
): CenterScheduleInterval | null {
  for (const interval of centerIntervals) {
    if (isOverlapping(startDate, endDate, interval)) {
      return interval;
    }
  }

  return null;
}

function resolveDependencyReadyDate(
  workOrder: WorkOrderDocument,
  scheduledEndById: Map<string, ISODateString>,
): ISODateString | null {
  let latestDependencyEnd: ISODateString | null = null;

  for (const parentId of workOrder.data.dependsOnWorkOrderIds) {
    const parentEndDate = scheduledEndById.get(parentId);
    if (!parentEndDate) {
      throw new Error(
        `Cannot schedule work order ${workOrder.docId}: parent dependency ${parentId} has not been scheduled`,
      );
    }

    latestDependencyEnd =
      latestDependencyEnd === null
        ? parentEndDate
        : maxIsoDate(latestDependencyEnd, parentEndDate);
  }

  return latestDependencyEnd;
}

function buildDependencyOrder(workOrders: WorkOrderDocument[]): string[] {
  const workOrderById = getWorkOrderById(workOrders);
  const inputOrderIndex = new Map(workOrders.map((workOrder, index) => [workOrder.docId, index]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const workOrder of workOrders) {
    inDegree.set(workOrder.docId, 0);
    adjacency.set(workOrder.docId, []);
  }

  for (const workOrder of workOrders) {
    for (const parentId of workOrder.data.dependsOnWorkOrderIds) {
      if (!workOrderById.has(parentId)) {
        throw new Error(
          `Cannot schedule work order ${workOrder.docId}: parent dependency ${parentId} does not exist in input`,
        );
      }

      adjacency.get(parentId)?.push(workOrder.docId);
      inDegree.set(workOrder.docId, (inDegree.get(workOrder.docId) ?? 0) + 1);
    }
  }

  const readyQueue = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort((left, right) => (inputOrderIndex.get(left) ?? 0) - (inputOrderIndex.get(right) ?? 0));

  const ordered: string[] = [];

  // Kahn's algorithm: emits parent-before-child order or detects cycles.
  while (readyQueue.length > 0) {
    const currentId = readyQueue.shift();
    if (!currentId) {
      break;
    }

    ordered.push(currentId);

    const children = adjacency.get(currentId) ?? [];
    for (const childId of children) {
      const nextDegree = (inDegree.get(childId) ?? 0) - 1;
      inDegree.set(childId, nextDegree);

      if (nextDegree === 0) {
        readyQueue.push(childId);
        readyQueue.sort(
          (left, right) => (inputOrderIndex.get(left) ?? 0) - (inputOrderIndex.get(right) ?? 0),
        );
      }
    }
  }

  if (ordered.length !== workOrders.length) {
    throw new Error(
      "Cannot schedule work orders: circular dependency detected in dependsOnWorkOrderIds",
    );
  }

  return ordered;
}

function seedFixedMaintenanceIntervals(
  workOrders: WorkOrderDocument[],
  workCenterById: Map<string, WorkCenterDocument>,
  centerScheduleById: Map<string, CenterScheduleInterval[]>,
): void {
  const fixedMaintenanceOrders = workOrders
    .filter((workOrder) => workOrder.data.isMaintenance)
    .sort(
      (left, right) =>
        parseUtcDate(left.data.startDate).toMillis() -
        parseUtcDate(right.data.startDate).toMillis(),
    );

  for (const workOrder of fixedMaintenanceOrders) {
    const workCenter = workCenterById.get(workOrder.data.workCenterId);
    if (!workCenter) {
      throw new Error(
        `Cannot schedule maintenance work order ${workOrder.docId}: missing work center ${workOrder.data.workCenterId}`,
      );
    }

    if (parseUtcDate(workOrder.data.endDate).toMillis() <= parseUtcDate(workOrder.data.startDate).toMillis()) {
      throw new Error(
        `Cannot schedule maintenance work order ${workOrder.docId}: endDate must be after startDate`,
      );
    }

    const centerIntervals = getCenterIntervals(centerScheduleById, workCenter.docId);
    // Fixed maintenance intervals reserve center capacity before movable work is planned.
    const overlappingInterval = findOverlappingInterval(
      centerIntervals,
      workOrder.data.startDate,
      workOrder.data.endDate,
    );
    if (overlappingInterval) {
      throw new Error(
        `Cannot schedule maintenance work order ${workOrder.docId}: fixed interval overlaps with work order ${overlappingInterval.workOrderId} on work center ${workCenter.docId}`,
      );
    }

    insertCenterInterval(centerScheduleById, workCenter.docId, {
      workOrderId: workOrder.docId,
      startDate: workOrder.data.startDate,
      endDate: workOrder.data.endDate,
      isFixed: true,
    });
  }
}

function buildChangeRecord(
  previous: WorkOrderDocument,
  next: WorkOrderDocument,
  reason: string,
): WorkOrderScheduleChange {
  return {
    workOrderId: previous.docId,
    workOrderNumber: previous.data.workOrderNumber,
    previousStartDate: previous.data.startDate,
    previousEndDate: previous.data.endDate,
    newStartDate: next.data.startDate,
    newEndDate: next.data.endDate,
    movedByMinutes: calculateMovedMinutes(previous.data.startDate, next.data.startDate),
    reason,
  };
}

function isScheduleChanged(previous: WorkOrderDocument, next: WorkOrderDocument): boolean {
  return (
    previous.data.startDate !== next.data.startDate ||
    previous.data.endDate !== next.data.endDate
  );
}

function scheduleWorkOrder(
  workOrder: WorkOrderDocument,
  workCenter: WorkCenterDocument,
  earliestStartDate: ISODateString,
): WorkOrderDocument {
  const alignedStart = getNextWorkingMoment(
    parseUtcDate(earliestStartDate),
    workCenter.data.shifts,
    workCenter.data.maintenanceWindows,
  );
  const alignedStartDate = formatUtcDate(alignedStart);
  const recalculatedEndDate = calculateEndDateWithShifts(
    alignedStartDate,
    workOrder.data.durationMinutes,
    workCenter.data.shifts,
    workCenter.data.maintenanceWindows,
  );

  return {
    ...workOrder,
    data: {
      ...workOrder.data,
      startDate: alignedStartDate,
      endDate: recalculatedEndDate,
    },
  };
}

function scheduleWorkOrderWithCenterConflicts(
  workOrder: WorkOrderDocument,
  workCenter: WorkCenterDocument,
  earliestStartDate: ISODateString,
  centerIntervals: CenterScheduleInterval[],
): WorkOrderDocument {
  let candidateStartDate = earliestStartDate;

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const scheduledWorkOrder = scheduleWorkOrder(workOrder, workCenter, candidateStartDate);
    const overlappingInterval = findOverlappingInterval(
      centerIntervals,
      scheduledWorkOrder.data.startDate,
      scheduledWorkOrder.data.endDate,
    );

    if (!overlappingInterval) {
      return scheduledWorkOrder;
    }

    // Push start to the blocking interval end and re-run shift/maintenance-aware scheduling.
    candidateStartDate = maxIsoDate(candidateStartDate, overlappingInterval.endDate);
  }

  throw new Error(
    `Cannot schedule work order ${workOrder.docId}: exceeded center conflict resolution iteration limit`,
  );
}

function computeMetrics(
  changes: WorkOrderScheduleChange[],
  updatedWorkOrders: WorkOrderDocument[],
  workCenterById: Map<string, WorkCenterDocument>,
): ReflowMetrics {
  const totalDelayMinutes = changes.reduce(
    (sum, change) => sum + Math.max(0, change.movedByMinutes),
    0,
  );

  // Group non-maintenance orders by work center to compute per-center utilization.
  const ordersByCenter = new Map<string, WorkOrderDocument[]>();
  for (const order of updatedWorkOrders) {
    if (order.data.isMaintenance) {
      continue;
    }
    const existing = ordersByCenter.get(order.data.workCenterId);
    if (existing) {
      existing.push(order);
    } else {
      ordersByCenter.set(order.data.workCenterId, [order]);
    }
  }

  const utilizationByWorkCenter = [...ordersByCenter.entries()].map(([workCenterId, orders]) => {
    const workCenter = workCenterById.get(workCenterId);
    const scheduledMinutes = orders.reduce((sum, o) => sum + o.data.durationMinutes, 0);

    if (!workCenter || orders.length === 0) {
      return { workCenterId, scheduledMinutes, availableMinutes: 0, utilizationPercent: 0 };
    }

    // Scheduling window = earliest start to latest end across this center's orders.
    const windowStart = orders.reduce(
      (min, o) => (parseUtcDate(o.data.startDate) < parseUtcDate(min) ? o.data.startDate : min),
      orders[0]?.data.startDate ?? "",
    );
    const windowEnd = orders.reduce(
      (max, o) => (parseUtcDate(o.data.endDate) > parseUtcDate(max) ? o.data.endDate : max),
      orders[0]?.data.endDate ?? "",
    );

    const availableMinutes = calculateAvailableShiftMinutes(
      windowStart,
      windowEnd,
      workCenter.data.shifts,
    );
    const utilizationPercent =
      availableMinutes > 0 ? Math.round((scheduledMinutes / availableMinutes) * 100) : 0;

    return { workCenterId, scheduledMinutes, availableMinutes, utilizationPercent };
  });

  return {
    totalDelayMinutes,
    affectedWorkOrderCount: changes.length,
    utilizationByWorkCenter,
  };
}

export class ReflowService {
  reflow(input: ReflowInput): ReflowResult {
    try {
      const workCenterById = getWorkCenterById(input.workCenters);
      const workOrderById = getWorkOrderById(input.workOrders);
      const scheduleOrder = buildDependencyOrder(input.workOrders);
      const centerScheduleById = new Map<string, CenterScheduleInterval[]>();
      const updatedById = new Map<string, WorkOrderDocument>();
      const scheduledEndById = new Map<string, ISODateString>();
      const changes: WorkOrderScheduleChange[] = [];

      seedFixedMaintenanceIntervals(input.workOrders, workCenterById, centerScheduleById);

      for (const workOrderId of scheduleOrder) {
        const workOrder = workOrderById.get(workOrderId);
        if (!workOrder) {
          throw new Error(`Cannot schedule work order ${workOrderId}: missing from input list`);
        }

        const dependencyReadyDate = resolveDependencyReadyDate(workOrder, scheduledEndById);

        if (workOrder.data.isMaintenance) {
          if (
            dependencyReadyDate !== null &&
            parseUtcDate(workOrder.data.startDate).toMillis() <
              parseUtcDate(dependencyReadyDate).toMillis()
          ) {
            throw new Error(
              `Cannot satisfy dependencies for maintenance work order ${workOrder.docId}: it is fixed in time and starts before parent completion`,
            );
          }

          updatedById.set(workOrder.docId, workOrder);
          scheduledEndById.set(workOrder.docId, workOrder.data.endDate);
          continue;
        }

        const workCenter = workCenterById.get(workOrder.data.workCenterId);
        if (!workCenter) {
          throw new Error(
            `Cannot schedule work order ${workOrder.docId}: missing work center ${workOrder.data.workCenterId}`,
          );
        }

        const schedulingStartDate =
          dependencyReadyDate === null
            ? workOrder.data.startDate
            : maxIsoDate(workOrder.data.startDate, dependencyReadyDate);
        const centerIntervals = getCenterIntervals(centerScheduleById, workCenter.docId);
        const updatedWorkOrder = scheduleWorkOrderWithCenterConflicts(
          workOrder,
          workCenter,
          schedulingStartDate,
          centerIntervals,
        );
        updatedById.set(updatedWorkOrder.docId, updatedWorkOrder);
        scheduledEndById.set(updatedWorkOrder.docId, updatedWorkOrder.data.endDate);
        insertCenterInterval(centerScheduleById, workCenter.docId, {
          workOrderId: updatedWorkOrder.docId,
          startDate: updatedWorkOrder.data.startDate,
          endDate: updatedWorkOrder.data.endDate,
          isFixed: false,
        });

        if (isScheduleChanged(workOrder, updatedWorkOrder)) {
          changes.push(
            buildChangeRecord(
              workOrder,
              updatedWorkOrder,
              "Adjusted to satisfy dependencies, avoid work-center overlap, and align with shift/maintenance windows.",
            ),
          );
        }
      }

      const outputInOriginalOrder = input.workOrders
        .map((workOrder) => updatedById.get(workOrder.docId))
        .filter((workOrder): workOrder is WorkOrderDocument => Boolean(workOrder));

      const explanation =
        changes.length === 0
          ? "No schedule changes were required. Work orders already satisfy dependencies, work-center conflict, and shift/maintenance constraints."
          : `Reflow updated ${changes.length} work order(s) by enforcing dependency completion, work-center non-overlap, and shift/maintenance alignment.`;

      const result: ReflowResult = {
        updatedWorkOrders: outputInOriginalOrder,
        changes,
        explanation,
        metrics: computeMetrics(changes, outputInOriginalOrder, workCenterById),
      };

      // Defensive post-check to ensure returned schedule still satisfies all hard constraints.
      validateReflowResult(input, result);

      return result;
    } catch (error) {
      if (error instanceof ImpossibleScheduleError) {
        throw error;
      }

      throw new ImpossibleScheduleError(toErrorMessage(error));
    }
  }
}
