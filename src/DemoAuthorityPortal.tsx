import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, Building2, CheckCircle2, ChevronRight,
  CircleDot, Clock3, Download, HeartPulse, Hospital, MapPin, PawPrint,
  Radio, ShieldCheck, Siren, Stethoscope, Syringe, Users, X,
} from "lucide-react";
import { exportAuthorityPdf } from "./exportPdf";
import PawLogo from "./PawLogo";
import { DEMO_CARE_NETWORK, DEMO_DISTRICTS, DEMO_INCIDENTS, DEMO_TEAMS, DEMO_WEEKS } from "./demoAuthorityData";

type DemoTab = "command" | "districts" | "incidents" | "abc" | "network" | "wards";

export default function DemoAuthorityPortal() {
  const [tab, setTab] = useState<DemoTab>("command");
  const [district, setDistrict] = useState("NCR Region");
  const [admin, setAdmin] = useState("nirmalnpatel54321@gmail.com");
  const [selectedIncident, setSelectedIncident] = useState<(typeof DEMO_INCIDENTS)[number] | null>(null);
  const [dispatches, setDispatches] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const filteredDistricts = useMemo(() => district === "NCR Region" ? DEMO_DISTRICTS : DEMO_DISTRICTS.filter((item) => item.name === district), [district]);
  const exportSnapshot = async () => {
    try {
      await exportAuthorityPdf("NCR presentation snapshot", [
        "Illustrative sample records only. No real dispatch or clinical integration.",
        ...filteredDistricts.map(d => `${d.name} | Index ${d.score} | ABC ${d.sterilized}% | ARV ${d.vaccinated}%`),
        ...DEMO_INCIDENTS.map(i => `${i.id} | ${i.type} | ${i.area} | ${i.severity}`),
      ], true);
      setNotice("Sample PDF downloaded.");
    } catch { setNotice("PDF could not be generated. Please retry."); }
  };
  const tabs: Array<[DemoTab, string, React.ReactNode]> = [
    ["command", "Command center", <Activity size={17} />],
    ["districts", "District performance", <BarChart3 size={17} />],
    ["wards", "Ward risk", <MapPin size={17} />],
    ["incidents", "Bites & incidents", <Siren size={17} />],
    ["abc", "ABC & rabies", <Syringe size={17} />],
    ["network", "Care network", <Hospital size={17} />],
  ];
  return (
    <main className="demo-authority-shell">
      <aside className="da-sidebar">
        <a href="/demo" className="da-brand"><span><PawLogo size={19} color="white" /></span><div><strong>Pawlytics</strong><small>NCR Unified Command</small></div></a>
        <div className="da-live"><i /> LIVE DEMO <small>Simulated data</small></div>
        <nav>{tabs.map(([id, label, icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{icon}<span>{label}</span>{id === "incidents" && <b>5</b>}</button>)}</nav>
        <div className="da-ecosystem"><small>CONNECTED ECOSYSTEM</small><span>18 municipalities</span><span>64 hospitals & ARV centres</span><span>31 NGOs · 126 field teams</span><span>284K citizen accounts</span></div>
        <footer><ShieldCheck size={16} /><div><strong>Sample presenter</strong><select value={admin} onChange={(event) => setAdmin(event.target.value)}><option>nirmalnpatel54321@gmail.com</option><option>ujjvalxix19@gmail.com</option></select></div></footer>
      </aside>
      <section className="da-main"><div className="da-presentation-banner"><strong>Presentation mode · sample data</strong><span>No real dispatches, verified evidence or medical records.</span><a href="/authority/live">Staff sign-in</a><a href="/demo">Citizen demo</a></div>
        <header><div><small>NCR / UNIFIED OPERATIONS</small><h1>{tabs.find(([id]) => id === tab)?.[1]}</h1><p>Stray-dog safety, public health and humane population management</p></div><div className="da-head-actions"><select value={district} onChange={(event) => setDistrict(event.target.value)}><option>NCR Region</option>{DEMO_DISTRICTS.map((item) => <option key={item.name}>{item.name}</option>)}</select><button onClick={() => void exportSnapshot()}><Download size={15} /> Export PDF</button></div></header>
        {notice && <div className="da-notice"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}
        {tab === "command" && <CommandCenter openIncident={setSelectedIncident} dispatches={dispatches} />}
        {tab === "districts" && <DistrictPerformance districts={filteredDistricts} />}
        {tab === "wards" && <DemoWardRisk />}
        {tab === "incidents" && <IncidentOperations openIncident={setSelectedIncident} dispatches={dispatches} />}
        {tab === "abc" && <AbcOperations />}
        {tab === "network" && <CareNetwork />}
      </section>
      {selectedIncident && <IncidentDrawer incident={selectedIncident} dispatched={dispatches.includes(selectedIncident.id)} close={() => setSelectedIncident(null)} dispatch={() => { setDispatches((items) => [...new Set([...items, selectedIncident.id])]); setNotice(`Demo dispatch simulated for ${selectedIncident.area}. No team was contacted.`); setSelectedIncident(null); }} />}
    </main>
  );
}

function Kpis() {
  return <div className="da-kpis">
    <article><span className="teal"><PawPrint /></span><div><small>Mapped street dogs</small><strong>225,000</strong><em>91.3% census coverage</em></div></article>
    <article><span className="red"><HeartPulse /></span><div><small>Bites this month</small><strong>1,449</strong><em className="good">↓ 12.4% vs last month</em></div></article>
    <article><span className="blue"><Syringe /></span><div><small>ABC coverage</small><strong>61.8%</strong><em>12,840 due this quarter</em></div></article>
    <article><span className="amber"><Clock3 /></span><div><small>Median response</small><strong>28 min</strong><em className="good">↓ 9 min since launch</em></div></article>
  </div>;
}

function CommandCenter({ openIncident, dispatches }: { openIncident: (incident: (typeof DEMO_INCIDENTS)[number]) => void; dispatches: string[] }) {
  return <><Kpis /><div className="da-command-grid">
    <section className="da-card da-risk-map"><div className="da-card-title"><div><h2>Sample NCR risk intelligence</h2><p>Illustrative ward signals · open the citizen map for the interactive view</p></div><span><Radio size={14} /> Sample</span></div><div className="da-map-canvas"><div className="da-road r1"/><div className="da-road r2"/><div className="da-road r3"/><i className="heat h1"/><i className="heat h2"/><i className="heat h3"/><i className="heat h4"/><div className="map-label l1">NOIDA</div><div className="map-label l2">GREATER NOIDA</div><div className="map-label l3">DELHI</div><div className="da-map-stat"><strong>96</strong><span>active hotspots</span></div></div><div className="da-map-legend"><span><i className="critical"/>Critical</span><span><i className="high"/>High</span><span><i className="managed"/>Managed</span><a href="/demo">Open operational map <ChevronRight size={14}/></a></div></section>
    <section className="da-card"><div className="da-card-title"><div><h2>Priority response queue</h2><p>Ranked by injury risk, confidence and vulnerability</p></div><b>5 samples</b></div><div className="da-incident-list">{DEMO_INCIDENTS.slice(0,4).map((incident) => <button key={incident.id} onClick={() => openIncident(incident)}><img src={incident.image}/><div><strong>{incident.type}</strong><span><MapPin size={11}/>{incident.area}</span><small>{incident.age} · AI {incident.confidence}%</small></div><em className={incident.severity}>{dispatches.includes(incident.id) ? "SIMULATED" : incident.severity}</em></button>)}</div></section>
    <section className="da-card da-trend"><div className="da-card-title"><div><h2>Verified reports</h2><p>12-week citizen signal volume</p></div><strong>+18.6%</strong></div><div className="da-bars">{DEMO_WEEKS.map((value,index)=><i key={index} style={{height:`${value}%`}}><small>{index % 3 === 0 ? `W${index+1}` : ""}</small></i>)}</div></section>
    <section className="da-card"><div className="da-card-title"><div><h2>Teams in motion</h2><p>Cross-agency response visibility</p></div><span>4 / 126</span></div><div className="da-team-list">{DEMO_TEAMS.map(team=><article key={team.name}><div><strong>{team.name}</strong><span>{team.task} · {team.area}</span></div><small>{team.eta}</small><i><b style={{width:`${team.progress}%`}}/></i></article>)}</div></section>
  </div></>;
}

function DistrictPerformance({ districts }: { districts: readonly (typeof DEMO_DISTRICTS)[number][] }) {
  return <div className="da-page-grid"><section className="da-card da-wide"><div className="da-card-title"><div><h2>Municipal performance index</h2><p>Weighted: response 30% · ABC 25% · vaccination 25% · bite reduction 20%</p></div><span>FY 2026–27</span></div><div className="da-district-table"><header><span>District</span><span>Index</span><span>ABC</span><span>ARV</span><span>Response</span><span>Bite trend</span></header>{districts.map((item,index)=><article key={item.name}><strong><b>#{index+1}</b>{item.name}</strong><span className="score"><i style={{width:`${item.score}%`}}/>{item.score}</span><span>{item.sterilized}%</span><span>{item.vaccinated}%</span><span>{item.response}m</span><em className={item.trend <= 0 ? "good" : "bad"}>{item.trend > 0 ? "↑" : "↓"} {Math.abs(item.trend)}%</em></article>)}</div></section><section className="da-card"><h2>Funding linked to outcomes</h2><p>₹18.4 Cr allocated · ₹12.7 Cr utilized</p><div className="da-fund-ring"><strong>69%</strong><span>utilized</span></div><ul className="da-metrics"><li><span>ABC contracts</span><b>₹6.2 Cr</b></li><li><span>ARV procurement</span><b>₹2.8 Cr</b></li><li><span>Shelter upgrades</span><b>₹2.1 Cr</b></li><li><span>Response fleet</span><b>₹1.6 Cr</b></li></ul></section><section className="da-card"><h2>Accountability alerts</h2><div className="da-alerts"><article><AlertTriangle/><div><strong>Faridabad below ABC target</strong><span>17-point gap · escalation due in 2 days</span></div></article><article><CircleDot/><div><strong>Ghaziabad bite trend rising</strong><span>Ward 34 and 38 need waste audit</span></div></article><article><CheckCircle2/><div><strong>GB Nagar SLA achieved</strong><span>92% incidents closed within 45 min</span></div></article></div></section></div>;
}

function IncidentOperations({ openIncident, dispatches }: { openIncident: (incident: (typeof DEMO_INCIDENTS)[number]) => void; dispatches: string[] }) {
  return <><div className="da-flow"><article><span>1,449</span><small>Bite notifications</small></article><ChevronRight/><article><span>1,312</span><small>ARV started &lt;24h</small></article><ChevronRight/><article><span>1,204</span><small>Animal traced</small></article><ChevronRight/><article><span>986</span><small>Case closed</small></article></div><section className="da-card"><div className="da-card-title"><div><h2>Unified incident register</h2><p>Sample incident register. Hospital records are not connected.</p></div><a className="da-primary" href="/demo?report=1">Create demo report</a></div><div className="da-incident-table"><header><span>Incident</span><span>Location</span><span>Signal</span><span>Response</span><span>Status</span></header>{DEMO_INCIDENTS.map(incident=><button key={incident.id} onClick={()=>openIncident(incident)}><strong>{incident.id}<small>{incident.type}</small></strong><span>{incident.area}</span><span>AI {incident.confidence}%<small>{incident.source}</small></span><span>{incident.team}</span><em className={incident.severity}>{dispatches.includes(incident.id) ? "SIMULATED" : incident.severity}</em></button>)}</div></section></>;
}

function AbcOperations() {
  return <><div className="da-kpis compact"><article><span className="teal"><PawPrint/></span><div><small>Captured this month</small><strong>8,420</strong><em>87% of target</em></div></article><article><span className="blue"><Stethoscope/></span><div><small>Sterilized</small><strong>7,918</strong><em className="good">94% conversion</em></div></article><article><span className="amber"><Syringe/></span><div><small>Anti-rabies vaccinated</small><strong>8,107</strong><em>96.3% coverage</em></div></article><article><span className="red"><MapPin/></span><div><small>Returned to territory</small><strong>7,402</strong><em>GPS + ear tag verified</em></div></article></div><div className="da-page-grid"><section className="da-card da-wide"><div className="da-card-title"><div><h2>ABC traceability pipeline</h2><p>Every animal tracked from capture to same-territory release</p></div><span>Today</span></div><div className="da-abc-pipeline">{[["Captured",284],["Vet cleared",266],["Sterilized",251],["Recovery",238],["Released",219]].map(([label,value],index)=><article key={String(label)}><span>{value}</span><small>{label}</small>{index<4&&<ChevronRight/>}</article>)}</div><div className="da-tag-grid">{["GN-ABC-24091","GN-ABC-24092","GN-ABC-24093","GN-ABC-24094"].map((tag,index)=><article key={tag}><i className={index===2?"warning":""}><CheckCircle2/></i><div><strong>{tag}</strong><span>{index===2?"Recovery delayed · vet alerted":"GPS release point matched"}</span></div><b>{index===2?"WATCH":"VERIFIED"}</b></article>)}</div></section><section className="da-card"><h2>ARV stock intelligence</h2><p>14-day demand forecast across connected facilities</p><div className="da-stock"><strong>18,460 <small>doses</small></strong><span>22 days system cover</span><i><b style={{width:"78%"}}/></i></div><ul className="da-metrics"><li><span>Healthy stock</span><b className="good">51 centres</b></li><li><span>Reorder in 7 days</span><b>9 centres</b></li><li><span>Critical stock</span><b className="bad">4 centres</b></li></ul></section><section className="da-card"><h2>Humane welfare safeguards</h2><div className="da-alerts"><article><CheckCircle2/><div><strong>Same-location release</strong><span>97.8% GPS compliance</span></div></article><article><CheckCircle2/><div><strong>Post-op recovery</strong><span>Median 3.1 days · 99.2% survival</span></div></article><article><AlertTriangle/><div><strong>2 contractor audits due</strong><span>Video and kennel records pending</span></div></article></div></section></div></>;
}

function CareNetwork() {
  return <><div className="da-kpis compact"><article><span className="red"><Hospital/></span><div><small>ARV centres online</small><strong>64 / 68</strong><em>94% availability</em></div></article><article><span className="teal"><Building2/></span><div><small>Veterinary facilities</small><strong>43</strong><em>118 kennels available</em></div></article><article><span className="blue"><Users/></span><div><small>NGO partners</small><strong>31</strong><em>18 on response duty</em></div></article><article><span className="amber"><Siren/></span><div><small>Ambulances ready</small><strong>24 / 29</strong><em>Median arrival 21 min</em></div></article></div><div className="da-page-grid"><section className="da-card da-wide"><div className="da-card-title"><div><h2>Nearest-care orchestration</h2><p>Illustrative facility capacity. Confirm availability with the facility.</p></div><span><Radio/> Live capacity</span></div><div className="da-network-list">{DEMO_CARE_NETWORK.map(place=><article key={place.name}><span className={place.status==="Busy"?"busy":""}><Hospital/></span><div><strong>{place.name}</strong><small>{place.type} · {place.distance}</small></div><b>{place.capacity}</b><em>{place.eta}</em><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`} target="_blank" rel="noreferrer">Open directions</a></article>)}</div></section><section className="da-card"><h2>Inter-agency handoffs today</h2><div className="da-handoffs"><strong>1,286</strong><span>digital case handoffs</span><i><b style={{width:"92%"}}/></i><small>92% acknowledged within SLA</small></div><ul className="da-metrics"><li><span>Citizen → Municipality</span><b>782</b></li><li><span>Hospital → Animal team</span><b>214</b></li><li><span>Municipality → NGO</span><b>173</b></li><li><span>112 → Hospital</span><b>117</b></li></ul></section><section className="da-card"><h2>System health</h2><div className="da-alerts"><article><CheckCircle2/><div><strong>Illustrative integration overview</strong><span>Hospital/FHIR and 112 dispatch integrations are not connected</span></div></article><article><CheckCircle2/><div><strong>Consent & privacy controls</strong><span>Live original evidence uses protected Firebase storage</span></div></article><article><CircleDot/><div><strong>4 facilities syncing late</strong><span>Fallback telephone workflow active</span></div></article></div></section></div></>;
}

function IncidentDrawer({ incident, dispatched, close, dispatch }: { incident: (typeof DEMO_INCIDENTS)[number]; dispatched: boolean; close: () => void; dispatch: () => void }) {
  return <div className="da-drawer"><button className="drawer-close" onClick={close}><X/></button><img src={incident.image} alt="Incident evidence"/><span className={`da-severity ${incident.severity}`}>{incident.severity} priority</span><h2>{incident.type}</h2><p><MapPin size={14}/>{incident.area} · {incident.age} ago</p><div className="da-ai"><ShieldCheck/><div><strong>AI evidence fusion · {incident.confidence}%</strong><span>Sample scores only; these images were not verified by the reporting service</span></div></div><dl><div><dt>Dogs observed</dt><dd>{incident.dogs}</dd></div><div><dt>Signal source</dt><dd>{incident.source}</dd></div><div><dt>Assigned unit</dt><dd>{dispatched ? "Demo response simulated" : incident.team}</dd></div><div><dt>Public routing</dt><dd>Illustrative 250 m avoidance zone</dd></div></dl><div className="da-timeline"><article className="done"><i/><div><strong>Signal verified</strong><span>Illustrative verification stage</span></div></article><article className="done"><i/><div><strong>Public safety layer updated</strong><span>Illustrative public-map stage</span></div></article><article className={dispatched?"done":""}><i/><div><strong>Field response</strong><span>{dispatched?"Local demo action saved":"Awaiting dispatcher"}</span></div></article><article><i/><div><strong>Clinical / ABC closure</strong><span>Pending outcome evidence</span></div></article></div><button className="da-dispatch" disabled={dispatched} onClick={dispatch}>{dispatched?<><CheckCircle2/>Demo dispatch saved</>:<><Siren/>Simulate dispatch</>}</button></div>;
}

function DemoWardRisk() {
  const [hours, setHours] = useState(0);
  return <section className="da-card"><h2>Sample ward risk</h2><p>Illustrative ward assignments only. Risk weights: low 1, medium 3, high 7; multiplied by dog count, halving every six hours. Expired records are removed from the live map.</p><label>Simulate elapsed time <select aria-label="Sample risk age" value={hours} onChange={e => setHours(Number(e.target.value))}><option value={0}>Now</option><option value={6}>6 hours later</option><option value={12}>12 hours later</option></select></label><div className="ops-scroll"><table><thead><tr><th>Sample ward</th><th>Location</th><th>Dogs</th><th>Risk score</th></tr></thead><tbody>{DEMO_INCIDENTS.map((incident,index)=><tr key={incident.id}><td>Demo ward {index+1}</td><td>{incident.area}</td><td>{incident.dogs}</td><td>{Math.round((incident.severity==='critical'||incident.severity==='high'?7:3)*incident.dogs*Math.pow(.5,(hours+parseInt(incident.age)/60)/6)*10)/10}</td></tr>)}</tbody></table></div><p>These scores support comparison; they are not a prediction or guarantee of safety.</p></section>;
}
