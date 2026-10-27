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

Gemini verification is a moderation signal, not proof that a report is genuine or a route is safe. Rate limits, duplicate detection, reporter trust, privacy controls, expiry, and human review are implemented. Before an open public launch, configure a reCAPTCHA Enterprise site key and enable Firebase App Check enforcement, raise Gemini production quota, add monitoring/alerts and backups, and complete legal/privacy review. Do not market routes as guaranteed safe.

## Reference-site feature comparison

The reference is `https://pawlytics-506516.web.app/`; this repository deploys to `https://pawlytics-84071.web.app/`. The comparison covered anonymous desktop and phone flows, both deployed browser bundles, and the existing repository's authenticated flows. Existing reference users, reports, private evidence, and authority memberships are not migrated.

| Reference feature | Status in this repository |
| --- | --- |
| Live dog-sighting map, grouped risk zones, photo cards and fullscreen | Present; live empty states stay empty rather than showing sample reports |
| Current location, destination suggestions, walking alternatives and hotspot avoidance | Present; migrated to the supported Routes API for the new project |
| Nearby emergency vets, hospitals, clinics, rescue NGOs and rabies care on the main map | Restored outside demo mode, with location bias, short session caching and per-category Google Maps fallback links |
| Place photos, ratings, addresses, phone calls and route handoff | Present, now reachable from the main map |
| OpenStreetMap when Google Maps fails or reaches quota | Restored; live sightings and care links remain available, with an explicit external walking-directions handoff |
| Google sign-in, private citizen profiles, optional phone verification and privacy controls | Present; new-project Google and Phone providers configured |
| Camera/library evidence, multilingual speech, original metadata and upload stages | Present |
| Server-side Gemini verification, duplicate/rate checks, review and sanitized thumbnails | Present; the configured Vertex express-mode key is supported |
| Report notifications, history, AI explanations, map links and downloadable receipts | Present |
| Impact points, trust tier, streaks, reward eligibility and incentive demo accounts | Present; demo rewards remain client-only and labelled |
| Account export and delayed deletion/cancellation | Present |
| Bite first aid, dog-approach guidance, rabies-care handoff and WHO reference | Present |
| Authority invitations, organization/role access, review decisions and evidence | Present; empty live queues never substitute demo evidence |
| Authority MFA enrollment and second-factor sign-in | Restored with Firebase SMS enrollment/challenge UI, server checks and Firestore enforcement |
| Authority actions, team management and reviewed configuration changes | Present |
| NCR demonstration: 480 dogs, 96 hotspots, route presets and density rendering | Present at `/demo` |
| NCR command center, district performance, incident queue, ABC/rabies and care network | Present at `/demo/authority` |
| CCTV concept video, tracking overlay, metrics and playback controls | Present; explicitly simulated |
| Watch risk overview, walking presets, sighting confirmation, share and SOS | Restored at `/demo/watch`; demo sightings are explicitly local simulations |
| Watch map, destination search and real walking directions | Retained at `/demo/watch/map` |
| Manual dog placement, start positioning and safe-routing comparison | Present at `/test` |

Authority MFA uses the Firebase-verified second-factor claim. Enrollment alone or an administrative custom claim does not authorize protected evidence. Real SMS delivery requires the account owner's phone and verification code; automated tests never send SMS.

## Merge and deployment

`.github/workflows/deploy.yml` validates pull requests with lint, backend tests, isolated security-rule emulators, desktop/phone browser tests and a production build. A push to `main` deploys Hosting, Functions, Firestore rules/indexes and Storage rules to `pawlytics-84071` using GitHub OIDC Workload Identity Federation. No service-account private key or Gemini key is stored in GitHub. Public browser configuration and the deployment provider/service-account identifiers are repository variables; Gemini remains in Google Secret Manager.
