const stages = ["intake", "design", "concept", "generate_3d", "mesh_validate", "retopo", "uv", "materials", "rig", "animate", "export", "quality", "package"];

async function loadSystem() {
  const data = await (await fetch("/api/system")).json();
  const active = data.tools.find((tool) => tool.name === "offline_mvp");
  document.querySelector("#banner").textContent = active.detail + " External engines are shown below and are not invoked unless they are installed.";
  document.querySelector("#tools").innerHTML = data.tools.map((tool) => {
    const state = tool.used_by_pipeline ? "in use" : tool.available ? "found, not used" : "missing";
    const klass = tool.used_by_pipeline || tool.available ? "ok" : "no";
    return `<div class="tool"><b>${tool.name}</b> <span class="${klass}">${state}</span><div>${tool.detail}</div></div>`;
  }).join("");
}

async function loadLibrary() {
  const rows = await (await fetch("/api/library")).json();
  const host = document.querySelector("#library");
  if (!rows.length) {
    host.textContent = "No creatures yet.";
    return;
  }
  host.innerHTML = rows.map((row) => `
    <div class="card">
      <b>${row.species}</b> ${row.id}
      <div>${row.archetype} · ${row.status} · score ${row.quality_score ?? "n/a"}</div>
    </div>
  `).join("");
}

function showJob(job) {
  document.querySelector("#job-empty").hidden = true;
  const box = document.querySelector("#job");
  box.hidden = false;
  const index = Math.max(stages.indexOf(job.stage), 0);
  const pct = job.status === "completed" || job.status === "rejected" ? 100 : Math.round((index / stages.length) * 100);
  document.querySelector("#bar").style.width = pct + "%";
  const score = job.result && job.result.quality_score != null ? job.result.quality_score : "pending";
  document.querySelector("#job-meta").textContent = `${job.creature_id} · ${job.status} · stage ${job.stage || "-"} · ${job.error || ""}`;
  document.querySelector("#score").textContent = `Quality score: ${score}`;
  document.querySelector("#rig").textContent = job.status === "completed"
    ? "Rig and seven clips are in the creature folder. Unreal was not launched."
    : "Rig status follows the job. A rejected archetype has a skeleton stub only.";
  const link = document.querySelector("#download");
  if (job.status === "completed" || job.status === "rejected" || job.status === "failed") {
    link.hidden = false;
    link.href = `/api/creatures/${job.creature_id}/download`;
    link.textContent = "Download " + job.creature_id;
    document.querySelector("#concept").src = `/files/${job.creature_id}/concept/concept.png?t=${Date.now()}`;
    document.querySelector("#mesh").src = `/files/${job.creature_id}/concept/mesh_preview.png?t=${Date.now()}`;
  }
}

document.querySelector("#form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const status = document.querySelector("#form-status");
  status.textContent = "Running the offline pipeline…";
  const palette = String(form.get("palette")).split(",").map((color) => color.trim()).filter(Boolean);
  const body = {
    species: form.get("species"),
    archetype: form.get("archetype"),
    category: form.get("category"),
    style: form.get("style"),
    quality_profile: form.get("quality_profile"),
    element: form.get("element"),
    rarity: form.get("rarity"),
    surface_material: form.get("surface_material"),
    horns: Number(form.get("horns")),
    spikes: Number(form.get("spikes")),
    batch: Number(form.get("batch")),
    palette,
    prompt: form.get("prompt"),
    leg_count: 4,
    head_count: 1,
    tail_count: 1,
    wing_count: 0,
    extra_limbs: 0,
    sync: true,
  };
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    status.textContent = payload.detail || "Request failed";
    return;
  }
  status.textContent = `Finished ${payload.jobs.length} job(s).`;
  showJob(payload.jobs[0]);
  loadLibrary();
});

loadSystem();
loadLibrary();
