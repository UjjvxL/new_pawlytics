import { expect, test } from "@playwright/test";

test("citizen map renders its primary controls without overflow", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByLabel("Pawlytics")).toBeVisible();
  await expect(page.getByRole("button", { name: "Where to?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "My location" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Navigate safely" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Report" })).toBeVisible();
  await expect(page.getByText("Manual route testing")).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
});

test("test URL is isolated and exposes manual dog placement and safe-route toggle", async ({
  page,
}) => {
  await page.goto("/test");

  await expect(page.getByText("Manual route testing")).toBeVisible();
  await expect(page.getByText("Route tester")).toBeVisible();
  await expect(page.getByRole("button", { name: "Place dog" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set start" })).toBeVisible();
  await expect(page.getByText("Safe route", { exact: true })).toBeVisible();
});

test("status feedback is themed, dismissible, and does not block map controls", async ({
  page,
}) => {
  await page.goto("/test");
  await page.locator(".demo-controls input[type=checkbox]").uncheck();
  const notice = page.locator(".status-notice.warning");
  await expect(notice).toBeVisible();
  const appearance = await notice.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }));
  expect(appearance.background).not.toBe("rgb(23, 34, 31)");
  expect(appearance.color).not.toBe("rgb(255, 255, 255)");
  await notice.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(notice).toHaveCount(0);
});

test("NCR scale demo is isolated and exposes judge route presets", async ({
  page,
  request,
}) => {
  await page.goto("/demo");

  const demoControl = page.getByRole("button", {
    name: "NCR scale demo controls",
  });
  await expect(demoControl).toBeVisible();
  const controlSize = await demoControl.boundingBox();
  expect(controlSize?.width).toBeLessThanOrEqual(40);
  expect(controlSize?.height).toBeLessThanOrEqual(40);
  await demoControl.click();
  await expect(page.getByText("LIVE NCR SCALE DEMO")).toBeVisible();
  await expect(page.getByText(/480.*demo dogs/)).toBeVisible();
  await expect(page.getByText("Safe path", { exact: true })).toBeVisible();
  await expect(page.getByText("Manual route testing")).toHaveCount(0);
  await page.getByRole("button", { name: "Where to?" }).click();
  await expect(
    page.getByRole("button", { name: "Pari Chowk" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Knowledge Park II Metro" }),
  ).toBeVisible();
  for (let image = 1; image <= 5; image += 1) {
    const response = await request.get(`/demo/dogs/street-dog-${image}.webp`);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image/webp");
  }
});

test("NCR judge route demonstrably avoids the seeded danger corridor", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "one Directions API comparison is sufficient",
  );
  await context.setGeolocation({ latitude: 28.4589, longitude: 77.4947 });
  await page.goto("/demo");
  await expect(page.locator(".map .gm-style")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Where to?" }).click();
  await page.getByRole("button", { name: "Pari Chowk" }).click();
  await expect(page.getByText(/Shield avoided \d+ danger-risk points/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("link", { name: "Start this route in Google Maps" }),
  ).toHaveAttribute("href", /google\.com\/maps\/dir\/\?.*waypoints=/);
});

test("NCR demo hides detailed dog markers when zoomed out", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "wheel zoom assertion uses the desktop map gesture",
  );
  await context.setGeolocation({ latitude: 28.4589, longitude: 77.4947 });
  await page.goto("/demo");
  await expect(page.locator(".dog-marker").first()).toBeVisible({
    timeout: 20_000,
  });
  const marker = await page.locator(".dog-marker").first().boundingBox();
  expect(marker?.width).toBeLessThanOrEqual(30);
  expect(marker?.height).toBeLessThanOrEqual(30);
  await page.locator(".dog-marker").first().click({ force: true });
  await expect(page.locator(".hotspot-card img")).toHaveAttribute(
    "src",
    /\/demo\/dogs\/street-dog-[1-5]\.webp/,
  );
  await page.locator(".hotspot-card .card-close").click();
  const map = await page.locator(".map").boundingBox();
  if (!map) throw new Error("Map bounds unavailable");
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, 1_000);
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".dog-marker")).toHaveCount(0);
  await page
    .getByRole("button", { name: "NCR scale demo controls" })
    .click();
  await expect(page.getByText("Density when zoomed out")).toBeVisible();
});

test("Google map tiles and destination suggestions are operational", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "one live API check is sufficient",
  );
  await page.goto("/");
  const secureContext = await page.evaluate(() => window.isSecureContext);
  if (!secureContext) {
    await page.goto("/test");
    await expect(page.locator(".map .gm-style")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Set start" }).click();
    const map = await page.locator(".map").boundingBox();
    if (!map) throw new Error("Map bounds unavailable");
    await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
    await expect(page.getByRole("button", { name: "Set start" })).toBeVisible();
  }
  await expect(page.locator(".map .gm-style")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Where to?" }).click();
  await page
    .getByPlaceholder("Search for a destination")
    .fill("Concordia University Montreal");
  const suggestion = page.locator(".suggestions button").first();
  await expect(suggestion).toBeVisible({
    timeout: 20_000,
  });
  if (!secureContext) return;
  await suggestion.click();
  const handoff = page.getByRole("link", {
    name: "Start this route in Google Maps",
  });
  await expect(handoff).toBeVisible({ timeout: 30_000 });
  await expect(handoff).toHaveAttribute(
    "href",
    /google\.com\/maps\/dir\/\?.*origin=.*waypoints=/,
  );
});

test("authority URL renders its own authentication surface", async ({
  page,
}) => {
  await page.goto("/authority");

  await expect(
    page.getByRole("heading", { name: "Pawlytics Authority" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with invited account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Return to citizen map" }),
  ).toHaveAttribute("href", "/");
});

test("legacy service workers are removed and repeated reloads remain usable", async ({
  page,
}) => {
  await page.goto("/");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.reload();
    await expect(page.getByRole("button", { name: "Where to?" })).toBeVisible();
  }

  const serviceWorker = await page.evaluate(async () => ({
    controlled: Boolean(navigator.serviceWorker?.controller),
    registrations: navigator.serviceWorker
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0,
  }));
  expect(serviceWorker).toEqual({ controlled: false, registrations: 0 });
});

test("map header and bottom controls stay aligned at phone widths", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "desktop-chrome",
    "phone-layout assertion",
  );
  await page.goto("/");

  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      if (!value) throw new Error(`Missing ${selector}`);
      return {
        top: value.top,
        bottom: value.bottom,
        left: value.left,
        right: value.right,
        height: value.height,
      };
    };
    return {
      header: rect(".topbar"),
      brand: rect(".topbar .brand"),
      search: rect(".topbar .search-bar"),
      login: rect(".topbar .login-button"),
      recenter: rect(".map-actions"),
      risk: rect(".risk-chip"),
      bottom: rect(".bottom-actions"),
      viewportWidth: window.innerWidth,
    };
  });

  const center = (item: { top: number; height: number }) =>
    item.top + item.height / 2;
  expect(Math.abs(center(layout.brand) - center(layout.search))).toBeLessThan(
    8,
  );
  expect(Math.abs(center(layout.search) - center(layout.login))).toBeLessThan(
    8,
  );
  expect(layout.recenter.bottom).toBeLessThanOrEqual(layout.bottom.top + 1);
  expect(layout.risk.bottom).toBeLessThanOrEqual(layout.bottom.top + 1);
  expect(layout.header.left).toBeGreaterThanOrEqual(0);
  expect(layout.header.right).toBeLessThanOrEqual(layout.viewportWidth);
});
