import * as XLSX from "xlsx";

export type ExcelCellValue = string | number | boolean | Date | null | undefined;

export type ExcelColumn<Row> = {
  header: string;
  value: keyof Row | ((row: Row) => ExcelCellValue);
  width?: number;
};

export type ExcelSheet<Row = unknown> = {
  name: string;
  rows: readonly Row[];
  columns: readonly ExcelColumn<Row>[];
};

export const sanitizeSheetName = (name: string) => {
  const sanitized = name.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (sanitized || "Sheet").slice(0, 31);
};

export const sanitizeFilename = (name: string) => {
  const withoutExtension = name.replace(/(?:\.xlsx)+$/i, "");
  const sanitized = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "");
  return `${sanitized || "report"}.xlsx`;
};

export const localDateStamp = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const datedExcelFilename = (reportSlug: string, date = new Date()) =>
  sanitizeFilename(`${reportSlug}_${localDateStamp(date)}`);

/** Converts date-only values to local-midnight Excel dates without UTC shifts. */
export const toLocalDateCell = (
  value: string | Date | null | undefined,
): Date | "" => {
  if (!value) return "";
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return "";
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
      ? date
      : "";
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
    : "";
};

const cellValue = (value: ExcelCellValue): string | number | boolean | Date =>
  value === null || value === undefined ? "" : value;

export const buildExcelWorkbook = (sheets: readonly ExcelSheet[]) => {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  sheets.filter((sheet) => sheet.rows.length > 0).forEach((sheet) => {
    let name = sanitizeSheetName(sheet.name);
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      const marker = ` (${suffix++})`;
      name = `${sanitizeSheetName(sheet.name).slice(0, 31 - marker.length)}${marker}`;
    }
    usedNames.add(name.toLowerCase());

    const data = [
      sheet.columns.map((column) => column.header),
      ...sheet.rows.map((row) =>
        sheet.columns.map((column) =>
          cellValue(
            typeof column.value === "function"
              ? column.value(row)
              : (row as Record<PropertyKey, ExcelCellValue>)[column.value as PropertyKey],
          ),
        ),
      ),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(data, { cellDates: true });
    worksheet["!cols"] = sheet.columns.map((column, index) => {
      const contentWidth = data.reduce(
        (maximum, row) => Math.max(maximum, String(row[index] ?? "").length),
        column.header.length,
      );
      return { wch: column.width ?? Math.min(40, Math.max(10, contentWidth + 2)) };
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  });

  if (workbook.SheetNames.length === 0) {
    throw new Error("There are no rows to export.");
  }
  return workbook;
};

export const downloadExcelWorkbook = (
  sheets: readonly ExcelSheet[],
  reportSlug: string,
  date = new Date(),
) => {
  const workbook = buildExcelWorkbook(sheets);
  const filename = datedExcelFilename(reportSlug, date);
  XLSX.writeFile(workbook, filename, { bookType: "xlsx", cellDates: true });
  return filename;
};