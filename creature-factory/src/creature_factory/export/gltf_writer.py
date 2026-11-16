"""glTF 2.0 writer for the offline MVP. FBX is not emitted unless Blender is actually run."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from creature_factory.anim.clips import Clip
from creature_factory.math3d import ID_QUAT
from creature_factory.mesh import Mesh, vertex_normals
from creature_factory.rig.skeleton import Skeleton

_FLOAT = 5126
_USHORT = 5123
_UINT = 5125
_ARRAY = 34962
_ELEMENT = 34963


class _Blob:
    def __init__(self) -> None:
        self.data = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def _align(self) -> None:
        while len(self.data) % 4:
            self.data.append(0)

    def add(self, array: np.ndarray, acc_type: str, component: int, target: int | None, minimum=None, maximum=None) -> int:
        self._align()
        packed = np.ascontiguousarray(array)
        start = len(self.data)
        raw = packed.tobytes()
        self.data.extend(raw)
        view_index = len(self.views)
        view = {"buffer": 0, "byteOffset": start, "byteLength": len(raw)}
        if target:
            view["target"] = target
        self.views.append(view)
        accessor = {
            "bufferView": view_index,
            "byteOffset": 0,
            "componentType": component,
            "count": int(packed.shape[0]),
            "type": acc_type,
        }
        if minimum is not None:
            accessor["min"] = minimum
            accessor["max"] = maximum
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def _pack_vertices(mesh: Mesh, skeleton: Skeleton | None):
    normals = vertex_normals(mesh)
    bone_index = {} if skeleton is None else {name: index for index, name in enumerate(skeleton.names)}
    lookup: dict[tuple, int] = {}
    positions = []
    norms = []
    uvs = []
    joints = []
    weights = []
    indices: list[int] = []
    for face, quad in enumerate(mesh.quads):
        corners = []
        for corner, vertex in enumerate(quad):
            uv = mesh.uvs[face][corner]
            key = (vertex, round(uv[0], 5), round(uv[1], 5))
            if key not in lookup:
                lookup[key] = len(positions)
                positions.append(mesh.positions[vertex])
                norms.append(normals[vertex])
                uvs.append(uv)
                if skeleton is not None:
                    influences = sorted(mesh.weights[vertex].items(), key=lambda item: item[1], reverse=True)[:4]
                    joint = [0, 0, 0, 0]
                    weight = [0.0, 0.0, 0.0, 0.0]
                    for slot, (name, value) in enumerate(influences):
                        joint[slot] = bone_index[name]
                        weight[slot] = float(value)
                    total = sum(weight) or 1.0
                    weights.append([value / total for value in weight])
                    joints.append(joint)
            corners.append(lookup[key])
        a, b, c, d = corners
        indices.extend((a, b, c, a, c, d))
    return (
        np.array(positions, dtype=np.float32),
        np.array(norms, dtype=np.float32),
        np.array(uvs, dtype=np.float32),
        np.array(joints, dtype=np.uint16) if joints else None,
        np.array(weights, dtype=np.float32) if weights else None,
        np.array(indices, dtype=np.uint32),
    )


def write_gltf(
    path: Path,
    mesh: Mesh,
    skeleton: Skeleton | None = None,
    clips: dict[str, Clip] | None = None,
    texture_uris: dict[str, str] | None = None,
) -> None:
    positions, normals, uvs, joints, weights, indices = _pack_vertices(mesh, skeleton)
    blob = _Blob()
    index_component = _USHORT if len(positions) < 65535 else _UINT
    index_array = indices.astype(np.uint16 if index_component == _USHORT else np.uint32)
    index_acc = blob.add(index_array, "SCALAR", index_component, _ELEMENT)
    position_acc = blob.add(
        positions,
        "VEC3",
        _FLOAT,
        _ARRAY,
        positions.min(axis=0).round(6).tolist(),
        positions.max(axis=0).round(6).tolist(),
    )
    normal_acc = blob.add(normals, "VEC3", _FLOAT, _ARRAY)
    uv_acc = blob.add(uvs, "VEC2", _FLOAT, _ARRAY)
    attributes = {"POSITION": position_acc, "NORMAL": normal_acc, "TEXCOORD_0": uv_acc}
    if joints is not None and weights is not None:
        attributes["JOINTS_0"] = blob.add(joints, "VEC4", _USHORT, _ARRAY)
        attributes["WEIGHTS_0"] = blob.add(weights, "VEC4", _FLOAT, _ARRAY)

    nodes: list[dict] = []
    skin = None
    if skeleton is not None:
        children: dict[str, list[int]] = {name: [] for name in skeleton.names}
        for index, name in enumerate(skeleton.names):
            parent = skeleton.parent[name]
            if parent is not None:
                children[parent].append(index)
        for name in skeleton.names:
            node = {"name": name, "translation": [round(float(v), 6) for v in skeleton.local_translation[name]]}
            kids = children[name]
            if kids:
                node["children"] = kids
            nodes.append(node)
        matrices = []
        inverse = skeleton.inverse_bind()
        for name in skeleton.names:
            matrices.append(np.transpose(inverse[name]))
        ibm = np.stack(matrices).astype(np.float32)
        ibm_acc = blob.add(ibm.reshape(len(skeleton.names), 16), "MAT4", _FLOAT, None)
        skin = {"inverseBindMatrices": ibm_acc, "joints": list(range(len(skeleton.names))), "skeleton": 0}
        mesh_node = {"name": path.stem, "mesh": 0, "skin": 0}
    else:
        mesh_node = {"name": path.stem, "mesh": 0}
    mesh_node_index = len(nodes)
    nodes.append(mesh_node)

    images = []
    textures = []
    material: dict = {"name": "creature", "doubleSided": False, "pbrMetallicRoughness": {"metallicFactor": 0.05, "roughnessFactor": 0.55}}
    if texture_uris:
        ordered = [
            ("baseColor", "baseColorTexture", False),
            ("metallicRoughness", "metallicRoughnessTexture", False),
            ("normal", "normalTexture", True),
        ]
        for name, _slot, _is_normal in ordered:
            images.append({"uri": texture_uris[name], "mimeType": "image/png"})
            textures.append({"sampler": 0, "source": len(images) - 1})
        material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
        material["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": 1}
        material["normalTexture"] = {"index": 2}

    primitive = {"attributes": attributes, "indices": index_acc, "material": 0}
    animations = []
    if skeleton is not None and clips:
        for clip in clips.values():
            samplers = []
            channels = []
            time_acc = blob.add(
                np.array(clip.times, dtype=np.float32),
                "SCALAR",
                _FLOAT,
                None,
                [float(clip.times[0])],
                [float(clip.times[-1])],
            )
            for bone, keys in clip.rotations.items():
                values = np.array(keys, dtype=np.float32)
                if values.shape[0] != len(clip.times):
                    raise RuntimeError(f"{clip.name} {bone} key count does not match times")
                out_acc = blob.add(values, "VEC4", _FLOAT, None)
                sampler_index = len(samplers)
                samplers.append({"input": time_acc, "output": out_acc, "interpolation": "LINEAR"})
                channels.append({"sampler": sampler_index, "target": {"node": skeleton.names.index(bone), "path": "rotation"}})
            if clip.root_translation:
                values = np.array(clip.root_translation, dtype=np.float32)
                out_acc = blob.add(values, "VEC3", _FLOAT, None)
                sampler_index = len(samplers)
                samplers.append({"input": time_acc, "output": out_acc, "interpolation": "LINEAR"})
                channels.append({"sampler": sampler_index, "target": {"node": 0, "path": "translation"}})
            animations.append({"name": clip.name, "samplers": samplers, "channels": channels})

    bin_name = path.with_suffix(".bin").name
    document = {
        "asset": {"version": "2.0", "generator": "creature-factory offline_mvp 0.1.0"},
        "scene": 0,
        "scenes": [{"nodes": [mesh_node_index, 0] if skeleton is not None else [mesh_node_index]}],
        "nodes": nodes,
        "meshes": [{"name": path.stem, "primitives": [primitive]}],
        "buffers": [{"uri": bin_name, "byteLength": len(blob.data)}],
        "bufferViews": blob.views,
        "accessors": blob.accessors,
        "materials": [material],
    }
    if images:
        document["images"] = images
        document["textures"] = textures
        document["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    if skin is not None:
        document["skins"] = [skin]
    if animations:
        document["animations"] = animations
    path.parent.mkdir(parents=True, exist_ok=True)
    path.with_suffix(".bin").write_bytes(blob.data)
    path.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")


def validate_gltf(path: Path) -> list[str]:
    errors = []
    if not path.is_file():
        return [f"missing glTF {path}"]
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"glTF JSON is broken: {exc}"]
    if document.get("asset", {}).get("version") != "2.0":
        errors.append("asset.version is not 2.0")
    buffers = document.get("buffers") or []
    if len(buffers) != 1:
        errors.append("expected one buffer")
        return errors
    bin_path = path.parent / buffers[0]["uri"]
    if not bin_path.is_file():
        errors.append("buffer file is missing")
        return errors
    payload = bin_path.read_bytes()
    if len(payload) != buffers[0]["byteLength"]:
        errors.append("buffer byteLength does not match the file")
    for view in document.get("bufferViews", []):
        start = int(view.get("byteOffset", 0))
        end = start + int(view["byteLength"])
        if start < 0 or end > len(payload):
            errors.append("bufferView is outside the buffer")
    accessors = document.get("accessors", [])
    for accessor in accessors:
        if accessor["bufferView"] >= len(document.get("bufferViews", [])):
            errors.append("accessor points at a missing bufferView")
        if accessor["count"] <= 0:
            errors.append("accessor count is empty")
    for image in document.get("images", []):
        uri = image.get("uri", "")
        if uri and not (path.parent / uri).is_file():
            errors.append(f"missing texture {uri}")
    return errors
