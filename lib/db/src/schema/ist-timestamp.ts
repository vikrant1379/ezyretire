import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

const IST_OFFSET = "+05:30";

function formatIstTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}.${String(value.getUTCMilliseconds()).padStart(3, "0")}`;
}

export const istTimestamp = customType<{
  data: Date;
  driverData: string;
}>({
  dataType() {
    return "timestamp without time zone";
  },
  fromDriver(value) {
    const normalized = value.replace(" ", "T");
    const hasOffset = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(normalized);
    return new Date(hasOffset ? normalized : `${normalized}${IST_OFFSET}`);
  },
  toDriver(value) {
    return formatIstTimestamp(value);
  },
});

export const defaultIstNow = sql`timezone('Asia/Kolkata', now())`;