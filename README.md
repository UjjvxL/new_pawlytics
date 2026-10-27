# Pawlytics

A mobile-first dog-sighting safety map. It supports Google login, verified community reports, photo and multilingual speech input, live Firestore hotspots, and walking routes ranked to reduce exposure to active sightings.

## What works

- Google authentication through Firebase Auth
- Google Maps with current location, destination suggestions, walking directions, alternative-route risk scoring, and exact-route handoff to Google Maps
- Camera and photo-library upload, Web Speech API dictation, and client/server normalization of iPhone, Android, EXIF, XMP, Apple GPS, orientation, and capture-time metadata
- Server-confirmed upload stages (`created → image uploaded → metadata parsed → AI queued → decision`) with background progress in the notification bell
- Server-side Gemini image/report verification with multiple model fallbacks; the API key never enters the browser
- Firestore live updates and Cloud Storage images
- Report lifecycle history with AI result details, map links, and downloadable receipts
- Explainable 250 m yellow/red hotspot zones and a manual dog-placement/report tester at `/test`
- WHO-aligned bite first aid and a location-aware Google Maps handoff for nearby rabies care
- `/test` tools for placing dogs, toggling safe routing, and manually setting a route/report origin when insecure LAN HTTP cannot expose GPS
- Firestore and Storage rules that keep raw reports/evidence private and prevent clients from creating or approving safety records directly

## Quick setup: paste credentials in one file

Use **one Firebase/Google Cloud project** for all three services. The owner must create the project, accept Google's terms, and attach billing. The remaining local configuration can be handled from this workspace.

Open `.setup.local.mjs` in the project root. It has three sections: the complete Firebase `firebaseConfig` object, a Google Maps key, and a Gemini key. This file is excluded from Git. If it does not exist, copy `.setup.example.mjs` to `.setup.local.mjs`. Keep the `export` keywords; paste only the Firebase configuration object, not the SDK imports or `initializeApp(...)` call.

After all three sections are filled, run `npm run setup:local` (no dependency installation is needed for this command). It generates the Vite configuration in `.env.local`, puts the server-only Gemini key in `functions/.secret.local` for local emulators, and changes the Firebase CLI's default project in `.firebaserc`. It does not create cloud resources or deploy anything. The optional reCAPTCHA field can stay blank during initial setup.

The Gemini key must also be stored in Firebase Secret Manager before deploying functions; `functions/.secret.local` alone does not configure deployed functions. Never add Gemini to a `VITE_` variable because Vite exposes those values to browsers.

## 1. Create Firebase and get the web configuration

