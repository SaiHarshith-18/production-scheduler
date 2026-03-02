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

export interface ReflowResult {
  updatedWorkOrders: WorkOrderDocument[];
  changes: WorkOrderScheduleChange[];
  explanation: string;
}
