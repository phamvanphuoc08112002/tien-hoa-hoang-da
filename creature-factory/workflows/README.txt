ComfyUI / TRELLIS workflows for Creature Factory
================================================

These JSON files are ComfyUI API-format graphs (File → Export Workflow API).

concept_hero_api.json
  - Standard SD1.5 txt2img for Hero Type 1 concept art
  - Requires checkpoint: models/checkpoints/v1-5-pruned-emaonly.safetensors
    (or change ckpt_name in the JSON to a checkpoint you already have)
  - GTX 1050 4GB: start ComfyUI with --lowvram --preview-method auto

trellis_image_to_3d
  - Not bundled as a fixed graph because TRELLIS custom-node class names
    differ by install (ComfyUI-TRELLIS / TRELLIS.2 wrappers).
  - When your ComfyUI install exposes a TRELLIS image-to-3D node, export
    that workflow as API JSON to:
      workflows/trellis_image_to_3d_api.json
  - The factory TrellisAdapter will load it if present and if ComfyUI is up.

Hardware note
  This machine probed as NVIDIA GeForce GTX 1050 (4 GB).
  TRELLIS.2 typically needs ~8–24 GB VRAM. Concept art via SD1.5 may work
  with --lowvram; local TRELLIS mesh generation is unlikely to run here.
  Use a stronger GPU or a remote ComfyUI URL in config/default.yaml.
