import { useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  getRedirectResult,
  linkWithCredential,
  onAuthStateChanged,
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Camera,
  Crosshair,
  Download,
  ExternalLink,
  HeartPulse,
  LogOut,
  MapPin,
  Mic,
  Navigation,
  Plus,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Trophy,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import {
  auth,
  authReady,
  db,
  functions,
  isFirebaseConfigured,
  provider,
} from "./firebase";
import type { Severity, Sighting, UserProfile } from "./types";
import PawLogo from "./PawLogo";
import { DEFAULT_DEMO_SIGHTINGS } from "./demoData";

const INDIA = { lat: 20.5937, lng: 78.9629 };
const riskRadius: Record<Severity, number> = {
  low: 250,
  medium: 250,
  high: 250,
};
const riskWeight: Record<Severity, number> = { low: 1, medium: 3, high: 7 };
interface NavigationStep {
  instruction: string;
  distance: string;
  duration: string;
  end: google.maps.LatLngLiteral;
}
interface NavigationInfo {
  duration: string;
  distance: string;
  destination: string;
  risk: number;
  avoidedRisk: number;
  safetyEnabled: boolean;
  googleMapsUrl: string;
  firstStep: string;
  steps: NavigationStep[];
}
interface Hotspot {
  id: string;
  lat: number;
  lng: number;
  totalDogs: number;
  severity: Severity;
  reports: Sighting[];
  lastSeen: Date;
}

function sightingDate(value: Sighting["createdAt"]) {
  if (!value) return new Date(0);
  return "toDate" in value ? value.toDate() : value;
}

function formatSightingTime(
  value: Sighting["createdAt"],
  timezone?: string,
) {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  if (timezone) options.timeZone = timezone;
  try {
    return new Intl.DateTimeFormat(undefined, options).format(
      sightingDate(value),
    );
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat(undefined, options).format(
      sightingDate(value),
    );
  }
}

function isActiveSighting(sighting: Sighting) {
  if (!sighting.expiresAt) return true;
  const expiresAt =
    "toDate" in sighting.expiresAt
      ? sighting.expiresAt.toDate()
      : sighting.expiresAt;
  return expiresAt > new Date();
}

function groupHotspots(reports: Sighting[]): Hotspot[] {
  const groups: Hotspot[] = [];
  for (const report of [...reports].sort(
    (a, b) =>
      sightingDate(b.createdAt).getTime() - sightingDate(a.createdAt).getTime(),
  )) {
    const nearby = groups.find(
      (g) =>
        google.maps.geometry.spherical.computeDistanceBetween(
          new google.maps.LatLng(g.lat, g.lng),
          new google.maps.LatLng(report.lat, report.lng),
        ) <= 250,
    );
    if (nearby) {
      nearby.reports.push(report);
      nearby.totalDogs += Math.max(1, report.dogCount || 1);
      nearby.lat =
        nearby.reports.reduce((n, r) => n + r.lat, 0) / nearby.reports.length;
      nearby.lng =
        nearby.reports.reduce((n, r) => n + r.lng, 0) / nearby.reports.length;
      nearby.severity = nearby.totalDogs >= 5 ? "high" : "medium";
    } else
      groups.push({
        id: `hotspot-${report.id}`,
        lat: report.lat,
        lng: report.lng,
        totalDogs: Math.max(1, report.dogCount || 1),
        severity: (report.dogCount || 1) >= 5 ? "high" : "medium",
        reports: [report],
        lastSeen: sightingDate(report.createdAt),
      });
  }
  return groups;
}

function distanceToSegment(
  p: google.maps.LatLngLiteral,
  a: google.maps.LatLngLiteral,
  b: google.maps.LatLngLiteral,
) {
  const x = p.lat,
    y = p.lng,
    x1 = a.lat,
    y1 = a.lng,
    x2 = b.lat,
    y2 = b.lng;
  const dx = x2 - x1,
    dy = y2 - y1;
  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) * 111_000;
}

function routeRisk(route: google.maps.DirectionsRoute, sightings: Sighting[]) {
  const path = route.overview_path.map((p) => p.toJSON());
  return sightings.reduce((score, sighting) => {
    const hit = path
      .slice(1)
      .some(
        (p, i) =>
          distanceToSegment(
            { lat: sighting.lat, lng: sighting.lng },
            path[i],
            p,
          ) < riskRadius[sighting.severity],
      );
    return score + (hit ? riskWeight[sighting.severity] : 0);
  }, 0);
}

