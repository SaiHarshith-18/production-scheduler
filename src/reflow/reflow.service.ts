import {
  calculateEndDateWithShifts,
  formatUtcDate,
  getNextWorkingMoment,
  parseUtcDate,
} from "../utils/date-utils.js";
import type {
  ReflowInput,
  ReflowResult,
  WorkCenterDocument,
  WorkOrderDocument,
  WorkOrderScheduleChange,
} from "./types.js";

function getWorkCenterById(workCenters: WorkCenterDocument[]): Map<string, WorkCenterDocument> {
  return new Map(workCenters.map((workCenter) => [workCenter.docId, workCenter]));
}

function calculateMovedMinutes(previousIso: string, nextIso: string): number {
  const previous = parseUtcDate(previousIso);
  const next = parseUtcDate(nextIso);

  return Math.round((next.toMillis() - previous.toMillis()) / 60000);
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
): WorkOrderDocument {
  const alignedStart = getNextWorkingMoment(
    parseUtcDate(workOrder.data.startDate),
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
    const updatedWorkOrders: WorkOrderDocument[] = [];
    const changes: WorkOrderScheduleChange[] = [];

    for (const workOrder of input.workOrders) {
      if (workOrder.data.isMaintenance) {
        updatedWorkOrders.push(workOrder);
        continue;
      }

      const workCenter = workCenterById.get(workOrder.data.workCenterId);
      if (!workCenter) {
        throw new Error(
          `Cannot schedule work order ${workOrder.docId}: missing work center ${workOrder.data.workCenterId}`,
        );
      }

      const updatedWorkOrder = scheduleWorkOrder(workOrder, workCenter);
      updatedWorkOrders.push(updatedWorkOrder);

      if (isScheduleChanged(workOrder, updatedWorkOrder)) {
        changes.push(
          buildChangeRecord(
            workOrder,
            updatedWorkOrder,
            "Adjusted to the next valid working window based on shifts and maintenance windows.",
          ),
        );
      }
    }

    const explanation =
      changes.length === 0
        ? "No schedule changes were required. All non-maintenance work orders already fit shift and maintenance constraints."
        : `Baseline reflow applied shift and maintenance alignment to ${changes.length} work order(s). Dependencies and work center conflict resolution are not applied in this step yet.`;

    return {
      updatedWorkOrders,
      changes,
      explanation,
    };
  }
}
