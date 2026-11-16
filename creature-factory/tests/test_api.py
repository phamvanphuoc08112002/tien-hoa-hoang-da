"""Dashboard and generate API. Uses the preview profile so it stays local and fast."""

import io
import zipfile

from starlette.testclient import TestClient

from creature_factory.api import create_app
from creature_factory.config import load_settings


def _app(tmp_path):
    settings = load_settings()
    settings.output_dir = tmp_path / "out"
    settings.database_path = tmp_path / "factory.sqlite"
    settings.quality_profile = "preview"
    return create_app(settings)


def test_dashboard_and_generate(tmp_path):
    client = TestClient(_app(tmp_path))
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["generator"] == "offline_mvp"
    page = client.get("/")
    assert page.status_code == 200
    assert "Generate" in page.text
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/assets/styles.css").status_code == 200
    system = client.get("/api/system")
    tools = {item["name"]: item for item in system.json()["tools"]}
    assert tools["trellis2"]["used_by_pipeline"] is False
    assert tools["unreal"]["used_by_pipeline"] is False

    response = client.post(
        "/api/generate",
        json={
            "species": "Emberback",
            "archetype": "quadruped",
            "quality_profile": "preview",
            "horns": 2,
            "spikes": 0,
            "wing_count": 0,
            "palette": ["#8C3A2F", "#E3A008", "#2B2118", "#F4E1C1"],
            "sync": True,
            "batch": 1,
        },
    )
    assert response.status_code == 200, response.text
    job = response.json()["jobs"][0]
    assert job["status"] == "completed", job
    assert job["result"]["quality_score"] >= 85
    library = client.get("/api/library")
    assert library.json()[0]["id"] == job["creature_id"]
    download = client.get(f"/api/creatures/{job['creature_id']}/download")
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        names = set(archive.namelist())
    assert "metadata.json" in names
    assert "quality_report.json" in names
    assert "mesh/creature.gltf" in names
    preview = client.get(f"/files/{job['creature_id']}/concept/concept.png")
    assert preview.status_code == 200
    assert preview.content[:8] == b"\x89PNG\r\n\x1a\n"
    blocked = client.get(f"/files/{job['creature_id']}/../factory.sqlite")
    assert blocked.status_code in {400, 404}
