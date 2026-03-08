export type ISODateString = string;

export interface BaseDocument<TDocType extends string, TData> {
  docId: string;
  docType: TDocType;
  data: TData;
}

export interface WorkOrderData {
  workOrderNumber: string;
  manufacturingOrderId: string;
  workCenterId: string;
  startDate: ISODateString;
  endDate: ISODateString;
  durationMinutes: number;
  isMaintenance: boolean;
  dependsOnWorkOrderIds: string[];
}

export type WorkOrderDocument = BaseDocument<"workOrder", WorkOrderData>;

export interface ShiftDefinition {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
}

export interface MaintenanceWindow {
  startDate: ISODateString;
  endDate: ISODateString;
  reason?: string;
}

export interface WorkCenterData {
  name: string;
  shifts: ShiftDefinition[];
  maintenanceWindows: MaintenanceWindow[];
}

export type WorkCenterDocument = BaseDocument<"workCenter", WorkCenterData>;

export interface ManufacturingOrderData {
  manufacturingOrderNumber: string;
  itemId: string;
  quantity: number;
  dueDate: ISODateString;
}

export type ManufacturingOrderDocument = BaseDocument<
  "manufacturingOrder",
  ManufacturingOrderData
>;

export type ProductionDocument =
  | WorkOrderDocument
  | WorkCenterDocument
  | ManufacturingOrderDocument;

export interface ReflowInput {
  workOrders: WorkOrderDocument[];
  workCenters: WorkCenterDocument[];
  manufacturingOrders?: ManufacturingOrderDocument[];
}

export interface WorkOrderScheduleChange {
  workOrderId: string;
  workOrderNumber: string;
  previousStartDate: ISODateString;
  previousEndDate: ISODateString;
  newStartDate: ISODateString;
  newEndDate: ISODateString;
  movedByMinutes: number;
  reason: string;
}

export interface WorkCenterUtilization {
  workCenterId: string;
  /** Sum of durationMinutes for all non-maintenance work orders on this center. */
  scheduledMinutes: number;
  /** Total shift minutes available in the scheduling window for this center. */
  availableMinutes: number;
  /** scheduledMinutes / availableMinutes * 100, rounded to nearest integer. */
  utilizationPercent: number;
}

export interface ReflowMetrics {
  /** Sum of positive movedByMinutes across all changes (total delay introduced). */
  totalDelayMinutes: number;
  /** Number of work orders whose schedule changed. */
  affectedWorkOrderCount: number;
  /** Per-work-center utilization stats. */
  utilizationByWorkCenter: WorkCenterUtilization[];
}

export interface ReflowResult {
  updatedWorkOrders: WorkOrderDocument[];
  changes: WorkOrderScheduleChange[];
  explanation: string;
  metrics: ReflowMetrics;
}
