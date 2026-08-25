import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import { Crosshair, Navigation, Search, X } from "lucide-react";

const FALLBACK_LOCATION = { lat: 28.4589, lng: 77.4947 };
type Destination = { name: string; lat: number; lng: number };

export default function WatchDemo() {
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map>();
  const renderer = useRef<google.maps.DirectionsRenderer>();
  const [origin, setOrigin] = useState(FALLBACK_LOCATION);
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState<Destination | null>(null);
  const [routing, setRouting] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !mapNode.current) { setStatus("Map unavailable"); return; }
    let active = true;
    new Loader({ apiKey, version: "weekly", libraries: ["places"] }).load().then(() => {
      if (!active || !mapNode.current) return;
      map.current = new google.maps.Map(mapNode.current, {
        center: FALLBACK_LOCATION, zoom: 15, disableDefaultUI: true,
        clickableIcons: false, gestureHandling: "greedy",
        styles: [{ featureType: "poi.business", stylers: [{ visibility: "off" }] }],
      });
      renderer.current = new google.maps.DirectionsRenderer({
        map: map.current, polylineOptions: { strokeColor: "#136f63", strokeWeight: 6 },
      });
    }).catch(() => setStatus("Map unavailable"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(({ coords }) => {
      const next = { lat: coords.latitude, lng: coords.longitude };
      setOrigin(next); map.current?.setCenter(next);
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 8_000 });
  }, []);

  const mapsUrl = useMemo(() => {
    if (!destination) return "#";
    const params = new URLSearchParams({ api: "1", origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`, travelmode: "walking" });
    return `https://www.google.com/maps/dir/?${params}`;
  }, [destination, origin]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || !window.google) return;
    setRouting(true); setStatus("Finding route…");
    try {
      const geocoded = await new google.maps.Geocoder().geocode({ address: query, bounds: map.current?.getBounds() });
      const place = geocoded.results[0];
      if (!place) throw new Error("No destination");
      const next = { name: place.formatted_address.split(",")[0], lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      const result = await new google.maps.DirectionsService().route({ origin, destination: { lat: next.lat, lng: next.lng }, travelMode: google.maps.TravelMode.WALKING });
      renderer.current?.setDirections(result); setDestination(next);
      const leg = result.routes[0]?.legs[0];
      setStatus(leg ? `${leg.duration?.text} · ${leg.distance?.text}` : "Route ready");
    } catch { setStatus("Place not found"); }
    finally { setRouting(false); }
  }

  function clearRoute() {
    setQuery(""); setDestination(null); setStatus(""); renderer.current?.set("directions", null);
  }

  return <main className="watch-stage"><section className="watch-case" aria-label="Pawlytics Watch map">
    <div ref={mapNode} className="watch-map" aria-label="Walking route map" />
    <form className="watch-map-search" onSubmit={search}>
      <Search size={12}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Where to?" aria-label="Search destination"/>
      {query && <button type="button" onClick={clearRoute} aria-label="Clear destination"><X size={11}/></button>}
    </form>
    <button className="watch-map-locate" onClick={() => map.current?.panTo(origin)} aria-label="Recenter map"><Crosshair size={13}/></button>
    <div className="watch-map-route">
      {status && <small>{status}</small>}
      {destination ? <a href={mapsUrl} target="_blank" rel="noreferrer"><Navigation size={12}/>Start route</a>
        : <button onClick={() => document.querySelector<HTMLInputElement>(".watch-map-search input")?.focus()} disabled={routing}><Navigation size={12}/>{routing ? "Finding route…" : "Navigate safely"}</button>}
    </div>
  </section></main>;
}
