import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("authority presentation is public, PDF is real, dispatch is explicitly local, private dashboard still requires login", async ({
  page,
}) => {
  await page.goto("/authority");
  await expect(page.getByText("Presentation mode · sample data")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Staff sign-in" }),
  ).toHaveAttribute("href", "/authority/live");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/presentation.*\.pdf$/);
  const path = await download.path();
  expect((await readFile(path!)).subarray(0, 5).toString()).toBe("%PDF-");
  await page.locator(".da-incident-list button").first().click();
  await page.getByRole("button", { name: "Simulate dispatch" }).click();
  await expect(page.getByText(/No team was contacted/)).toBeVisible();
  await page.getByRole("button", { name: "Ward risk", exact: true }).click();
  const firstScore = Number(
    await page.locator("tbody tr").first().locator("td").last().textContent(),
  );
  await page.getByLabel("Sample risk age").selectOption("6");
  expect(
    Number(
      await page.locator("tbody tr").first().locator("td").last().textContent(),
    ),
  ).toBeLessThan(firstScore);
  await page.getByRole("button", { name: "ABC & rabies" }).click();
  await expect(
    page.getByRole("heading", { name: "ABC traceability pipeline" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Care network", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open directions" }).first(),
  ).toHaveAttribute("href", /google\.com\/maps\/search/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.goto("/authority/live");
  await expect(
    page.getByRole("button", { name: "Sign in with invited account" }),
  ).toBeVisible();
});

test("anonymous citizen presentation can save a labelled local photo draft without calling submission APIs", async ({
  page,
}) => {
  let submissions = 0;
  await page.route(
    /cloudfunctions\.net\/(createReportSession|uploadReportEvidence|prepareReportVerification)/,
    (route) => {
      submissions++;
      return route.abort();
    },
  );
  await page.goto("/demo?report=1");
  await expect(
    page.getByText("Presentation draft · no server submission"),
  ).toBeVisible();
  await page.getByLabel("Report category").selectOption("welfare");
  await page
    .getByPlaceholder(
      "Example: Three street dogs are barking and chasing cyclists near the gate…",
    )
    .fill("A calm dog is resting by the gate.");
  await page.getByRole("button", { name: "Use sample photo" }).click();
  await expect(page.locator(".photo-picker img")).toBeVisible();
  await page.getByRole("button", { name: "Save demo draft" }).click();
  await expect(
    page.getByText(/Demo draft saved in this tab only/),
  ).toBeVisible();
  const draft = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem("pawlytics:presentation-report") || "null",
    ),
  );
  expect(draft.category).toBe("welfare");
  expect(draft.mode).toBe("presentation-only");
  expect(submissions).toBe(0);
});

test("voice controls select English, Hindi and Marathi and preserve transcribed text", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class SpeechStub {
      lang = "";
      interimResults = false;
      onstart = () => {};
      onend = () => {};
      onerror = () => {};
      onresult = (event: unknown) => {
        void event;
      };
      start() {
        this.onstart();
        this.onresult({
          results: [
            [
              {
                transcript:
                  this.lang === "hi-IN"
                    ? "यहाँ एक कुत्ता है"
                    : this.lang === "mr-IN"
                      ? "इथे एक कुत्रा आहे"
                      : "A dog near the gate",
              },
            ],
          ],
        });
        this.onend();
      }
      stop() {
        this.onend();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: SpeechStub });
  });
  await page.goto("/demo?report=1");
  for (const [language, text] of [
    ["en-IN", "A dog near the gate"],
    ["hi-IN", "यहाँ एक कुत्ता है"],
    ["mr-IN", "इथे एक कुत्रा आहे"],
  ]) {
    await page.getByLabel("Voice language").selectOption(language);
    await page
      .getByRole("button", { name: `Dictate report in ${language}` })
      .click();
    expect(await page.locator(".report-sheet textarea").inputValue()).toContain(
      text,
    );
  }
});
