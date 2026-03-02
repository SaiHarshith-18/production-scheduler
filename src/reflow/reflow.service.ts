import {
  calculateEndDateWithShifts,
  formatUtcDate,
  getNextWorkingMoment,
  parseUtcDate,
} from "../utils/date-utils.js";
import type {
  ISODateString,
  ReflowInput,
  ReflowResult,
  WorkCenterDocument,
  WorkOrderDocument,
  WorkOrderScheduleChange,
} from "./types.js";

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

export class ReflowService {
  reflow(input: ReflowInput): ReflowResult {
    const workCenterById = getWorkCenterById(input.workCenters);
    const workOrderById = getWorkOrderById(input.workOrders);
    const scheduleOrder = buildDependencyOrder(input.workOrders);
    const updatedById = new Map<string, WorkOrderDocument>();
    const scheduledEndById = new Map<string, ISODateString>();
    const changes: WorkOrderScheduleChange[] = [];

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
      const updatedWorkOrder = scheduleWorkOrder(
        workOrder,
        workCenter,
        schedulingStartDate,
      );
      updatedById.set(updatedWorkOrder.docId, updatedWorkOrder);
      scheduledEndById.set(updatedWorkOrder.docId, updatedWorkOrder.data.endDate);

      if (isScheduleChanged(workOrder, updatedWorkOrder)) {
        changes.push(
          buildChangeRecord(
            workOrder,
            updatedWorkOrder,
            "Adjusted to satisfy parent dependency completion and align with shift/maintenance windows.",
          ),
        );
      }
    }

    const outputInOriginalOrder = input.workOrders
      .map((workOrder) => updatedById.get(workOrder.docId))
      .filter((workOrder): workOrder is WorkOrderDocument => Boolean(workOrder));

    const explanation =
      changes.length === 0
        ? "No schedule changes were required. Work orders already satisfy dependency order and shift/maintenance constraints."
        : `Dependency-aware baseline reflow updated ${changes.length} work order(s) by enforcing parent completion and shift/maintenance alignment. Work center conflict resolution is added in the next step.`;

    return {
      updatedWorkOrders: outputInOriginalOrder,
      changes,
      explanation,
    };
  }
}
