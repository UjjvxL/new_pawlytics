import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import { addDoc, collection, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth'
import { AlertTriangle, ArrowLeft, Bell, Camera, Crosshair, Download, ExternalLink, HeartPulse, LogOut, MapPin, Mic, Navigation, Plus, Search, ShieldCheck, WifiOff, X } from 'lucide-react'
import { auth, db, isFirebaseConfigured, provider, storage } from './firebase'
import type { Severity, Sighting } from './types'

const INDIA = { lat: 20.5937, lng: 78.9629 }
const riskRadius: Record<Severity, number> = { low: 250, medium: 250, high: 250 }
const riskWeight: Record<Severity, number> = { low: 1, medium: 3, high: 7 }
interface NavigationStep { instruction: string; distance: string; duration: string; end: google.maps.LatLngLiteral }
interface NavigationInfo { duration: string; distance: string; destination: string; risk: number; avoidedRisk: number; safetyEnabled: boolean; googleMapsUrl:string; firstStep: string; steps: NavigationStep[] }
interface Hotspot { id:string; lat:number; lng:number; totalDogs:number; severity:Severity; reports:Sighting[]; lastSeen:Date }

function sightingDate(value: Sighting['createdAt']) {
  if (!value) return new Date(0)
  return 'toDate' in value ? value.toDate() : value
}

function groupHotspots(reports: Sighting[]): Hotspot[] {
  const groups: Hotspot[] = []
  for (const report of [...reports].sort((a,b) => sightingDate(b.createdAt).getTime() - sightingDate(a.createdAt).getTime())) {
    const nearby = groups.find(g => google.maps.geometry.spherical.computeDistanceBetween(new google.maps.LatLng(g.lat,g.lng), new google.maps.LatLng(report.lat,report.lng)) <= 250)
    if (nearby) {
      nearby.reports.push(report); nearby.totalDogs += Math.max(1, report.dogCount || 1)
      nearby.lat = nearby.reports.reduce((n,r)=>n+r.lat,0)/nearby.reports.length; nearby.lng = nearby.reports.reduce((n,r)=>n+r.lng,0)/nearby.reports.length
      nearby.severity = nearby.totalDogs >= 5 ? 'high' : 'medium'
    } else groups.push({ id:`hotspot-${report.id}`, lat:report.lat, lng:report.lng, totalDogs:Math.max(1,report.dogCount||1), severity:(report.dogCount||1)>=5?'high':'medium', reports:[report], lastSeen:sightingDate(report.createdAt) })
  }
  return groups
}

function distanceToSegment(p: google.maps.LatLngLiteral, a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const x = p.lat, y = p.lng, x1 = a.lat, y1 = a.lng, x2 = b.lat, y2 = b.lng
  const dx = x2 - x1, dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) * 111_000
}

function routeRisk(route: google.maps.DirectionsRoute, sightings: Sighting[]) {
  const path = route.overview_path.map(p => p.toJSON())
  return sightings.reduce((score, sighting) => {
    const hit = path.slice(1).some((p, i) => distanceToSegment({ lat: sighting.lat, lng: sighting.lng }, path[i], p) < riskRadius[sighting.severity])
    return score + (hit ? riskWeight[sighting.severity] : 0)
  }, 0)
}

