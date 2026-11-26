import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, Check, ChevronDown, Clipboard, Database, ExternalLink,
  FileDown, History, Play, Search, Table2, TrendingUp, Archive,
} from "lucide-react";

type DatasetRow = Record<string, string>;
type FileInfo = { name: string; size: number; modified: string; download: string };
type SourceMapStats = { source: string; total: number; evaluated: number; outdated: number; outdatedPercentage: number | null };
type TreemapTile = SourceMapStats & { x: number; y: number; width: number; height: number };
type StatusPayload = {
  generatedAt: string;
  staticMode?: boolean;
  dataset: { rows: number; file: FileInfo | null };
  rows: DatasetRow[];
};

const field = {
  code: "Código SPIM", analyzeName: "Nombre Analyze", portalName: "Nombre producto Portal",
  portalId: "ID producto Portal", portalUrl: "URL producto Portal", serverPath: "Ruta descarga en servidor",
  source: "Fuente origen", folder: "Carpeta dataset", otherHistory: "Es otros históricos",
  dagAirflow: "DAG Airflow",
  frequency: "Periodicidad", date: "Fecha", analyzePath: "Path Analyze",
  recordsDatax: "Registros DatasetsDatax", recordsWeb: "Registros tabla web",
  historyCount: "Históricos scraper", lastScrape: "Último scraping", historyChanged: "Fecha cambió en históricos",
  maxDelay: "Máximo retraso", criterionStatus: "Estado según criterio", historicalCandidate: "Candidato a histórico",
} as const;
const airflowDagBaseUrl = "http://10.0.0.12:8080/dags";

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" });
}
function formatSize(bytes: number) { return `${(bytes / 1024).toFixed(1)} KB`; }
function display(value?: string) { return value && value.trim() && value !== "-" ? value : "No disponible"; }
function getAirflowDagIds(value: string) {
  return value.split("|").map((dagId) => dagId.trim()).filter((dagId) => /^[A-Za-z0-9_.-]+$/.test(dagId));
}
function getAirflowRobotCode(dagId: string) {
  return `F${dagId}`;
}
function getAirflowTriggerUrl(dagId: string) {
  const origin = encodeURIComponent(`/dags/${dagId}/grid`);
  return `${airflowDagBaseUrl}/${encodeURIComponent(dagId)}/trigger?origin=${origin}`;
}
function isHistorical(row: DatasetRow) {
  return row[field.otherHistory] === "Sí";
}
function isFresh(row: DatasetRow) {
  return !isHistorical(row) && row[field.criterionStatus] === "Actualizado";
}
function isOutdated(row: DatasetRow) {
  return !isHistorical(row) && row[field.criterionStatus] === "Atrasado";
}
function isHistoricalCandidate(row: DatasetRow) {
  return !isHistorical(row) && row[field.historicalCandidate] === "Sí";
}

function getSourceMapStats(rows: DatasetRow[], historical: boolean): SourceMapStats[] {
  const grouped = new Map<string, SourceMapStats>();
  rows.forEach((row) => {
    if (isHistorical(row) !== historical) return;
    const source = display(row[field.source]);
    const stats = grouped.get(source) || { source, total: 0, evaluated: 0, outdated: 0, outdatedPercentage: null };
    stats.total += 1;
    const status = row[field.criterionStatus];
    if (status === "Actualizado" || status === "Atrasado") {
      stats.evaluated += 1;
      if (status === "Atrasado") stats.outdated += 1;
    }
    stats.outdatedPercentage = stats.evaluated ? stats.outdated / stats.evaluated * 100 : null;
    grouped.set(source, stats);
  });
  return Array.from(grouped.values()).sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
}

