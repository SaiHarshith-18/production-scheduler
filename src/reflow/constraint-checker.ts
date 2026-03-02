import { calculateEndDateWithShifts, parseUtcDate, validateShiftDefinitions } from "../utils/date-utils.js";
import type {
  ReflowInput,
  ReflowResult,
  WorkCenterDocument,
  WorkOrderDocument,
} from "./types.js";

function getWorkCenterMap(workCenters: WorkCenterDocument[]): Map<string, WorkCenterDocument> {
  return new Map(workCenters.map((workCenter) => [workCenter.docId, workCenter]));
}

function getWorkOrderMap(workOrders: WorkOrderDocument[]): Map<string, WorkOrderDocument> {
  return new Map(workOrders.map((workOrder) => [workOrder.docId, workOrder]));
}

function toMillis(value: string): number {
  return parseUtcDate(value).toMillis();
}

export class ConstraintChecker {
  validateReflowResult(input: ReflowInput, result: ReflowResult): void {
    const workCenterById = getWorkCenterMap(input.workCenters);
    const originalById = getWorkOrderMap(input.workOrders);
    const updatedById = getWorkOrderMap(result.updatedWorkOrders);

    if (result.updatedWorkOrders.length !== input.workOrders.length) {
      throw new Error(
        `Invalid schedule: expected ${input.workOrders.length} work orders in output but received ${result.updatedWorkOrders.length}`,
      );
    }

    for (const workCenter of input.workCenters) {
      validateShiftDefinitions(workCenter.data.shifts);
    }

    for (const originalOrder of input.workOrders) {
      const updatedOrder = updatedById.get(originalOrder.docId);
      if (!updatedOrder) {
        throw new Error(`Invalid schedule: missing updated work order ${originalOrder.docId}`);
      }

      if (originalOrder.data.isMaintenance) {
        if (
          originalOrder.data.startDate !== updatedOrder.data.startDate ||
          originalOrder.data.endDate !== updatedOrder.data.endDate
        ) {
          throw new Error(
            `Invalid schedule: maintenance work order ${originalOrder.docId} was rescheduled`,
          );
        }
      }
    }

    for (const updatedOrder of result.updatedWorkOrders) {
      const workCenter = workCenterById.get(updatedOrder.data.workCenterId);
      if (!workCenter) {
        throw new Error(
          `Invalid schedule: work order ${updatedOrder.docId} references unknown work center ${updatedOrder.data.workCenterId}`,
        );
      }

      if (toMillis(updatedOrder.data.endDate) <= toMillis(updatedOrder.data.startDate)) {
        throw new Error(
          `Invalid schedule: work order ${updatedOrder.docId} has endDate before or equal to startDate`,
        );
      }

      if (!updatedOrder.data.isMaintenance) {
        const expectedEndDate = calculateEndDateWithShifts(
          updatedOrder.data.startDate,
          updatedOrder.data.durationMinutes,
          workCenter.data.shifts,
          workCenter.data.maintenanceWindows,
        );
        if (expectedEndDate !== updatedOrder.data.endDate) {
          throw new Error(
            `Invalid schedule: work order ${updatedOrder.docId} violates shift/maintenance execution constraints`,
          );
        }
      }

      for (const parentId of updatedOrder.data.dependsOnWorkOrderIds) {
        const parent = updatedById.get(parentId);
        if (!parent) {
          throw new Error(
            `Invalid schedule: work order ${updatedOrder.docId} references missing parent ${parentId}`,
          );
        }

        if (toMillis(parent.data.endDate) > toMillis(updatedOrder.data.startDate)) {
          throw new Error(
            `Invalid schedule: work order ${updatedOrder.docId} starts before parent ${parentId} completes`,
          );
        }
      }
    }

    const ordersByWorkCenter = new Map<string, WorkOrderDocument[]>();
    for (const updatedOrder of result.updatedWorkOrders) {
      const grouped = ordersByWorkCenter.get(updatedOrder.data.workCenterId);
      if (grouped) {
        grouped.push(updatedOrder);
      } else {
        ordersByWorkCenter.set(updatedOrder.data.workCenterId, [updatedOrder]);
      }
    }

    for (const [workCenterId, orders] of ordersByWorkCenter.entries()) {
      orders.sort((left, right) => toMillis(left.data.startDate) - toMillis(right.data.startDate));

      for (let index = 1; index < orders.length; index += 1) {
        const previous = orders[index - 1];
        const current = orders[index];

        if (!previous || !current) {
          continue;
        }

        if (toMillis(previous.data.endDate) > toMillis(current.data.startDate)) {
          throw new Error(
            `Invalid schedule: work center ${workCenterId} has overlapping work orders ${previous.docId} and ${current.docId}`,
          );
        }
      }
    }

    for (const change of result.changes) {
      if (!originalById.has(change.workOrderId)) {
        throw new Error(
          `Invalid changes output: referenced work order ${change.workOrderId} does not exist`,
        );
      }
    }
  }
}

export function validateReflowResult(input: ReflowInput, result: ReflowResult): void {
  const checker = new ConstraintChecker();
  checker.validateReflowResult(input, result);
}
