import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  Database,
  ExternalLink,
  FileDown,
  Search,
  Table2,
} from "lucide-react";

type DatasetRow = Record<string, string>;
type FileInfo = { name: string; size: number; modified: string; download: string };
type StatusPayload = {
  generatedAt: string;
  dataset: { rows: number; file: FileInfo | null };
  rows: DatasetRow[];
};

const field = {
  code: "Código SPIM",
  analyzeName: "Nombre Analyze",
  portalName: "Nombre producto Portal",
  portalId: "ID producto Portal",
  portalUrl: "URL producto Portal",
  serverPath: "Ruta descarga en servidor",
  source: "Presencia en fuentes",
  identification: "Estado identificación SPIM",
  frequency: "Frecuencia de datos",
  analyzePath: "Path Analyze",
  recordsDatax: "Registros DatasetsDatax",
  recordsWeb: "Registros tabla web",
} as const;

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function display(value?: string) {
  return value && value.trim() && value !== "-" ? value : "No disponible";
}

export default function App() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("Todos");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("No se pudo consultar la consolidación.");
      setData(await response.json() as StatusPayload);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sources = useMemo(() => {
    const values = new Set((data?.rows || []).map((row) => row[field.source]).filter(Boolean));
    return Array.from(values).sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (data?.rows || []).filter((row) => {
      const searchable = [
        row[field.code],
        row[field.analyzeName],
        row[field.portalName],
        row[field.portalId],
      ].join(" ").toLowerCase();
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (source === "Todos" || row[field.source] === source);
    });
  }, [data, query, source]);

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(path);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("No se pudo copiar la ruta. Selecciónela manualmente.");
    }
  }

  if (loading && !data) return <main className="loading"><Database className="pulse" /> Cargando consolidación...</main>;
  if (!data) return <main className="loading"><p>{error}</p><button className="text-button" onClick={() => void load()}>Reintentar</button></main>;

  const withPortal = data.rows.filter((row) => row[field.portalUrl]).length;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <div className="logo"><Table2 size={21} /></div>
          <div><strong>Datax</strong><span>Consolidación SPIM</span></div>
        </a>
        <div className="header-actions">
          <span className="last-update">Actualizado {formatDate(data.generatedAt)}</span>
          {data.dataset.file && <a className="download-link" href={data.dataset.file.download}><FileDown size={16} /> Descargar CSV</a>}
        </div>
      </header>

      <main className="content">
        <section className="intro">
          <div>
            <p className="overline">CATÁLOGO DE DATOS</p>
            <h1>Busca un código SPIM</h1>
            <p className="subtitle">Consulta la información consolidada de Datax, el portal web y las rutas de descarga internas.</p>
          </div>
          <div className="summary">
            <div><strong>{data.dataset.rows.toLocaleString("es-BO")}</strong><span>registros</span></div>
            <div><strong>{withPortal.toLocaleString("es-BO")}</strong><span>con portal</span></div>
          </div>
        </section>

        <section className="search-card">
          <div className="search-box"><Search size={20} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código SPIM, nombre o ID de portal" /></div>
          <label className="select-box">Fuente <select value={source} onChange={(event) => setSource(event.target.value)}><option>Todos</option>{sources.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></label>
        </section>

        {error && <div className="error">{error}</div>}

        <section className="results">
          <div className="results-heading"><div><h2>Resultados</h2><span>{filteredRows.length} coincidencias</span></div><button className="refresh" onClick={() => void load()}>Actualizar</button></div>
          {filteredRows.length ? <div className="table-scroll"><table><thead><tr><th>Código SPIM</th><th>Información del dataset</th><th>Portal Datax</th><th>Descarga en servidor</th></tr></thead><tbody>
            {filteredRows.map((row, index) => {
              const path = row[field.serverPath];
              const portalUrl = row[field.portalUrl];
              return <tr key={`${row[field.code]}-${index}`}>
                <td><code>{display(row[field.code])}</code><span className="source-tag">{display(row[field.source])}</span></td>
                <td><strong>{display(row[field.analyzeName] || row[field.portalName])}</strong><span className="muted">{display(row[field.analyzePath])}</span><div className="details"><span>{display(row[field.frequency])}</span><span>{row[field.recordsDatax] || "0"} registros Datax</span><span>{row[field.recordsWeb] || "0"} web</span></div></td>
                <td>{portalUrl ? <a className="action-button portal" href={portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Abrir portal</a> : <span className="unavailable">{display(row[field.portalName])}</span>}{row[field.portalId] && <small>ID {row[field.portalId]}</small>}</td>
                <td>{path ? <button className="action-button path" onClick={() => void copyPath(path)} title={path}>{copied === path ? <><Check size={15} /> Copiada</> : <><Clipboard size={15} /> Copiar ruta</>}</button> : <span className="unavailable">Sin ruta registrada</span>}</td>
              </tr>;
            })}
          </tbody></table></div> : <div className="empty"><Search size={28} /><strong>No encontramos ese código SPIM</strong><span>Prueba con otro código, nombre o limpia los filtros.</span></div>}
        </section>
      </main>
      <footer>Fuente: DATAX_Consolidacion_Tabla_Web.csv · Corte {formatDate(data.generatedAt)}</footer>
    </div>
  );
}
