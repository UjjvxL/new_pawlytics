import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Crosshair, Dog, Footprints, HeartPulse, MapPin, Navigation, Phone, Share2, ShieldCheck, X } from "lucide-react";

const DESTINATIONS = [
  { name: "IILM Gate 1", eta: "4 min", lat: 28.4584, lng: 77.4952 },
  { name: "KP II Metro", eta: "12 min", lat: 28.4644, lng: 77.4895 },
  { name: "Pari Chowk", eta: "22 min", lat: 28.4657, lng: 77.5108 },
] as const;

export default function WatchDemo() {
  const [screen, setScreen] = useState<"home" | "walk" | "report" | "sos">("home");
  const [time, setTime] = useState("");
  const [gps, setGps] = useState<GeolocationCoordinates | null>(null);
  const [gpsState, setGpsState] = useState("Finding GPS");
  const [reported, setReported] = useState(false);
  const [destination, setDestination] = useState<(typeof DESTINATIONS)[number] | null>(null);
  useEffect(() => {
    const update = () => setTime(new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date()));
    update(); const timer = window.setInterval(update, 30_000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!navigator.geolocation) return setGpsState("GPS unavailable");
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => { setGps(coords); setGpsState("GPS live"); },
      () => setGpsState("Demo location"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 8_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  const origin = useMemo(() => gps ? `${gps.latitude},${gps.longitude}` : "28.4589,77.4947", [gps]);
  const mapsUrl = destination ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination.lat},${destination.lng}&travelmode=walking` : "#";
  const shareWalk = async () => {
    const data = { title: "Pawlytics Safe Walk", text: "Follow my Pawlytics safe walk status.", url: `${location.origin}/demo` };
    if (navigator.share) await navigator.share(data).catch(() => undefined);
  };
  return <main className="watch-stage">
    <section className="watch-case" aria-label="Pawlytics Watch demo">
      <header className="watch-status"><span>{time}</span><i className={gps ? "live" : ""}/><small>{gpsState}</small></header>
      {screen !== "home" && <button className="watch-close" onClick={() => setScreen("home")} aria-label="Back to watch home"><X size={14}/></button>}
      {screen === "home" && <div className="watch-scroll">
        <div className="watch-brand"><span><Dog size={15}/></span><div><strong>Pawlytics</strong><small>SAFE WALK</small></div></div>
        <section className="watch-risk"><div className="watch-radar"><i/><i/><i/><span><ShieldCheck size={23}/></span></div><strong>Low risk</strong><p><b>2</b> sightings within 500 m</p><small>Safest direction: North-East</small></section>
        <button className="watch-primary" onClick={() => setScreen("walk")}><Navigation size={18}/><span><strong>Start safe walk</strong><small>Avoid 3 hotspots</small></span><ChevronRight size={15}/></button>
        <div className="watch-grid"><button onClick={() => setScreen("report")}><span className="amber"><Dog/></span><strong>Spot dog</strong></button><button onClick={() => void shareWalk()}><span className="blue"><Share2/></span><strong>Share walk</strong></button></div>
        <button className="watch-sos-link" onClick={() => setScreen("sos")}><HeartPulse size={15}/> Bite help / SOS</button>
        <footer>Demo · NCR live safety network</footer>
      </div>}
      {screen === "walk" && <div className="watch-scroll watch-page"><Navigation className="page-icon"/><h1>Safe walk</h1><p>Choose where you’re walking. Pawlytics checks the dog-risk corridor first.</p>{DESTINATIONS.map(place=><button className="watch-destination" key={place.name} onClick={()=>setDestination(place)}><MapPin/><span><strong>{place.name}</strong><small>{place.eta} away</small></span>{destination?.name===place.name?<Check/>:<ChevronRight/>}</button>)}{destination&&<a className="watch-go" href={mapsUrl} target="_blank" rel="noreferrer"><Footprints/>Start route</a>}<small className="watch-note">Route opens in Google Maps with your live GPS.</small></div>}
      {screen === "report" && <div className="watch-scroll watch-page"><Dog className="page-icon amber-text"/><h1>Dog spotted?</h1><p>Your GPS and time will create a provisional alert. Add a photo later from your phone.</p><div className="watch-location"><Crosshair/><span><strong>{gpsState}</strong><small>{gps ? `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}` : "IILM University demo zone"}</small></span></div>{reported?<div className="watch-success"><Check/><strong>Alert sent</strong><span>Nearby walkers warned for 20 min</span></div>:<button className="watch-report" onClick={()=>setReported(true)}><AlertTriangle/>Confirm sighting</button>}</div>}
      {screen === "sos" && <div className="watch-scroll watch-page sos"><HeartPulse className="page-icon"/><h1>Dog bite help</h1><div className="watch-sos-steps"><span><b>1</b>Wash wound with soap for 15 min</span><span><b>2</b>Get rabies vaccine immediately</span><span><b>3</b>Do not cover the wound tightly</span></div><a href="tel:112" className="watch-emergency"><Phone/>Call 112</a><a href="/demo" className="watch-nearby"><MapPin/>Find nearest ARV centre</a><small className="watch-note">Emergency actions require a second tap in the phone call screen.</small></div>}
    </section>
    <aside className="watch-caption"><strong>Apple Watch web companion</strong><span>Designed for a 41–49 mm display · scroll with the Digital Crown</span><a href="/demo">Return to Pawlytics demo</a></aside>
  </main>;
}
