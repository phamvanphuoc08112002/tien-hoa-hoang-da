# Creature Factory

Offline-first pipeline for a game-ready stylized creature. The active generator is labeled `offline_mvp` in `config/default.yaml`. It builds a quadruped with pure Python: vertices, quad faces, UVs, a skeleton, skin weights, sampled animation curves, and procedural PBR images, then writes glTF. It does not call TRELLIS, ComfyUI, Blender, or Unreal.

The existing Phaser game in the parent folder is not part of this project and was not modified.

## Run the API and dashboard

From this folder:

```text
python -m pip install -r requirements.txt
python run.py serve
```

Open http://127.0.0.1:8765

The form runs the 13-stage pipeline. `stylized AAA` is the default quality profile (10k–40k triangles, 2048² PBR). `preview` uses the same checks with a smaller mesh and 128² textures.

Generate the sample Emberback without the browser:

```text
python run.py generate --sample
python run.py probe
```

Sample output:

`outputs/creatures/CR-quadruped-emberback-sample`

## Tests

```text
python -m pytest
```

Last run on this machine: **15 passed** in about 9 seconds. Tests use the preview profile and temporary folders. They do not need a GPU, Unreal, Redis, Postgres, or MinIO.

One warning is printed: Starlette 1.10 prefers the `httpx2` package, and this environment has `httpx`. The API tests still pass.

## What works today

- Quadruped only: 4 legs, 1 head, 1 tail, optional horns and a few back spikes. Wings and other limb counts are rejected.
- Closed quad mesh, part-atlas UVs, linear subdivision to the quality budget, LOD0–LOD3.
- LOD3 and the collision mesh are a box proxy, not a QuadriFlow remesh.
- Procedural PBR set: base color, normal, metallic-roughness.
- Custom quadruped skeleton, 4 influences per vertex, saved in glTF and `rig/weights.npz`.
- Seven clips: idle, walk, run, jump, attack, hit, death. Walk and run plant the feet with a 2-bone IK solve.
- Quality report with a 0–100 score. Critical failures reject the job or loop back one stage.
- FastAPI dashboard: form, tool status, job result, previews, score, download zip, library.
- SQLite metadata and local folders. Other archetypes write a skeleton stub and stop.

Stylized sample Emberback: quality score 100, decision accept, LOD0 10944 triangles, LOD1 2736, LOD2 684, LOD3 84, textures 2048².

## What was found on this machine

| Tool | State |
| --- | --- |
| Python 3.13, FastAPI, Uvicorn, NumPy, Pillow, PyYAML, pytest | Installed and used |
| Redis server | Installed, answers `PING`. Not used. The `redis` and `celery` Python packages are not installed |
| TRELLIS.2 | Not installed. No weights downloaded |
| ComfyUI | No server on port 8188. Concept art is Pillow |
| Blender / Rigify / QuadriFlow | `blender.exe` and `quadriflow` were not found. No bpy script was executed |
| Unreal Editor | Not installed. `unreal/import_creature.py` is written and not run |
| LangGraph | Not installed. `pipeline/engine.py` runs the stages |
| PostgreSQL | No server and no `psql`. Metadata is SQLite |
| MinIO | No server and no Python client. Files stay on disk |

Calling the TRELLIS, Celery, Postgres, or MinIO adapters raises `AdapterUnavailable` instead of returning a fake result.

## Layout per creature

```text
Creature_ID/
  concept/          concept.png, design.json, mesh_preview.png
  mesh/             creature.gltf + bin, lod0–lod3, collision, retopo.json
  textures/         basecolor, normal, metallic_roughness
  materials/        material.json
  rig/              skeleton.json, weights.npz, weights_summary.json
  animations/       idle, walk, run, jump, attack, hit, death
  unreal/           import script, physics description, anim state list, status.json
  metadata.json
  quality_report.json
  logs/pipeline.jsonl
```

`mesh/creature.gltf` is the skinned hero with all seven animations. There is no FBX file. FBX export was not invented because Blender is absent.

## Honest limits

- The mesh is a constructed quadruped, not a TRELLIS reconstruction of the concept image.
- Textures are tiled procedural noise in the atlas. They are not a unique bake of every texel from the high-resolution mesh.
- Subdivision is linear, so the silhouette stays close to the control cage. It is not Catmull-Clark and not QuadriFlow.
- Skin weights are assigned by body part and blended across joints. They are not a heat-diffusion solve.
- Animations are authored curves and IK, not motion capture. Jump, attack, hit, and death are posed directly and are not foot-slide tested.
- The Unreal files describe an import, a physics setup, and an animation state list. No Skeletal Mesh, Physics Asset, or AnimBP was created in an editor.
- A quality score of 100 means the automated checks passed. It is not a sign-off from a character artist.
- Biped, winged, insectoid, serpentine, aquatic, and hybrid stop after a distinct skeleton stub.
