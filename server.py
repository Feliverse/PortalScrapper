import csv
import json
import mimetypes
import subprocess
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from openpyxl import Workbook
from openpyxl.styles import Font


ROOT = Path(__file__).resolve().parent
V2_DIR = ROOT / "v2"
CSV_PATH = V2_DIR / "productos_datax_dataset.csv"
HISTORY_DIR = V2_DIR / "historial_productos"
FRONTEND_DIR = ROOT / "frontend" / "dist"
PORT = 8000


def csv_rows(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file, delimiter=";"))


def file_metadata(path):
    if not path.exists():
        return None
    modified = datetime.fromtimestamp(path.stat().st_mtime)
    return {
        "name": path.name,
        "size": path.stat().st_size,
        "modified": modified.isoformat(timespec="seconds"),
        "download": f"/downloads/{path.name}",
    }


def status_payload():
    rows = csv_rows(CSV_PATH)
    counts = {}
    for row in rows:
        state = row.get("Estado de actualización", "Sin fecha")
        counts[state] = counts.get(state, 0) + 1
    excel_files = sorted(V2_DIR.glob("comparacion_productos_*.xlsx"))
    snapshots = sorted(HISTORY_DIR.glob("productos_*.csv"))
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "dataset": {
            "rows": len(rows),
            "counts": counts,
            "file": file_metadata(CSV_PATH),
        },
        "latestComparison": file_metadata(excel_files[-1]) if excel_files else None,
        "snapshots": [
            file_metadata(path) for path in reversed(snapshots[-10:])
        ],
        "rows": rows,
        "rules": [
            {"name": "Al día", "description": "Menos del 80% del ciclo de actualización."},
            {"name": "Próximo a vencer", "description": "Entre 80% y 100% del ciclo esperado."},
            {"name": "Atrasado", "description": "Superó el ciclo de actualización."},
            {"name": "Sin fecha", "description": "No hay una fecha de actualización válida."},
            {"name": "Periodicidad no reconocida", "description": "La periodicidad no tiene una regla configurada."},
        ],
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
