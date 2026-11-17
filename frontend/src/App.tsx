import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, Check, ChevronDown, Clipboard, Database, ExternalLink,
  FileDown, History, Play, Search, Table2, TrendingUp,
} from "lucide-react";

type DatasetRow = Record<string, string>;
type FileInfo = { name: string; size: number; modified: string; download: string };
type SourceOutdated = { source: string; total: number; evaluated: number; outdated: number; index: number };
type StatusPayload = {
  generatedAt: string;
  dataset: { rows: number; file: FileInfo | null };
  outdatedBySource: SourceOutdated[];
  rows: DatasetRow[];
};

const field = {
  code: "Código SPIM", analyzeName: "Nombre Analyze", portalName: "Nombre producto Portal",
  portalId: "ID producto Portal", portalUrl: "URL producto Portal", serverPath: "Ruta descarga en servidor",
  source: "Fuente origen", folder: "Carpeta dataset", otherHistory: "Es otros históricos",
  frequency: "Periodicidad", date: "Fecha", analyzePath: "Path Analyze",
  recordsDatax: "Registros DatasetsDatax", recordsWeb: "Registros tabla web",
  historyCount: "Históricos scraper", lastScrape: "Último scraping", historyChanged: "Fecha cambió en históricos",
  maxDelay: "Máximo retraso", criterionStatus: "Estado según criterio",
} as const;

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" });
}
function formatSize(bytes: number) { return `${(bytes / 1024).toFixed(1)} KB`; }
function display(value?: string) { return value && value.trim() && value !== "-" ? value : "No disponible"; }
function isHistorical(row: DatasetRow) {
  return row[field.otherHistory] === "Sí";
}
function isFresh(row: DatasetRow) {
  return !isHistorical(row) && row[field.criterionStatus] === "Actualizado";
}

