"""Adapter probes must match what is installed, and missing tools must refuse."""

import importlib.util

from creature_factory.adapters import (
    AdapterUnavailable,
    CeleryQueue,
    MinioStore,
    PostgresStore,
    TrellisAdapter,
    find_blender,
    find_unreal,
    probe_environment,
)
from creature_factory.config import load_settings


def test_missing_generators_refuse():
    try:
        TrellisAdapter().generate("in.png", "out")
        raise AssertionError("TRELLIS should have refused")
    except AdapterUnavailable as exc:
        assert "TRELLIS" in str(exc)
    try:
        CeleryQueue().submit("job")
        raise AssertionError("Celery should have refused")
    except AdapterUnavailable as exc:
        assert "Celery" in str(exc)
    try:
        PostgresStore("postgresql://localhost/none")
        raise AssertionError("Postgres should have refused")
    except AdapterUnavailable as exc:
        assert "PostgreSQL" in str(exc)
    try:
        MinioStore("http://127.0.0.1:9000")
        raise AssertionError("MinIO should have refused")
    except AdapterUnavailable as exc:
        assert "MinIO" in str(exc)


def test_probes_do_not_claim_unused_tools():
    report = {item["name"]: item for item in probe_environment(load_settings())}
    for name in ("trellis2", "comfyui", "blender", "unreal", "celery", "langgraph", "quadriflow", "rigify", "postgres", "minio"):
        assert report[name]["used_by_pipeline"] is False
        if not report[name]["available"]:
            text = report[name]["detail"].lower()
            assert any(token in text for token in ("not", "missing", "absent", "no ", "unavailable")), text
    assert report["jobs"]["active"] == "inline"
    assert report["metadata"]["active"] == "sqlite"
    assert report["offline_mvp"]["used_by_pipeline"] is True
    assert report["trellis2"]["available"] == (importlib.util.find_spec("trellis") is not None or importlib.util.find_spec("trellis2") is not None)
    assert report["langgraph"]["available"] == (importlib.util.find_spec("langgraph") is not None)
    assert report["blender"]["available"] == (find_blender(None) is not None)
    assert report["unreal"]["available"] == (find_unreal() is not None)
