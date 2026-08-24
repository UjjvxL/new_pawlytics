# Pawlytics

A mobile-first dog-sighting safety map for India. It supports Google login, verified community reports, photo and speech input, live Firestore hotspots, and walking routes ranked to reduce exposure to active sightings.

## What works

- Google authentication through Firebase Auth
- Google Maps with current location, India-focused destination search, walking directions, and alternative-route risk scoring
- Photo capture/upload, Web Speech API dictation, location and timestamp metadata
- Server-side Gemini 3.6 Flash image/report verification; the API key never enters the browser
- Firestore live updates and Cloud Storage images
- Rules that let signed-in users create pending reports but never approve their own reports

## 1. Create Firebase and get the frontend keys

1. Open [Firebase Console](https://console.firebase.google.com/), create a project, then add a **Web app**.
2. In **Build → Authentication → Sign-in method**, enable **Google**. Add your production domain under Authentication → Settings → Authorized domains.
3. Create **Firestore Database** and **Storage**. Cloud Functions deployment requires the Blaze billing plan.
4. Copy `.env.example` to `.env` and paste the Firebase web config values shown under **Project settings → Your apps → SDK setup and configuration**.

Firebase web configuration is intentionally public and protected by Firebase rules. Do not place the Gemini secret in `.env`.

## 2. Get a Google Maps key

1. In [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview), select the same project and attach billing.
2. Enable **Maps JavaScript API**, **Geocoding API**, and **Directions API**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. Restrict it to website HTTP referrers (`http://localhost:5173/*` plus your production domain) and restrict API access to those three APIs.
5. Put it in `.env` as `VITE_GOOGLE_MAPS_API_KEY`.

The implementation uses Google's browser Directions service, which Google deprecated in February 2026 but continues to support. A production v2 should move routing to Routes API before removal is announced.

## 3. Get and securely store the Gemini key

1. Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Install/login to Firebase CLI, select your project, and store the key in Secret Manager:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase functions:secrets:set GEMINI_API_KEY
```

Paste the key only when the final command prompts. The function uses multimodal `gemini-3.6-flash`.

## 4. Run and deploy

```bash
npm install
npm --prefix functions install
npm run dev
```

Deploy after testing:

```bash
npm run build
firebase deploy --only firestore:rules,storage,functions,hosting
```

Geolocation and camera require HTTPS in production; localhost is allowed during development.

## Safety notes before public launch

Gemini verification is a moderation signal, not proof that a report is genuine or a route is safe. Add Firebase App Check, rate limits, duplicate-image detection, reporter reputation, abuse review, privacy/retention consent, and a human moderation queue before public use. Reports expire after 24 hours. Do not market routes as guaranteed safe.