export default function App() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("Todos");
  const [path, setPath] = useState("Todos");
  const [copied, setCopied] = useState("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("No se pudo consultar la consolidación.");
      setData(await response.json() as StatusPayload);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error inesperado.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runScraper() {
    setRunning(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/run-v2", { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "El scraper no pudo finalizar.");
      setNotice("Scraper ejecutado correctamente. Histórico y dashboard actualizados.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error al ejecutar el scraper.");
    } finally {
      setRunning(false);
    }
  }

  const sources = useMemo(() => Array.from(new Set((data?.rows || []).map((row) => row[field.source]).filter(Boolean))).sort(), [data]);
  const paths = useMemo(() => {
    const counts = new Map<string, number>();
    (data?.rows || []).forEach((row) => {
      const value = display(row[field.source]);
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const stats = useMemo(() => {
    const rows = data?.rows || [];
    const historical = rows.filter(isHistorical).length;
    const current = rows.length - historical;
    const fresh = rows.filter(isFresh).length;
    return { historical, current, fresh, percentage: current ? Math.round((fresh / current) * 100) : 0 };
  }, [data]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (data?.rows || []).filter((row) => {
      const searchable = [row[field.code], row[field.analyzeName], row[field.portalName], row[field.portalId]].join(" ").toLowerCase();
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (source === "Todos" || row[field.source] === source)
        && (path === "Todos" || display(row[field.folder]) === path);
    });
  }, [data, query, source, path]);

  async function copyPath(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value); window.setTimeout(() => setCopied(""), 1800);
    } catch { setError("No se pudo copiar la ruta. Selecciónela manualmente."); }
  }

  if (loading && !data) return <main className="loading"><Database className="pulse" /> Cargando consolidación...</main>;
  if (!data) return <main className="loading"><p>{error}</p><button className="text-button" onClick={() => void load()}>Reintentar</button></main>;

  const maxPathCount = paths[0]?.[1] || 1;
  return <div className="app">
    <header className="topbar"><a className="brand" href="/"><div className="logo"><Table2 size={21} /></div><div><strong>Datax</strong><span>Consolidación SPIM</span></div></a><div className="header-actions"><span className="last-update">Actualizado {formatDate(data.generatedAt)}</span>{data.dataset.file && <a className="download-link" href={data.dataset.file.download}><FileDown size={16} /> Descargar CSV</a>}</div></header>
    <main className="content">
      <section className="intro"><div><p className="overline">CENTRO DE INTELIGENCIA DE DATOS</p><h1>Salud del catálogo Datax</h1><p className="subtitle">Una lectura optimista y accionable del estado de los datasets publicados, sus fuentes de origen y su frecuencia de actualización.</p><div className="intro-actions"><button className="scraper-button" onClick={() => void runScraper()} disabled={running}><Play size={15} />{running ? "Ejecutando scraper..." : "Ejecutar scraper y actualizar"}</button></div></div><div className="summary"><div><strong>{data.dataset.rows.toLocaleString("es-BO")}</strong><span>datasets del portal</span></div><div><strong>{stats.percentage}%</strong><span>actualización estimada</span></div></div></section>

      <section className="kpis"><div className="kpi"><div className="kpi-icon blue"><Database /></div><div><span>Base del análisis</span><strong>{data.dataset.rows}</strong><small>productos publicados</small></div></div><div className="kpi"><div className="kpi-icon green"><TrendingUp /></div><div><span>Actualizados</span><strong>{stats.fresh}</strong><small>fecha, frecuencia e históricos</small></div></div><div className="kpi"><div className="kpi-icon purple"><History /></div><div><span>Otros históricos</span><strong>{stats.historical}</strong><small>identificados por path</small></div></div><div className="kpi"><div className="kpi-icon orange"><BarChart3 /></div><div><span>Fuentes de origen</span><strong>{paths.length}</strong><small>paths distintos</small></div></div></section>

      <section className="analytics-grid"><article className="chart-card"><div className="card-title"><div><p className="overline">COBERTURA DEL CATÁLOGO</p><h2>Vigentes frente a históricos</h2></div><span className="hint">Base: portal</span></div><div className="donut-layout"><div className="donut" style={{ "--historical": `${data.dataset.rows ? stats.historical / data.dataset.rows * 100 : 0}%` } as CSSProperties}><div><strong>{stats.current}</strong><span>vigentes</span></div></div><div className="legend"><div><i className="legend-current" /><span>Vigentes</span><strong>{stats.current}</strong></div><div><i className="legend-history" /><span>Otros históricos</span><strong>{stats.historical}</strong></div><p>Se separa la fuente de la carpeta y se marca el prefijo “OTROS HISTÓRICOS”.</p></div></div></article><article className="chart-card"><div className="card-title"><div><p className="overline">FUENTES DE ORIGEN</p><h2>Datasets por fuente</h2></div><span className="hint">{paths.length} fuentes</span></div><div className="path-chart">{paths.slice(0, 7).map(([name, count]) => <button className={`path-row ${source === name ? "selected" : ""}`} key={name} onClick={() => setSource(source === name ? "Todos" : name)}><span title={name}>{name}</span><div className="bar-track"><i style={{ width: `${count / maxPathCount * 100}%` }} /></div><b>{count}</b></button>)}{paths.length > 7 && <span className="chart-note">Usa el filtro Fuente para consultar todas las fuentes.</span>}</div></article></section>
      <section className="ranking-card"><div className="card-title"><div><p className="overline">PRIORIZACIÓN OPERATIVA</p><h2>Fuentes más desactualizadas</h2></div><span className="hint">Índice: atrasados / evaluados</span></div>{data.outdatedBySource.length ? <div className="ranking-list">{data.outdatedBySource.slice(0, 10).map((item, index) => <button className={`ranking-row ${source === item.source ? "selected" : ""}`} key={item.source} onClick={() => setSource(source === item.source ? "Todos" : item.source)}><strong>{index + 1}</strong><span className="ranking-source" title={item.source}>{item.source}</span><div className="ranking-bar"><i style={{ width: `${item.index}%` }} /></div><b>{item.index}%</b><small>{item.outdated} atrasados de {item.evaluated} evaluados</small></button>)}</div> : <p className="chart-note">No hay fuentes con datos evaluables.</p>}</section>
      <section className="search-card"><div className="search-box"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código SPIM, nombre o ID de portal" /></div><label className="select-box">Fuente <select value={source} onChange={(event) => setSource(event.target.value)}><option>Todos</option>{sources.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></label><label className="select-box">Carpeta <select value={path} onChange={(event) => setPath(event.target.value)}><option>Todos</option>{Array.from(new Set((data.rows || []).map((row) => display(row[field.folder])))).sort().map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></label></section>
      {notice && <div className="notice">{notice}</div>}{error && <div className="error">{error}</div>}
      <section className="results"><div className="results-heading"><div><h2>Datasets del portal</h2><span>{filteredRows.length} coincidencias</span></div><button className="refresh" onClick={() => void load()}>Actualizar</button></div>{filteredRows.length ? <div className="table-scroll"><table><thead><tr><th>Código SPIM</th><th>Información del dataset</th><th>Portal Datax</th><th>Descarga en servidor</th></tr></thead><tbody>{filteredRows.map((row, index) => { const serverPath = row[field.serverPath]; const portalUrl = row[field.portalUrl]; return <tr key={`${row[field.portalId] || row[field.code]}-${index}`}><td><code>{display(row[field.code])}</code><span className={`source-tag ${isHistorical(row) ? "history-tag" : ""}`}>{isHistorical(row) ? "OTROS HISTÓRICOS" : display(row[field.source])}</span></td><td><strong>{display(row[field.analyzeName] || row[field.portalName])}</strong><span className="muted">Fuente: {display(row[field.source])} · Carpeta: {display(row[field.folder])}</span><div className="details"><span>{display(row[field.frequency])}</span><span>{display(row[field.date])}</span><span>{isHistorical(row) ? "Fuera del cálculo" : display(row[field.criterionStatus])}</span><span>{display(row[field.maxDelay])}</span><span>{row[field.historyCount] || "0"} snapshots</span></div><span className="muted">Último scraping: {display(row[field.lastScrape])}</span></td><td>{portalUrl ? <a className="action-button portal" href={portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Abrir portal</a> : <span className="unavailable">{display(row[field.portalName])}</span>}{row[field.portalId] && <small>ID {row[field.portalId]}</small>}</td><td>{serverPath ? <button className="action-button path" onClick={() => void copyPath(serverPath)} title={serverPath}>{copied === serverPath ? <><Check size={15} /> Copiada</> : <><Clipboard size={15} /> Copiar ruta</>}</button> : <span className="unavailable">Sin ruta registrada</span>}</td></tr>; })}</tbody></table></div> : <div className="empty"><Search size={28} /><strong>No encontramos resultados</strong><span>Prueba con otro filtro o código SPIM.</span></div>}</section>
    </main><footer>Fuente: productos_datax_dataset.csv + DATAX_Consolidacion_Tabla_Web.csv · Corte {formatDate(data.generatedAt)}</footer>
  </div>;
}
