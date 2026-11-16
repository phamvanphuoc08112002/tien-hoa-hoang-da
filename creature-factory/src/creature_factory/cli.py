"""Command line for probes, generation, and the dashboard server."""

from __future__ import annotations

import argparse
import json

from creature_factory.adapters import probe_environment
from creature_factory.adapters.metadata_store import SqliteMetadata
from creature_factory.config import load_settings
from creature_factory.pipeline import now
from creature_factory.pipeline.engine import execute_pipeline
from creature_factory.specs import sample_emberback


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="creature-factory")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("probe", help="Print which external tools are actually installed")
    generate = sub.add_parser("generate", help="Run the offline pipeline once")
    generate.add_argument("--sample", action="store_true", help="Generate the Emberback quadruped")
    generate.add_argument("--profile", default=None)
    serve = sub.add_parser("serve", help="Start the API and dashboard")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    args = parser.parse_args(argv)
    settings = load_settings()
    if args.command == "probe":
        print(json.dumps(probe_environment(settings), indent=2))
        return
    if args.command == "generate":
        spec = sample_emberback(args.profile or settings.quality_profile)
        if args.profile:
            spec.quality_profile = args.profile
        result = execute_pipeline(spec, settings, job_id="cli")
        store = SqliteMetadata(settings.database_path)
        stamp = now()
        store.insert_job(
            {
                "id": "cli-" + spec.creature_id,
                "creature_id": spec.creature_id,
                "status": result["status"],
                "stage": result.get("stage"),
                "batch_id": "cli",
                "created_at": stamp,
                "updated_at": stamp,
                "spec_json": spec.model_dump_json(),
                "error": result.get("error"),
                "result_json": json.dumps(result),
            }
        )
        store.upsert_creature(
            {
                "id": spec.creature_id,
                "species": spec.species,
                "archetype": spec.archetype,
                "quality_score": result.get("quality_score"),
                "status": result["status"],
                "output_dir": result.get("output_dir"),
                "created_at": stamp,
                "metadata_json": json.dumps({"quality_decision": result.get("quality_decision"), "generator": result.get("generator")}),
            }
        )
        print(json.dumps({key: result[key] for key in ("status", "creature_id", "quality_score", "quality_decision", "output_dir", "error", "generator", "orchestrator")}, indent=2))
        return
    if args.command == "serve":
        import uvicorn

        from creature_factory.api import create_app

        uvicorn.run(create_app(settings), host=args.host or settings.host, port=args.port or settings.port)
