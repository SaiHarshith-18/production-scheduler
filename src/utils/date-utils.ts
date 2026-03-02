import { DateTime, Interval } from "luxon";

import type {
  ISODateString,
  MaintenanceWindow,
  ShiftDefinition,
} from "../reflow/types.js";

const UTC_ZONE = "utc";
const SEARCH_DAY_LIMIT = 30;

interface NormalizedMaintenanceWindow {
  start: DateTime;
  end: DateTime;
  reason?: string;
}

interface ShiftWindow {
  start: DateTime;
  end: DateTime;
}

function toDocumentDayOfWeek(date: DateTime): number {
  // Luxon weekday: Mon=1..Sun=7. Test doc format: Sun=0..Sat=6.
  return date.weekday % 7;
}

function assertValidDate(date: DateTime, context: string): void {
  if (!date.isValid) {
    throw new Error(`${context}: ${date.invalidExplanation ?? "invalid date"}`);
  }
}

function normalizeMaintenanceWindows(
  maintenanceWindows: MaintenanceWindow[],
): NormalizedMaintenanceWindow[] {
  return maintenanceWindows
    .map((window) => {
      const normalizedWindow: NormalizedMaintenanceWindow = {
        start: parseUtcDate(window.startDate),
        end: parseUtcDate(window.endDate),
      };

      if (window.reason !== undefined) {
        normalizedWindow.reason = window.reason;
      }

      return normalizedWindow;
    })
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

function getShiftsForDay(
  date: DateTime,
  shifts: ShiftDefinition[],
): ShiftDefinition[] {
  const dayOfWeek = toDocumentDayOfWeek(date);

  return shifts
    .filter((shift) => shift.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startHour - b.startHour);
}

function getShiftWindowContaining(
  moment: DateTime,
  shifts: ShiftDefinition[],
): ShiftWindow | null {
  const dayShifts = getShiftsForDay(moment, shifts);

  for (const shift of dayShifts) {
    const shiftStart = moment.startOf("day").plus({ hours: shift.startHour });
    const shiftEnd = moment.startOf("day").plus({ hours: shift.endHour });

    if (moment >= shiftStart && moment < shiftEnd) {
      return { start: shiftStart, end: shiftEnd };
    }
  }

  return null;
}

function findNextShiftWindow(
  from: DateTime,
  shifts: ShiftDefinition[],
): ShiftWindow | null {
  for (let dayOffset = 0; dayOffset <= SEARCH_DAY_LIMIT; dayOffset += 1) {
    const day = from.startOf("day").plus({ days: dayOffset });
    const dayShifts = getShiftsForDay(day, shifts);

    for (const shift of dayShifts) {
      const shiftStart = day.plus({ hours: shift.startHour });
      const shiftEnd = day.plus({ hours: shift.endHour });

      if (shiftEnd <= from) {
        continue;
      }

      return { start: shiftStart, end: shiftEnd };
    }
  }

  return null;
}

function getMaintenanceWindowAt(
  moment: DateTime,
  maintenanceWindows: NormalizedMaintenanceWindow[],
): NormalizedMaintenanceWindow | null {
  for (const window of maintenanceWindows) {
    if (moment >= window.start && moment < window.end) {
      return window;
    }
  }

  return null;
}

function findFirstMaintenanceStartingWithin(
  rangeStart: DateTime,
  rangeEnd: DateTime,
  maintenanceWindows: NormalizedMaintenanceWindow[],
): NormalizedMaintenanceWindow | null {
  for (const window of maintenanceWindows) {
    if (window.start >= rangeEnd) {
      return null;
    }

    if (window.start >= rangeStart) {
      return window;
    }
  }

  return null;
}

export function parseUtcDate(value: ISODateString): DateTime {
  const parsed = DateTime.fromISO(value, { zone: UTC_ZONE });
  assertValidDate(parsed, `Invalid ISO date string "${value}"`);

  return parsed.toUTC();
}

export function formatUtcDate(value: DateTime): ISODateString {
  const utc = value.toUTC();
  assertValidDate(utc, "Cannot format invalid DateTime");

  const iso = utc.toISO({ suppressMilliseconds: true });
  if (!iso) {
    throw new Error("Unable to format DateTime as ISO string");
  }

  return iso;
}

export function isWithinShift(moment: DateTime, shifts: ShiftDefinition[]): boolean {
  validateShiftDefinitions(shifts);
  return getShiftWindowContaining(moment.toUTC(), shifts) !== null;
}

export function isDuringMaintenance(
  moment: DateTime,
  maintenanceWindows: MaintenanceWindow[],
): boolean {
  const normalized = normalizeMaintenanceWindows(maintenanceWindows);
  return getMaintenanceWindowAt(moment.toUTC(), normalized) !== null;
}

export function getNextWorkingMoment(
  from: DateTime,
  shifts: ShiftDefinition[],
  maintenanceWindows: MaintenanceWindow[],
): DateTime {
  validateShiftDefinitions(shifts);

  const normalizedMaintenanceWindows = normalizeMaintenanceWindows(maintenanceWindows);
  let cursor = from.toUTC();

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const activeMaintenance = getMaintenanceWindowAt(
      cursor,
      normalizedMaintenanceWindows,
    );
    if (activeMaintenance) {
      cursor = activeMaintenance.end;
      continue;
    }

    const containingShift = getShiftWindowContaining(cursor, shifts);
    if (containingShift) {
      return cursor;
    }

    const nextShift = findNextShiftWindow(cursor, shifts);
    if (!nextShift) {
      break;
    }

    cursor = nextShift.start;
  }

  throw new Error("Cannot find next working moment within search limit");
}

