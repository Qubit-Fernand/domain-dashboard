import { StrictMode, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowDownUp,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Cloud,
  RefreshCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import "./styles.css";

type Domain = {
  name: string;
  registrar: string;
  dnsProvider: string;
  expiresAt?: string | null;
  autoRenew: boolean;
  purpose: string;
  owner: string;
  tags: string[];
  notes?: string;
  source?: string[];
};

type Status = "expired" | "urgent" | "soon" | "healthy" | "unknown";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntil(date?: string | null) {
  if (!date) return null;
  const expires = new Date(`${date}T00:00:00`);
  if (Number.isNaN(expires.getTime())) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((expires.getTime() - start.getTime()) / MS_PER_DAY);
}

function getStatus(days: number | null): Status {
  if (days == null) return "unknown";
  if (days < 0) return "expired";
  if (days <= 14) return "urgent";
  if (days <= 60) return "soon";
  return "healthy";
}

function statusLabel(status: Status) {
  return {
    expired: "Expired",
    urgent: "Urgent",
    soon: "Soon",
    healthy: "Healthy",
    unknown: "Unknown",
  }[status];
}

function App() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [query, setQuery] = useState("");
  const [registrar, setRegistrar] = useState("All");
  const [showAttentionOnly, setShowAttentionOnly] = useState(false);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  async function loadDomains() {
    setError("");
    try {
      const response = await fetch(`/domains.json?ts=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextDomains = (await response.json()) as Domain[];
      setDomains(nextDomains);
      setLastLoadedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load domains.");
    }
  }

  useEffect(() => {
    void loadDomains();
  }, []);

  const enriched = useMemo(
    () =>
      domains
        .map((domain) => {
          const days = daysUntil(domain.expiresAt);
          return { ...domain, days, status: getStatus(days) };
        })
        .sort((a, b) => (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)),
    [domains],
  );

  const registrars = useMemo(
    () => ["All", ...Array.from(new Set(domains.map((domain) => domain.registrar))).sort()],
    [domains],
  );

  const filtered = enriched.filter((domain) => {
    const queryText = query.trim().toLowerCase();
    const matchesQuery =
      queryText.length === 0 ||
      [domain.name, domain.registrar, domain.dnsProvider, domain.purpose, domain.owner, ...domain.tags, ...(domain.source || [])]
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    const matchesRegistrar = registrar === "All" || domain.registrar === registrar;
    const matchesAttention = !showAttentionOnly || domain.status !== "healthy" || !domain.autoRenew;
    return matchesQuery && matchesRegistrar && matchesAttention;
  });

  const stats = {
    total: domains.length,
    urgent: enriched.filter((domain) => domain.status === "expired" || domain.status === "urgent" || domain.status === "unknown").length,
    soon: enriched.filter((domain) => domain.status === "soon").length,
    autoRenew: enriched.filter((domain) => domain.autoRenew).length,
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local inventory</p>
          <h1>Domain Dashboard</h1>
        </div>
        <button className="iconButton" onClick={() => void loadDomains()} title="Refresh domains">
          <RefreshCcw size={18} />
        </button>
      </header>

      <section className="metrics" aria-label="Domain summary">
        <Metric icon={<Cloud />} label="Domains" value={stats.total.toString()} />
        <Metric icon={<AlertTriangle />} label="Needs attention" value={stats.urgent.toString()} tone="warn" />
        <Metric icon={<CalendarClock />} label="Due in 60 days" value={stats.soon.toString()} />
        <Metric icon={<ShieldCheck />} label="Auto renew" value={stats.autoRenew.toString()} tone="good" />
      </section>

      <section className="toolbar" aria-label="Filters">
        <label className="searchBox">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search domains, DNS, usage, tags"
          />
        </label>
        <select value={registrar} onChange={(event) => setRegistrar(event.target.value)} aria-label="Registrar">
          {registrars.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showAttentionOnly}
            onChange={(event) => setShowAttentionOnly(event.target.checked)}
          />
          Attention only
        </label>
      </section>

      {error ? <p className="error">Could not load `public/domains.json`: {error}</p> : null}

      <section className="tableWrap" aria-label="Domain table">
        <div className="tableHeader">
          <span>Domain</span>
          <span>Registrar</span>
          <span>DNS</span>
          <span>
            <ArrowDownUp size={14} /> Expiry
          </span>
          <span>Purpose</span>
          <span>Status</span>
        </div>
        {filtered.map((domain) => (
          <article className="domainRow" key={domain.name}>
            <div>
              <strong>{domain.name}</strong>
              <div className="tags">
                {domain.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
            <span>{domain.registrar}</span>
            <span>{domain.dnsProvider}</span>
            <span>
              {domain.expiresAt || "No expiry data"}
              <small>
                {domain.days == null
                  ? "Check registrar"
                  : domain.days >= 0
                    ? `${domain.days} days left`
                    : `${Math.abs(domain.days)} days ago`}
              </small>
            </span>
            <span>{domain.purpose}</span>
            <StatusPill status={domain.status} autoRenew={domain.autoRenew} />
          </article>
        ))}
        {filtered.length === 0 ? <p className="empty">No domains match the current filters.</p> : null}
      </section>

      <footer className="footer">
        <span>{lastLoadedAt ? `Loaded ${lastLoadedAt.toLocaleTimeString()}` : "Loading data..."}</span>
        <span>Source: public/domains.json</span>
      </footer>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "good";
}) {
  return (
    <article className={`metric ${tone}`}>
      <div className="metricIcon">{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

function StatusPill({ status, autoRenew }: { status: Status; autoRenew: boolean }) {
  const Icon = status === "healthy" ? CheckCircle2 : status === "expired" ? CircleSlash : AlertTriangle;

  return (
    <span className={`pill ${status}`}>
      <Icon size={15} />
      {statusLabel(status)}
      {autoRenew ? <small>Auto</small> : null}
    </span>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