export default function App() {
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map>();
  const renderer = useRef<google.maps.DirectionsRenderer>();
  const markers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const riskCircles = useRef<google.maps.Circle[]>([]);
  const locationMarker = useRef<google.maps.marker.AdvancedMarkerElement>();
  const accuracyCircle = useRef<google.maps.Circle>();
  const watchId = useRef<number>();
  const firstLocation = useRef(true);
  const followingRef = useRef(true);
  const reroute = useRef<(risks: Sighting[]) => Promise<void>>();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [location, setLocation] = useState<google.maps.LatLngLiteral | null>(
    null,
  );
  const [locationState, setLocationState] = useState<
    "finding" | "tracking" | "denied" | "unavailable"
  >("finding");
  const [following, setFollowing] = useState(true);
  const [notice, setNotice] = useState("");
  const [myReports, setMyReports] = useState<Sighting[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [navigation, setNavigation] = useState<NavigationInfo | null>(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const testMode =
    window.location.pathname === "/test" ||
    new URLSearchParams(window.location.search).has("test");
  const [manualSightings, setManualSightings] = useState<Sighting[]>([]);
  const [placementMode, setPlacementMode] = useState(false);
  const [originPlacementMode, setOriginPlacementMode] = useState(false);
  const [safeRouting, setSafeRouting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let stopAuth: undefined | (() => void);
    let stopProfile: undefined | (() => void);
    void authReady.then(async () => {
      try {
        await getRedirectResult(auth);
      } catch (error) {
        if (!cancelled) {
          console.error("redirect-sign-in", error);
          setNotice(
            "Google sign-in could not be completed. Check that this domain is authorized and retry.",
          );
        }
      }
      if (cancelled) return;
      stopAuth = onAuthStateChanged(auth, (next) => {
        stopProfile?.();
        setUser(next);
        setProfile(null);
        if (!next) return;
        void httpsCallable(
          functions,
          "bootstrapUser",
        )({}).catch((error) => {
          console.error("profile-bootstrap", error);
          setNotice(
            "Signed in, but your profile could not be initialized. Tap the profile icon to retry.",
          );
        });
        stopProfile = onSnapshot(
          doc(db, "users", next.uid),
          (snap) => {
            if (snap.exists()) setProfile(snap.data() as UserProfile);
          },
          (error) => {
            console.error("profile-listener", error);
            setNotice("Signed in, but the profile database is unavailable.");
          },
        );
      });
    });
    return () => {
      cancelled = true;
      stopAuth?.();
      stopProfile?.();
    };
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!user) {
      setMyReports([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, "reports"),
        where("reporterId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(20),
      ),
      (snap) =>
        setMyReports(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Sighting)
            .sort(
              (a, b) =>
                sightingDate(b.createdAt).getTime() -
                sightingDate(a.createdAt).getTime(),
            )
            .slice(0, 20),
        ),
    );
  }, [user]);
  useEffect(() => {
    if (!isFirebaseConfigured) {
      setSightings(DEFAULT_DEMO_SIGHTINGS);
      return;
    }
    return onSnapshot(
      collection(db, "publicSightings"),
      (snap) => {
        const liveSightings = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Sighting,
        );
        setSightings(
          liveSightings.length > 0 ? liveSightings : DEFAULT_DEMO_SIGHTINGS,
        );
      },
      () => {
        setSightings(DEFAULT_DEMO_SIGHTINGS);
      },
    );
  }, []);

  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key || !mapNode.current) return;
    new Loader({
      apiKey: key,
      version: "weekly",
      libraries: ["places", "marker", "geometry"],
    })
      .load()
      .then(() => {
        map.current = new google.maps.Map(mapNode.current!, {
          center: INDIA,
          zoom: 5,
          mapId: "DEMO_MAP_ID",
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          styles: [
            { featureType: "poi.business", stylers: [{ visibility: "off" }] },
          ],
        });
        renderer.current = new google.maps.DirectionsRenderer({
          map: map.current,
          suppressMarkers: false,
          polylineOptions: { strokeColor: "#136f63", strokeWeight: 6 },
        });
        setMapsReady(true);
      })
      .catch(() =>
        setNotice(
          "Google Maps failed to load. Check the API key and enabled APIs.",
        ),
      );
  }, []);

  useEffect(() => {
    if (!mapsReady || !map.current) return;
    if (!navigator.geolocation) {
      setLocationState("unavailable");
      return;
    }
    const onPosition = (pos: GeolocationPosition) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocation(here);
      setLocationState("tracking");
      if (!locationMarker.current) {
        const dot = document.createElement("div");
        dot.className = "user-location";
        dot.setAttribute("aria-label", "Your location");
        locationMarker.current = new google.maps.marker.AdvancedMarkerElement({
          map: map.current,
          position: here,
          content: dot,
          zIndex: 999,
        });
        accuracyCircle.current = new google.maps.Circle({
          map: map.current,
          center: here,
          radius: Math.max(pos.coords.accuracy, 15),
          strokeColor: "#2678e8",
          strokeOpacity: 0.25,
          strokeWeight: 1,
          fillColor: "#4285f4",
          fillOpacity: 0.12,
        });
      } else {
        locationMarker.current.position = here;
        accuracyCircle.current?.setCenter(here);
        accuracyCircle.current?.setRadius(Math.max(pos.coords.accuracy, 15));
      }
      if (firstLocation.current || followingRef.current) {
        map.current?.panTo(here);
        if (firstLocation.current) map.current?.setZoom(16);
      }
      firstLocation.current = false;
    };
    const onError = (err: GeolocationPositionError) => {
      setLocationState(
        err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
      );
      setNotice(
        err.code === err.PERMISSION_DENIED
          ? "Location permission is blocked. Allow location for this site in your browser settings, then tap the target button."
          : "GPS position is unavailable. Check device location services and try again.",
      );
    };
    setLocationState("finding");
    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 15000,
    });
    const listener = map.current.addListener("dragstart", () => {
      followingRef.current = false;
      setFollowing(false);
    });
    return () => {
      if (watchId.current !== undefined)
        navigator.geolocation.clearWatch(watchId.current);
      listener.remove();
    };
  }, [mapsReady]);

  useEffect(() => {
    if (!mapsReady || !map.current) return;
    markers.current.forEach((m) => (m.map = null));
    const visibleSightings = (
      testMode ? [...sightings, ...manualSightings] : sightings
    ).filter((s) => (testMode || !s.testOnly) && isActiveSighting(s));
    const hotspots = groupHotspots(visibleSightings);
    riskCircles.current.forEach((c) => c.setMap(null));
    riskCircles.current = hotspots.map(
      (s) =>
        new google.maps.Circle({
          map: map.current,
          center: { lat: s.lat, lng: s.lng },
          radius: 250,
          strokeColor: s.severity === "high" ? "#d93025" : "#f29900",
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: s.severity === "high" ? "#ea4335" : "#fbbc04",
          fillOpacity: 0.18,
          clickable: false,
        }),
    );
    markers.current = hotspots.map((s) => {
      const pin = document.createElement("button");
      pin.className = `dog-marker ${s.severity}`;
      pin.innerHTML = `<span>🐕</span><b>${s.totalDogs}</b>`;
      pin.setAttribute(
        "aria-label",
        `${s.totalDogs} dogs, ${s.severity} risk hotspot`,
      );
      pin.onclick = () => setSelected(s);
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: map.current,
        position: { lat: s.lat, lng: s.lng },
        content: pin,
        zIndex: 1_000,
      });
      return marker;
    });
  }, [mapsReady, sightings, testMode, manualSightings]);

  useEffect(() => {
    if (
      !mapsReady ||
      !map.current ||
      !testMode ||
      (!placementMode && !originPlacementMode)
    )
      return;
    const listener = map.current.addListener(
      "click",
      (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return;
        const point = event.latLng.toJSON();
        if (originPlacementMode) {
          setLocation(point);
          setLocationState("tracking");
          setFollowing(true);
          followingRef.current = true;
          firstLocation.current = false;
          if (!locationMarker.current) {
            const dot = document.createElement("div");
            dot.className = "user-location";
            dot.setAttribute("aria-label", "Your test start location");
            locationMarker.current =
              new google.maps.marker.AdvancedMarkerElement({
                map: map.current,
                position: point,
                content: dot,
                zIndex: 999,
              });
          } else locationMarker.current.position = point;
          setOriginPlacementMode(false);
          renderer.current?.set("directions", null);
          setNavigation(null);
          setNotice(
            "Test start location set. It will be used for routes and test reports.",
          );
          return;
        }
        const placed: Sighting = {
          id: `manual-${Date.now()}`,
          ...point,
          description: "Manually placed test danger zone",
          severity: "high",
          dogCount: 3,
          verificationStatus: "approved",
        };
        const nextManual = [...manualSightings, placed];
        setManualSightings(nextManual);
        setPlacementMode(false);
        if (navigation && safeRouting && reroute.current) {
          setNotice(
            "Dog zone placed — automatically recalculating a safe route…",
          );
          void reroute.current([...sightings, ...nextManual]);
        } else {
          renderer.current?.set("directions", null);
          setNavigation(null);
          setNotice("Test dog zone placed. Calculate a route to include it.");
        }
      },
    );
    return () => listener.remove();
  }, [
    mapsReady,
    testMode,
    placementMode,
    originPlacementMode,
    manualSightings,
    navigation,
    safeRouting,
    sightings,
  ]);

  function locate(move = true): Promise<google.maps.LatLngLiteral> {
    if (location) {
      if (move) {
        followingRef.current = true;
        setFollowing(true);
        map.current?.panTo(location);
        map.current?.setZoom(Math.max(map.current.getZoom() || 0, 16));
      }
      return Promise.resolve(location);
    }
    setLocationState("finding");
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation(here);
          setLocationState("tracking");
          if (move) {
            followingRef.current = true;
            setFollowing(true);
            map.current?.panTo(here);
            map.current?.setZoom(16);
          }
          resolve(here);
        },
        (err) => {
          setLocationState(
            err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
          );
          setNotice("Location access is needed for reports and navigation.");
          reject(err);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      ),
    );
  }

  async function login() {
    try {
      await authReady;
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code =
        typeof err === "object" && err && "code" in err ? String(err.code) : "";
      if (
        code.includes("popup-blocked") ||
        code.includes("operation-not-supported-in-this-environment") ||
        code.includes("web-storage-unsupported")
      ) {
        setNotice(
          "Popup was blocked. Continuing with secure redirect sign-in…",
        );
        await signInWithRedirect(auth, provider);
        return;
      }
      if (
        !code.includes("popup-closed-by-user") &&
        !code.includes("cancelled-popup-request")
      )
        setNotice(
          `Google sign-in failed${code ? `: ${code.replace("auth/", "")}` : ""}.`,
        );
    }
  }

  const activeRisk = useMemo(
    () =>
      (testMode ? [...sightings, ...manualSightings] : sightings).filter(
        (s) => (testMode || !s.testOnly) && isActiveSighting(s),
      ),
    [sightings, testMode, manualSightings],
  );

  if (window.location.pathname.startsWith("/authority"))
    return <AuthorityPortal user={user} profile={profile} login={login} />;

  return (
    <main className="app-shell">
      <div ref={mapNode} className="map" />
      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <div className="setup-state">
          <div className="brand-mark" title="Pawlytics">
            <PawLogo size={22} color="white" />
          </div>
          <h1>Welcome to Pawlytics</h1>
          <p>
            Add your API keys to <code>.env</code> to load the live map.
          </p>
        </div>
      )}

      <header className="topbar">
        <div className="brand" aria-label="Pawlytics">
          <div className="brand-mark" title="Pawlytics">
            <PawLogo size={20} color="white" />
          </div>
          <span style={{ fontWeight: 800, fontSize: "17px", color: "#1a2744" }}>Pawlytics</span>
        </div>
        <button className="search-bar" onClick={() => setRouteOpen(true)}>
          <Search size={20} />
          <span>Where to?</span>
        </button>
        {user ? (
          <div className="profile-actions">
            <button
              className="notification-button"
              onClick={() => setNotificationsOpen((v) => !v)}
              aria-label="Report notifications"
            >
              <Bell size={20} />
              {myReports.some((r) =>
                [
                  "uploading",
                  "uploaded",
                  "automated_review",
                  "review_required",
                  "pending",
                ].includes(r.verificationStatus),
              ) && <i />}
            </button>
            <button
              className="avatar-button"
              onClick={() => setAccountOpen(true)}
              aria-label="Open account"
            >
              {user.photoURL ? (
                <img src={user.photoURL} />
              ) : (
                <UserRound size={18} />
              )}
            </button>
          </div>
        ) : (
          <button className="login-button" onClick={login}>
            Sign in
          </button>
        )}
      </header>
      {notificationsOpen && user && (
        <ReportsPanel
          reports={myReports}
          close={() => setNotificationsOpen(false)}
        />
      )}
      {user && profile && !profile.onboardingComplete && (
        <OnboardingSheet user={user} close={() => {}} onStatus={setNotice} />
      )}
      {user && profile && accountOpen && (
        <AccountSheet
          user={user}
          profile={profile}
          close={() => setAccountOpen(false)}
          onStatus={setNotice}
        />
      )}
      {!online && (
        <div className="offline-chip">
          <WifiOff size={14} />
          Offline · saved map shell only
        </div>
      )}

      <div className="map-actions">
        <button
          className={following && location ? "following" : ""}
          onClick={() => locate()}
          aria-label="My location"
        >
          <Crosshair size={21} />
        </button>
      </div>
      {locationState !== "tracking" && (
        <div className={`location-status ${locationState}`}>
          <span className="location-spinner" />
          <div>
            <strong>
              {locationState === "finding"
                ? "Finding your location…"
                : locationState === "denied"
                  ? "Location permission blocked"
                  : "GPS unavailable"}
            </strong>
            <small>
              {locationState === "denied"
                ? "Allow location in browser settings, then tap the target."
                : locationState === "unavailable"
                  ? "Turn on device location services."
                  : "For accurate routes and reports"}
            </small>
          </div>
        </div>
      )}
      <div className="risk-chip">
        <ShieldCheck size={17} />
        <strong>{activeRisk.length}</strong> active sighting
        {activeRisk.length === 1 ? "" : "s"} nearby
      </div>
      {testMode && <div className="demo-chip">Manual route testing</div>}
      {testMode && (
        <section className="demo-controls">
          <strong>Route tester</strong>
          <button
            className={placementMode ? "placing" : ""}
            onClick={() => {
              setOriginPlacementMode(false);
              setPlacementMode((v) => !v);
            }}
          >
            <Plus size={16} />
            {placementMode ? "Tap map…" : "Place dog"}
          </button>
          <button
            className={originPlacementMode ? "placing" : ""}
            onClick={() => {
              setPlacementMode(false);
              setOriginPlacementMode((v) => !v);
            }}
          >
            <Crosshair size={16} />
            {originPlacementMode ? "Tap start…" : "Set start"}
          </button>
          <label>
            <span>Safe route</span>
            <input
              type="checkbox"
              checked={safeRouting}
              onChange={(e) => {
                setSafeRouting(e.target.checked);
                renderer.current?.set("directions", null);
                setNavigation(null);
                setNotice(
                  e.target.checked
                    ? "Safety avoidance is ON. Calculate a route."
                    : "Safety avoidance is OFF. The default Google route will be shown.",
                );
              }}
            />
            <i />
          </label>
          <button
            className="clear-dogs"
            disabled={!manualSightings.length}
            onClick={() => {
              setManualSightings([]);
              renderer.current?.set("directions", null);
              setNavigation(null);
            }}
          >
            Clear placed
          </button>
        </section>
      )}

      {navigation && navigationActive && (
        <section className="turn-banner">
          <Navigation size={30} />
          <div>
            <small>Next</small>
            <strong
              dangerouslySetInnerHTML={{ __html: navigation.firstStep }}
            />
            <span>
              {navigation.distance} remaining · {navigation.duration}
            </span>
          </div>
        </section>
      )}
      {navigation && (
        <section
          className={stepsOpen ? "navigation-card expanded" : "navigation-card"}
        >
          <button
            className="card-close"
            onClick={() => {
              renderer.current?.set("directions", null);
              setNavigation(null);
              setNavigationActive(false);
              setStepsOpen(false);
            }}
          >
            <X size={18} />
          </button>
          <div className="nav-summary">
            <div className="nav-eta">{navigation.duration}</div>
            <div className="nav-details">
              <strong>{navigation.destination}</strong>
              <span>
                {navigation.distance} ·{" "}
                {navigation.risk === 0
                  ? "No active hotspots on route"
                  : `${navigation.risk} risk points on ${navigation.safetyEnabled ? "safest" : "default"} route`}
              </span>
              {navigation.avoidedRisk > 0 && (
                <em>
                  Shield avoided {navigation.avoidedRisk} danger-risk points
                </em>
              )}
              <small
                dangerouslySetInnerHTML={{ __html: navigation.firstStep }}
              />
            </div>
          </div>
          <div className="nav-controls">
            <a
              className="google-maps-start"
              href={navigation.googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Start this route in Google Maps"
            >
              <Navigation size={18} />
              <span>Start in Google Maps</span>
            </a>
            <button onClick={() => setStepsOpen((v) => !v)}>
              {stepsOpen ? "Hide steps" : "Preview steps"}
            </button>
          </div>
          {stepsOpen && (
            <ol className="step-list">
              {navigation.steps.map((step, i) => (
                <li key={i}>
                  <span>{i + 1}</span>
                  <div>
                    <p dangerouslySetInnerHTML={{ __html: step.instruction }} />
                    <small>
                      {step.distance} · {step.duration}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      <nav
        className={
          navigation ? "bottom-actions route-active" : "bottom-actions"
        }
      >
        <button className="navigate-button" onClick={() => setRouteOpen(true)}>
          <Navigation size={22} fill="currentColor" />
          Navigate safely
        </button>
        <button className="safety-button" onClick={() => setSafetyOpen(true)}>
          <HeartPulse size={22} />
          <span>Safety</span>
        </button>
        <button
          className="report-button"
          onClick={() => (user ? setReportOpen(true) : login())}
        >
          <Plus size={25} />
          <span>Report</span>
        </button>
      </nav>

      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {routeOpen && (
        <RouteSheet
          map={map.current}
          renderer={renderer.current}
          sightings={activeRisk}
          currentLocation={location}
          locate={locate}
          close={() => setRouteOpen(false)}
          setNotice={setNotice}
          setNavigation={setNavigation}
          safeRouting={safeRouting}
          onRouteReady={(fn) => {
            reroute.current = fn;
          }}
        />
      )}
      {reportOpen && user && (
        <ReportSheet
          testMode={testMode}
          initialLocation={location}
          locate={locate}
          close={() => setReportOpen(false)}
          onStatus={setNotice}
        />
      )}
      {safetyOpen && (
        <SafetySheet location={location} close={() => setSafetyOpen(false)} />
      )}
      {selected && (
        <HotspotCard hotspot={selected} close={() => setSelected(null)} />
      )}
    </main>
  );
}

function AuthorityPortal({
  user,
  profile,
  login,
}: {
  user: User | null;
  profile: UserProfile | null;
  login: () => Promise<void>;
}) {
  const [context, setContext] = useState<{
    platformAdmin: boolean;
    memberships: Array<{ organizationId: string; role: string }>;
  } | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [tab, setTab] = useState<
    "overview" | "reviews" | "actions" | "team" | "settings"
  >("overview");
  const [reviews, setReviews] = useState<any[]>([]),
    [actions, setActions] = useState<any[]>([]),
    [members, setMembers] = useState<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<Sighting | null>(null),
    [notice, setNotice] = useState("");
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(location.search),
      organizationId = params.get("org"),
      inviteId = params.get("invite"),
      token = params.get("token");
    if (!organizationId || !inviteId || !token) return;
    setAcceptingInvite(true);
    void httpsCallable(
      functions,
      "acceptAuthorityInvite",
    )({ organizationId, inviteId, token })
      .then(async () => {
        await user.getIdToken(true);
        history.replaceState({}, "", location.pathname);
        location.reload();
      })
      .catch(() => {
        setNotice(
          "This invitation is invalid, expired, or belongs to a different Google account.",
        );
        setAcceptingInvite(false);
      });
  }, [user]);
  useEffect(() => {
    if (!user) {
      setContext(null);
      return;
    }
    void httpsCallable(
      functions,
      "getAuthorityContext",
    )({})
      .then((r) => {
        const next = r.data as typeof context;
        setContext(next);
        if (next?.memberships[0])
          setOrganizationId(next.memberships[0].organizationId);
      })
      .catch(() => setNotice("Authority access could not be loaded."));
  }, [user]);
  useEffect(() => {
    if (!organizationId) return;
    const stops = [
      onSnapshot(
        query(
          collection(db, "reviewCases"),
          where("organizationId", "==", organizationId),
        ),
        (s) => setReviews(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      ),
      onSnapshot(
        query(
          collection(db, "authorityActions"),
          where("organizationId", "==", organizationId),
        ),
        (s) => setActions(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      ),
      onSnapshot(
        collection(db, "organizations", organizationId, "members"),
        (s) => setMembers(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [organizationId]);
  async function openReview(reportId: string) {
    try {
      const snap = await getDoc(doc(db, "reports", reportId));
      if (snap.exists())
        setSelectedReport({ id: snap.id, ...snap.data() } as Sighting);
    } catch {
      setNotice("Report evidence could not be loaded.");
    }
  }
  if (!user)
    return (
      <main className="authority-login">
        <div className="authority-login-card">
          <div className="brand-mark" title="Pawlytics">
            <PawLogo size={22} color="white" />
          </div>
          <h1>Pawlytics Authority</h1>
          <p>Verified government and municipal staff only.</p>
          <button onClick={() => void login()}>
            Sign in with invited account
          </button>
          <a href="/">Return to citizen map</a>
        </div>
      </main>
    );
  if (!context || acceptingInvite)
    return (
      <main className="authority-login">
        <div className="authority-spinner" />
        <p>
          {acceptingInvite
            ? "Accepting secure invitation…"
            : "Checking authority access…"}
        </p>
      </main>
    );
  if (!context.platformAdmin && !context.memberships.length)
    return (
      <main className="authority-login">
        <div className="authority-login-card">
          <ShieldCheck size={38} />
          <h1>Authority access restricted</h1>
          <p>
            Your citizen account is active, but it has not been invited to a
            verified organization.
          </p>
          <a href="/">Return to citizen map</a>
          <button className="quiet" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </main>
    );
  const openReviews = reviews.filter((r) => r.status === "open").length,
    pendingActions = actions.filter(
      (a) => !["completed", "cancelled"].includes(a.status),
    ).length;
  return (
    <main className="authority-shell">
      <aside>
        <a className="authority-brand" href="/">
          <span>P</span>
          <div>
            <strong>Pawlytics</strong>
            <small>Authority Control Room</small>
          </div>
        </a>
        <nav>
          {(
            [
              ["overview", "Overview"],
              ["reviews", `Review queue (${openReviews})`],
              ["actions", "Field actions"],
              ["team", "People & access"],
              ["settings", "Policy settings"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <footer>
          <strong>{profile?.displayName || user.displayName}</strong>
          <small>
            {context.memberships.find(
              (m) => m.organizationId === organizationId,
            )?.role || "platform administrator"}
          </small>
          <button onClick={() => signOut(auth)}>
            <LogOut size={15} />
            Sign out
          </button>
        </footer>
      </aside>
      <section className="authority-main">
        <header>
          <div>
            <h1>
              {tab === "overview"
                ? "Operations overview"
                : tab === "reviews"
                  ? "Verification queue"
                  : tab === "actions"
                    ? "Field actions"
                    : tab === "team"
                      ? "People and access"
                      : "Policy settings"}
            </h1>
            <p>Audited, jurisdiction-scoped safety operations</p>
          </div>
          {context.memberships.length > 1 && (
            <select
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              {context.memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organizationId}
                </option>
              ))}
            </select>
          )}
        </header>
        {notice && (
          <div className="authority-notice">
            {notice}
            <button onClick={() => setNotice("")}>
              <X />
            </button>
          </div>
        )}
        {tab === "overview" && (
          <div className="authority-overview">
            <div className="authority-kpis">
              <article>
                <strong>{openReviews}</strong>
                <span>Awaiting review</span>
              </article>
              <article>
                <strong>
                  {reviews.filter((r) => r.priority === "high").length}
                </strong>
                <span>High priority</span>
              </article>
              <article>
                <strong>{pendingActions}</strong>
                <span>Actions open</span>
              </article>
              <article>
                <strong>
                  {members.filter((m) => m.status === "active").length}
                </strong>
                <span>Active staff</span>
              </article>
            </div>
            <section className="authority-card">
              <h2>Operational priorities</h2>
              {reviews.slice(0, 5).map((r) => (
                <button
                  className="priority-row"
                  key={r.id}
                  onClick={() => {
                    setTab("reviews");
                    void openReview(r.reportId);
                  }}
                >
                  <span className={`priority-dot ${r.priority}`} />
                  <div>
                    <strong>{r.priority} priority report</strong>
                    <small>{r.reasonCodes?.join(" · ")}</small>
                  </div>
                  <span>{r.status}</span>
                </button>
              ))}
              {!reviews.length && (
                <p>No reports currently assigned to this organization.</p>
              )}
            </section>
          </div>
        )}
        {tab === "reviews" && (
          <section className="authority-card review-list">
            <div className="card-heading">
              <h2>Reports requiring a decision</h2>
              <span>{openReviews} open</span>
            </div>
            {reviews.map((r) => (
              <button key={r.id} onClick={() => void openReview(r.reportId)}>
                <span className={`priority-dot ${r.priority}`} />
                <div>
                  <strong>Report {r.reportId.slice(0, 8)}</strong>
                  <small>
                    {r.reasonCodes?.join(" · ") || "Automated review"}
                  </small>
                </div>
                <span>{r.status}</span>
              </button>
            ))}
            {!reviews.length && <p>Queue is clear.</p>}
          </section>
        )}
        {tab === "actions" && (
          <ActionsPanel
            organizationId={organizationId}
            actions={actions}
            onStatus={setNotice}
          />
        )}{" "}
        {tab === "team" && (
          <TeamPanel
            organizationId={organizationId}
            members={members}
            onStatus={setNotice}
          />
        )}{" "}
        {tab === "settings" && (
          <AuthoritySettings
            organizationId={organizationId}
            onStatus={setNotice}
          />
        )}
      </section>
      {selectedReport && (
        <ReviewPanel
          organizationId={organizationId}
          report={selectedReport}
          close={() => setSelectedReport(null)}
          onStatus={setNotice}
        />
      )}
    </main>
  );
}

function ReviewPanel({
  organizationId,
  report,
  close,
  onStatus,
}: {
  organizationId: string;
  report: Sighting;
  close: () => void;
  onStatus: (v: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const [publishImage, setPublishImage] = useState(
    Boolean(report.sharePublicImage && report.privacySafeForPublic),
  );
  const [evidenceUrl, setEvidenceUrl] = useState(""),
    [evidenceError, setEvidenceError] = useState("");
  useEffect(() => {
    let active = true;
    void httpsCallable(
      functions,
      "getReportEvidenceUrl",
    )({ organizationId, reportId: report.id })
      .then((result) => {
        if (active) setEvidenceUrl((result.data as { url: string }).url);
      })
      .catch(() => {
        if (active) setEvidenceError("Evidence image could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [organizationId, report.id]);
  async function decide(decision: "confirmed" | "rejected" | "duplicate") {
    if (reason.trim().length < 5)
      return onStatus("Add a clear decision reason.");
    setBusy(true);
    try {
      await httpsCallable(
        functions,
        "reviewReport",
      )({
        organizationId,
        reportId: report.id,
        decision,
        reason,
        publishImage: decision === "confirmed" && publishImage,
      });
      onStatus(`Report ${decision}.`);
      close();
    } catch {
      onStatus("Decision failed or your role is not permitted.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="authority-drawer">
      <button className="drawer-close" onClick={close}>
        <X />
      </button>
      <span className={`risk-label ${report.severity}`}>
        {report.verificationStatus}
      </span>
      <h2>Review report {report.id.slice(0, 8)}</h2>
      <div className="review-evidence">
        {evidenceUrl ? (
          <img src={evidenceUrl} alt="Original report evidence" />
        ) : (
          <div>{evidenceError || "Loading original evidence…"}</div>
        )}
      </div>
      <p>{report.description}</p>
      <dl>
        <div>
          <dt>AI summary</dt>
          <dd>{report.aiSummary || "Unavailable"}</dd>
        </div>
        <div>
          <dt>AI reason</dt>
          <dd>{report.aiReason || "Unavailable"}</dd>
        </div>
        <div>
          <dt>AI confidence</dt>
          <dd>
            {report.aiConfidence
              ? `${Math.round(report.aiConfidence * 100)}%`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>Detected dogs</dt>
          <dd>{report.dogCount ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Reported / detected severity</dt>
          <dd>
            {report.severity} / {report.observedSeverity || "unavailable"}
          </dd>
        </div>
        <div>
          <dt>Detected behaviour</dt>
          <dd>{report.observedBehavior || "Unavailable"}</dd>
        </div>
        <div>
          <dt>Location evidence</dt>
          <dd>
            {report.locationEvidence || "Pending"}
            {report.photoDistanceMetres != null
              ? ` · ${Math.round(report.photoDistanceMetres)} m from report`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Time evidence</dt>
          <dd>
            {report.timeEvidence || "Pending"}
            {report.photoCapturedAt
              ? ` · ${formatSightingTime(report.photoCapturedAt, report.sightingTimezone)}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Source / manipulation check</dt>
          <dd>
            {report.photoSource || "unknown"} · metadata: location{" "}
            {(
              report.metadataLocationSource ||
              report.metadataSource ||
              "none"
            ).replace(/_/g, " ")}
            {" · "}time{" "}
            {(report.metadataTimeSource || "none").replace(/_/g, " ")} ·{" "}
            {report.metadataMake || report.metadataModel
              ? `${report.metadataMake || ""} ${report.metadataModel || ""}`.trim()
              : "device unknown"}{" "}
            ·{" "}
            {report.manipulationLikely
              ? "possible manipulation"
              : "no manipulation detected"}
          </dd>
        </div>
        <div>
          <dt>Public image consent / AI privacy check</dt>
          <dd>
            {report.sharePublicImage ? "user consented" : "private only"} ·{" "}
            {report.privacySafeForPublic
              ? "AI found no obvious identifying detail"
              : "AI privacy check not passed"}
          </dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd>
            {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
          </dd>
        </div>
        <div>
          <dt>Reward</dt>
          <dd>{report.rewardStatus || "ineligible"}</dd>
        </div>
        <div>
          <dt>Pipeline decision</dt>
          <dd>
            {report.decisionSource?.replace(/_/g, " ") ||
              report.processingStatus ||
              "pending"}
            {report.evidenceQuality
              ? ` · ${report.evidenceQuality} evidence`
              : ""}
            {report.aiModel ? ` · ${report.aiModel}` : ""}
          </dd>
        </div>
      </dl>
      <label>
        Mandatory decision reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain evidence and decision…"
        />
      </label>
      <label className="consent-row">
        <input
          type="checkbox"
          checked={publishImage}
          disabled={!report.sharePublicImage}
          onChange={(event) => setPublishImage(event.target.checked)}
        />
        <span>
          <strong>Publish sanitized carousel thumbnail</strong>
          <small>
            Available only when the reporter consented. Confirm there are no
            identifiable people, plates, or private documents.
          </small>
        </span>
      </label>
      <div className="review-actions">
        <button disabled={busy} onClick={() => void decide("confirmed")}>
          Confirm
        </button>
        <button disabled={busy} onClick={() => void decide("rejected")}>
          Reject
        </button>
        <button disabled={busy} onClick={() => void decide("duplicate")}>
          Duplicate
        </button>
      </div>
    </div>
  );
}

function ActionsPanel({
  organizationId,
  actions,
  onStatus,
}: {
  organizationId: string;
  actions: any[];
  onStatus: (v: string) => void;
}) {
  const [type, setType] = useState("field_inspection"),
    [note, setNote] = useState("");
  async function create() {
    try {
      await httpsCallable(
        functions,
        "transitionAuthorityAction",
      )({ organizationId, actionType: type, status: "pending", note });
      setNote("");
      onStatus("Field action recorded.");
    } catch {
      onStatus("Your role cannot create this action.");
    }
  }
  async function transition(actionId: string, status: string) {
    try {
      await httpsCallable(
        functions,
        "transitionAuthorityAction",
      )({
        organizationId,
        actionId,
        status,
        note: `Status changed to ${status}`,
      });
      onStatus("Action updated.");
    } catch {
      onStatus("Action update failed.");
    }
  }
  return (
    <section className="authority-card">
      <div className="action-create">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="field_inspection">Field inspection</option>
          <option value="waste_issue">Waste/feeding issue</option>
          <option value="abc_referral">ABC referral</option>
          <option value="vaccination_referral">Vaccination referral</option>
          <option value="public_advisory">Public advisory</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Action details and location"
        />
        <button onClick={() => void create()}>Create action</button>
      </div>
      <div className="action-list">
        {actions.map((a) => (
          <article key={a.id}>
            <div>
              <strong>{String(a.actionType).replace(/_/g, " ")}</strong>
              <p>{a.note}</p>
              <small>{a.status}</small>
            </div>
            {!["completed", "cancelled"].includes(a.status) && (
              <div>
                <button onClick={() => void transition(a.id, "in_progress")}>
                  Start
                </button>
                <button onClick={() => void transition(a.id, "completed")}>
                  Complete
                </button>
              </div>
            )}
          </article>
        ))}
        {!actions.length && <p>No actions recorded.</p>}
      </div>
    </section>
  );
}

function TeamPanel({
  organizationId,
  members,
  onStatus,
}: {
  organizationId: string;
  members: any[];
  onStatus: (v: string) => void;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("field_officer"),
    [invite, setInvite] = useState("");
  async function send() {
    try {
      const r = await httpsCallable(
        functions,
        "inviteAuthorityMember",
      )({ organizationId, email, role, jurisdictionIds: [] });
      const data = r.data as { inviteId: string; inviteToken: string };
      const url = `${location.origin}/authority?org=${organizationId}&invite=${data.inviteId}&token=${encodeURIComponent(data.inviteToken)}`;
      setInvite(url);
      await navigator.clipboard.writeText(url);
      onStatus("Secure invitation link copied. It expires in seven days.");
    } catch {
      onStatus("Invitation failed or your role is not permitted.");
    }
  }
  return (
    <section className="authority-card">
      <div className="action-create">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Official email address"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="moderator">Moderator</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="field_officer">Field officer</option>
          <option value="analyst">Analyst</option>
          <option value="org_admin">Organization admin</option>
        </select>
        <button onClick={() => void send()}>Invite staff</button>
      </div>
      {invite && (
        <p className="invite-result">
          Invitation copied. Share it only with the intended staff member.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Role</th>
            <th>Status</th>
            <th>MFA</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.email || m.id}</td>
              <td>{m.role}</td>
              <td>{m.status}</td>
              <td>{m.mfaRequired ? "Required" : "Not enabled"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AuthoritySettings({
  organizationId,
  onStatus,
}: {
  organizationId: string;
  onStatus: (v: string) => void;
}) {
  const [riskRadiusMetres, setRadius] = useState(250),
    [provisionalHours, setHours] = useState(2),
    [alertRadiusKm, setAlert] = useState(1.5),
    [reason, setReason] = useState("");
  async function propose() {
    try {
      const r = await httpsCallable(
        functions,
        "proposeOrganizationConfig",
      )({
        organizationId,
        values: { riskRadiusMetres, provisionalHours, alertRadiusKm },
        reason,
      });
      onStatus(
        `Configuration proposed: ${(r.data as any).configVersionId}. A different admin must approve it.`,
      );
    } catch {
      onStatus(
        "Configuration proposal failed. Check limits, reason, and role.",
      );
    }
  }
  return (
    <section className="authority-card settings-form">
      <p>
        Safety-critical settings are bounded, versioned, audited, and require a
        second administrator.
      </p>
      <label>
        Route risk radius <output>{riskRadiusMetres} m</output>
        <input
          type="range"
          min="150"
          max="500"
          value={riskRadiusMetres}
          onChange={(e) => setRadius(Number(e.target.value))}
        />
      </label>
      <label>
        Provisional lifetime <output>{provisionalHours} hours</output>
        <input
          type="range"
          min="0.5"
          max="6"
          step="0.5"
          value={provisionalHours}
          onChange={(e) => setHours(Number(e.target.value))}
        />
      </label>
      <label>
        Citizen alert radius <output>{alertRadiusKm} km</output>
        <input
          type="range"
          min="0.25"
          max="5"
          step="0.25"
          value={alertRadiusKm}
          onChange={(e) => setAlert(Number(e.target.value))}
        />
      </label>
      <label>
        Change justification
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this safer for this jurisdiction?"
        />
      </label>
      <button onClick={() => void propose()}>Propose versioned change</button>
    </section>
  );
}

function OnboardingSheet({
  user,
  onStatus,
}: {
  user: User;
  close: () => void;
  onStatus: (v: string) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [language, setLanguage] = useState("en");
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [communityVisible, setCommunityVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await httpsCallable(
        functions,
        "completeOnboarding",
      )({
        displayName,
        language,
        adult,
        acceptedTerms: terms,
        communityVisible,
        leaderboardVisible: false,
      });
      onStatus("Welcome to Pawlytics. Your private profile is ready.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Onboarding failed.";
      onStatus(message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="scrim onboarding-scrim">
      <section className="sheet onboarding-sheet">
        <div className="onboarding-mark">P</div>
        <h2>Build safer streets together</h2>
        <p className="onboarding-lead">
          Create a private-by-default citizen profile. Reporting and community
          participation are for adults at launch.
        </p>
        <form onSubmit={finish}>
          <label className="field-label">Display name</label>
          <input
            className="profile-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            required
          />
          <label className="field-label">Language</label>
          <select
            className="profile-input"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="mr">मराठी</option>
            <option value="fr">Français</option>
          </select>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={communityVisible}
              onChange={(e) => setCommunityVisible(e.target.checked)}
            />
            <span>
              <strong>Community profile</strong>
              <small>
                Optional. Show only your pseudonym, badges, and impact totals.
              </small>
            </span>
          </label>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              required
            />
            <span>
              <strong>I am 18 or older</strong>
              <small>
                Maps and safety guidance remain available without contributing.
              </small>
            </span>
          </label>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              required
            />
            <span>
              <strong>I accept the Terms and Privacy Notice</strong>
              <small>
                Originals and precise locations stay private. A metadata-free
                thumbnail is shared only when you choose that on a report.
              </small>
            </span>
          </label>
          <button
            className="submit-report"
            disabled={saving || !adult || !terms}
          >
            {saving ? "Creating profile…" : "Continue to Pawlytics"}
          </button>
        </form>
      </section>
    </div>
  );
}

function AccountSheet({
  user,
  profile,
  close,
  onStatus,
}: {
  user: User;
  profile: UserProfile;
  close: () => void;
  onStatus: (v: string) => void;
}) {
  const [phone, setPhone] = useState("+91 ");
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const phoneVerifier = useRef<RecaptchaVerifier | null>(null);
  const [communityVisible, setCommunityVisible] = useState(
    profile.communityVisible,
  );
  const [leaderboardVisible, setLeaderboardVisible] = useState(
    profile.leaderboardVisible,
  );
  useEffect(() => () => phoneVerifier.current?.clear(), []);
  async function sendCode() {
    setBusy(true);
    try {
      await authReady;
      auth.languageCode = profile.language || navigator.language;
      phoneVerifier.current?.clear();
      const verifier = new RecaptchaVerifier(auth, "phone-recaptcha", {
        size: "normal",
        "expired-callback": () =>
          onStatus("Phone verification expired. Complete the check again."),
      });
      phoneVerifier.current = verifier;
      const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(
        phone.replace(/\s/g, ""),
        verifier,
      );
      setVerificationId(id);
      onStatus("Verification code sent.");
    } catch (error) {
      console.error("phone-code", error);
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code).replace("auth/", "")
          : "unknown-error";
      onStatus(
        `Could not send the code (${code}). Use an India or Canada number in full international format.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function verifyPhone() {
    setBusy(true);
    try {
      await linkWithCredential(
        user,
        PhoneAuthProvider.credential(verificationId, code),
      );
      await user.getIdToken(true);
      await httpsCallable(functions, "bootstrapUser")({});
      onStatus("Phone verified. Points and streaks are now eligible.");
    } catch {
      onStatus(
        "That code could not be verified or the phone is linked to another account.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function savePrivacy(
    nextCommunity = communityVisible,
    nextLeaderboard = leaderboardVisible,
  ) {
    setCommunityVisible(nextCommunity);
    setLeaderboardVisible(nextLeaderboard);
    try {
      await httpsCallable(
        functions,
        "updateUserSettings",
      )({
        language: profile.language,
        communityVisible: nextCommunity,
        leaderboardVisible: nextLeaderboard,
        pushEnabled: false,
      });
      onStatus("Privacy settings saved.");
    } catch {
      onStatus("Settings could not be saved.");
    }
  }
  async function share() {
    const data = {
      title: "Pawlytics impact",
      text: `I have helped confirm ${profile.confirmedReports} community dog sighting${profile.confirmedReports === 1 ? "" : "s"} with Pawlytics.`,
      url: location.origin,
    };
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(`${data.text} ${data.url}`);
      onStatus("Impact link copied.");
    }
  }
  async function exportData() {
    setBusy(true);
    try {
      const result = await httpsCallable(functions, "exportMyData")({}),
        blob = new Blob([JSON.stringify(result.data, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pawlytics-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      onStatus("Your private data export was downloaded.");
    } catch {
      onStatus("Data export failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function requestDeletion() {
    if (
      !confirm(
        "Delete your Pawlytics account? Reporting will be suspended now. You have seven days to cancel before permanent deletion.",
      )
    )
      return;
    setBusy(true);
    try {
      const result = await httpsCallable(
          functions,
          "requestAccountDeletion",
        )({}),
        date = new Date(
          (result.data as { executeAfter: string }).executeAfter,
        ).toLocaleDateString();
      onStatus(
        `Deletion scheduled for ${date}. Sign in before then to cancel.`,
      );
    } catch {
      onStatus("Account deletion could not be scheduled.");
    } finally {
      setBusy(false);
    }
  }
  async function cancelDeletion() {
    setBusy(true);
    try {
      await httpsCallable(functions, "cancelAccountDeletion")({});
      onStatus("Account deletion cancelled. Contributions are active again.");
    } catch {
      onStatus("No cancellable deletion request was found.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="scrim">
      <section className="sheet account-sheet">
        <div className="sheet-handle" />
        <div className="sheet-title">
          <button onClick={close}>
            <X />
          </button>
          <div>
            <h2>Your Pawlytics account</h2>
            <p>
              @{profile.handle} · {profile.trustTier} tier
            </p>
          </div>
        </div>
        <div className="impact-grid">
          <div>
            <Trophy />
            <strong>{profile.impactPoints}</strong>
            <span>Impact points</span>
          </div>
          <div>
            <ShieldCheck />
            <strong>{profile.confirmedReports}</strong>
            <span>Confirmed</span>
          </div>
          <div>
            <span className="streak-icon">🔥</span>
            <strong>{profile.currentStreak}</strong>
            <span>Day streak</span>
          </div>
        </div>
        <section className="account-section">
          <h3>Reward eligibility</h3>
          {profile.phoneVerified ? (
            <p className="verified-line">
              <ShieldCheck size={18} />
              Phone verified · reports with original recent GPS/time can earn
              points
            </p>
          ) : (
            <>
              <p>
                Verify one phone number to reduce duplicate accounts and unlock
                points, streaks, and leaderboards.
              </p>
              <div id="phone-recaptcha" />
              <div className="phone-row">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  aria-label="Phone number"
                />
                {verificationId ? (
                  <>
                    <input
                      className="code-input"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode="numeric"
                      placeholder="OTP"
                    />
                    <button
                      onClick={verifyPhone}
                      disabled={busy || code.length < 6}
                    >
                      Verify
                    </button>
                  </>
                ) : (
                  <button onClick={sendCode} disabled={busy}>
                    Send OTP
                  </button>
                )}
              </div>
            </>
          )}
        </section>
        <section className="account-section">
          <h3>Privacy</h3>
          <label className="setting-row">
            <span>
              <strong>Community profile</strong>
              <small>Show pseudonym, badges, and totals</small>
            </span>
            <input
              type="checkbox"
              checked={communityVisible}
              onChange={(e) =>
                void savePrivacy(e.target.checked, leaderboardVisible)
              }
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Leaderboards</strong>
              <small>Opt in to public rankings</small>
            </span>
            <input
              type="checkbox"
              checked={leaderboardVisible}
              onChange={(e) =>
                void savePrivacy(communityVisible, e.target.checked)
              }
            />
          </label>
        </section>
        <section className="account-section">
          <h3>Your data</h3>
          <p>
            Download a copy, or schedule deletion with a seven-day recovery
            period.
          </p>
          <div className="data-actions">
            <button onClick={exportData} disabled={busy}>
              <Download />
              Export my data
            </button>
            {profile.contributionStatus === "suspended" ? (
              <button onClick={cancelDeletion} disabled={busy}>
                Cancel deletion
              </button>
            ) : (
              <button
                className="danger-action"
                onClick={requestDeletion}
                disabled={busy}
              >
                Delete account
              </button>
            )}
          </div>
        </section>
        <div className="account-actions">
          <button onClick={share}>
            <Share2 />
            Share impact
          </button>
          <a href="/authority">
            <Settings />
            Authority portal
          </a>
          <button className="logout-action" onClick={() => signOut(auth)}>
            <LogOut />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

function RouteSheet({
  map,
  renderer,
  sightings,
  currentLocation,
  locate,
  close,
  setNotice,
  setNavigation,
  safeRouting,
  onRouteReady,
}: {
  map?: google.maps.Map;
  renderer?: google.maps.DirectionsRenderer;
  sightings: Sighting[];
  currentLocation: google.maps.LatLngLiteral | null;
  locate: () => Promise<google.maps.LatLngLiteral>;
  close: () => void;
  setNotice: (v: string) => void;
  setNavigation: (v: NavigationInfo) => void;
  safeRouting: boolean;
  onRouteReady: (fn: (risks: Sighting[]) => Promise<void>) => void;
}) {
  const destinationRef = useRef<HTMLInputElement>(null);
  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken>();
  const [routing, setRouting] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<
    google.maps.places.PlacePrediction[]
  >([]);
  useEffect(() => {
    if (searchText.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } =
          (await google.maps.importLibrary(
            "places",
          )) as google.maps.PlacesLibrary;
        if (!sessionToken.current)
          sessionToken.current = new AutocompleteSessionToken();
        const result =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: searchText,
            sessionToken: sessionToken.current,
            origin: currentLocation || undefined,
            locationBias: map?.getBounds() || undefined,
            language: navigator.language || "en",
          });
        setSuggestions(
          result.suggestions
            .flatMap((s) => (s.placePrediction ? [s.placePrediction] : []))
            .slice(0, 6),
        );
      } catch (err) {
        console.error("Autocomplete failed", err);
        setSuggestions([]);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchText, currentLocation, map]);
  async function selectSuggestion(
    prediction: google.maps.places.PlacePrediction,
  ) {
    setSearchText(prediction.text.toString());
    setSuggestions([]);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ["location", "formattedAddress", "displayName"],
      });
      sessionToken.current = undefined;
      if (!place.location) throw new Error("Place has no location");
      await navigate(place.location);
    } catch {
      setNotice("Could not load that destination. Please try another result.");
    }
  }
  async function search(e: React.FormEvent) {
    e.preventDefault();
    const text = destinationRef.current?.value.trim();
    if (!text) return;
    try {
      const result = await new google.maps.Geocoder().geocode({
        address: text,
        bounds: map?.getBounds(),
      });
      if (!result.results[0]) throw new Error("No result");
      await navigate(result.results[0].geometry.location);
    } catch {
      setNotice("Destination not found. Add an area or city and try again.");
    }
  }
  async function navigate(
    destination: google.maps.LatLng | string,
    routeSightings = sightings,
  ) {
    setRouting(true);
    try {
      const origin = currentLocation || (await locate());
      const service = new google.maps.DirectionsService();
      const result = await service.route({
        origin,
        destination,
        travelMode: google.maps.TravelMode.WALKING,
        provideRouteAlternatives: true,
      });
      type Candidate = {
        result: google.maps.DirectionsResult;
        i: number;
        score: number;
        seconds: number;
      };
      const candidates: Candidate[] = result.routes.map((route, i) => ({
        result,
        i,
        score: routeRisk(route, routeSightings),
        seconds: route.legs.reduce(
          (sum, leg) => sum + (leg.duration?.value || 0),
          0,
        ),
      }));
      const baselineRisk = candidates[0].score;
      if (
        safeRouting &&
        baselineRisk > 0 &&
        destination instanceof google.maps.LatLng
      ) {
        const destinationPoint = destination.toJSON();
        const latitudeScale = Math.max(
          0.25,
          Math.cos((origin.lat * Math.PI) / 180),
        );
        const north = destinationPoint.lat - origin.lat;
        const east = (destinationPoint.lng - origin.lng) * latitudeScale;
        const length = Math.hypot(north, east) || 1;
        const dangerous = routeSightings
          .filter((s) => routeRisk(result.routes[0], [s]) > 0)
          .slice(0, 3);
        const detourRequests = dangerous.flatMap((s) =>
          [-1, 1].map((side) => {
            const offset = (riskRadius[s.severity] * 2.2) / 111_000;
            const point = {
              lat: s.lat + side * (-east / length) * offset,
              lng: s.lng + (side * (north / length) * offset) / latitudeScale,
            };
            return service.route({
              origin,
              destination,
              travelMode: google.maps.TravelMode.WALKING,
              provideRouteAlternatives: false,
              waypoints: [{ location: point, stopover: false }],
            });
          }),
        );
        const detours = await Promise.allSettled(detourRequests);
        detours.forEach((response) => {
          if (response.status !== "fulfilled") return;
          response.value.routes.forEach((route, i) =>
            candidates.push({
              result: response.value,
              i,
              score: routeRisk(route, routeSightings),
              seconds: route.legs.reduce(
                (sum, leg) => sum + (leg.duration?.value || 0),
                0,
              ),
            }),
          );
        });
      }
      const chosen = safeRouting
        ? candidates.sort(
            (a, b) => a.score - b.score || a.seconds - b.seconds,
          )[0]
        : candidates[0];
      renderer?.setDirections(chosen.result);
      renderer?.setRouteIndex(chosen.i);
      const leg = chosen.result.routes[chosen.i].legs[0];
      const avoidedRisk = safeRouting
        ? Math.max(0, baselineRisk - chosen.score)
        : 0;
      const selectedPath = chosen.result.routes[chosen.i].overview_path;
      const waypoints = [1, 2, 3]
        .map((part) =>
          selectedPath[
            Math.min(
              selectedPath.length - 2,
              Math.max(1, Math.floor((selectedPath.length * part) / 4)),
            )
          ].toUrlValue(6),
        )
        .join("|");
      const mapsParams = new URLSearchParams({
        api: "1",
        origin: `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`,
        destination: leg.end_location.toUrlValue(6),
        travelmode: "walking",
        dir_action: "navigate",
        waypoints,
      });
      const googleMapsUrl = `https://www.google.com/maps/dir/?${mapsParams.toString()}`;
      setNavigation({
        duration: leg.duration?.text || "—",
        distance: leg.distance?.text || "—",
        destination: leg.end_address,
        risk: chosen.score,
        avoidedRisk,
        safetyEnabled: safeRouting,
        googleMapsUrl,
        firstStep: leg.steps[0]?.instructions || "Follow the highlighted route",
        steps: leg.steps.map((step) => ({
          instruction: step.instructions,
          distance: step.distance?.text || "",
          duration: step.duration?.text || "",
          end: step.end_location.toJSON(),
        })),
      });
      setNotice(
        !safeRouting
          ? `Default route shown with ${chosen.score} danger-risk points — safety avoidance is OFF.`
          : avoidedRisk > 0
            ? `Safer alternative selected — avoided ${avoidedRisk} danger-risk points.`
            : chosen.score
              ? "Safest available route shown — it still passes near a reported sighting."
              : "Safer route selected. Stay alert to changing conditions.",
      );
      onRouteReady(async (risks) => navigate(destination, risks));
      map?.fitBounds(chosen.result.routes[chosen.i].bounds);
      close();
    } catch {
      setNotice(
        "Could not calculate that route. Try a more specific destination.",
      );
    } finally {
      setRouting(false);
    }
  }
  return (
    <div className="scrim">
      <section className="sheet route-sheet">
        <div className="sheet-handle" />
        <div className="sheet-title">
          <button onClick={close}>
            <ArrowLeft />
          </button>
          <div>
            <h2>Safe navigation</h2>
            <p>Routes are ranked by verified sightings</p>
          </div>
        </div>
        <form className="route-input" onSubmit={search}>
          <MapPin size={21} />
          <input
            ref={destinationRef}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            autoFocus
            placeholder="Search for a destination"
            autoComplete="off"
          />
          <button disabled={routing} aria-label="Find route">
            <Navigation size={19} />
          </button>
        </form>
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((prediction, i) => (
              <button
                key={`${prediction.placeId}-${i}`}
                onClick={() => selectSuggestion(prediction)}
              >
                <MapPin size={18} />
                <span>{prediction.text.toString()}</span>
              </button>
            ))}
          </div>
        )}
        {routing && <div className="progress">Finding the safest route…</div>}
        <div className="route-note">
          <ShieldCheck />
          <div>
            <strong>Community-aware routing</strong>
            <p>
              Pawlytics compares available walking routes and reduces exposure
              to active dog hotspots.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

interface ClientPhotoMetadata {
  latitude?: number;
  longitude?: number;
  capturedAt?: string;
  make?: string;
  model?: string;
  orientation?: number;
  originalPreserved: boolean;
  platform: string;
}
async function readClientPhotoMetadata(
  file: File,
): Promise<ClientPhotoMetadata> {
  const platform = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? "ios"
      : /Android/i.test(navigator.userAgent)
        ? "android"
        : "web",
    base = { originalPreserved: file.size < 10_000_000, platform };
  try {
    const exifr = await import("exifr"),
      [gps, full, orientation] = await Promise.all([
        exifr.gps(file),
        exifr.parse(file, {
          gps: true,
          exif: true,
          tiff: true,
          xmp: true,
          reviveValues: true,
        }),
        exifr.orientation(file),
      ]),
      appleCoordinates = String(
        full?.GPSCoordinates ||
          full?.location ||
          full?.Location ||
          full?.["com.apple.quicktime.location.ISO6709"] ||
          "",
      ).match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/),
      captured =
        full?.DateTimeOriginal || full?.CreateDate || full?.DateCreated,
      latitude = Number(
        gps?.latitude ??
          full?.latitude ??
          (appleCoordinates ? appleCoordinates[1] : undefined),
      ),
      longitude = Number(
        gps?.longitude ??
          full?.longitude ??
          (appleCoordinates ? appleCoordinates[2] : undefined),
      ),
      date =
        captured instanceof Date ? captured : new Date(String(captured || ""));
    return {
      ...base,
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
      capturedAt: Number.isFinite(date.getTime())
        ? date.toISOString()
        : undefined,
      make: String(full?.Make || "").slice(0, 80) || undefined,
      model: String(full?.Model || "").slice(0, 80) || undefined,
      orientation: Number.isFinite(Number(orientation))
        ? Number(orientation)
        : undefined,
    };
  } catch {
    return base;
  }
}

async function optimizePhoto(file: File): Promise<File> {
  // Preserve original EXIF location/time whenever it fits the upload limit.
  if (file.size < 10_000_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (v) => (v ? resolve(v) : reject(new Error("Photo compression failed"))),
        "image/jpeg",
        0.82,
      ),
    );
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

function ReportSheet({
  testMode,
  initialLocation,
  locate,
  close,
  onStatus,
}: {
  testMode: boolean;
  initialLocation: google.maps.LatLngLiteral | null;
  locate: () => Promise<google.maps.LatLngLiteral>;
  close: () => void;
  onStatus: (v: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoSource, setPhotoSource] = useState<"camera" | "library">(
    "library",
  );
  const [sharePublicImage, setSharePublicImage] = useState(true);
  const [preview, setPreview] = useState("");
  const [listening, setListening] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState(
    navigator.language.startsWith("fr")
      ? "fr-CA"
      : navigator.language.startsWith("hi")
        ? "hi-IN"
        : "en-CA",
  );
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState("");
  const [stageNumber, setStageNumber] = useState(0);
  const uploadSteps = [
    "Report created",
    "Image uploaded",
    "Metadata parsed",
    "AI analysis",
    "Decision",
  ];
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function dictate() {
    const SpeechRecognition =
      (
        window as unknown as {
          SpeechRecognition?: new () => any;
          webkitSpeechRecognition?: new () => any;
        }
      ).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => any })
        .webkitSpeechRecognition;
    if (!SpeechRecognition)
      return onStatus("Speech-to-text is not supported in this browser.");
    const recognition = new SpeechRecognition();
    recognition.lang = speechLanguage;
    recognition.interimResults = true;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      onStatus(
        "Voice input stopped. Check microphone permission and try again.",
      );
    };
    recognition.onresult = (e: any) =>
      setDescription(
        Array.from(e.results)
          .map((r: any) => r[0].transcript)
          .join(" "),
      );
    recognition.start();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo)
      return onStatus(
        "Please add a current photo so AI can verify the report.",
      );
    if (description.trim().length < 10)
      return onStatus("Please describe what you saw in a little more detail.");
    setSaving(true);
    let currentStage = "Getting precise location…";
    try {
      setStage(currentStage);
      const position = initialLocation || (await locate());
      currentStage = "Creating secure report…";
      setStage(currentStage);
      const idempotencyKey = crypto.randomUUID();
      const session = await httpsCallable(
        functions,
        "createReportSession",
      )({
        ...position,
        description: description.trim(),
        severity,
        photoSource,
        sharePublicImage,
        testMode,
        idempotencyKey,
      });
      const { reportId } = session.data as {
        reportId: string;
      };
      setStageNumber(1);
      currentStage = "Preparing photo…";
      setStage(currentStage);
      const clientMetadata = await readClientPhotoMetadata(photo);
      const preparedPhoto = await optimizePhoto(photo);
      if (preparedPhoto.size > 10 * 1024 * 1024)
        throw new Error("PHOTO_TOO_LARGE");
      currentStage = "Uploading and securely storing image…";
      setStage(currentStage);
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("PHOTO_READ_FAILED"));
        reader.onload = () =>
          resolve(String(reader.result).split(",")[1] || "");
        reader.readAsDataURL(preparedPhoto);
      });
      await httpsCallable(
        functions,
        "uploadReportEvidence",
      )({
        reportId,
        imageBase64,
        contentType: preparedPhoto.type,
        clientMetadata,
      });
      setStageNumber(2);
      currentStage = "Image uploaded. Parsing GPS, time and file metadata…";
      setStage(currentStage);
      const metadataResult = await httpsCallable(
          functions,
          "prepareReportVerification",
        )({ reportId }),
        metadata = metadataResult.data as {
          hasGps: boolean;
          hasCaptureTime: boolean;
        };
      setStageNumber(3);
      currentStage = `Metadata parsed (${metadata.hasGps ? "photo GPS found" : "current app location retained"}, ${metadata.hasCaptureTime ? "capture time found" : "submission time retained"}). AI verification is queued…`;
      setStage(currentStage);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      close();
      onStatus(
        "Image and metadata are confirmed. AI is running in the background; open the bell for live progress and the decision.",
      );
    } catch (err) {
      console.error(err);
      const code =
        typeof err === "object" && err && "code" in err ? String(err.code) : "";
      const message = err instanceof Error ? err.message : "";
      onStatus(
        message === "PHOTO_TOO_LARGE"
          ? "That photo is too large. Choose a smaller image."
          : code.includes("unauthenticated")
            ? "Your session expired. Sign in again and retry."
            : code.includes("permission-denied") ||
                code.includes("unauthorized")
              ? "Upload permission was denied. Sign out, sign in, and retry."
              : `Submission stopped during “${currentStage}”. ${code || message || "Please retry."}`,
      );
    } finally {
      setSaving(false);
      setStage("");
    }
  }
  return (
    <div className="scrim">
      <section className="sheet report-sheet">
        <div className="sheet-handle" />
        <div className="sheet-title">
          <button onClick={close}>
            <X />
          </button>
          <div>
            <h2>Report a dog sighting</h2>
            <p>Your report will be checked by AI</p>
          </div>
        </div>
        <form onSubmit={submit}>
          {saving && (
            <div className="report-progress" role="status" aria-live="polite">
              <div className="verification-orbit">
                <ShieldCheck size={25} />
                <i />
              </div>
              <strong>{stage}</strong>
              <span>Every checkmark below is confirmed by the server.</span>
              <ol>
                {uploadSteps.map((label, index) => (
                  <li
                    key={label}
                    className={
                      index < stageNumber
                        ? "done"
                        : index === stageNumber
                          ? "active"
                          : ""
                    }
                  >
                    <i>{index < stageNumber ? "✓" : index + 1}</i>
                    <small>{label}</small>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="voice-heading">
            <label className="field-label">What is happening?</label>
            <select
              value={speechLanguage}
              onChange={(e) => setSpeechLanguage(e.target.value)}
              aria-label="Voice language"
            >
              <option value="en-CA">English (Canada)</option>
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">हिन्दी</option>
              <option value="mr-IN">मराठी</option>
              <option value="fr-CA">Français</option>
            </select>
          </div>
          <div className="textarea-wrap">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Example: Three street dogs are barking and chasing cyclists near the gate…"
              maxLength={500}
            />
            <button
              type="button"
              className={listening ? "mic active" : "mic"}
              onClick={dictate}
              aria-label={`Dictate report in ${speechLanguage}`}
            >
              <Mic size={20} />
            </button>
          </div>
          <label className="field-label">How risky does it feel?</label>
          <div className="severity-picker">
            {(["low", "medium", "high"] as Severity[]).map((v) => (
              <button
                type="button"
                key={v}
                className={severity === v ? `selected ${v}` : ""}
                onClick={() => setSeverity(v)}
              >
                {v === "low" ? "Calm" : v === "medium" ? "Alert" : "Danger"}
              </button>
            ))}
          </div>
          <div className={preview ? "photo-picker has-photo" : "photo-picker"}>
            {preview ? (
              <img src={preview} />
            ) : (
              <>
                <Camera size={30} />
                <strong>Add a current photo</strong>
                <span>Original GPS metadata helps verify the location</span>
              </>
            )}
          </div>
          <div className="photo-actions">
            <label>
              <Camera size={18} />
              Take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setPhotoSource("camera");
                    setPhoto(f);
                    setPreview(URL.createObjectURL(f));
                  }
                }}
              />
            </label>
            <label>
              <Plus size={18} />
              Photo library
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setPhotoSource("library");
                    setPhoto(f);
                    setPreview(URL.createObjectURL(f));
                  }
                }}
              />
            </label>
          </div>
          {photo && (
            <p className="photo-evidence">
              {photoSource === "camera"
                ? "Live camera capture: current app GPS will be used."
                : "Library photo: embedded Apple/EXIF GPS will be checked when available."}
            </p>
          )}
          <label className="consent-row report-image-consent">
            <input
              type="checkbox"
              checked={sharePublicImage}
              onChange={(event) => setSharePublicImage(event.target.checked)}
            />
            <span>
              <strong>Show this sighting photo on the map</strong>
              <small>
                If accepted and privacy-safe, Pawlytics publishes a resized copy
                with GPS and device metadata removed. The original stays
                private.
              </small>
            </span>
          </label>
          <div className="location-confirm">
            <MapPin />
            <div>
              <strong>Current location attached</strong>
              <span>Location and time help prevent false reports</span>
            </div>
          </div>
          <button className="submit-report" disabled={saving}>
            {saving ? stage : "Submit for verification"}
          </button>
        </form>
      </section>
    </div>
  );
}

function HotspotCard({
  hotspot,
  close,
}: {
  hotspot: Hotspot;
  close: () => void;
}) {
  const [reportIndex, setReportIndex] = useState(0);
  const reports = useMemo(
    () =>
      [...hotspot.reports].sort((a, b) => {
        const aHasPhoto = Boolean(a.thumbnailUrl || a.imageUrl);
        const bHasPhoto = Boolean(b.thumbnailUrl || b.imageUrl);
        if (aHasPhoto !== bHasPhoto) return aHasPhoto ? -1 : 1;
        return (
          sightingDate(b.createdAt).getTime() -
          sightingDate(a.createdAt).getTime()
        );
      }),
    [hotspot.reports],
  );
  const report = reports[reportIndex] || reports[0];
  const photoUrl = report.thumbnailUrl || report.imageUrl;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [report.id, photoUrl]);
  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - sightingDate(report.createdAt).getTime()) / 60000),
  );
  const age =
    ageMinutes < 60
      ? `${ageMinutes} min ago`
      : `${Math.round(ageMinutes / 60)} hr ago`;
  return (
    <section className="sighting-card hotspot-card">
      <button className="card-close" onClick={close}>
        <X size={18} />
      </button>
      <header>
        <span className={`risk-label ${hotspot.severity}`}>
          <AlertTriangle size={14} />
          {hotspot.totalDogs >= 5 ? "Red zone" : "Yellow zone"}
        </span>
        <h3>{hotspot.totalDogs} dogs reported within 250 m</h3>
        <p>
          {hotspot.reports.length} verified report
          {hotspot.reports.length === 1 ? "" : "s"} · Last seen {age}
        </p>
        <div className="risk-explanation">
          <ShieldCheck size={15} />
          <span>
            <strong>Why this risk:</strong>{" "}
            {hotspot.totalDogs >= 5
              ? "a pack of 5+ dogs is active in this zone"
              : "recent verified dog activity is inside the route buffer"}
            . Confidence:{" "}
            {hotspot.reports.length >= 3
              ? "high"
              : hotspot.reports.length === 2
                ? "moderate"
                : "limited"}
            .
          </span>
        </div>
      </header>
      {reports.length > 1 && (
        <div className="report-tabs">
          {reports.map((item, i) => (
            <button
              className={i === reportIndex ? "active" : ""}
              key={item.id}
              onClick={() => setReportIndex(i)}
              aria-label={`Show report ${i + 1}${item.thumbnailUrl || item.imageUrl ? " with photo" : ""}`}
            >
              {item.thumbnailUrl || item.imageUrl ? "📷" : i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="report-detail">
        {photoUrl && !imageFailed ? (
          <img
            src={photoUrl}
            alt={`Verified dog report ${reportIndex + 1} of ${reports.length}`}
            loading="eager"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="no-photo" aria-label="No public photo for this report">
            <span>🐕</span>
            <small>{imageFailed ? "Photo unavailable" : "No public photo"}</small>
          </div>
        )}
        <div>
          <strong>
            {report.dogCount || 1} dog{(report.dogCount || 1) === 1 ? "" : "s"}{" "}
            · {report.observedBehavior || report.severity}
          </strong>
          <p>{report.aiSummary || report.description}</p>
          <dl>
            <div>
              <dt>Reported</dt>
              <dd>
                {formatSightingTime(report.createdAt, report.sightingTimezone)}
              </dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>
                {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
              </dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>
                {report.locationEvidence || "AI verified"}
                {report.aiConfidence
                  ? ` · ${Math.round(report.aiConfidence * 100)}% confidence`
                  : ""}
              </dd>
            </div>
          </dl>
          {report.testOnly && (
            <small className="test-label">Developer test report</small>
          )}
        </div>
      </div>
      <footer>
        Stay alert and give street dogs space. Conditions can change quickly.
      </footer>
    </section>
  );
}

function ReportsPanel({
  reports,
  close,
}: {
  reports: Sighting[];
  close: () => void;
}) {
  const approved = reports.filter((r) =>
    ["confirmed", "approved"].includes(r.verificationStatus),
  ).length;
  function downloadReceipt(report: Sighting) {
    const receipt = {
      reportId: report.id,
      status: report.verificationStatus,
      submittedAt: sightingDate(report.createdAt).toISOString(),
      location: { lat: report.lat, lng: report.lng },
      description: report.description,
      aiSummary: report.aiSummary,
      aiConfidence: report.aiConfidence,
      evidence: report.locationEvidence,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `pawlytics-${report.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const pending = (status: Sighting["verificationStatus"]) =>
    ["uploading", "uploaded", "automated_review", "pending"].includes(status);
  const protecting = (status: Sighting["verificationStatus"]) =>
    ["provisional", "confirmed", "approved"].includes(status);
  const stages = ["Report", "Image", "Metadata", "AI/checks", "Decision"];
  function progress(report: Sighting) {
    if (report.verificationStatus === "expired")
      return { completed: 1, active: -1 };
    if (report.verificationStatus === "uploading")
      return { completed: 1, active: 1 };
    if (report.verificationStatus === "uploaded")
      return { completed: 2, active: 2 };
    if (report.verificationStatus === "automated_review")
      return { completed: 3, active: 3 };
    if (report.verificationStatus === "review_required")
      return { completed: 4, active: 4 };
    return { completed: 5, active: -1 };
  }
  return (
    <section className="notification-panel reports-panel">
      <header>
        <div>
          <strong>My reports</strong>
          <small>
            {reports.length} submitted · {approved} confirmed
          </small>
        </div>
        <button onClick={close}>
          <X size={17} />
        </button>
      </header>
      {reports.length === 0 ? (
        <p>No reports yet.</p>
      ) : (
        reports.map((r) => (
          <article key={r.id} data-report-id={r.id}>
            {r.imageUrl && <img src={r.imageUrl} alt="Report evidence" />}
            <span
              className={`status-dot ${protecting(r.verificationStatus) ? "approved" : r.verificationStatus}`}
            />
            <div>
              <strong>
                {r.verificationStatus === "provisional"
                  ? "Provisionally protecting routes"
                  : r.verificationStatus === "confirmed" ||
                      r.verificationStatus === "approved"
                    ? "Confirmed and protecting routes"
                    : r.verificationStatus === "review_required"
                      ? "Sent to a human safety reviewer"
                      : r.verificationStatus === "uploading"
                        ? "Photo upload did not finish"
                        : r.verificationStatus === "uploaded"
                          ? "Image upload confirmed"
                          : pending(r.verificationStatus)
                            ? "Verification in progress"
                            : "Not added to the map"}
              </strong>
              <p>
                {r.verificationStatus === "uploaded"
                  ? "The server has the image. GPS, capture time, device metadata, and orientation are being parsed next."
                  : r.verificationStatus === "automated_review" &&
                      r.processingStatus === "ai_queued"
                    ? "Image metadata is confirmed. AI analysis is queued; you can close Pawlytics."
                    : r.verificationStatus === "automated_review"
                      ? "AI is checking the dog, scene, time, location evidence, manipulation, and duplicates. You can close Pawlytics."
                      : r.verificationStatus === "review_required"
                        ? "Automated checks finished, but a person must make the final decision."
                        : r.verificationStatus === "uploading"
                          ? "The evidence is not queued. Submit a new report; incomplete uploads expire automatically."
                          : pending(r.verificationStatus)
                            ? "Your evidence is safely queued. You can close Pawlytics."
                            : r.aiReason || r.aiSummary || r.description}
              </p>
              <ol
                className="verification-timeline"
                aria-label="Verification progress"
              >
                {stages.map((label, index) => {
                  const state = progress(r);
                  return (
                    <li key={label}>
                      <i
                        className={
                          index < state.completed
                            ? "done"
                            : index === state.active
                              ? "active"
                              : ""
                        }
                      />
                      <small>{label}</small>
                    </li>
                  );
                })}
              </ol>
              <small>
                {formatSightingTime(r.createdAt, r.sightingTimezone)} ·{" "}
                {r.lat?.toFixed(4)}, {r.lng?.toFixed(4)}
                {r.pointsAwarded ? ` · +${r.pointsAwarded} points` : ""}
              </small>
              <div className="report-links">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin size={12} />
                  Map
                </a>
                <button onClick={() => downloadReceipt(r)}>
                  <Download size={12} />
                  Receipt
                </button>
              </div>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

function SafetySheet({
  location,
  close,
}: {
  location: google.maps.LatLngLiteral | null;
  close: () => void;
}) {
  const query = location
    ? `anti-rabies vaccine clinic near ${location.lat},${location.lng}`
    : "anti-rabies vaccine clinic near me";
  return (
    <div className="scrim">
      <section className="sheet safety-sheet">
        <div className="sheet-handle" />
        <div className="sheet-title">
          <button onClick={close}>
            <X />
          </button>
          <div>
            <h2>Dog safety & bite help</h2>
            <p>Fast guidance when every minute matters</p>
          </div>
        </div>
        <div className="emergency-card">
          <HeartPulse />
          <div>
            <strong>Bitten or scratched?</strong>
            <p>
              Wash and flush every wound with soap and running water for at
              least 15 minutes. Seek urgent medical care immediately for rabies
              post-exposure assessment—do not wait for symptoms.
            </p>
          </div>
        </div>
        <ol className="first-aid">
          <li>
            <b>1</b>
            <span>
              <strong>Wash for 15 minutes</strong>Use plenty of soap and running
              water.
            </span>
          </li>
          <li>
            <b>2</b>
            <span>
              <strong>Apply antiseptic if available</strong>Use an
              iodine-containing or similarly virucidal preparation.
            </span>
          </li>
          <li>
            <b>3</b>
            <span>
              <strong>Get medical care now</strong>A clinician must assess
              rabies vaccine and immunoglobulin needs.
            </span>
          </li>
        </ol>
        <a
          className="care-link"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
          target="_blank"
          rel="noreferrer"
        >
          <MapPin />
          Find nearby rabies care in Google Maps
          <ExternalLink size={16} />
        </a>
        <section className="approach-guide">
          <h3>If a dog approaches</h3>
          <p>
            Stay calm. Do not run, scream, stare directly, or make sudden
            movements. Stand sideways, keep your arms still, and slowly create
            distance. Use a bag or umbrella as a barrier if needed.
          </p>
        </section>
        <p className="medical-note">
          Emergency numbers vary by country. Call local emergency services for
          severe bleeding, injuries, or immediate danger. This guide does not
          replace professional medical care.
        </p>
        <a
          className="who-link"
          href="https://www.who.int/news-room/fact-sheets/detail/rabies"
          target="_blank"
          rel="noreferrer"
        >
          WHO rabies guidance <ExternalLink size={13} />
        </a>
      </section>
    </div>
  );
}
