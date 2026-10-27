import { expect, test } from "@playwright/test";

test("live citizen map exposes the complete animal-care directory", async ({ page }) => {
  await page.goto("/");
  const directory = page.getByLabel("Nearby animal care filters");
  await expect(directory).toBeVisible();
  for (const category of ["Emergency vets", "Pet hospitals", "Vet clinics", "Rescue NGOs", "Rabies care"]) {
    await expect(directory.getByText(category, { exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});

test("a blocked Google Maps script keeps the fallback map, care links, and walking handoff usable", async ({ page }) => {
  await page.route(/maps\.googleapis\.com\/maps\/api\/js/, route => route.abort());
  await page.goto("/");
  await expect(page.getByRole("region", { name: "OpenStreetMap fallback" })).toBeVisible({ timeout: 25_000 });
  const attribution = page.getByRole("link", { name: "OpenStreetMap", exact: true });
  await expect(attribution).toBeVisible();
  const attributionBounds = await attribution.boundingBox();
  expect(attributionBounds?.y).toBeGreaterThanOrEqual(0);
  expect((attributionBounds?.y || 0) + (attributionBounds?.height || 0)).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(page.getByRole("link", { name: "Search Emergency vets in Google Maps" })).toHaveAttribute("href", /google\.com\/maps\/search/);
  await page.getByRole("button", { name: "Where to?", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Walking directions" })).toBeVisible();
  const start = page.getByPlaceholder("Street, landmark, or address");
  if (await start.isVisible()) await start.fill("IILM University Greater Noida");
  await page.getByPlaceholder("Where are you walking?").fill("Knowledge Park II Metro");
  await expect(page.getByRole("link", { name: "Open walking directions" })).toHaveAttribute("href", /travelmode=walking/);
  await expect(page.getByText("Pawlytics route risk comparison is unavailable in this mode.", { exact: false })).toBeVisible();
});

test("watch companion restores walking presets, a clearly simulated sighting, sharing, and SOS", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => undefined }, configurable: true });
  });
  await page.goto("/demo/watch");
  await expect(page.getByText("Low risk", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Start safe walk/ }).click();
  await page.getByRole("button", { name: /KP II Metro/ }).click();
  await expect(page.getByRole("link", { name: "Start route", exact: true })).toHaveAttribute("href", /google\.com\/maps\/dir/);
  await page.getByRole("button", { name: "Back to watch home" }).click();
  await page.getByRole("button", { name: "Spot dog" }).click();
  await page.getByRole("button", { name: "Confirm sighting" }).click();
  await expect(page.getByText("Demo sighting saved")).toBeVisible();
  await expect(page.getByText("Demo only · no public alert was sent")).toBeVisible();
  await page.getByRole("button", { name: "Back to watch home" }).click();
  await page.getByRole("button", { name: "Share walk" }).click();
  await expect(page.getByRole("status")).toHaveText("Walk link copied");
  await page.getByRole("button", { name: "Bite help / SOS" }).click();
  await expect(page.getByRole("link", { name: "Call 112" })).toHaveAttribute("href", "tel:112");
  await expect(page.getByRole("link", { name: "Find nearest ARV centre" })).toHaveAttribute("href", "/demo");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});
