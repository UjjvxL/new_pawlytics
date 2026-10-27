# Pawlytics

**Pawlytics** is a mobile-first community reporting and risk-awareness platform for dog-related street safety. It brings citizen reports, explainable map signals, safer-walk guidance, nearby animal-care discovery, and protected authority workflows into one application.

## Quick links

- **Live app:** [pawlytics-84071.web.app](https://pawlytics-84071.web.app/)
- **Public authority presentation:** [Command centre](https://pawlytics-84071.web.app/authority)
- **Citizen and map demo:** [NCR demo](https://pawlytics-84071.web.app/demo)
- **Watch companion demo:** [Watch home](https://pawlytics-84071.web.app/demo/watch) · [Interactive watch map](https://pawlytics-84071.web.app/demo/watch/map)
- **Staff sign-in:** [Protected authority workspace](https://pawlytics-84071.web.app/authority/live)
- **Source code:** [GitHub repository](https://github.com/UjjvxL/new_pawlytics)
- **Firebase project:** [Project overview](https://console.firebase.google.com/project/pawlytics-84071/overview)
- **Build, checks, and deployments:** [GitHub Actions](https://github.com/UjjvxL/new_pawlytics/actions)
- **Previous reference deployment:** [pawlytics-506516.web.app](https://pawlytics-506516.web.app/)

> Demo pages use clearly labelled sample data. They do not create public alerts or contact emergency services.

## Features

### Citizen experience

- Sign in with Google using Firebase Authentication.
- Submit a report with a photo, category, severity, observation time, and location.
- Upload from a camera or photo library and dictate a report in English, Hindi, or Marathi where the browser supports speech recognition.
- Track server-confirmed report-processing stages and receive notifications, review outcomes, and downloadable report receipts.
- View nearby reports and explainable 250-metre yellow/red hotspot zones.
- Compare walking routes using active, time-decayed reports; review route-risk explanations and hand off a selected route to Google Maps.
- Find emergency vets, hospitals, vet clinics, rescue NGOs, and rabies-care locations. If Google Maps is unavailable or quota-limited, the app provides an OpenStreetMap view and external search/directions links.
- Read bite first-aid guidance and use location-aware links to find nearby care.
- View profile, contribution history, incentives, privacy controls, and report-verification status.

### Verification, privacy, and safety

- Server-side image/report checks use Gemini with model fallbacks. The Gemini key stays on the server and is not included in the browser bundle.
- Validate image bytes and supported EXIF/XMP metadata, compare location/time evidence, detect exact-image duplicates, apply trust/rate checks, and route uncertain or high-risk reports for human review.
- AI is a moderation signal, not proof that an image or report is genuine.
- Original report evidence is private by default. Public thumbnails require opt-in and privacy checks; raw evidence locations are not exposed on the public map.
- Firestore and Storage rules enforce ownership and organization boundaries and prevent direct client creation or approval of protected safety records.
- Risk scores and route suggestions are decision support only. Pawlytics does not guarantee a route is safe and does not dispatch emergency services.

### Authority tools

- Public presentation dashboard at `/authority` with labelled sample data and real PDF export.
- Protected staff workspace at `/authority/live`, requiring an active organization membership and verified second factor.
- Organization-scoped ward analytics and report review with reasoned decisions and ward assignment.
- Animal Birth Control (ABC) lifecycle records and anti-rabies vaccine (ARV) stock movements, written by server transactions with idempotent retries and audit events.
- Production queues remain empty when there is no live evidence; presentation records are not inserted into real operational data.

## Pages

| Route | Purpose | Access |
| --- | --- | --- |
| `/` | Live citizen map and reporting | Public map; sign-in required for account actions |
| `/demo` | NCR sample map, reports, care discovery, and route demo | Public; sample data |
| `/demo?report=1` | Local-only sample report draft | Public; does not upload evidence |
| `/demo/watch` | Walking and emergency-guidance presentation | Public; simulated actions are labelled |
| `/demo/watch/map` | Interactive map for the watch-sized companion | Public |
| `/authority` | Authority command-centre presentation | Public; sample data |
| `/demo/authority` | Authority workflow demonstration | Public; sample data |
| `/authority/live` | Private staff workspace and operations | Authorized organization members with MFA |
| `/test` | Development report, route, and map tools | Development/testing |

## Technology

- **Frontend:** React 18, TypeScript, Vite, CSS, Google Maps JavaScript API, Places and Routes APIs, with an OpenStreetMap fallback.
- **Backend:** Firebase Authentication, Cloud Firestore, Cloud Storage, Cloud Functions (Node.js 22), Firebase security rules, and Google Gemini/Vertex-compatible verification.
- **Region:** Cloud Functions, Firestore, and Storage are configured for `asia-south1` (Mumbai).
- **Hosting:** Firebase Hosting project `pawlytics-84071`.
- **Tests:** ESLint, Functions unit tests, Firestore/Storage rules tests, callable integration tests against isolated emulators, and Playwright desktop/phone browser tests.

## Local development

### Requirements

- Node.js 22
- Java 21 or newer for Firebase emulator tests
- A Firebase/Google Cloud project for live authentication, maps, uploads, and backend functions

### Configure credentials

Use one Firebase/Google Cloud project for the Firebase services, Maps APIs, and Gemini configuration.

1. Create a Firebase project, add a Web app, enable Google sign-in, and create the default Firestore database and Storage bucket.
2. Use the **Blaze** plan for deployed Cloud Functions and Cloud Storage. Attach a billing account and review the relevant Firebase and Google Maps pricing/quotas before enabling live use.
3. Enable these APIs in the same Google Cloud project: **Maps JavaScript API**, **Places API (New)**, **Geocoding API**, and **Routes API**.
4. Create a Google Maps browser key. Restrict it to the app's website origins and only the APIs above. For local Vite development, allow `http://localhost:5173/*` and `http://127.0.0.1:5173/*`; add the production host `https://pawlytics-84071.web.app/*`.
5. Copy the local setup template and fill in the Firebase web configuration, restricted Maps key, and server-only Gemini key:

```powershell
Copy-Item .setup.example.mjs .setup.local.mjs
```

On macOS/Linux, use `cp .setup.example.mjs .setup.local.mjs`.

Edit `.setup.local.mjs` and paste the complete Firebase `firebaseConfig` object and the two keys. Then run:

```bash
npm run setup:local
```

The helper writes `.env.local`, `functions/.secret.local` for local emulators, and selects `pawlytics-84071` as the Firebase CLI project. It does not create cloud resources or deploy. The template and generated credential files are ignored by Git. Never commit them.

Firebase's web config and a Maps browser key are visible in a browser by design; protect them with Firebase security rules, website restrictions, and API restrictions. **Never put the Gemini key in a `VITE_*` variable.** A local `functions/.secret.local` file does not configure deployed functions.

### Install and run

```bash
npm install
npm --prefix functions install
npm run dev
```

Open the local URL shown by Vite (normally `http://localhost:5173`). For LAN testing:

```bash
npm run dev -- --host 0.0.0.0
```

Browsers only grant GPS and camera access in secure contexts such as HTTPS or localhost. Plain HTTP on a LAN may not provide those permissions.

### Configure Gemini for deployed functions

Store the Gemini key in Firebase Secret Manager for the selected project. From an authenticated Firebase CLI session, run:

```bash
npx firebase login
npx firebase functions:secrets:set GEMINI_API_KEY
```

The CLI securely prompts for the value. Enable the required API/model access and check quota in the project that owns the key. Model fallbacks improve resilience but do not guarantee quota or availability. See [Firebase secret parameters](https://firebase.google.com/docs/functions/config-env#secret_parameters).

### Run checks

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

`npm test` includes lint, Functions unit tests, Firestore/Storage rules tests, callable integration tests, and Playwright browser tests. Emulator tests use the isolated `demo-pawlytics` project; they do not send SMS or use production data. Phone-sized browser tests emulate Chrome viewports and are not physical-device or Safari certification. Speech tests stub the browser API; actual microphone recognition depends on browser and operating-system support.

Optional live smoke tests create isolated test reports and remove their documents and images. Use only a designated test account and review the scripts before running:

```bash
LIVE_SMOKE=1 LIVE_SMOKE_UID=your_test_account_uid npm run test:live
npm run test:e2e:live
```

## Deployment

Pull requests run the automated validation workflow. A push or merge to `main` runs the checks and, on success, deploys the app and Firebase backend to project `pawlytics-84071`:

```bash
npm run build
npm --prefix functions run build
npx firebase deploy --project pawlytics-84071 --only firestore:rules,firestore:indexes,storage,functions,hosting
```

The GitHub Actions workflow uses Google Cloud Workload Identity Federation (OIDC); it does not require a service-account private key in GitHub. Deployment uses repository variables for public browser configuration and the OIDC provider/service-account identifiers. The Gemini secret stays in Google Secret Manager. See [the deployment workflow](.github/workflows/deploy.yml) and [workflow runs](https://github.com/UjjvxL/new_pawlytics/actions).

## Operational limits and launch checklist

- Reports and public map signals depend on available, verified contributions. Early wards may have sparse data; absence of a hotspot is not evidence of safety.
- Google Maps, Places, Routes, Gemini, Firebase quotas and billing apply. Configure API restrictions, budgets/alerts, and quota limits in Google Cloud.
- Before a broad public launch, configure and enforce Firebase App Check, monitor abuse and spend, maintain backups, and complete privacy/legal review.
- Route guidance is not a safety guarantee. AI output is not a medical diagnosis or proof of report authenticity.
- The prototype does not connect to emergency dispatch/112, hospital/FHIR systems, or official municipal feeds. Watch sightings and CCTV examples are simulations and are labelled as such.
- Actual camera/GPS/microphone behavior varies by device and browser. Real SMS-based MFA requires a staff member to enroll and verify their own phone.

For animal-care operations, ABC records document workflow stages; they do not perform veterinary treatment. ARV stock ledgers record reported movements and are not connected to a hospital or vaccine inventory system.

## Deployment history

- Feature parity, map fallback, watch companion, and protected authority MFA: [PR #1](https://github.com/UjjvxL/new_pawlytics/pull/1)
- Public authority presentation, protected operations tracking, PDF export, and safety improvements: [PR #2](https://github.com/UjjvxL/new_pawlytics/pull/2)
- Current production deployment: [pawlytics-84071.web.app](https://pawlytics-84071.web.app/)