function layoutTreemap(items: SourceMapStats[], x = 0, y = 0, width = 100, height = 100): TreemapTile[] {
  if (!items.length) return [];
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const remaining = items.map((item) => ({
    ...item,
    area: item.total / total * width * height,
  }));
  const tiles: TreemapTile[] = [];
  let left = x;
  let top = y;
  let remainingWidth = width;
  let remainingHeight = height;

  const worstAspectRatio = (row: typeof remaining, side: number) => {
    const area = row.reduce((sum, item) => sum + item.area, 0);
    const smallest = Math.min(...row.map((item) => item.area));
    const largest = Math.max(...row.map((item) => item.area));
    return Math.max((side ** 2 * largest) / (area ** 2), (area ** 2) / (side ** 2 * smallest));
  };

  while (remaining.length) {
    const first = remaining.shift();
    if (!first) break;
    const row = [first];
    const side = Math.min(remainingWidth, remainingHeight);
    while (remaining.length) {
      const next = remaining[0];
      if (!next || worstAspectRatio([...row, next], side) > worstAspectRatio(row, side)) break;
      const nextItem = remaining.shift();
      if (nextItem) row.push(nextItem);
    }

    const rowArea = row.reduce((sum, item) => sum + item.area, 0);
    if (remainingWidth >= remainingHeight) {
      const rowWidth = rowArea / remainingHeight;
      let rowTop = top;
      row.forEach((item) => {
        const itemHeight = item.area / rowWidth;
        const { area: _area, ...stats } = item;
        tiles.push({ ...stats, x: left, y: rowTop, width: rowWidth, height: itemHeight });
        rowTop += itemHeight;
      });
      left += rowWidth;
      remainingWidth -= rowWidth;
    } else {
      const rowHeight = rowArea / remainingWidth;
      let rowLeft = left;
      row.forEach((item) => {
        const itemWidth = item.area / rowHeight;
        const { area: _area, ...stats } = item;
        tiles.push({ ...stats, x: rowLeft, y: top, width: itemWidth, height: rowHeight });
        rowLeft += itemWidth;
      });
      top += rowHeight;
      remainingHeight -= rowHeight;
    }
  }
  return tiles;
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
  const [showHistoricalMap, setShowHistoricalMap] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/status");
      if (response.ok) {
        setData(await response.json() as StatusPayload);
        setError("");
        return;
      }
      throw new Error("API local no disponible.");
    } catch {
      try {
        const staticResponse = await fetch(`${import.meta.env.BASE_URL}status.json`);
        if (!staticResponse.ok) throw new Error("No se pudo cargar la instantánea estática.");
        setData(await staticResponse.json() as StatusPayload);
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Error inesperado.");
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runScraper() {
    if (data?.staticMode) {
      setError("La ejecución del scraper solo está disponible en el servidor local.");
      return;
    }
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
    const candidates = rows.filter(isHistoricalCandidate).length;
    const dagAirflow = rows.filter((row) => row[field.dagAirflow]?.trim()).length;
    const withoutCandidates = current - candidates;
    return {
      historical, current, fresh, candidates, dagAirflow,
      percentage: current ? Math.round((fresh / current) * 100) : 0,
      percentageWithoutCandidates: withoutCandidates ? Math.round((fresh / withoutCandidates) * 100) : 0,
    };
  }, [data]);

  const sourceMapStats = useMemo(
    () => getSourceMapStats(data?.rows || [], showHistoricalMap),
    [data, showHistoricalMap],
  );
  const sourceMapTiles = useMemo(() => layoutTreemap(sourceMapStats), [sourceMapStats]);

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
      <section className="intro"><div><p className="overline">CENTRO DE INTELIGENCIA DE DATOS</p><h1>Salud del catálogo Datax</h1><p className="subtitle">{data.staticMode ? "Instantánea publicada en GitHub Pages. Los datos se actualizan al generar una nueva versión del sitio." : "Una lectura optimista y accionable del estado de los datasets publicados, sus fuentes de origen y su frecuencia de actualización."}</p><div className="intro-actions"><button className="scraper-button" onClick={() => void runScraper()} disabled={running || data.staticMode}><Play size={15} />{data.staticMode ? "Versión estática" : running ? "Ejecutando scraper..." : "Ejecutar scraper y actualizar"}</button></div></div><div className="summary"><div><strong>{data.dataset.rows.toLocaleString("es-BO")}</strong><span>datasets del portal</span></div><div><strong>{stats.percentage}%</strong><span>actualización actual</span></div><div><strong>{stats.percentageWithoutCandidates}%</strong><span>sin candidatos a histórico</span></div></div></section>

      <section className="kpis"><div className="kpi"><div className="kpi-icon blue"><Database /></div><div><span>Base del análisis</span><strong>{data.dataset.rows}</strong><small>productos publicados</small></div></div><div className="kpi"><div className="kpi-icon green"><TrendingUp /></div><div><span>Actualizados</span><strong>{stats.fresh}</strong><small>fecha, frecuencia e históricos</small></div></div><div className="kpi"><div className="kpi-icon purple"><History /></div><div><span>Otros históricos</span><strong>{stats.historical}</strong><small>identificados por path</small></div></div><div className="kpi"><div className="kpi-icon red"><Archive /></div><div><span>Candidatos a histórico</span><strong>{stats.candidates}</strong><small>más de 2× su retraso máximo</small></div></div><div className="kpi"><div className="kpi-icon orange"><BarChart3 /></div><div><span>Fuentes de origen</span><strong>{paths.length}</strong><small>paths distintos</small></div></div><div className="kpi"><div className="kpi-icon blue"><Database /></div><div><span>DAG Airflow</span><strong>{stats.dagAirflow}</strong><small>datasets con DAG asignado</small></div></div></section>

      <section className="analytics-grid"><article className="chart-card"><div className="card-title"><div><p className="overline">COBERTURA DEL CATÁLOGO</p><h2>Vigentes frente a históricos</h2></div><span className="hint">Base: portal</span></div><div className="donut-layout"><div className="donut" style={{ "--historical": `${data.dataset.rows ? stats.historical / data.dataset.rows * 100 : 0}%` } as CSSProperties}><div><strong>{stats.current}</strong><span>vigentes</span></div></div><div className="legend"><div><i className="legend-current" /><span>Vigentes</span><strong>{stats.current}</strong></div><div><i className="legend-history" /><span>Otros históricos</span><strong>{stats.historical}</strong></div><p>Se separa la fuente de la carpeta y se marca el prefijo “OTROS HISTÓRICOS”.</p></div></div></article><article className="chart-card"><div className="card-title"><div><p className="overline">FUENTES DE ORIGEN</p><h2>Datasets por fuente</h2></div><span className="hint">{paths.length} fuentes</span></div><div className="path-chart">{paths.slice(0, 7).map(([name, count]) => <button className={`path-row ${source === name ? "selected" : ""}`} key={name} onClick={() => setSource(source === name ? "Todos" : name)}><span title={name}>{name}</span><div className="bar-track"><i style={{ width: `${count / maxPathCount * 100}%` }} /></div><b>{count}</b></button>)}{paths.length > 7 && <span className="chart-note">Usa el filtro Fuente para consultar todas las fuentes.</span>}</div></article></section>
      <section className="source-map-card"><div className="card-title"><div><p className="overline">PRIORIZACIÓN OPERATIVA</p><h2>{showHistoricalMap ? "Datasets históricos por fuente" : "Actualización por fuente"}</h2><span className="hint">{sourceMapStats.reduce((total, item) => total + item.total, 0)} datasets · tamaño por cantidad · color por desactualización</span></div><button className="map-toggle" onClick={() => setShowHistoricalMap(!showHistoricalMap)}><History size={15} />{showHistoricalMap ? "Ver fuentes actuales" : `Ver históricos (${stats.historical})`}</button></div>{sourceMapTiles.length ? <><div className="treemap" role="group" aria-label={showHistoricalMap ? "Mapa de datasets históricos por fuente" : "Mapa de datasets actuales por fuente"}>{sourceMapTiles.map((tile) => { const latePercentage = tile.outdatedPercentage; const color = latePercentage === null ? "#80868b" : `hsl(${120 * (1 - latePercentage / 100)}, 58%, 40%)`; const details = latePercentage === null ? `${tile.total} datasets · sin datos evaluables` : `${tile.total} datasets · ${tile.outdated} atrasados de ${tile.evaluated} evaluados (${Math.round(latePercentage)}% desactualizados)`; return <button className={`treemap-tile ${source === tile.source ? "selected" : ""}`} key={tile.source} style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%`, backgroundColor: color }} title={`${tile.source}: ${details}`} aria-label={`${tile.source}: ${details}`} aria-pressed={source === tile.source} onClick={() => setSource(source === tile.source ? "Todos" : tile.source)}><span>{tile.source}</span><strong>{tile.total}</strong>{tile.outdatedPercentage !== null && <small>{Math.round(tile.outdatedPercentage)}% atrasados</small>}</button>; })}</div><div className="map-legend"><span>100% atrasados</span><i /><span>100% actualizados</span><span className="map-legend-unknown">Sin datos evaluables</span></div></> : <p className="chart-note">No hay datasets {showHistoricalMap ? "históricos" : "actuales"} para mostrar.</p>}</section>
      <section className="search-card"><div className="search-box"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código SPIM, nombre o ID de portal" /></div><label className="select-box">Fuente <select value={source} onChange={(event) => setSource(event.target.value)}><option>Todos</option>{sources.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></label><label className="select-box">Carpeta <select value={path} onChange={(event) => setPath(event.target.value)}><option>Todos</option>{Array.from(new Set((data.rows || []).map((row) => display(row[field.folder])))).sort().map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></label></section>
      {notice && <div className="notice">{notice}</div>}{error && <div className="error">{error}</div>}
      <section className="results"><div className="results-heading"><div><h2>Datasets del portal</h2><span>{filteredRows.length} coincidencias</span></div><button className="refresh" onClick={() => void load()}>Actualizar</button></div>{filteredRows.length ? <div className="table-scroll"><table><thead><tr><th>Código SPIM</th><th>Información del dataset</th><th>Portal Datax</th><th>Acciones</th></tr></thead><tbody>{filteredRows.map((row, index) => { const serverPath = row[field.serverPath]; const portalUrl = row[field.portalUrl]; const dagAirflow = row[field.dagAirflow]?.trim() || ""; const dagAirflowIds = getAirflowDagIds(dagAirflow); const outdated = isOutdated(row); const historicalCandidate = isHistoricalCandidate(row); const dagAirflowMissing = !dagAirflow; return <tr className={historicalCandidate ? "historical-candidate-row" : outdated ? "outdated-row" : ""} key={`${row[field.portalId] || row[field.code]}-${index}`}><td><code>{display(row[field.code])}</code><span className={`source-tag ${isHistorical(row) ? "history-tag" : historicalCandidate ? "candidate-tag" : ""}`}>{isHistorical(row) ? "OTROS HISTÓRICOS" : historicalCandidate ? "CANDIDATO A HISTÓRICO" : display(row[field.source])}</span></td><td><strong>{display(row[field.analyzeName] || row[field.portalName])}</strong>{historicalCandidate && <span className="historical-candidate-badge">CANDIDATO A HISTÓRICO</span>}{!historicalCandidate && outdated && <span className="outdated-badge">DESACTUALIZADO</span>}<span className="muted">Fuente: {display(row[field.source])} · Carpeta: {display(row[field.folder])}</span><div className="details">{dagAirflowMissing ? <span className="dag-airflow-missing">DAG Airflow: No disponible</span> : <button className="details-copy" onClick={() => void copyPath(dagAirflow)} title="Copiar DAG Airflow">{copied === dagAirflow ? <><Check size={13} /> Copiado</> : <><Clipboard size={13} /> DAG Airflow: {dagAirflow}</>}</button>}<span>{display(row[field.frequency])}</span><span>{display(row[field.date])}</span><span className={historicalCandidate ? "historical-candidate-status" : outdated ? "outdated-status" : ""}>{isHistorical(row) ? "Fuera del cálculo" : display(row[field.criterionStatus])}</span><span>{display(row[field.maxDelay])}</span><span>{row[field.historyCount] || "0"} snapshots</span></div><span className="muted">Último scraping: {display(row[field.lastScrape])}</span></td><td>{portalUrl ? <a className="action-button portal" href={portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Abrir portal</a> : <span className="unavailable">{display(row[field.portalName])}</span>}{row[field.portalId] && <small>ID {row[field.portalId]}</small>}</td><td><div className="access-actions">{serverPath ? <button className="action-button path" onClick={() => void copyPath(serverPath)} title={serverPath}>{copied === serverPath ? <><Check size={15} /> Copiada</> : <><Clipboard size={15} /> Copiar ruta</>}</button> : <span className="unavailable">Sin ruta registrada</span>}{dagAirflowIds.map((dagId) => { const robotCode = getAirflowRobotCode(dagId); return <div className="dag-actions" key={dagId}><a className="action-button dag-link" href={`${airflowDagBaseUrl}/${encodeURIComponent(dagId)}/grid`} target="_blank" rel="noreferrer" title={`Abrir DAG ${dagId} en Airflow`}><ExternalLink size={15} /> Abrir DAG {dagId}</a><a className="action-button dag-trigger" href={getAirflowTriggerUrl(dagId)} target="_blank" rel="noreferrer" title={`Ejecutar robot ${robotCode}`} aria-label={`Ejecutar robot ${robotCode}`}><Play size={15} /></a></div>; })}</div></td></tr>; })}</tbody></table></div> : <div className="empty"><Search size={28} /><strong>No encontramos resultados</strong><span>Prueba con otro filtro o código SPIM.</span></div>}</section>
    </main><footer>Fuente: productos_datax_dataset.csv + DATAX_Consolidacion_Tabla_Web.csv · Corte {formatDate(data.generatedAt)}</footer>
  </div>;
}