export default function App() {
  const mapNode = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map>()
  const renderer = useRef<google.maps.DirectionsRenderer>()
  const markers = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const riskCircles = useRef<google.maps.Circle[]>([])
  const locationMarker = useRef<google.maps.marker.AdvancedMarkerElement>()
  const accuracyCircle = useRef<google.maps.Circle>()
  const watchId = useRef<number>()
  const firstLocation = useRef(true)
  const followingRef = useRef(true)
  const reroute = useRef<((risks: Sighting[]) => Promise<void>)>()
  const [user, setUser] = useState<User | null>(null)
  const [mapsReady, setMapsReady] = useState(false)
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [reportOpen, setReportOpen] = useState(false)
  const [routeOpen, setRouteOpen] = useState(false)
  const [selected, setSelected] = useState<Hotspot | null>(null)
  const [location, setLocation] = useState<google.maps.LatLngLiteral | null>(null)
  const [locationState, setLocationState] = useState<'finding' | 'tracking' | 'denied' | 'unavailable'>('finding')
  const [following, setFollowing] = useState(true)
  const [notice, setNotice] = useState('')
  const [myReports, setMyReports] = useState<Sighting[]>([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [navigation, setNavigation] = useState<NavigationInfo | null>(null)
  const [navigationActive, setNavigationActive] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)
  const testMode = new URLSearchParams(window.location.search).has('test')
  const [manualSightings, setManualSightings] = useState<Sighting[]>([])
  const [placementMode, setPlacementMode] = useState(false)
  const [safeRouting, setSafeRouting] = useState(true)

  useEffect(() => {
    getRedirectResult(auth).catch(() => setNotice('Google sign-in could not be completed. Please retry.'))
    return onAuthStateChanged(auth, setUser)
  }, [])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (!user) { setMyReports([]); return }
    return onSnapshot(query(collection(db,'sightings'),where('reporterId','==',user.uid)), snap => setMyReports(snap.docs.map(d=>({id:d.id,...d.data()} as Sighting)).sort((a,b)=>sightingDate(b.createdAt).getTime()-sightingDate(a.createdAt).getTime()).slice(0,12)))
  }, [user])
  useEffect(() => {
    if (!isFirebaseConfigured) return
    return onSnapshot(query(collection(db, 'sightings'), where('verificationStatus', '==', 'approved')), snap => {
      setSightings(snap.docs.map(d => ({ id: d.id, ...d.data() } as Sighting)))
    }, () => setNotice('Could not load sightings. Check Firebase rules.'))
  }, [])

  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!key || !mapNode.current) return
    new Loader({ apiKey: key, version: 'weekly', libraries: ['places', 'marker', 'geometry'] }).load().then(() => {
      map.current = new google.maps.Map(mapNode.current!, {
        center: INDIA, zoom: 5, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, clickableIcons: false,
        gestureHandling: 'greedy', styles: [{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }]
      })
      renderer.current = new google.maps.DirectionsRenderer({ map: map.current, suppressMarkers: false, polylineOptions: { strokeColor: '#136f63', strokeWeight: 6 } })
      setMapsReady(true)
    }).catch(() => setNotice('Google Maps failed to load. Check the API key and enabled APIs.'))
  }, [])

  useEffect(() => {
    if (!mapsReady || !map.current) return
    if (!navigator.geolocation) { setLocationState('unavailable'); return }
    const onPosition = (pos: GeolocationPosition) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setLocation(here); setLocationState('tracking')
      if (!locationMarker.current) {
        const dot = document.createElement('div'); dot.className = 'user-location'; dot.setAttribute('aria-label', 'Your location')
        locationMarker.current = new google.maps.marker.AdvancedMarkerElement({ map: map.current, position: here, content: dot, zIndex: 999 })
        accuracyCircle.current = new google.maps.Circle({ map: map.current, center: here, radius: Math.max(pos.coords.accuracy, 15), strokeColor: '#2678e8', strokeOpacity: .25, strokeWeight: 1, fillColor: '#4285f4', fillOpacity: .12 })
      } else {
        locationMarker.current.position = here
        accuracyCircle.current?.setCenter(here); accuracyCircle.current?.setRadius(Math.max(pos.coords.accuracy, 15))
      }
      if (firstLocation.current || followingRef.current) { map.current?.panTo(here); if (firstLocation.current) map.current?.setZoom(16) }
      firstLocation.current = false
    }
    const onError = (err: GeolocationPositionError) => {
      setLocationState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
      setNotice(err.code === err.PERMISSION_DENIED ? 'Location permission is blocked. Allow location for this site in your browser settings, then tap the target button.' : 'GPS position is unavailable. Check device location services and try again.')
    }
    setLocationState('finding')
    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 })
    const listener = map.current.addListener('dragstart', () => { followingRef.current = false; setFollowing(false) })
    return () => { if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current); listener.remove() }
  }, [mapsReady])

  useEffect(() => {
    if (!mapsReady || !map.current) return
    markers.current.forEach(m => m.map = null)
    const visibleSightings = (testMode ? [...sightings, ...manualSightings] : sightings).filter(s => testMode || !s.testOnly)
    const hotspots = groupHotspots(visibleSightings)
    riskCircles.current.forEach(c => c.setMap(null))
    riskCircles.current = hotspots.map(s => new google.maps.Circle({ map: map.current, center: { lat: s.lat, lng: s.lng }, radius: 250, strokeColor: s.severity === 'high' ? '#d93025' : '#f29900', strokeOpacity: .8, strokeWeight: 2, fillColor: s.severity === 'high' ? '#ea4335' : '#fbbc04', fillOpacity: .18, clickable: false }))
    markers.current = hotspots.map(s => {
      const pin = document.createElement('button')
      pin.className = `dog-marker ${s.severity}`
      pin.innerHTML = `<span>🐕</span><b>${s.totalDogs}</b>`
      pin.setAttribute('aria-label', `${s.totalDogs} dogs, ${s.severity} risk hotspot`)
      pin.onclick = () => setSelected(s)
      const marker = new google.maps.marker.AdvancedMarkerElement({ map: map.current, position: { lat: s.lat, lng: s.lng }, content: pin })
      return marker
    })
  }, [mapsReady, sightings, testMode, manualSightings])

  useEffect(() => {
    if (!mapsReady || !map.current || !testMode || !placementMode) return
    const listener = map.current.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return
      const point = event.latLng.toJSON()
      const placed: Sighting = { id: `manual-${Date.now()}`, ...point, description: 'Manually placed test danger zone', severity: 'high', dogCount: 3, verificationStatus: 'approved' }
      const nextManual = [...manualSightings, placed]
      setManualSightings(nextManual)
      setPlacementMode(false)
      if (navigation && safeRouting && reroute.current) {
        setNotice('Dog zone placed — automatically recalculating a safe route…')
        void reroute.current([...sightings, ...nextManual])
      } else {
        renderer.current?.set('directions', null); setNavigation(null)
        setNotice('Test dog zone placed. Calculate a route to include it.')
      }
    })
    return () => listener.remove()
  }, [mapsReady, testMode, placementMode, manualSightings, navigation, safeRouting, sightings])

  function locate(move = true): Promise<google.maps.LatLngLiteral> {
    if (location) {
      if (move) { followingRef.current = true; setFollowing(true); map.current?.panTo(location); map.current?.setZoom(Math.max(map.current.getZoom() || 0, 16)) }
      return Promise.resolve(location)
    }
    setLocationState('finding')
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(pos => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setLocation(here); setLocationState('tracking')
      if (move) { followingRef.current = true; setFollowing(true); map.current?.panTo(here); map.current?.setZoom(16) }
      resolve(here)
    }, err => { setLocationState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'); setNotice('Location access is needed for reports and navigation.'); reject(err) }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }))
  }

  async function login() {
    try {
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, provider)
    } catch (err) {
      const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : ''
      if (code.includes('popup-blocked')) {
        setNotice('Popup was blocked. Continuing with secure redirect sign-in…')
        await signInWithRedirect(auth, provider)
        return
      }
      if (!code.includes('popup-closed-by-user') && !code.includes('cancelled-popup-request')) setNotice(`Google sign-in failed${code ? `: ${code.replace('auth/', '')}` : ''}.`)
    }
  }

  const activeRisk = useMemo(() => (testMode ? [...sightings, ...manualSightings] : sightings).filter(s => (testMode || !s.testOnly) && (() => {
    if (!s.expiresAt) return true
    const date = 'toDate' in s.expiresAt ? s.expiresAt.toDate() : s.expiresAt
    return date > new Date()
  })()), [sightings, testMode, manualSightings])

  return <main className="app-shell">
    <div ref={mapNode} className="map" />
    {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && <div className="setup-state"><div className="brand-mark">P</div><h1>Welcome to Pawlytics</h1><p>Add your API keys to <code>.env</code> to load the live map.</p></div>}

    <header className="topbar">
      <div className="brand"><div className="brand-mark">P</div><span>Pawlytics</span></div>
      {user ? <div className="profile-actions"><button className="notification-button" onClick={()=>setNotificationsOpen(v=>!v)} aria-label="Report notifications"><Bell size={20}/>{myReports.some(r=>r.verificationStatus==='pending')&&<i/>}</button><button className="avatar-button" onClick={() => signOut(auth)} title="Sign out">{user.photoURL ? <img src={user.photoURL} /> : <LogOut size={18} />}</button></div> : <button className="login-button" onClick={login}>Sign in</button>}
    </header>
    {notificationsOpen && user && <ReportsPanel reports={myReports} close={()=>setNotificationsOpen(false)}/>}
    {!online && <div className="offline-chip"><WifiOff size={14}/>Offline · saved map shell only</div>}

    <button className="search-bar" onClick={() => setRouteOpen(true)}><Search size={20}/><span>Where do you want to go?</span></button>
    <div className="map-actions"><button className={following && location ? 'following' : ''} onClick={() => locate()} aria-label="My location"><Crosshair size={21}/></button></div>
    {locationState !== 'tracking' && <div className={`location-status ${locationState}`}><span className="location-spinner"/><div><strong>{locationState === 'finding' ? 'Finding your location…' : locationState === 'denied' ? 'Location permission blocked' : 'GPS unavailable'}</strong><small>{locationState === 'denied' ? 'Allow location in browser settings, then tap the target.' : locationState === 'unavailable' ? 'Turn on device location services.' : 'For accurate routes and reports'}</small></div></div>}
    <div className="risk-chip"><ShieldCheck size={17}/><strong>{activeRisk.length}</strong> active sighting{activeRisk.length === 1 ? '' : 's'} nearby</div>
    {testMode && <div className="demo-chip">Manual route testing</div>}
    {testMode && <section className="demo-controls"><strong>Route tester</strong><button className={placementMode ? 'placing' : ''} onClick={() => setPlacementMode(v => !v)}><Plus size={16}/>{placementMode ? 'Tap map…' : 'Place dog'}</button><label><span>Safe route</span><input type="checkbox" checked={safeRouting} onChange={e => { setSafeRouting(e.target.checked); renderer.current?.set('directions', null); setNavigation(null); setNotice(e.target.checked ? 'Safety avoidance is ON. Calculate a route.' : 'Safety avoidance is OFF. The default Google route will be shown.') }}/><i/></label><button className="clear-dogs" disabled={!manualSightings.length} onClick={() => { setManualSightings([]); renderer.current?.set('directions', null); setNavigation(null) }}>Clear placed</button></section>}

    {navigation && navigationActive && <section className="turn-banner"><Navigation size={30}/><div><small>Next</small><strong dangerouslySetInnerHTML={{ __html: navigation.firstStep }}/><span>{navigation.distance} remaining · {navigation.duration}</span></div></section>}
    {navigation && <section className={stepsOpen ? 'navigation-card expanded' : 'navigation-card'}><button className="card-close" onClick={() => { renderer.current?.set('directions', null); setNavigation(null); setNavigationActive(false); setStepsOpen(false) }}><X size={18}/></button><div className="nav-summary"><div className="nav-eta">{navigation.duration}</div><div className="nav-details"><strong>{navigation.destination}</strong><span>{navigation.distance} · {navigation.risk === 0 ? 'No active hotspots on route' : `${navigation.risk} risk points on ${navigation.safetyEnabled ? 'safest' : 'default'} route`}</span>{navigation.avoidedRisk > 0 && <em>Shield avoided {navigation.avoidedRisk} danger-risk points</em>}<small dangerouslySetInnerHTML={{ __html: navigation.firstStep }}/></div></div><div className="nav-controls"><a className="google-maps-start" href={navigation.googleMapsUrl} target="_blank" rel="noreferrer" aria-label="Start this route in Google Maps"><Navigation size={18}/><span>Start in Google Maps</span></a><button onClick={() => setStepsOpen(v => !v)}>{stepsOpen ? 'Hide steps' : 'Preview steps'}</button></div>{stepsOpen && <ol className="step-list">{navigation.steps.map((step, i) => <li key={i}><span>{i + 1}</span><div><p dangerouslySetInnerHTML={{ __html: step.instruction }}/><small>{step.distance} · {step.duration}</small></div></li>)}</ol>}</section>}
    <nav className={navigation ? 'bottom-actions route-active' : 'bottom-actions'}>
      <button className="navigate-button" onClick={() => setRouteOpen(true)}><Navigation size={22} fill="currentColor"/>Navigate safely</button>
      <button className="safety-button" onClick={() => setSafetyOpen(true)}><HeartPulse size={22}/><span>Safety</span></button>
      <button className="report-button" onClick={() => user ? setReportOpen(true) : login()}><Plus size={25}/><span>Report</span></button>
    </nav>

    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}
    {routeOpen && <RouteSheet map={map.current} renderer={renderer.current} sightings={activeRisk} currentLocation={location} locate={locate} close={() => setRouteOpen(false)} setNotice={setNotice} setNavigation={setNavigation} safeRouting={safeRouting} onRouteReady={fn => { reroute.current = fn }}/>} 
    {reportOpen && user && <ReportSheet user={user} initialLocation={location} locate={locate} close={() => setReportOpen(false)} onStatus={setNotice}/>} 
    {safetyOpen && <SafetySheet location={location} close={()=>setSafetyOpen(false)}/>}
    {selected && <HotspotCard hotspot={selected} close={() => setSelected(null)}/>} 
  </main>
}