export function calculateEndDateWithShifts(
  startDate: ISODateString,
  durationMinutes: number,
  shifts: ShiftDefinition[],
  maintenanceWindows: MaintenanceWindow[] = [],
): ISODateString {
  if (durationMinutes < 0) {
    throw new Error("durationMinutes must be >= 0");
  }

  if (durationMinutes === 0) {
    return startDate;
  }

  validateShiftDefinitions(shifts);

  const normalizedMaintenanceWindows = normalizeMaintenanceWindows(maintenanceWindows);
  let remainingMinutes = durationMinutes;
  let cursor = getNextWorkingMoment(parseUtcDate(startDate), shifts, maintenanceWindows);

  for (let iteration = 0; iteration < 100_000 && remainingMinutes > 0; iteration += 1) {
    const shiftWindow =
      getShiftWindowContaining(cursor, shifts) ?? findNextShiftWindow(cursor, shifts);

    if (!shiftWindow) {
      throw new Error("Cannot schedule work: no future shift window available");
    }

    if (cursor < shiftWindow.start) {
      cursor = shiftWindow.start;
    }

    const activeMaintenance = getMaintenanceWindowAt(
      cursor,
      normalizedMaintenanceWindows,
    );
    if (activeMaintenance) {
      cursor = getNextWorkingMoment(activeMaintenance.end, shifts, maintenanceWindows);
      continue;
    }

    let availableUntil = shiftWindow.end;
    const maintenanceInShift = findFirstMaintenanceStartingWithin(
      cursor,
      shiftWindow.end,
      normalizedMaintenanceWindows,
    );
    if (maintenanceInShift) {
      availableUntil = maintenanceInShift.start;
    }

    const availableInterval = Interval.fromDateTimes(cursor, availableUntil);
    const availableMinutes = Math.floor(availableInterval.length("minutes"));

    if (availableMinutes <= 0) {
      cursor = getNextWorkingMoment(shiftWindow.end, shifts, maintenanceWindows);
      continue;
    }

    const consumedMinutes = Math.min(remainingMinutes, availableMinutes);
    cursor = cursor.plus({ minutes: consumedMinutes });
    remainingMinutes -= consumedMinutes;

    if (remainingMinutes > 0) {
      cursor = getNextWorkingMoment(cursor, shifts, maintenanceWindows);
    }
  }

  if (remainingMinutes > 0) {
    throw new Error("Cannot schedule work: exceeded scheduling iteration limit");
  }

  return formatUtcDate(cursor);
}

export function validateShiftDefinitions(shifts: ShiftDefinition[]): void {
  if (shifts.length === 0) {
    throw new Error("Cannot schedule work: no shifts are configured");
  }

  for (const [index, shift] of shifts.entries()) {

    if (!Number.isInteger(shift.dayOfWeek) || shift.dayOfWeek < 0 || shift.dayOfWeek > 6) {
      throw new Error(
        `Invalid shift at index ${index}: dayOfWeek must be an integer between 0 and 6`,
      );
    }

    if (!Number.isInteger(shift.startHour) || shift.startHour < 0 || shift.startHour > 23) {
      throw new Error(
        `Invalid shift at index ${index}: startHour must be an integer between 0 and 23`,
      );
    }

    if (!Number.isInteger(shift.endHour) || shift.endHour < 0 || shift.endHour > 23) {
      throw new Error(
        `Invalid shift at index ${index}: endHour must be an integer between 0 and 23`,
      );
    }

    if (shift.endHour <= shift.startHour) {
      throw new Error(
        `Invalid shift at index ${index}: endHour must be greater than startHour for same-day shifts`,
      );
    }
  }
}
