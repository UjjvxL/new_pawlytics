type RouteMeasure = { value: number; text: string };
type WalkingStep = {
  instructions: string;
  distance: RouteMeasure;
  duration: RouteMeasure;
  end_location: google.maps.LatLng;
};

export type WalkingRoute = {
  nativeRoute: google.maps.routes.Route;
  bounds: google.maps.LatLngBounds;
  overview_path: google.maps.LatLng[];
  legs: {
    duration: RouteMeasure;
    distance: RouteMeasure;
    end_location: google.maps.LatLng;
    end_address: string;
    steps: WalkingStep[];
  }[];
};

export type WalkingRoutesResult = { routes: WalkingRoute[] };
type WalkingRequest = {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLng | google.maps.LatLngLiteral | string;
  provideRouteAlternatives?: boolean;
  waypoints?: { location: google.maps.LatLngLiteral; stopover: boolean }[];
};

function distance(value: number, text?: string | null): RouteMeasure {
  return { value, text: text || (value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`) };
}

function duration(millis: number | null | undefined, text?: string | null): RouteMeasure {
  return { value: (millis || 0) / 1000, text: text || `${Math.max(1, Math.round((millis || 0) / 60000))} min` };
}

export async function computeWalkingRoutes(request: WalkingRequest): Promise<WalkingRoutesResult> {
  const { Route } = await google.maps.importLibrary("routes") as google.maps.RoutesLibrary;
  const { routes } = await Route.computeRoutes({
    origin: request.origin,
    destination: request.destination,
    travelMode: "WALKING",
    computeAlternativeRoutes: Boolean(request.provideRouteAlternatives && !request.waypoints?.length),
    intermediates: request.waypoints?.map(point => ({ location: point.location, via: !point.stopover })),
    polylineQuality: "HIGH_QUALITY",
    fields: ["path", "legs", "viewport", "localizedValues", "distanceMeters", "durationMillis"],
  });
  const normalized = (routes || []).filter(route => route.path?.length && route.legs?.length).map(route => ({
    nativeRoute: route,
    bounds: route.viewport || route.path!.reduce((bounds, point) => bounds.extend(point), new google.maps.LatLngBounds()),
    overview_path: route.path!.map(point => new google.maps.LatLng(point.lat, point.lng)),
    legs: route.legs!.map(leg => ({
      duration: duration(leg.durationMillis ?? leg.staticDurationMillis, leg.localizedValues?.duration),
      distance: distance(leg.distanceMeters, leg.localizedValues?.distance),
      end_location: new google.maps.LatLng(leg.endLocation || route.path![route.path!.length - 1]),
      end_address: typeof request.destination === "string" ? request.destination : "Destination",
      steps: leg.steps.map(step => ({
        instructions: step.instructions || "Continue along the route",
        distance: distance(step.distanceMeters, step.localizedValues?.distance),
        duration: duration(step.staticDurationMillis, step.localizedValues?.staticDuration),
        end_location: new google.maps.LatLng(step.endLocation || leg.endLocation || route.path![route.path!.length - 1]),
      })),
    })),
  }));
  if (!normalized.length) throw new Error("No walking route was found for these locations.");
  return { routes: normalized };
}

export class WalkingRouteRenderer {
  private polylines: google.maps.Polyline[] = [];
  private markers: google.maps.marker.AdvancedMarkerElement[] = [];
  private revision = 0;

  constructor(private map: google.maps.Map) {}

  clear() {
    this.revision++;
    this.polylines.forEach(line => line.setMap(null));
    this.markers.forEach(marker => { marker.map = null; });
    this.polylines = [];
    this.markers = [];
  }

  async show(route: WalkingRoute) {
    this.clear();
    const revision = this.revision;
    this.polylines = route.nativeRoute.createPolylines({
      polylineOptions: { strokeColor: "#136f63", strokeWeight: 6 },
    });
    this.polylines.forEach(line => line.setMap(this.map));
    const bounds = new google.maps.LatLngBounds();
    route.overview_path.forEach(point => bounds.extend(point));
    this.map.fitBounds(bounds, 60);
    const markers = await route.nativeRoute.createWaypointAdvancedMarkers();
    if (this.revision !== revision) return;
    this.markers = markers;
    markers.forEach(marker => { marker.map = this.map; });
  }
}
