declare module "luxon" {
  export interface DateTimeFromISOOptions {
    zone?: string;
  }

  export interface DateTimeToISOOptions {
    suppressMilliseconds?: boolean;
  }

  export interface DateTimeDurationLike {
    days?: number;
    hours?: number;
    minutes?: number;
  }

  export class DateTime {
    static fromISO(value: string, options?: DateTimeFromISOOptions): DateTime;

    readonly isValid: boolean;
    readonly invalidExplanation: string | null;
    readonly weekday: number;

    toUTC(): DateTime;
    startOf(unit: "day" | string): DateTime;
    plus(duration: DateTimeDurationLike): DateTime;
    toMillis(): number;
    toISO(options?: DateTimeToISOOptions): string | null;
    valueOf(): number;
  }

  export class Interval {
    static fromDateTimes(start: DateTime, end: DateTime): Interval;
    length(unit: "minutes" | string): number;
  }
}
