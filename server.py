import csv
import json
import mimetypes
import re
import subprocess
import sys
import unicodedata
from calendar import monthrange
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from openpyxl import Workbook
from openpyxl.styles import Font


ROOT = Path(__file__).resolve().parent
V2_DIR = ROOT / "v2"
CSV_PATH = ROOT / "diccionary" / "DATAX_Consolidacion_Tabla_Web.csv"
PORTAL_CSV_PATH = V2_DIR / "productos_datax_dataset.csv"
HISTORY_DIR = V2_DIR / "historial_productos"
FRONTEND_DIR = ROOT / "frontend" / "dist"
PORT = 8000
DELAY_CRITERIA_PATH = ROOT / "diccionary" / "maximoRetraso.csv"
DELAY_TOLERANCE = 1.2


def csv_rows(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file, delimiter=";"))


def path_metadata(raw_path):
    parts = [part.strip() for part in re.split(r"[\\/]+", raw_path or "") if part.strip()]
    historical = bool(parts and parts[0].upper() == "OTROS HISTÓRICOS")
    source_index = 1 if historical else 0
    return {
        "Fuente origen": parts[source_index] if len(parts) > source_index else "Sin fuente",
        "Carpeta dataset": parts[-1] if parts else "Sin carpeta",
        "Es otros históricos": "Sí" if historical else "No",
    }


def load_delay_criteria():
    if not DELAY_CRITERIA_PATH.exists():
        return {}
    with DELAY_CRITERIA_PATH.open("r", encoding="utf-8-sig", newline="") as file:
        for _ in range(4):
            next(file, "")
        criteria = {}
        for row in csv.DictReader(file, delimiter=";"):
            path = row.get("Path", "").strip()
            name = row.get("Cubo / Dataset", "").strip()
            if path and name:
                criteria[(path, name)] = row
        return criteria


def _normalized(value):
    text = unicodedata.normalize("NFKD", value or "")
    return "".join(character for character in text if not unicodedata.combining(character)).lower()


def delay_offset(value):
    match = re.search(
        r"(\d+(?:[,.]\d+)?)\s*(?:-\s*(\d+(?:[,.]\d+)?)\s*)?(ano|mes|semana|seman|dia)",
        _normalized(value),
    )
    if not match:
        return None
    first = float(match.group(1).replace(",", "."))
    second = float(match.group(2).replace(",", ".")) if match.group(2) else first
    return (first + second) / 2, _normalized(match.group(3))


def add_months(value, months):
    whole_months = int(months)
    target_month = value.month - 1 + whole_months
    year = value.year + target_month // 12
    month = target_month % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def add_frequency(value, frequency):
    normalized = _normalized(frequency)
    months = {
        "mensual": 1,
        "bimestral": 2,
        "trimestral": 3,
        "cuatrimestral": 4,
        "semestral": 6,
        "anual": 12,
    }
    for name, amount in months.items():
        if name in normalized:
            return add_months(value, amount)
    if "diari" in normalized:
        return value + timedelta(days=1)
    if "seman" in normalized:
        return value + timedelta(days=7)
    return None


