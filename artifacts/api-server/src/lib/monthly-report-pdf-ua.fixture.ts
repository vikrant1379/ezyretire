import { writeFile } from "node:fs/promises";
import { buildMonthlyReportDelivery } from "./monthly-report-email.js";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Expected an output PDF path");

const boundaryText = [
  "Review the monthly plan before confirming changes.",
  "अगले महीने खर्चों की समीक्षा करें और लक्ष्य की प्रगति जाँचें।",
].join(" ");
const sections = Array.from({ length: 14 }, (_, sectionIndex) => ({
  title: sectionIndex === 7 ? "निवेश और चिकित्सा योजना" : `Planning section ${sectionIndex + 1}`,
  metrics: Object.fromEntries(Array.from(
    { length: 6 },
    (_, metricIndex) => [`balance${metricIndex + 1}`, 1234567.89 + sectionIndex * 100 + metricIndex],
  )),
  metricFormats: Object.fromEntries(Array.from(
    { length: 6 },
    (_, metricIndex) => [`balance${metricIndex + 1}`, "currency"],
  )),
  actions: [
    sectionIndex === 0
      ? Array.from({ length: 90 }, () => boundaryText).join(" ")
      : `${boundaryText} ${"ACCOUNTREFERENCE".repeat(18)}`,
    `Confirm allocation ${sectionIndex + 1} before the next review.`,
  ],
}));

const pdf = buildMonthlyReportDelivery({
  id: "pdf-ua-release-fixture",
  month: "2025-03",
  generatedAt: "2025-04-01T00:00:00.000Z",
  retirementForecast: {
    projectedRetirementMonth: null,
    asOfDate: "2025-03-31",
  },
  sections,
}).pdf;

await writeFile(outputPath, pdf);