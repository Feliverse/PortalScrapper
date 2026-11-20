import json
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server


PUBLIC_DIR = ROOT / "frontend" / "public"
DOWNLOAD_DIR = PUBLIC_DIR / "downloads" / "consolidacion"
OUTPUT_JSON = PUBLIC_DIR / "status.json"

payload = server.status_payload()
payload["staticMode"] = True

csv_file = server.CSV_PATH
if csv_file.exists():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(csv_file, DOWNLOAD_DIR / csv_file.name)
    payload["dataset"]["file"] = {
        "name": csv_file.name,
        "size": csv_file.stat().st_size,
        "modified": payload["dataset"]["file"]["modified"] if payload["dataset"]["file"] else "",
        "download": f"{server.mimetypes.guess_type(csv_file.name)[0] or 'text/csv'}",
    }
    payload["dataset"]["file"]["download"] = "./downloads/consolidacion/" + csv_file.name

OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
print(f"Exportada la instantánea estática: {OUTPUT_JSON}")