def fecha_limite_con_retraso(fecha, frecuencia, maximo_retraso, multiplicador):
    try:
        publicada = datetime.strptime(fecha[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None

    fecha_limite = add_frequency(publicada, frecuencia)
    retraso = delay_offset(maximo_retraso)
    if fecha_limite is None or retraso is None:
        return None

    cantidad, unidad = retraso
    cantidad *= multiplicador
    if unidad in {"ano", "mes"}:
        total_meses = cantidad * (12 if unidad == "ano" else 1)
        meses_enteros = int(total_meses)
        fecha_limite = add_months(fecha_limite, meses_enteros)
        fecha_limite += timedelta(days=round((total_meses - meses_enteros) * 30))
    else:
        fecha_limite += timedelta(days=cantidad * (7 if unidad.startswith("seman") else 1))
    return fecha_limite


def criterio_actualizacion(fecha, frecuencia, maximo_retraso, hoy=None):
    try:
        publicada = datetime.strptime(fecha[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return "Sin fecha"

    fecha_limite = fecha_limite_con_retraso(fecha, frecuencia, maximo_retraso, DELAY_TOLERANCE)
    if fecha_limite is None:
        return "Sin criterio"

    return "Actualizado" if (hoy or date.today()) <= fecha_limite else "Atrasado"


def es_candidato_historico(fecha, frecuencia, maximo_retraso, hoy=None):
    fecha_limite = fecha_limite_con_retraso(fecha, frecuencia, maximo_retraso, 2)
    return fecha_limite is not None and (hoy or date.today()) > fecha_limite


def file_metadata(path):
    if not path.exists():
        return None
    modified = datetime.fromtimestamp(path.stat().st_mtime)
    return {
        "name": path.name,
        "size": path.stat().st_size,
        "modified": modified.isoformat(timespec="seconds"),
        "download": f"/downloads/consolidacion/{path.name}" if path == CSV_PATH else f"/downloads/{path.name}",
    }


def status_payload():
    consolidation_rows = csv_rows(CSV_PATH)
    consolidation_by_id = {
        row.get("ID producto Portal", "").strip(): row
        for row in consolidation_rows
        if row.get("ID producto Portal", "").strip()
    }
    delay_criteria = load_delay_criteria()
    history_files = sorted(HISTORY_DIR.glob("productos_*.csv"))
    history_by_id = {}
    history_values = {}
    for history_file in history_files:
        match = re.search(r"productos_(\d{8}_\d{6})\.csv$", history_file.name)
        seen_at = (
            datetime.strptime(match.group(1), "%Y%m%d_%H%M%S").isoformat(timespec="seconds")
            if match
            else datetime.fromtimestamp(history_file.stat().st_mtime).isoformat(timespec="seconds")
        )
        for history_row in csv_rows(history_file):
            dataset_id = history_row.get("ID", "").strip()
            if not dataset_id:
                continue
            history_by_id.setdefault(dataset_id, []).append(seen_at)
            history_values.setdefault(dataset_id, []).append(history_row.get("Fecha", ""))

    portal_rows = csv_rows(PORTAL_CSV_PATH)
    rows = []
    for portal_row in portal_rows:
        row = dict(portal_row)
        row.update(consolidation_by_id.get(portal_row.get("ID", "").strip(), {}))
        row.update(path_metadata(row.get("Path Analyze", "")))
        criterion = delay_criteria.get((
            row.get("Path Analyze", "").strip(),
            row.get("Nombre Analyze", "").strip(),
        ))
        row["Máximo retraso"] = criterion.get("maximo_retraso", "") if criterion else ""
        row["Estado según criterio"] = criterio_actualizacion(
            portal_row.get("Fecha", ""),
            portal_row.get("Periodicidad", "") or row.get("Periodicidad Portal", ""),
            row["Máximo retraso"],
        )
        row["Candidato a histórico"] = (
            "Sí"
            if row.get("Es otros históricos") != "Sí"
            and es_candidato_historico(
                portal_row.get("Fecha", ""),
                portal_row.get("Periodicidad", "") or row.get("Periodicidad Portal", ""),
                row["Máximo retraso"],
            )
            else "No"
        )
        dataset_id = portal_row.get("ID", "").strip()
        observations = history_by_id.get(dataset_id, [])
        dates = history_values.get(dataset_id, [])
        row["Históricos scraper"] = str(len(observations))
        row["Último scraping"] = max(observations) if observations else ""
        row["Fecha cambió en históricos"] = "Sí" if len(set(dates)) > 1 else "No"
        rows.append(row)
    source_stats = {}
    for row in rows:
        if row.get("Es otros históricos") == "Sí":
            continue
        source = row.get("Fuente origen") or "Sin fuente"
        stats = source_stats.setdefault(source, {"total": 0, "evaluated": 0, "outdated": 0})
        stats["total"] += 1
        if row.get("Estado según criterio") in {"Actualizado", "Atrasado"}:
            stats["evaluated"] += 1
        if row.get("Estado según criterio") == "Atrasado":
            stats["outdated"] += 1
    outdated_by_source = [
        {
            "source": source,
            "total": stats["total"],
            "evaluated": stats["evaluated"],
            "outdated": stats["outdated"],
            "index": round(stats["outdated"] / stats["evaluated"] * 100) if stats["evaluated"] else 0,
        }
        for source, stats in source_stats.items()
    ]
    outdated_by_source.sort(key=lambda item: (-item["index"], -item["outdated"], item["source"]))
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "dataset": {
            "rows": len(rows),
            "file": file_metadata(CSV_PATH),
        },
        "outdatedBySource": outdated_by_source,
        "rows": rows,
    }


def csv_to_excel():
    if not CSV_PATH.exists():
        raise FileNotFoundError("No existe el CSV principal.")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output = V2_DIR / f"productos_datax_dataset_{timestamp}.xlsx"
    rows = csv_rows(CSV_PATH)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Datasets"
    if rows:
        headers = list(rows[0].keys())
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for row in rows:
            sheet.append([row.get(header, "") for header in headers])
        sheet.freeze_panes = "A2"
        for column in sheet.columns:
            width = max(len(str(cell.value or "")) for cell in column) + 2
            sheet.column_dimensions[column[0].column_letter].width = min(width, 60)
    workbook.save(output)
    return output


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path):
        if not path.exists() or not path.is_file() or ROOT not in path.resolve().parents:
            self.send_error(404)
            return
        content = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self._send_json(status_payload())
            return
        if parsed.path.startswith("/downloads/consolidacion/"):
            requested = unquote(parsed.path.removeprefix("/downloads/consolidacion/"))
            if requested == CSV_PATH.name:
                self._send_file(CSV_PATH)
            else:
                self.send_error(404)
            return
        if parsed.path.startswith("/downloads/"):
            requested = unquote(parsed.path.removeprefix("/downloads/"))
            self._send_file((V2_DIR / requested).resolve())
            return
        if FRONTEND_DIR.exists():
            requested = parsed.path.removeprefix("/")
            candidate = (FRONTEND_DIR / requested).resolve()
            if not candidate.is_file() or FRONTEND_DIR.resolve() not in candidate.parents:
                candidate = FRONTEND_DIR / "index.html"
            self._send_file(candidate)
            return
        self.send_error(404, "Construye el frontend con npm run build.")

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/run-v2":
                result = subprocess.run(
                    [sys.executable, str(V2_DIR / "PortalScrapper.py")],
                    cwd=V2_DIR,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    check=False,
                )
                if result.returncode:
                    self._send_json({"error": result.stderr or result.stdout}, 500)
                else:
                    self._send_json({"message": result.stdout, "status": status_payload()})
                return
            if parsed.path == "/api/convert-excel":
                output = csv_to_excel()
                self._send_json({"file": file_metadata(output)})
                return
            self.send_error(404)
        except (OSError, ValueError, FileNotFoundError) as error:
            self._send_json({"error": str(error)}, 500)

    def log_message(self, format_string, *args):
        print(f"[portal] {format_string % args}")


if __name__ == "__main__":
    print(f"Dashboard disponible en http://localhost:{PORT}")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()
