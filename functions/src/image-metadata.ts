import exifr from "exifr";

export interface ImageMetadata {
  latitude?: number;
  longitude?: number;
  capturedAt?: Date;
  make?: string;
  model?: string;
  orientation?: number;
}

export function validDate(value: unknown) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function appleLocation(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  return match
    ? { latitude: Number(match[1]), longitude: Number(match[2]) }
    : null;
}

const metadataText = (value: unknown) =>
  String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 80) || undefined;

function validCoordinates(lat: number | undefined, lng: number | undefined) {
  return (
    lat !== undefined &&
    lng !== undefined &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function resolveImageMetadata(
  serverMetadata: ImageMetadata,
  rawClient: Record<string, unknown> = {},
) {
  const clientLat = optionalNumber(rawClient.latitude),
    clientLng = optionalNumber(rawClient.longitude),
    serverLat = optionalNumber(serverMetadata.latitude),
    serverLng = optionalNumber(serverMetadata.longitude),
    clientValid = validCoordinates(clientLat, clientLng),
    serverValid = validCoordinates(serverLat, serverLng),
    latitude = serverValid ? serverLat : clientValid ? clientLat : undefined,
    longitude = serverValid ? serverLng : clientValid ? clientLng : undefined,
    serverCapturedAt = validDate(serverMetadata.capturedAt),
    clientCapturedAt = validDate(rawClient.capturedAt),
    capturedAt = serverCapturedAt || clientCapturedAt || null,
    locationSource = serverValid
      ? "server_exif"
      : clientValid
        ? "client_preprocess"
        : "none",
    timeSource = serverCapturedAt
      ? "server_exif"
      : clientCapturedAt
        ? "client_preprocess"
        : "none",
    source = locationSource !== "none" ? locationSource : timeSource,
    rawOrientation =
      optionalNumber(serverMetadata.orientation) ??
      optionalNumber(rawClient.orientation),
    orientation =
      rawOrientation !== undefined &&
      Number.isInteger(rawOrientation) &&
      rawOrientation >= 1 &&
      rawOrientation <= 8
        ? rawOrientation
        : null;
  return {
    latitude,
    longitude,
    capturedAt,
    hasGps: validCoordinates(latitude, longitude),
    hasCaptureTime: Boolean(capturedAt),
    source,
    locationSource,
    timeSource,
    make: serverMetadata.make || metadataText(rawClient.make) || null,
    model: serverMetadata.model || metadataText(rawClient.model) || null,
    orientation,
  };
}

export async function extractImageMetadata(
  bytes: Buffer,
): Promise<ImageMetadata> {
  try {
    const [gps, full, orientation] = await Promise.all([
        exifr.gps(bytes),
        exifr.parse(bytes, {
          gps: true,
          exif: true,
          tiff: true,
          xmp: true,
          reviveValues: true,
        }),
        exifr.orientation(bytes),
      ]),
      apple = appleLocation(
        full?.GPSCoordinates ||
          full?.location ||
          full?.Location ||
          full?.["com.apple.quicktime.location.ISO6709"],
      ),
      latitude = Number(gps?.latitude ?? full?.latitude ?? apple?.latitude),
      longitude = Number(gps?.longitude ?? full?.longitude ?? apple?.longitude),
      capturedAt = validDate(
        full?.DateTimeOriginal ||
          full?.CreateDate ||
          full?.DateCreated ||
          full?.ModifyDate,
      );
    return {
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
      capturedAt,
      make: metadataText(full?.Make),
      model: metadataText(full?.Model),
      orientation: Number.isFinite(Number(orientation))
        ? Number(orientation)
        : undefined,
    };
  } catch {
    return {};
  }
}
