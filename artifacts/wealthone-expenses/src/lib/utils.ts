import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCompactINR(amount: number) {
  const absoluteAmount = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (absoluteAmount >= 10_000_000) {
    return `${sign}₹${trimCompactDecimals(absoluteAmount / 10_000_000)}\u00A0Cr`;
  }
  if (absoluteAmount >= 100_000) {
    return `${sign}₹${trimCompactDecimals(absoluteAmount / 100_000)}\u00A0L`;
  }
  return formatINR(amount);
}

function trimCompactDecimals(value: number) {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}
