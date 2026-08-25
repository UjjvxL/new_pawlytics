export type Severity = "low" | "medium" | "high";
export type Behavior =
  | "calm"
  | "roaming"
  | "barking"
  | "chasing"
  | "aggressive"
  | "injured"
  | "unknown";

export interface AiVerdict {
  containsDog: boolean;
  plausible: boolean;
  manipulationLikely: boolean;
  confidence: number;
  dogCount: number;
  observedSeverity: Severity;
  observedBehavior: Behavior;
}

export function detectImageType(bytes: Uint8Array, declaredMime = "") {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  )
    return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brands = ascii(8, Math.min(bytes.length, 64)).toLowerCase(),
      heicBrands = ["heic", "heix", "hevc", "hevx", "heim", "heis"],
      heifBrands = ["mif1", "msf1"];
    if (heicBrands.some((brand) => brands.includes(brand))) return "image/heic";
    if (heifBrands.some((brand) => brands.includes(brand)))
      return declaredMime.toLowerCase().includes("heic")
        ? "image/heic"
        : "image/heif";
  }
  return null;
}

export function classifyLocation(
  hasGps: boolean,
  distanceMetres: number | null,
  liveCamera: boolean,
  source: string,
) {
  if (!hasGps) return liveCamera ? "live-camera" : "unverified";
  if (distanceMetres !== null && distanceMetres > 200) return "mismatch";
  return source === "server_exif" ? "verified" : "client-metadata";
}

export function triageReport(
  verdict: AiVerdict,
  locationEvidence: string,
  timeEvidence: string,
  testOnly = false,
) {
  const confidence = Math.max(0, Math.min(1, Number(verdict.confidence) || 0));
  const dangerous =
    verdict.observedSeverity === "high" ||
    ["aggressive", "chasing", "injured"].includes(verdict.observedBehavior);
  const visualConfidence =
    verdict.containsDog &&
    verdict.plausible &&
    !verdict.manipulationLikely &&
    confidence >= 0.8;
  const locationMismatch = locationEvidence === "mismatch";
  // A test report can only be created by a platform-admin claim and remains
  // isolated from the production map and rewards. It still executes upload,
  // metadata parsing, and Gemini before receiving a deterministic map result.
  const autoPublish =
    testOnly || (visualConfidence && !dangerous && !locationMismatch);
  const status = testOnly
    ? "provisional"
    : !verdict.containsDog && confidence >= 0.8
      ? "rejected"
      : autoPublish
        ? "provisional"
        : "review_required";
  const strongEvidence =
    ["verified", "live-camera"].includes(locationEvidence) &&
    timeEvidence === "recent" &&
    !verdict.manipulationLikely;
  return {
    status,
    autoPublish,
    dangerous,
    humanReviewRequired: status === "review_required",
    evidenceQuality: strongEvidence ? "strong" : "limited",
    publicHours: strongEvidence ? 6 : 2,
    reasonCode: testOnly
      ? "admin_test"
      : verdict.manipulationLikely
        ? "possible_manipulation"
        : dangerous
          ? "dangerous_behavior"
          : locationMismatch
            ? "location_mismatch"
            : "low_ai_confidence",
  } as const;
}

export function reportRateLimits(testOnly: boolean) {
  return testOnly ? { tenMinutes: 60, day: 300 } : { tenMinutes: 8, day: 30 };
}