function RouteSheet({ map, renderer, sightings, currentLocation, locate, close, setNotice, setNavigation, safeRouting, onRouteReady }: { map?: google.maps.Map, renderer?: google.maps.DirectionsRenderer, sightings: Sighting[], currentLocation: google.maps.LatLngLiteral | null, locate: () => Promise<google.maps.LatLngLiteral>, close: () => void, setNotice: (v: string) => void, setNavigation: (v: NavigationInfo) => void, safeRouting: boolean, onRouteReady: (fn: (risks: Sighting[]) => Promise<void>) => void }) {
  const destinationRef = useRef<HTMLInputElement>(null)
  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken>()
  const [routing, setRouting] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [suggestions, setSuggestions] = useState<google.maps.places.PlacePrediction[]>([])
  useEffect(() => {
    if (searchText.trim().length < 2) { setSuggestions([]); return }
    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary
        if (!sessionToken.current) sessionToken.current = new AutocompleteSessionToken()
        const result = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: searchText, sessionToken: sessionToken.current, origin: currentLocation || undefined, locationBias: map?.getBounds() || undefined, language: navigator.language || 'en' })
        setSuggestions(result.suggestions.flatMap(s => s.placePrediction ? [s.placePrediction] : []).slice(0, 6))
      } catch (err) { console.error('Autocomplete failed', err); setSuggestions([]) }
    }, 220)
    return () => window.clearTimeout(timer)
  }, [searchText, currentLocation, map])
  async function selectSuggestion(prediction: google.maps.places.PlacePrediction) {
    setSearchText(prediction.text.toString()); setSuggestions([])
    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] })
      sessionToken.current = undefined
      if (!place.location) throw new Error('Place has no location')
      await navigate(place.location)
    } catch { setNotice('Could not load that destination. Please try another result.') }
  }
  async function search(e: React.FormEvent) {
    e.preventDefault()
    const text = destinationRef.current?.value.trim()
    if (!text) return
    try {
      const result = await new google.maps.Geocoder().geocode({ address: text, bounds: map?.getBounds() })
      if (!result.results[0]) throw new Error('No result')
      await navigate(result.results[0].geometry.location)
    } catch { setNotice('Destination not found. Add an area or city and try again.') }
  }
  async function navigate(destination: google.maps.LatLng | string, routeSightings = sightings) {
    setRouting(true)
    try {
      const origin = currentLocation || await locate()
      const service = new google.maps.DirectionsService()
      const result = await service.route({ origin, destination, travelMode: google.maps.TravelMode.WALKING, provideRouteAlternatives: true })
      type Candidate = { result: google.maps.DirectionsResult; i: number; score: number; seconds: number }
      const candidates: Candidate[] = result.routes.map((route, i) => ({ result, i, score: routeRisk(route, routeSightings), seconds: route.legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0) }))
      const baselineRisk = candidates[0].score
      if (safeRouting && baselineRisk > 0 && destination instanceof google.maps.LatLng) {
        const destinationPoint = destination.toJSON()
        const latitudeScale = Math.max(.25, Math.cos(origin.lat * Math.PI / 180))
        const north = destinationPoint.lat - origin.lat
        const east = (destinationPoint.lng - origin.lng) * latitudeScale
        const length = Math.hypot(north, east) || 1
        const dangerous = routeSightings.filter(s => routeRisk(result.routes[0], [s]) > 0).slice(0, 3)
        const detourRequests = dangerous.flatMap(s => [-1, 1].map(side => {
          const offset = (riskRadius[s.severity] * 2.2) / 111_000
          const point = { lat: s.lat + side * (-east / length) * offset, lng: s.lng + side * (north / length) * offset / latitudeScale }
          return service.route({ origin, destination, travelMode: google.maps.TravelMode.WALKING, provideRouteAlternatives: false, waypoints: [{ location: point, stopover: false }] })
        }))
        const detours = await Promise.allSettled(detourRequests)
        detours.forEach(response => {
          if (response.status !== 'fulfilled') return
          response.value.routes.forEach((route, i) => candidates.push({ result: response.value, i, score: routeRisk(route, routeSightings), seconds: route.legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0) }))
        })
      }
      const chosen = safeRouting ? candidates.sort((a, b) => a.score - b.score || a.seconds - b.seconds)[0] : candidates[0]
      renderer?.setDirections(chosen.result); renderer?.setRouteIndex(chosen.i)
      const leg = chosen.result.routes[chosen.i].legs[0]
      const avoidedRisk = safeRouting ? Math.max(0, baselineRisk - chosen.score) : 0
      const selectedPath = chosen.result.routes[chosen.i].overview_path
      const waypoints = [1,2,3].map(part => selectedPath[Math.min(selectedPath.length-2, Math.max(1, Math.floor(selectedPath.length*part/4)))].toUrlValue(6)).join('|')
      const mapsParams = new URLSearchParams({ api:'1', destination:leg.end_location.toUrlValue(6), travelmode:'walking', dir_action:'navigate', waypoints })
      const googleMapsUrl = `https://www.google.com/maps/dir/?${mapsParams.toString()}`
      setNavigation({ duration: leg.duration?.text || '—', distance: leg.distance?.text || '—', destination: leg.end_address, risk: chosen.score, avoidedRisk, safetyEnabled: safeRouting, googleMapsUrl, firstStep: leg.steps[0]?.instructions || 'Follow the highlighted route', steps: leg.steps.map(step => ({ instruction: step.instructions, distance: step.distance?.text || '', duration: step.duration?.text || '', end: step.end_location.toJSON() })) })
      setNotice(!safeRouting ? `Default route shown with ${chosen.score} danger-risk points — safety avoidance is OFF.` : avoidedRisk > 0 ? `Safer alternative selected — avoided ${avoidedRisk} danger-risk points.` : chosen.score ? 'Safest available route shown — it still passes near a reported sighting.' : 'Safer route selected. Stay alert to changing conditions.')
      onRouteReady(async risks => navigate(destination, risks))
      map?.fitBounds(chosen.result.routes[chosen.i].bounds); close()
    } catch { setNotice('Could not calculate that route. Try a more specific destination.') } finally { setRouting(false) }
  }
  return <div className="scrim"><section className="sheet route-sheet"><div className="sheet-handle"/><div className="sheet-title"><button onClick={close}><ArrowLeft/></button><div><h2>Safe navigation</h2><p>Routes are ranked by verified sightings</p></div></div><form className="route-input" onSubmit={search}><MapPin size={21}/><input ref={destinationRef} value={searchText} onChange={e => setSearchText(e.target.value)} autoFocus placeholder="Search for a destination" autoComplete="off"/><button disabled={routing} aria-label="Find route"><Navigation size={19}/></button></form>{suggestions.length > 0 && <div className="suggestions">{suggestions.map((prediction, i) => <button key={`${prediction.placeId}-${i}`} onClick={() => selectSuggestion(prediction)}><MapPin size={18}/><span>{prediction.text.toString()}</span></button>)}</div>}{routing && <div className="progress">Finding the safest route…</div>}<div className="route-note"><ShieldCheck/><div><strong>Community-aware routing</strong><p>Pawlytics compares available walking routes and reduces exposure to active dog hotspots.</p></div></div></section></div>
}

