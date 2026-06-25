/** Format an integer number of cents as a USD currency string. */
export function formatCents(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/** Truncate a long blockchain address for display: 0x1234…cdef */
export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Group a 16-digit PAN into 4-digit chunks for display. */
export function formatPan(pan: string): string {
  return pan.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** Human-friendly relative-ish timestamp (date + time). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
