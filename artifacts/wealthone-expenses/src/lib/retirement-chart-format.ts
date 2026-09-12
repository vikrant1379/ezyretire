export const formatChartAmount = (value: number) => {
  const amount = Math.abs(value);
  if (amount >= 10000000) {
    const label = `₹${(value / 10000000).toFixed(1)}Cr`;
    // Preserve ordinary desktop labels within the existing 60px gutter.
    // Count the minus sign too, so negative labels receive the same protection.
    if (label.length <= 8) return label;
    if (amount >= 1e15) {
      // Superscript exponents keep even three-digit exponents within the gutter.
      const scientific = value.toExponential(0).replace(/e\+(\d+)/, (_, exponent: string) =>
        `e${exponent.replace(/\d/g, (digit) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(digit)])}`);
      return `₹${scientific}`;
    }
    return formatMobileChartAmount(value);
  }
  if (amount >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(value / 1000).toFixed(0)}K`;
  return `₹${Math.round(value)}`;
};

export const formatMobileChartAmount = (value: number) => {
  const amount = Math.abs(value);
  const [scale, suffix] = amount >= 1e12 ? [1e12, "T"] as const
    : amount >= 1e9 ? [1e9, "B"] as const
    : amount >= 1e7 ? [1e7, "Cr"] as const
    : amount >= 1e5 ? [1e5, "L"] as const
    : amount >= 1e3 ? [1e3, "K"] as const : [1, ""] as const;
  return `₹${Number((value / scale).toFixed(amount / scale < 10 ? 1 : 0))}${suffix}`;
};