async function optimizePhoto(file: File): Promise<File> {
  // Preserve original EXIF location/time whenever it fits the upload limit.
  if (file.size < 10_000_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(new Error('Photo compression failed')), 'image/jpeg', .82))
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

function ReportSheet({ user, initialLocation, locate, close, onStatus }: { user: User, initialLocation: google.maps.LatLngLiteral | null, locate: () => Promise<google.maps.LatLngLiteral>, close: () => void, onStatus: (v: string) => void }) {
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoSource, setPhotoSource] = useState<'camera'|'library'>('library')
  const [preview, setPreview] = useState('')
  const [listening, setListening] = useState(false)
  const [speechLanguage, setSpeechLanguage] = useState(navigator.language.startsWith('fr') ? 'fr-CA' : navigator.language.startsWith('hi') ? 'hi-IN' : 'en-CA')
  const [saving, setSaving] = useState(false)
  const [stage, setStage] = useState('')
  function dictate() {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any, webkitSpeechRecognition?: new () => any }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition
    if (!SpeechRecognition) return onStatus('Speech-to-text is not supported in this browser.')
    const recognition = new SpeechRecognition(); recognition.lang = speechLanguage; recognition.interimResults = true
    recognition.onstart = () => setListening(true); recognition.onend = () => setListening(false)
    recognition.onerror = () => { setListening(false); onStatus('Voice input stopped. Check microphone permission and try again.') }
    recognition.onresult = (e: any) => setDescription(Array.from(e.results).map((r: any) => r[0].transcript).join(' '))
    recognition.start()
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!photo) return onStatus('Please add a current photo so AI can verify the report.')
    if (description.trim().length < 10) return onStatus('Please describe what you saw in a little more detail.')
    setSaving(true)
    let currentStage = 'Getting precise location…'
    try {
      setStage(currentStage)
      const position = initialLocation || await locate()
      currentStage = 'Saving report…'; setStage(currentStage)
      const draft = await addDoc(collection(db, 'sightings'), { ...position, description: description.trim(), severity, reporterId: user.uid, reporterName: user.displayName, reporterEmail: user.email, photoSource, verificationStatus: 'pending', processingStatus: 'awaiting-image', createdAt: serverTimestamp() })
      currentStage = 'Preparing photo…'; setStage(currentStage)
      const preparedPhoto = await optimizePhoto(photo)
      if (preparedPhoto.size > 10 * 1024 * 1024) throw new Error('PHOTO_TOO_LARGE')
      currentStage = 'Uploading photo…'; setStage(currentStage)
      const imageRef = ref(storage, `sightings/${user.uid}/${draft.id}/${Date.now()}-${preparedPhoto.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
      await uploadBytes(imageRef, preparedPhoto, { contentType: preparedPhoto.type })
      const imageUrl = await getDownloadURL(imageRef)
      currentStage = 'Queuing verification…'; setStage(currentStage)
      await updateDoc(draft, { imageUrl, processingStatus:'queued' })
      close(); onStatus('Report submitted. Gemini will verify it in the background—check the bell for the result.')
    } catch (err) { console.error(err); const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : ''; const message = err instanceof Error ? err.message : ''; onStatus(message === 'PHOTO_TOO_LARGE' ? 'That photo is too large. Choose a smaller image.' : code.includes('unauthenticated') ? 'Your session expired. Sign in again and retry.' : code.includes('permission-denied') || code.includes('unauthorized') ? 'Upload permission was denied. Sign out, sign in, and retry.' : `Submission stopped during “${currentStage}”. ${code || message || 'Please retry.'}`) } finally { setSaving(false); setStage('') }
  }
  return <div className="scrim"><section className="sheet report-sheet"><div className="sheet-handle"/><div className="sheet-title"><button onClick={close}><X/></button><div><h2>Report a dog sighting</h2><p>Your report will be checked by AI</p></div></div><form onSubmit={submit}>
    <div className="voice-heading"><label className="field-label">What is happening?</label><select value={speechLanguage} onChange={e=>setSpeechLanguage(e.target.value)} aria-label="Voice language"><option value="en-CA">English (Canada)</option><option value="en-IN">English (India)</option><option value="hi-IN">हिन्दी</option><option value="mr-IN">मराठी</option><option value="fr-CA">Français</option></select></div><div className="textarea-wrap"><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Example: Three street dogs are barking and chasing cyclists near the gate…" maxLength={500}/><button type="button" className={listening ? 'mic active' : 'mic'} onClick={dictate} aria-label={`Dictate report in ${speechLanguage}`}><Mic size={20}/></button></div>
    <label className="field-label">How risky does it feel?</label><div className="severity-picker">{(['low','medium','high'] as Severity[]).map(v => <button type="button" key={v} className={severity === v ? `selected ${v}` : ''} onClick={() => setSeverity(v)}>{v === 'low' ? 'Calm' : v === 'medium' ? 'Alert' : 'Danger'}</button>)}</div>
    <div className={preview ? 'photo-picker has-photo' : 'photo-picker'}>{preview ? <img src={preview}/> : <><Camera size={30}/><strong>Add a current photo</strong><span>Original GPS metadata helps verify the location</span></>}</div>
    <div className="photo-actions"><label><Camera size={18}/>Take photo<input type="file" accept="image/*" capture="environment" onChange={e => { const f=e.target.files?.[0]; if(f){setPhotoSource('camera');setPhoto(f);setPreview(URL.createObjectURL(f))} }}/></label><label><Plus size={18}/>Photo library<input type="file" accept="image/*" onChange={e => { const f=e.target.files?.[0]; if(f){setPhotoSource('library');setPhoto(f);setPreview(URL.createObjectURL(f))} }}/></label></div>
    {photo && <p className="photo-evidence">{photoSource==='camera'?'Live camera capture: current app GPS will be used.':'Library photo: embedded Apple/EXIF GPS will be checked when available.'}</p>}
    <div className="location-confirm"><MapPin/><div><strong>Current location attached</strong><span>Location and time help prevent false reports</span></div></div>
    <button className="submit-report" disabled={saving}>{saving ? stage : 'Submit for verification'}</button>
  </form></section></div>
}

function HotspotCard({ hotspot, close }: { hotspot: Hotspot, close: () => void }) {
  const [reportIndex, setReportIndex] = useState(0)
  const report = hotspot.reports[reportIndex]
  const ageMinutes = Math.max(0, Math.round((Date.now() - sightingDate(report.createdAt).getTime()) / 60000))
  const age = ageMinutes < 60 ? `${ageMinutes} min ago` : `${Math.round(ageMinutes/60)} hr ago`
  return <section className="sighting-card hotspot-card"><button className="card-close" onClick={close}><X size={18}/></button><header><span className={`risk-label ${hotspot.severity}`}><AlertTriangle size={14}/>{hotspot.totalDogs >= 5 ? 'Red zone' : 'Yellow zone'}</span><h3>{hotspot.totalDogs} dogs reported within 250 m</h3><p>{hotspot.reports.length} verified report{hotspot.reports.length===1?'':'s'} · Last seen {age}</p><div className="risk-explanation"><ShieldCheck size={15}/><span><strong>Why this risk:</strong> {hotspot.totalDogs >= 5 ? 'a pack of 5+ dogs is active in this zone' : 'recent verified dog activity is inside the route buffer'}. Confidence: {hotspot.reports.length >= 3 ? 'high' : hotspot.reports.length === 2 ? 'moderate' : 'limited'}.</span></div></header>{hotspot.reports.length > 1 && <div className="report-tabs">{hotspot.reports.map((_,i)=><button className={i===reportIndex?'active':''} key={i} onClick={()=>setReportIndex(i)}>{i+1}</button>)}</div>}<div className="report-detail">{report.imageUrl ? <img src={report.imageUrl} alt="Verified dog report"/> : <div className="no-photo">🐕</div>}<div><strong>{report.dogCount || 1} dog{(report.dogCount||1)===1?'':'s'} · {report.observedBehavior || report.severity}</strong><p>{report.aiSummary || report.description}</p><dl><div><dt>Reported</dt><dd>{sightingDate(report.createdAt).toLocaleString()}</dd></div><div><dt>Location</dt><dd>{report.lat.toFixed(5)}, {report.lng.toFixed(5)}</dd></div><div><dt>Evidence</dt><dd>{report.locationEvidence || 'AI verified'}{report.aiConfidence ? ` · ${Math.round(report.aiConfidence*100)}% confidence` : ''}</dd></div></dl>{report.testOnly && <small className="test-label">Developer test report</small>}</div></div><footer>Stay alert and give street dogs space. Conditions can change quickly.</footer></section>
}

function ReportsPanel({ reports, close }: { reports:Sighting[], close:()=>void }) {
  const approved = reports.filter(r=>r.verificationStatus==='approved').length
  function downloadReceipt(report:Sighting) {
    const receipt = { reportId:report.id, status:report.verificationStatus, submittedAt:sightingDate(report.createdAt).toISOString(), location:{lat:report.lat,lng:report.lng}, description:report.description, aiSummary:report.aiSummary, aiConfidence:report.aiConfidence, evidence:report.locationEvidence }
    const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'})); const link=document.createElement('a'); link.href=url; link.download=`pawlytics-${report.id}.json`; link.click(); URL.revokeObjectURL(url)
  }
  return <section className="notification-panel reports-panel"><header><div><strong>My reports</strong><small>{reports.length} submitted · {approved} verified</small></div><button onClick={close}><X size={17}/></button></header>{reports.length===0?<p>No reports yet.</p>:reports.map(r=><article key={r.id}>{r.imageUrl&&<img src={r.imageUrl} alt="Report evidence"/>}<span className={`status-dot ${r.verificationStatus}`}/><div><strong>{r.verificationStatus==='pending'?'Gemini verification in progress':r.verificationStatus==='approved'?'Verified and protecting routes':'Not added to the map'}</strong><p>{r.verificationStatus==='pending'?'Your upload is safely queued. You can close Pawlytics.':r.aiReason||r.aiSummary||r.description}</p><small>{sightingDate(r.createdAt).toLocaleString()} · {r.lat?.toFixed(4)}, {r.lng?.toFixed(4)}</small><div className="report-links"><a href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`} target="_blank" rel="noreferrer"><MapPin size={12}/>Map</a><button onClick={()=>downloadReceipt(r)}><Download size={12}/>Receipt</button></div></div></article>)}</section>
}

