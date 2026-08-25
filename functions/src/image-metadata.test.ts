import assert from "node:assert/strict";
import test from "node:test";
import piexif from "piexifjs";
import sharp from "sharp";
import {
  appleLocation,
  extractImageMetadata,
  optionalNumber,
  resolveImageMetadata,
  validDate,
} from "./image-metadata";

function degrees(value: number) {
  const absolute = Math.abs(value),
    whole = Math.floor(absolute),
    minutes = Math.floor((absolute - whole) * 60),
    seconds = (absolute - whole - minutes / 60) * 3_600;
  return [
    [whole, 1],
    [minutes, 1],
    [Math.round(seconds * 10_000), 10_000],
  ];
}

async function mobileJpeg(make: string, model: string, orientation: number) {
  const plain = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 50, g: 120, b: 90 },
    },
  })
    .jpeg()
    .toBuffer();
  const dictionary = {
    "0th": {
      [piexif.ImageIFD.Make]: make,
      [piexif.ImageIFD.Model]: model,
      [piexif.ImageIFD.Orientation]: orientation,
    },
    Exif: {
      [piexif.ExifIFD.DateTimeOriginal]: "2026:08:24 19:15:30",
    },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: "N",
      [piexif.GPSIFD.GPSLatitude]: degrees(45.5019),
      [piexif.GPSIFD.GPSLongitudeRef]: "W",
      [piexif.GPSIFD.GPSLongitude]: degrees(-73.5674),
    },
    "1st": {},
    thumbnail: null,
  } as unknown as Parameters<typeof piexif.dump>[0];
  const encoded = `data:image/jpeg;base64,${plain.toString("base64")}`,
    withExif = piexif.insert(piexif.dump(dictionary), encoded);
  return Buffer.from(withExif.split(",")[1], "base64");
}

for (const device of [
  { make: "Apple", model: "iPhone 15 Pro", orientation: 6 },
  { make: "Google", model: "Pixel 9", orientation: 1 },
]) {
  test(`parses real ${device.make} EXIF GPS, time, model, and orientation`, async () => {
    const metadata = await extractImageMetadata(
      await mobileJpeg(device.make, device.model, device.orientation),
    );
    assert.ok(Math.abs((metadata.latitude || 0) - 45.5019) < 0.00001);
    assert.ok(Math.abs((metadata.longitude || 0) + 73.5674) < 0.00001);
    assert.equal(metadata.make, device.make);
    assert.equal(metadata.model, device.model);
    assert.equal(metadata.orientation, device.orientation);
    assert.equal(metadata.capturedAt?.getFullYear(), 2026);
  });
}

test("parses Apple's ISO 6709 location convention", () => {
  assert.deepEqual(appleLocation("+45.5019-073.5674+012.345/"), {
    latitude: 45.5019,
    longitude: -73.5674,
  });
});

test("invalid dates and image bytes fail closed", async () => {
  assert.equal(validDate("not-a-date"), undefined);
  assert.equal(optionalNumber(null), undefined);
  assert.equal(optionalNumber(undefined), undefined);
  assert.equal(optionalNumber(""), undefined);
  assert.equal(optionalNumber("45.5"), 45.5);
  assert.deepEqual(await extractImageMetadata(Buffer.from("not an image")), {});
});

test("missing mobile metadata stays missing instead of becoming zero coordinates", () => {
  const missing = resolveImageMetadata(
    {},
    { latitude: null, longitude: null, capturedAt: null },
  );
  assert.equal(missing.hasGps, false);
  assert.equal(missing.latitude, undefined);
  assert.equal(missing.longitude, undefined);
  assert.equal(missing.locationSource, "none");

  const mixed = resolveImageMetadata(
    { capturedAt: new Date("2026-08-24T19:15:30Z") },
    { latitude: 45.5019, longitude: -73.5674 },
  );
  assert.equal(mixed.locationSource, "client_preprocess");
  assert.equal(mixed.timeSource, "server_exif");
  assert.equal(mixed.source, "client_preprocess");
});
