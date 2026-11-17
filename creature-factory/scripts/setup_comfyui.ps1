# Clone ComfyUI next to the factory and print the remaining model steps.
# Does NOT download multi-GB checkpoints or TRELLIS weights.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root "tools"
$Comfy = Join-Path $Tools "ComfyUI"

Write-Host "GPU check (nvidia-smi):"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null
Write-Host ""

New-Item -ItemType Directory -Force -Path $Tools | Out-Null
if (-not (Test-Path (Join-Path $Comfy "main.py"))) {
    Write-Host "Cloning ComfyUI into $Comfy ..."
    git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git $Comfy
} else {
    Write-Host "ComfyUI already present at $Comfy"
}

Write-Host ""
Write-Host "Next steps (manual - large downloads):"
Write-Host "  1. cd `"$Comfy`""
Write-Host "  2. python -m venv .venv"
Write-Host "  3. .\.venv\Scripts\Activate.ps1"
Write-Host "  4. pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124"
Write-Host "  5. pip install -r requirements.txt"
Write-Host "  6. Put an SD1.5 (or other) .safetensors into models\checkpoints\"
Write-Host "     and set ckpt_name in workflows\concept_hero_api.json if the name differs."
Write-Host "  7. Start with low VRAM flags on GTX 1050 4GB:"
Write-Host "       python main.py --listen 127.0.0.1 --port 8188 --lowvram"
Write-Host "  8. From creature-factory: python run.py generate --hero --profile hero_stylized"
Write-Host ""
Write-Host "TRELLIS.2 needs much more than 4 GB VRAM. Do not expect local image-to-3D"
Write-Host "on this GPU. Point comfyui_url at a remote ComfyUI with TRELLIS if you have one."