function SafetySheet({ location, close }: { location:google.maps.LatLngLiteral|null, close:()=>void }) {
  const query = location ? `anti-rabies vaccine clinic near ${location.lat},${location.lng}` : 'anti-rabies vaccine clinic near me'
  return <div className="scrim"><section className="sheet safety-sheet"><div className="sheet-handle"/><div className="sheet-title"><button onClick={close}><X/></button><div><h2>Dog safety & bite help</h2><p>Fast guidance when every minute matters</p></div></div><div className="emergency-card"><HeartPulse/><div><strong>Bitten or scratched?</strong><p>Wash and flush every wound with soap and running water for at least 15 minutes. Seek urgent medical care immediately for rabies post-exposure assessment—do not wait for symptoms.</p></div></div><ol className="first-aid"><li><b>1</b><span><strong>Wash for 15 minutes</strong>Use plenty of soap and running water.</span></li><li><b>2</b><span><strong>Apply antiseptic if available</strong>Use an iodine-containing or similarly virucidal preparation.</span></li><li><b>3</b><span><strong>Get medical care now</strong>A clinician must assess rabies vaccine and immunoglobulin needs.</span></li></ol><a className="care-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer"><MapPin/>Find nearby rabies care in Google Maps<ExternalLink size={16}/></a><section className="approach-guide"><h3>If a dog approaches</h3><p>Stay calm. Do not run, scream, stare directly, or make sudden movements. Stand sideways, keep your arms still, and slowly create distance. Use a bag or umbrella as a barrier if needed.</p></section><p className="medical-note">Emergency numbers vary by country. Call local emergency services for severe bleeding, injuries, or immediate danger. This guide does not replace professional medical care.</p><a className="who-link" href="https://www.who.int/news-room/fact-sheets/detail/rabies" target="_blank" rel="noreferrer">WHO rabies guidance <ExternalLink size={13}/></a></section></div>
}
