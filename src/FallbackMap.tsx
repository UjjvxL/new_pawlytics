import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ExternalLink, X } from "lucide-react";
import type { Sighting } from "./types";

type Point = { lat: number; lng: number };
export default function FallbackMap({ sightings, location, onSelect, onMapTap }: {
  sightings: Sighting[];
  location: Point | null;
  onSelect: (sighting: Sighting) => void;
  onMapTap?: (point: Point) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const layer = useRef<L.LayerGroup>();
  const select = useRef(onSelect);
  const tap = useRef(onMapTap);
  select.current = onSelect;
  tap.current = onMapTap;
  useEffect(() => {
    if (!node.current) return;
    const instance = L.map(node.current, { zoomControl: false, attributionControl: false }).setView([20.5937, 78.9629], 5);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    L.control.attribution({ position: "bottomleft" }).addTo(instance);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => tap.current?.(event.latlng));
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(node.current);
    return () => { observer.disconnect(); instance.remove(); map.current = undefined; layer.current = undefined; };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const points: L.LatLngExpression[] = [];
    sightings.forEach(sighting => {
      const point: L.LatLngTuple = [sighting.lat, sighting.lng];
      points.push(point);
      const count = Math.max(1, sighting.dogCount || 1);
      const label = document.createElement("span");
      label.textContent = `${count} dogs reported`;
      L.circleMarker(point, { radius: Math.min(14, 6 + count), color: count >= 5 ? "#a9322b" : "#b56a13", fillColor: count >= 5 ? "#dc4c43" : "#ee9d2b", fillOpacity: .85, weight: 3, bubblingMouseEvents: false })
        .bindTooltip(label).on("click", () => select.current(sighting)).addTo(layer.current!);
    });
    if (location) {
      const point: L.LatLngTuple = [location.lat, location.lng];
      L.circleMarker(point, { radius: 7, color: "white", fillColor: "#136f63", fillOpacity: 1, weight: 3 }).bindTooltip("Your location").addTo(layer.current);
      map.current.setView(point, Math.max(map.current.getZoom(), 14));
    } else if (points.length) map.current.fitBounds(L.latLngBounds(points).pad(.2), { maxZoom: 14 });
  }, [sightings, location]);
  return <div ref={node} className="free-map-fallback" role="region" aria-label="OpenStreetMap fallback" />;
}

export function FallbackRouteSheet({ location, close }: { location: Point | null; close: () => void }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const start = location ? `${location.lat},${location.lng}` : origin.trim();
  const params = new URLSearchParams({ api: "1", origin: start, destination: destination.trim(), travelmode: "walking" });
  return <div className="scrim"><section className="sheet route-sheet" role="dialog" aria-modal="true" aria-label="Walking directions">
    <div className="sheet-title"><button onClick={close} aria-label="Close walking directions"><X /></button><div><h2>Walking directions</h2><p>Continue navigating while the map service is unavailable</p></div></div>
    {!location && <label>Starting point<input autoFocus value={origin} onChange={event => setOrigin(event.target.value)} placeholder="Street, landmark, or address" /></label>}
    <label>Destination<input autoFocus={Boolean(location)} value={destination} onChange={event => setDestination(event.target.value)} placeholder="Where are you walking?" /></label>
    <p className="medical-note">Directions open in Google Maps. Pawlytics route risk comparison is unavailable in this mode.</p>
    {start && destination.trim() && <a className="care-link" href={`https://www.google.com/maps/dir/?${params}`} target="_blank" rel="noreferrer"><ExternalLink size={18} />Open walking directions</a>}
  </section></div>;
}
