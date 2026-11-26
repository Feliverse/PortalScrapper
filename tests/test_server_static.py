import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.request import urlopen

import server as portal_server


class StaticServingTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.frontend_dir = self.root / "frontend" / "dist"
        self.assets_dir = self.frontend_dir / "assets"
        self.assets_dir.mkdir(parents=True)
        (self.frontend_dir / "index.html").write_text("<main>Dashboard</main>", encoding="utf-8")
        (self.assets_dir / "app.css").write_text("body { color: navy; }", encoding="utf-8")
        self.csv_path = self.root / "consolidation.csv"
        self.csv_path.write_bytes(b"id\n1\n")

        self.settings = patch.multiple(
            portal_server,
            ROOT=self.root,
            FRONTEND_DIR=self.frontend_dir,
            CSV_PATH=self.csv_path,
        )
        self.settings.start()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), portal_server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        self.settings.stop()
        self.temporary_directory.cleanup()

    def test_serves_index_inline_under_configured_base_path(self):
        with urlopen(f"{self.base_url}/PortalScrapper/") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "text/html")
            self.assertIsNone(response.headers.get("Content-Disposition"))
            self.assertEqual(response.read(), b"<main>Dashboard</main>")

    def test_serves_assets_under_configured_base_path(self):
        with urlopen(f"{self.base_url}/PortalScrapper/assets/app.css") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "text/css")
            self.assertIsNone(response.headers.get("Content-Disposition"))
            self.assertEqual(response.read(), b"body { color: navy; }")

    def test_keeps_root_asset_paths_working(self):
        with urlopen(f"{self.base_url}/assets/app.css") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "text/css")
            self.assertEqual(response.read(), b"body { color: navy; }")

    def test_keeps_file_downloads_as_attachments(self):
        with urlopen(f"{self.base_url}/downloads/consolidacion/consolidation.csv") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get("Content-Disposition"), 'attachment; filename="consolidation.csv"')
            self.assertEqual(response.read(), b"id\n1\n")


if __name__ == "__main__":
    unittest.main()
