export const ABC_STAGES = [
  "captured",
  "vet_cleared",
  "sterilized",
  "vaccinated",
  "recovery",
  "released",
] as const;
export type AbcStage = (typeof ABC_STAGES)[number];
export function validAbcTransition(current: string | undefined, next: string) {
  if (current && !ABC_STAGES.includes(current as AbcStage)) return false;
  return (
    ABC_STAGES.indexOf(next as AbcStage) ===
    (current ? ABC_STAGES.indexOf(current as AbcStage) + 1 : 0)
  );
}
export function updateStock(
  current: number,
  movement: string,
  quantity: number,
) {
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 100000 ||
    !["received", "administered", "wasted"].includes(movement)
  )
    throw new Error("Invalid ARV movement.");
  const next = current + (movement === "received" ? quantity : -quantity);
  if (next < 0) throw new Error("Insufficient recorded stock.");
  return next;
}
export function wardAnalytics(
  reports: Array<Record<string, unknown>>,
  now = Date.now(),
) {
  const wards = new Map<
    string,
    {
      ward: string;
      reports: number;
      dogs: number;
      score: number;
      highRisk: number;
    }
  >();
  for (const report of reports) {
    if (
      report.testOnly ||
      !["provisional", "confirmed", "approved"].includes(
        String(report.verificationStatus),
      )
    )
      continue;
    const expires = Number(report.expiresAtMillis || 0);
    if (expires && expires <= now) continue;
    const ward = String(report.wardId || report.jurisdictionId || "Unassigned");
    const item = wards.get(ward) || {
      ward,
      reports: 0,
      dogs: 0,
      score: 0,
      highRisk: 0,
    };
    const age =
      Math.max(0, now - Number(report.createdAtMillis || now)) / 3600000;
    const dogs = Math.max(1, Math.min(30, Number(report.dogCount) || 1));
    item.reports++;
    item.dogs += dogs;
    item.highRisk += report.severity === "high" ? 1 : 0;
    item.score +=
      ({ low: 1, medium: 3, high: 7 }[String(report.severity)] || 1) *
      dogs *
      Math.pow(0.5, age / 6);
    wards.set(ward, item);
  }
  return [...wards.values()]
    .map((item) => ({ ...item, score: Math.round(item.score * 10) / 10 }))
    .sort((a, b) => b.score - a.score);
}
