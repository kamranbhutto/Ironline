let currency = "USD";
export const setCurrency = (c: string) => {
  currency = c;
};

export const money = (n: number | null | undefined, digits = 2) =>
  n == null
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export const num = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(n);

export const date = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export const isPast = (isoDate: string | null | undefined) =>
  !!isoDate && isoDate < new Date().toISOString().slice(0, 10);

export const label = (status: string) => {
  const t = status.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