1. Open [Firebase Console](https://console.firebase.google.com/), create a project, and add a **Web app** (`</>`). Google Analytics is optional and is not used by this app.
2. Upgrade to **Blaze** and attach billing. Both Cloud Storage and deployed Cloud Functions require it. See [Storage requirements](https://firebase.google.com/docs/storage/web/start).
3. In **Build → Authentication → Sign-in method**, enable **Google**, choosing your support email. Under **Settings → Authorized domains**, add `localhost` for local development and your hosting domains when deploying. [New projects do not include localhost by default](https://firebase.google.com/docs/auth/faq-and-troubleshooting).
   For the account screen's optional phone verification and rewards, also enable **Phone** and allow **India (IN)** and **Canada (CA)** under Authentication's SMS region policy. The current deployment has these enabled. Real SMS delivery requires a user-supplied number and reCAPTCHA; setup tests do not send SMS.
4. Create the default **Firestore Database** in Native mode, using production mode, and the default **Storage** bucket. The server functions currently use `asia-south1` (Mumbai); use that location for these resources if you intend to keep the existing backend region. Their initial production rules will be replaced by this repository's rules at deployment.
5. Under **Project settings → Your apps → SDK setup and configuration → Config**, copy the entire `firebaseConfig` object into the first section of `.setup.local.mjs`. This includes the Firebase API key and five other values; you do not need to obtain them separately.

Firebase web configuration is intentionally public and protected by Firebase rules. No service-account JSON or separate Google OAuth client secret is needed for this setup.

## 2. Get a Google Maps key

1. In [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview), select the same project and attach billing.
2. Enable **Maps JavaScript API**, **Places API (New)**, **Geocoding API**, and **Routes API**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. Restrict it to **Websites** (`http://localhost:5173/*` and `http://127.0.0.1:5173/*`, plus your actual hosting domains when deploying). Restrict API access to those four APIs. Use a separate Gemini key.
5. Paste it into `googleMapsApiKey` in `.setup.local.mjs`. See [Google's key setup instructions](https://developers.google.com/maps/documentation/javascript/get-api-key).

Walking routes use the [new Route class](https://developers.google.com/maps/documentation/javascript/routes/routes-js-migration), including alternative-route comparison, risk avoidance detours, route drawing, and the watch demo. Fresh projects need Routes API; the app no longer uses Directions API (Legacy). The main map shows live reports; sample reports are available at `/demo` and do not replace an empty or unavailable live database.

## 3. Get and securely store the Gemini key

1. Use either a **Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey) or an existing **Vertex AI express-mode key**. See [Gemini key instructions](https://ai.google.dev/gemini-api/docs/api-key) and [Vertex express-mode endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/express-mode/api-reference). Vertex express-mode keys beginning with `AQ.` are sent to the Vertex publisher endpoint; Gemini API keys use the Gemini Developer API. Each provider needs billing/quota in the project that owns its key.
2. Paste it into `geminiApiKey` in `.setup.local.mjs` and run `npm run setup:local`. Leave `recaptchaEnterpriseSiteKey` blank for now.
3. After dependencies are installed, log in to Firebase CLI and store the key in Secret Manager for deployed functions:

```bash
npx firebase login
npx firebase functions:secrets:set GEMINI_API_KEY
```

The final command securely prompts for the key. The setup helper has already selected the new default project. The function attempts several Flash model IDs; model access and quota must be verified against the new project before treating image verification as working. Enable billing and request suitable production quota; fallbacks are resilience, not extra guaranteed capacity. [Firebase documents secret storage here](https://firebase.google.com/docs/functions/config-env#secret_parameters).

## 4. Run and deploy

```bash
npm install
npm --prefix functions install
npm run setup:local
npm run dev
```

For another device on the same network:

```bash
npm run dev -- --host 0.0.0.0
```

Plain LAN HTTP is not a secure browser context, so iOS/Android can withhold GPS and camera permissions. Use the deployed HTTPS URL for real device GPS/camera testing. On `/test`, **Set start** lets you tap a non-hardcoded test origin when using LAN HTTP.

Run the complete local gate with:

```bash
npm test
npm run build
```

The opt-in live smoke test creates isolated admin-only reports, exercises the real upload/metadata/Gemini/authority/browser flow, and removes its documents and images:

```bash
LIVE_SMOKE=1 LIVE_SMOKE_UID=your_test_account_uid npm run test:live
npm run test:e2e:live
```

Deploy after testing:

```bash
npm run build
npm --prefix functions run build
npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
```

Geolocation and camera require HTTPS in production; localhost is allowed during development.

Admin, migration, and live-browser scripts read the selected project from `.env.local` and `.firebaserc`; inconsistent selections fail before they access cloud data. The optional live smoke test requires an explicit Firebase test-account UID with completed onboarding, and can use `LIVE_SMOKE_SERVICE_ACCOUNT` to select a signing service account. Rule tests run against an isolated `demo-pawlytics` emulator project. They require Java 21 or newer; the runner also detects Homebrew's `openjdk@21` installation on macOS.

Starting the frontend does not deploy the backend; real report verification needs deployed functions, rules, indexes, and the Gemini secret. The frontend currently has no emulator connection configuration.

## Safety notes before public launch

Gemini verification is a moderation signal, not proof that a report is genuine or a route is safe. Rate limits, exact-image duplicate detection, reporter trust, privacy controls, expiry, and human review are implemented. Before an open public launch, configure a reCAPTCHA Enterprise site key and enable Firebase App Check enforcement, raise Gemini production quota, add monitoring/alerts and backups, and complete legal/privacy review. Do not market routes as guaranteed safe.

## Deployment audit and feature comparison

Reference: <https://pawlytics-506516.web.app/>. New deployment: <https://pawlytics-84071.web.app/?ready=1>. Anonymous public pages were inspected in real Chrome at desktop and phone sizes, and compared with their deployed bundles, repository history, routes, components and callable services. The generic web fetcher could not render either app; browser access worked. The original project's protected Cloud Functions source returned permission denied, so its UI/presentation is not proof that its server features work. Original users, reports and private evidence were not copied.

This repository uses React 18, Vite, TypeScript, CSS and Firebase Auth/Firestore/Storage/Functions. There is no active Supabase or Tailwind integration to migrate. No repository AGENTS.md was found; the supplied physical-iPad instructions do not apply to these browser tests. Environment inputs are documented in `.env.example`; `.env.local`, `.setup.local.mjs` and `functions/.secret.local` are ignored. Gemini credentials remain in Secret Manager and server code.

**Working** means an implemented flow with the verification described below; **partial** means a specific limitation remains; **missing** means no real implementation existed; **unverifiable** means the required live evidence was unavailable. Presentation fixtures are never classified as live implementation.

| Capability | New app before this work | Current status and verification |
| --- | --- | --- |
| Citizen photo, GPS, timestamp, category and severity | Partial: secure image flow existed; category and explicit observation time were absent | Working in code/integration tests: ReportSheet → createReportSession → uploadReportEvidence → prepareReportVerification → Firestore trigger. Category/time validated by server, observed time stored separately from server/EXIF time; private originals retained. Emulator tests create actual sessions; a temporary isolated production image exercised Storage/Firestore/Gemini. Physical camera and real-device GPS permission remain unverifiable; browser tests use emulated GPS. |
| Hindi, English and Marathi voice | Partial: Web Speech UI existed, lifecycle/preserving typed text needed work | Partial: all three language selectors/transcription handlers tested with a browser speech stub; microphone cleanup and typed-text retention added. Actual microphone recognition and language availability depend on the browser/OS and were not verified on physical hardware. Unsupported/denied speech gives visible feedback and typing remains usable. |
| Metadata/image validation, duplicates, trust/moderation | Partial: real checks existed but admin test mode could fabricate an AI fallback result | Working: byte signatures, Apple/Android EXIF/XMP, location/time mismatch, exact-image hashes, trust/rate restrictions, review cases and human decisions traced in Functions. Policy/unit tests cover malformed evidence, mismatch, stale photos and high-risk escalation. AI failure now creates human review, including tests; no fabricated verification. AI remains a probabilistic signal; cryptographic identity or image authenticity is not claimed. |
| Explainable hotspots and time-sensitive risk | Partial: groups/expiry existed, but an open map could retain expired reports until the next snapshot | Working: active sightings refresh each minute; walking scores use severity × bounded dog count × six-hour age decay, with expiry exclusion. Hotspot cards explain evidence and limits. Ward aggregates use the same weights and only active public reports; unit and callable tests check decay/expiry. Public location is fuzzed; it is not raw evidence GPS. |
| Safer routes and nearby care / rabies first aid | Partial: legacy Directions API failed on new project; care directory hidden outside demo; no quota fallback | Working: supported Routes API, scored alternatives/detours, route handoff and all five care categories on the main map. Browser tests exercise real routes and place lookup. Per-category external search and OSM map remain usable when Google Maps fails. Provider availability/opening hours and route safety are not guaranteed. First-aid content links WHO; no clinical treatment or vaccine availability is asserted. |
| Authority review, ward risk, ABC/ARV records and PDF | Partial: protected reviews/actions/team existed; ward/ABC/ARV were presentation-only; export was JSON | Working implementation: `/authority/live` uses invitation/role/MFA access, original-evidence preview, reasoned review and ward assignment. New server transactions persist ordered ABC lifecycle stages, nonnegative ARV stock movements, idempotency and audit logs. Callable emulator tests verify role/org/MFA denial, database persistence, retries and balances; rule tests forbid anonymous/cross-org/direct writes. Live ward/operations PDF and clearly labelled sample PDF are real downloads, verified by `%PDF-` bytes. No hospital/FHIR feed, 112 dispatch integration, automatic clinical verification or official municipal data connection exists. |
| Firebase authentication, live updates and private evidence | Partial: Google auth/live data worked; authority MFA UI/server enforcement incomplete | Working Google login and deployed private-data rules; emulator tests verify ownership/org/MFA and upload authorization. Live updates use Firestore listeners. SMS enrollment/challenge UI and backend/rule checks are implemented; actual SMS delivery and an owner-completed MFA sign-in remain unverifiable. Raw evidence is private; public thumbnails require opt-in and privacy checks and remove metadata. |

### Presentation without login

- `/authority` and `/demo/authority`: public command center, district/ward risk, incidents, ABC/rabies and care-network sample screens. A persistent banner labels sample data. Dispatch only simulates a local UI action and explicitly contacts no team. Operational-map and care-direction controls are real links; PDF export creates an actual labelled sample PDF.
- `/demo`: NCR sample sightings, hotspot rendering, care discovery, route presets, local reporting and CCTV concept. `/demo?report=1` opens a photo/voice/category/time draft. A sample photo is available; saving stores only draft metadata in tab storage, uploads no evidence and claims no verification.
- `/demo/watch`: watch presentation with walking presets, sharing, local demo sighting and SOS. `/demo/watch/map` retains the interactive map. These are web companions, not native watchOS apps.
- `/authority/live`: private staff dashboard. An active organization membership and the configured second factor are required. No sample evidence is substituted into an empty real queue.

### Backend records and verification

`getAuthorityOperations` reads authorized organization records and active public sightings. `recordAuthorityOperation` writes `organizations/{org}/abcAnimals`, `arvStock` and immutable `operations` events with an audit log. ABC stages progress captured → vet cleared → sterilized → vaccinated → recovery → released; stock receipts/administered/wasted movements reject negative balance. Recording documents completed work; it does not perform a clinical action. Analytics cap at 1,000 reports, animal/stock views at 300 each, recent events at 50. Scale beyond these pilot limits requires pagination/aggregation. Existing organization security rules already deny all client writes and require authorized/MFA reads, so no SQL migration or broader access policy was added.

Validated on 2026-10-27: `npm run typecheck`, `npm run build` and `npm test` passed: 15 Functions unit tests, 8 security-rule tests, 5 callable integration tests and 55 browser tests (11 intentional viewport-specific skips).

Run `npm run typecheck`, `npm run build` and `npm test`. The test command includes lint, Functions unit tests, Firestore/Storage rules, Auth/Functions/Firestore/Storage callable integration tests and desktop/phone-sized browser tests. Emulators use isolated `demo-pawlytics`; no production auth tokens or SMS are used. Phone-sized tests run Chrome emulation, not physical Safari. Speech tests stub recognition and do not establish actual microphone quality.

### Cloud configuration and remaining owner actions

The new project's Firebase providers/domains, Mumbai database/storage, rules/indexes, Gemini secret, supported Maps services/restrictions, production Functions and Hosting are configured. A project operations workspace is configured as the pilot; `ujjvalxix19@gmail.com` has a verified-account, active `org_admin` membership. This is project authorization, not a claim of government affiliation. The owner still needs to enroll and verify their own phone MFA at `/authority/live`; no one can supply that personal verification on their behalf. No onboarding terms/age consent was accepted for the owner.

Presentation routes need no login or further setup. Normal signed-in citizen contribution still requires the user's own profile/consent completion. The optional App Check enterprise site key remains unset and enforcement is disabled as in the existing architecture; production hardening/monitoring beyond this feature-parity request is described above. Original-backend behavior, physical camera/GPS/microphone and real SMS cannot be certified from automated browser tests.

## Merge and deployment

`.github/workflows/deploy.yml` validates pull requests with lint, backend tests, isolated security-rule and callable integration emulators, desktop/phone browser tests and a production build. A push to `main` deploys Hosting, Functions, Firestore rules/indexes and Storage rules to `pawlytics-84071` using GitHub OIDC Workload Identity Federation. No service-account private key or Gemini key is stored in GitHub. Public browser configuration and the deployment provider/service-account identifiers are repository variables; Gemini remains in Google Secret Manager.
