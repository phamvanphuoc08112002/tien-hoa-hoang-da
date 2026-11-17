"""Real ComfyUI HTTP client. Uses the documented /prompt, /history, /view routes."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from creature_factory.adapters import AdapterUnavailable


class ComfyUIClient:
    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout
        self.client_id = str(uuid.uuid4())

    def _url(self, path: str) -> str:
        return urljoin(self.base_url, path.lstrip("/"))

    def alive(self) -> bool:
        try:
            response = httpx.get(self._url("/system_stats"), timeout=2.0)
            return response.status_code == 200
        except httpx.HTTPError:
            return False

    def object_info(self) -> dict[str, Any]:
        response = httpx.get(self._url("/object_info"), timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def has_node(self, class_type: str) -> bool:
        try:
            return class_type in self.object_info()
        except httpx.HTTPError:
            return False

    def queue_prompt(self, workflow: dict[str, Any]) -> str:
        payload = {"prompt": workflow, "client_id": self.client_id}
        response = httpx.post(self._url("/prompt"), json=payload, timeout=self.timeout)
        if response.status_code >= 400:
            detail = response.text[:500]
            raise AdapterUnavailable("ComfyUI", f"prompt rejected ({response.status_code}): {detail}")
        data = response.json()
        if "error" in data:
            raise AdapterUnavailable("ComfyUI", f"prompt error: {data['error']}")
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            raise AdapterUnavailable("ComfyUI", f"no prompt_id in response: {data}")
        return str(prompt_id)

    def wait_history(self, prompt_id: str, timeout_s: float = 600.0, poll_s: float = 1.5) -> dict[str, Any]:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            response = httpx.get(self._url(f"/history/{prompt_id}"), timeout=self.timeout)
            response.raise_for_status()
            payload = response.json()
            if prompt_id in payload:
                return payload[prompt_id]
            time.sleep(poll_s)
        raise AdapterUnavailable("ComfyUI", f"timed out waiting for prompt {prompt_id}")

    def download_image(self, image_meta: dict[str, Any], dest: Path) -> Path:
        params = {
            "filename": image_meta["filename"],
            "subfolder": image_meta.get("subfolder", ""),
            "type": image_meta.get("type", "output"),
        }
        response = httpx.get(self._url("/view"), params=params, timeout=self.timeout)
        response.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(response.content)
        return dest

    def first_saved_image(self, history: dict[str, Any]) -> dict[str, Any]:
        outputs = history.get("outputs") or {}
        for _node_id, node_out in outputs.items():
            images = node_out.get("images") or []
            if images:
                return images[0]
        raise AdapterUnavailable("ComfyUI", "workflow finished but no SaveImage outputs were found")

    def run_workflow_to_image(self, workflow: dict[str, Any], dest: Path, timeout_s: float = 600.0) -> Path:
        prompt_id = self.queue_prompt(workflow)
        history = self.wait_history(prompt_id, timeout_s=timeout_s)
        image_meta = self.first_saved_image(history)
        return self.download_image(image_meta, dest)


def load_workflow(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise AdapterUnavailable("ComfyUI", f"workflow file missing: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def set_prompt_text(workflow: dict[str, Any], positive: str, negative: str | None = None) -> dict[str, Any]:
    """Fill the first two CLIPTextEncode nodes: positive then negative."""
    clip_nodes = [node_id for node_id, node in workflow.items() if node.get("class_type") == "CLIPTextEncode"]
    if not clip_nodes:
        raise AdapterUnavailable("ComfyUI", "workflow has no CLIPTextEncode nodes")
    workflow[clip_nodes[0]]["inputs"]["text"] = positive
    if negative is not None and len(clip_nodes) > 1:
        workflow[clip_nodes[1]]["inputs"]["text"] = negative
    return workflow


def set_seed(workflow: dict[str, Any], seed: int) -> dict[str, Any]:
    for node in workflow.values():
        if node.get("class_type") == "KSampler" and "seed" in node.get("inputs", {}):
            node["inputs"]["seed"] = int(seed)
            break
    return workflow
