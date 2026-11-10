import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowDownToLine, CheckCircle2, Database, FileSpreadsheet, Play, RefreshCw, ShieldAlert } from "lucide-react";

type DatasetRow = Record<string, string>;
type FileInfo = { name: string; size: number; modified: string; download: string };
type StatusPayload = {
  generatedAt: string;
  dataset: { rows: number; counts: Record<string, number>; file: FileInfo | null };
  latestComparison: FileInfo | null;
  snapshots: FileInfo[];
  rows: DatasetRow[];
  rules: { name: string; description: string }[];
};

const states = ["Al día", "Próximo a vencer", "Atrasado", "Sin fecha", "Periodicidad no reconocida"];
const colors: Record<string, string> = { "Al día": "good", "Próximo a vencer": "warning", Atrasado: "danger", "Sin fecha": "muted", "Periodicidad no reconocida": "muted" };

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" }) : "No disponible";
}
function formatSize(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function App() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("No se pudo consultar la API local.");
      setData(await response.json() as StatusPayload);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runV2() {
    setRunning(true); setMessage("");
    try {
      const response = await fetch("/api/run-v2", { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "La ejecución falló.");
      setMessage("v2 ejecutada correctamente. Los datasets fueron actualizados.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado."); }
    finally { setRunning(false); }
  }

  async function convertExcel() {
    setMessage("");
    try {
      const response = await fetch("/api/convert-excel", { method: "POST" });
      const payload = await response.json() as { file?: FileInfo; error?: string };
      if (!response.ok || !payload.file) throw new Error(payload.error || "No se pudo convertir el CSV.");
      window.location.href = payload.file.download;
      setMessage("Excel generado y listo para descargar.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error inesperado."); }
  }

  const filteredRows = useMemo(() => (data?.rows || []).filter((row) => {
    const matchesState = filter === "Todos" || row["Estado de actualización"] === filter;
    const text = `${row["Nombre del Producto"]} ${row["Sigla Institución"]}`.toLowerCase();
    return matchesState && text.includes(query.toLowerCase());
  }).slice(0, 100), [data, filter, query]);

  if (loading && !data) return <main className="loading"><RefreshCw className="spin" /> Cargando estado de datasets...</main>;
  const counts = data?.dataset.counts || {};
  const atRisk = (counts["Atrasado"] || 0) + (counts["Próximo a vencer"] || 0);

  return <div className="app">
    <header className="topbar"><div className="brand"><div className="logo"><Database size={22} /></div><div><span className="eyebrow">DATAX · PROSPECCION</span><h1>Monitor de datasets</h1></div></div><div className="header-status"><span className="live-dot" /> Monitoreo activo <button className="icon-btn" onClick={() => void load()} title="Actualizar"><RefreshCw size={17} /></button></div></header>
    <main className="content">
      <section className="hero"><div><p className="eyebrow accent">CENTRO DE CONTROL</p><h2>Estado de actualización</h2><p className="subtitle">Supervisa la vigencia del catálogo y ejecuta el scraper v2 cuando necesites un nuevo corte.</p></div><div className="actions"><button className="button primary" onClick={() => void runV2()} disabled={running}><Play size={16} /> {running ? "Ejecutando v2..." : "Ejecutar v2"}</button><button className="button secondary" onClick={() => void convertExcel()}><FileSpreadsheet size={16} /> Convertir a Excel</button></div></section>
      {message && <div className="notice"><Activity size={17} /> {message}</div>}
      <section className="metrics"><Metric icon={<Database />} label="Datasets registrados" value={data?.dataset.rows || 0} tone="blue" /><Metric icon={<CheckCircle2 />} label="Al día" value={counts["Al día"] || 0} tone="green" /><Metric icon={<AlertTriangle />} label="Requieren atención" value={atRisk} tone="orange" /><Metric icon={<ShieldAlert />} label="Sin fecha / regla" value={(counts["Sin fecha"] || 0) + (counts["Periodicidad no reconocida"] || 0)} tone="purple" /></section>
      <div className="grid">
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">REGLAS DE MONITOREO</p><h3>Semáforo de actualización</h3></div><span className="timestamp">Corte: {formatDate(data?.generatedAt)}</span></div><div className="rules">{states.map((state) => <div className="rule" key={state}><span className={`dot ${colors[state]}`} /><div><strong>{state}</strong><p>{data?.rules.find((rule) => rule.name === state)?.description}</p></div><b>{counts[state] || 0}</b></div>)}</div></section>
        <section className="panel files"><div className="panel-heading"><div><p className="eyebrow">ARCHIVOS GENERADOS</p><h3>Descargas rápidas</h3></div></div><FileCard label="CSV principal" file={data?.dataset.file} /><FileCard label="Última comparación" file={data?.latestComparison} /><div className="snapshots"><span>Snapshots recientes</span>{data?.snapshots.slice(0, 3).map((file) => <a href={file.download} key={file.name}><ArrowDownToLine size={14} /> {file.name}</a>)}</div></section>
      </div>
      <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">CATÁLOGO CONSUMIDO</p><h3>Productos del CSV</h3></div><div className="filters"><input placeholder="Buscar dataset o institución..." value={query} onChange={(event) => setQuery(event.target.value)} /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>Todos</option>{states.map((state) => <option key={state}>{state}</option>)}</select></div></div><div className="table-wrap"><table><thead><tr><th>Dataset</th><th>Institución</th><th>Periodicidad</th><th>Última fecha</th><th>Estado</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.ID}><td><a href={row.URL} target="_blank" rel="noreferrer">{row["Nombre del Producto"]}</a></td><td>{row["Sigla Institución"] || "—"}</td><td>{row.Periodicidad || "—"}</td><td>{row.Fecha || "—"}</td><td><span className={`badge ${colors[row["Estado de actualización"]] || "muted"}`}><span className="dot" />{row["Estado de actualización"] || "Sin fecha"}</span></td></tr>)}</tbody></table>{!filteredRows.length && <div className="empty">No hay datasets para este filtro.</div>}</div><div className="table-footer">Mostrando {filteredRows.length} de {data?.dataset.rows || 0} registros</div></section>
    </main>
  </div>;
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value.toLocaleString("es-BO")}</strong></div></div>;
}
function FileCard({ label, file }: { label: string; file: FileInfo | null | undefined }) {
  return <div className="file-card"><div className="file-icon"><FileSpreadsheet size={19} /></div><div className="file-info"><strong>{label}</strong><span>{file ? `${file.name} · ${formatSize(file.size)}` : "No disponible"}</span></div>{file && <a className="download" href={file.download} title={`Descargar ${label}`}><ArrowDownToLine size={17} /></a>}</div>;
}
