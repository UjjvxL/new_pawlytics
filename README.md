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

## 1. Create Firebase and get the frontend keys

1. Open [Firebase Console](https://console.firebase.google.com/), create a project, then add a **Web app**.
2. In **Build → Authentication → Sign-in method**, enable **Google**. Add your production domain under Authentication → Settings → Authorized domains.
3. Create **Firestore Database** and **Storage**. Cloud Functions deployment requires the Blaze billing plan.
4. Copy `.env.example` to `.env` and paste the Firebase web config values shown under **Project settings → Your apps → SDK setup and configuration**.

Firebase web configuration is intentionally public and protected by Firebase rules. Do not place the Gemini secret in `.env`.

## 2. Get a Google Maps key

1. In [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview), select the same project and attach billing.
2. Enable **Maps JavaScript API**, **Places API (New)**, **Geocoding API**, and **Directions API**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. Restrict it to website HTTP referrers (`http://localhost:5173/*` plus your production domain) and restrict API access to those APIs.
5. Put it in `.env` as `VITE_GOOGLE_MAPS_API_KEY`.

The current browser route comparison uses `DirectionsService`; plan a controlled migration to Routes API after matching the alternative-route and Google Maps handoff behavior.

## 3. Get and securely store the Gemini key

1. Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Install/login to Firebase CLI, select your project, and store the key in Secret Manager:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase functions:secrets:set GEMINI_API_KEY
```

Paste the key only when the final command prompts. The function starts with `gemini-3.6-flash` and falls back across supported Flash models when a model is rate-limited. Enable billing and request suitable production quota; fallbacks are resilience, not extra guaranteed capacity.

## 4. Run and deploy

```bash
npm install
npm --prefix functions install
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
LIVE_SMOKE=1 npm run test:live
npm run test:e2e:live
```

Deploy after testing:

```bash
npm run build
firebase deploy --only firestore:rules,storage,functions,hosting
```

Geolocation and camera require HTTPS in production; localhost is allowed during development.

## Safety notes before public launch

Gemini verification is a moderation signal, not proof that a report is genuine or a route is safe. Rate limits, duplicate detection, reporter trust, privacy controls, expiry, and human review are implemented. Before an open public launch, configure a reCAPTCHA Enterprise site key and enable Firebase App Check enforcement, raise Gemini production quota, add monitoring/alerts and backups, and complete legal/privacy review. Do not market routes as guaranteed safe.
