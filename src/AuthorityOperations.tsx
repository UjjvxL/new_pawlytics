import { useEffect, useRef, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { exportAuthorityPdf } from "./exportPdf";

type Ward = {
  ward: string;
  reports: number;
  dogs: number;
  score: number;
  highRisk: number;
};
type RecordRow = {
  id: string;
  subject: string;
  wardId: string;
  stage?: string;
  balance?: number;
};
type Snapshot = {
  wards: Ward[];
  animals: RecordRow[];
  stock: RecordRow[];
  events: Array<Record<string, unknown>>;
  generatedAt: string;
  reportLimitReached: boolean;
};
const stages = [
  "captured",
  "vet_cleared",
  "sterilized",
  "vaccinated",
  "recovery",
  "released",
];
export default function AuthorityOperations({
  organizationId,
  role,
}: {
  organizationId: string;
  role: string;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("abc"),
    [subject, setSubject] = useState(""),
    [wardId, setWard] = useState(""),
    [stage, setStage] = useState("captured"),
    [quantity, setQuantity] = useState("1"),
    [note, setNote] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const canEdit = [
    "platform_admin",
    "org_admin",
    "dispatcher",
    "field_officer",
  ].includes(role);
  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setData(null);
    setLoading(true);
    setError("");
    let active = true;
    let version = 0;
    const load = async () => {
      const sequence = ++version;
      try {
        const result = await httpsCallable(
          functions,
          "getAuthorityOperations",
        )({ organizationId });
        if (active && sequence === version) {
          setData(result.data as Snapshot);
          setError("");
        }
      } catch (err) {
        if (active)
          setError(
            `Operations could not be loaded. ${String((err as Error).message)}`,
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    const fail = () => {
      if (active) {
        setError(
          "Live updates are unavailable or permission was denied. Refresh after signing in with the required authority factor.",
        );
        setLoading(false);
      }
    };
    const stops = [
      onSnapshot(
        query(
          collection(db, "publicSightings"),
          where("organizationId", "==", organizationId),
          limit(1000),
        ),
        () => void load(),
        fail,
      ),
      onSnapshot(
        query(
          collection(db, `organizations/${organizationId}/operations`),
          orderBy("createdAt", "desc"),
          limit(1),
        ),
        () => void load(),
        fail,
      ),
    ];
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearInterval(timer);
      active = false;
      stops.forEach((stop) => stop());
    };
  }, [organizationId]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await httpsCallable(
        functions,
        "recordAuthorityOperation",
      )({
        organizationId,
        kind,
        subject,
        wardId,
        stage,
        quantity: Number(quantity),
        note,
        idempotencyKey: requestId.current,
      });
      if (!(result.data as { ok: boolean }).ok)
        throw new Error("Server did not confirm the operation.");
      requestId.current = crypto.randomUUID();
      setNotice("Operation saved by the server. Live totals will refresh.");
      setNote("");
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function exportPdf() {
    if (!data) return;
    setBusy(true);
    try {
      await exportAuthorityPdf(
        "Pawlytics authority operations",
        [
          `Organization: ${organizationId}`,
          `Snapshot: ${data.generatedAt}`,
          data.reportLimitReached
            ? "Report cap reached: analytics cover the first 1,000 records."
            : "Organization-scoped records",
          "WARD RISK - six-hour score half-life; expired and test reports excluded",
          ...data.wards.map(
            (w) =>
              `${w.ward} | ${w.reports} reports | ${w.dogs} dogs | score ${w.score} | ${w.highRisk} high risk`,
          ),
          "ABC ANIMAL RECORDS",
          ...data.animals.map((a) => `${a.subject} | ${a.wardId} | ${a.stage}`),
          "ARV STOCK",
          ...data.stock.map(
            (s) => `${s.subject} | ${s.wardId} | ${s.balance} doses`,
          ),
        ],
        false,
      );
      setNotice("Private PDF downloaded. Store it securely.");
    } catch {
      setError("PDF export failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  if (!organizationId)
    return (
      <section className="authority-card">
        <h2>Select an organization</h2>
        <p>
          Your account needs an assigned organization before it can view ward
          records. The public presentation is available at{" "}
          <a href="/authority">/authority</a>.
        </p>
      </section>
    );
  return (
    <div className="authority-operations">
      <section className="authority-card">
        <div className="card-heading">
          <div>
            <h2>Ward risk & ABC / ARV operations</h2>
            <p>
              Live organization records. Scores decay with age and exclude
              expired or test sightings.
            </p>
          </div>
          <button disabled={!data || busy} onClick={() => void exportPdf()}>
            Export PDF
          </button>
        </div>
        {loading && <p role="status">Loading authorized operations…</p>}
        {error && (
          <p role="alert" className="ops-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="ops-notice">
            {notice}
          </p>
        )}
        {data && (
          <>
            <div className="ops-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Ward</th>
                    <th>Active reports</th>
                    <th>Dogs</th>
                    <th>Risk score</th>
                    <th>High risk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.wards.map((w) => (
                    <tr key={w.ward}>
                      <td>{w.ward}</td>
                      <td>{w.reports}</td>
                      <td>{w.dogs}</td>
                      <td>{w.score}</td>
                      <td>{w.highRisk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.wards.length && (
              <p>
                No active verified reports are assigned to wards yet. Staff can
                assign wards while reviewing a report.
              </p>
            )}
            {data.reportLimitReached && (
              <p role="status">
                Analytics are capped at 1,000 report records; narrow your
                organization scope before relying on totals.
              </p>
            )}
          </>
        )}
      </section>
      {canEdit && (
        <section className="authority-card">
          <h2>Record a completed field operation</h2>
          <p>
            Record actual work only. Saving a record does not dispatch a team or
            administer a vaccine.
          </p>
          <form className="ops-form" onSubmit={(event) => void save(event)}>
            <label>
              Record type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setStage(e.target.value === "abc" ? "captured" : "received");
                }}
              >
                <option value="abc">ABC animal tracking</option>
                <option value="arv">ARV stock movement</option>
              </select>
            </label>
            <label>
              {kind === "abc" ? "Animal tag" : "Facility name"}
              <input
                required
                minLength={2}
                maxLength={100}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label>
              Ward / jurisdiction
              <input
                required
                maxLength={80}
                value={wardId}
                onChange={(e) => setWard(e.target.value)}
              />
            </label>
            <label>
              {kind === "abc" ? "Completed stage" : "Stock movement"}
              <select value={stage} onChange={(e) => setStage(e.target.value)}>
                {(kind === "abc"
                  ? stages
                  : ["received", "administered", "wasted"]
                ).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            {kind === "arv" && (
              <label>
                Doses
                <input
                  type="number"
                  required
                  min={1}
                  max={100000}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
            )}
            <label>
              Evidence / staff note
              <input
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button disabled={busy}>
              {busy ? "Saving…" : "Save operation"}
            </button>
          </form>
        </section>
      )}
      {data && (
        <>
          <section className="authority-card">
            <h2>ABC lifecycle</h2>
            {!data.animals.length ? (
              <p>No animal records yet.</p>
            ) : (
              <div className="ops-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Animal tag</th>
                      <th>Ward</th>
                      <th>Last completed stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.animals.map((a) => (
                      <tr key={a.id}>
                        <td>{a.subject}</td>
                        <td>{a.wardId}</td>
                        <td>{a.stage?.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="authority-card">
            <h2>ARV stock ledger</h2>
            {!data.stock.length ? (
              <p>No stock movements recorded yet.</p>
            ) : (
              <div className="ops-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Facility</th>
                      <th>Ward</th>
                      <th>Available doses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stock.map((s) => (
                      <tr key={s.id}>
                        <td>{s.subject}</td>
                        <td>{s.wardId}</td>
                        <td>{s.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
