"""Read-only source discovery and explicit physical LPS geometry."""
import ast
import csv
import json
import os
import hashlib
import re
from functools import lru_cache
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CASE_INTERPRETATION = ('CPE is a lumen-excluded radiomic sampling region, not a tissue classification, plaque or disease map. '
                       'AI predictions are computed separately from patient-level features using saved Cox models. '
                       'Voxelwise feature maps are not local event-risk predictions.')
LPS_FROM_RAS = np.diag([-1., -1., 1., 1.])

@lru_cache(maxsize=4096)
def _read_json(path,modified,size):
    return json.loads(Path(path).read_text())

def read_json(path):
    stat=path.stat()
    return _read_json(str(path),stat.st_mtime_ns,stat.st_size)

def validate_case_config(conf):
    pid = str(conf['patientId'])
    if not re.fullmatch(r'[A-Za-z0-9_-]+',pid):
        raise ValueError('patientId must be a single case identifier')
    return {**conf,'patientId':pid}

def catalog_configurations():
    if os.environ.get("CORONARY_PORTABLE_HOME"):
        from .portable import configurations
        return configurations()
    override = os.environ.get('CORONARY_CATALOG_CONFIG')
    if not override and not os.environ.get('CORONARY_CASE_CONFIG'):
        from .registry import cases as registry_cases
        return registry_cases()
    path = Path(override) if override else None
    if path is None:
        conf = read_case_config()
        return {conf['patientId']:conf}
    entries = read_json(path)['cases']
    cases = {}
    for entry in entries:
        source = Path(entry)
        if not source.is_absolute():source=path.parent/source
        conf=validate_case_config(read_json(source))
        if conf['patientId'] in cases:raise ValueError('Duplicate patient ID in case catalogue')
        cases[conf['patientId']]=conf
    return cases

def read_case_config(case_id=None):
    if case_id is not None:
        cases=catalog_configurations()
        if case_id not in cases:raise LookupError('Patient is not in the case catalogue')
        return cases[case_id]
    override = os.environ.get('CORONARY_CASE_CONFIG')
    if override:return validate_case_config(read_json(Path(override)))
    cases = catalog_configurations()
    if not cases:raise ValueError('Add at least one patient to config/viewer.local.json.')
    return next(iter(cases.values()))

def imaging_config(conf):
    """Clinical sources/overrides never invalidate CT or mesh preparation."""
    return {key:value for key,value in conf.items() if key not in ('patientData','aiInput')}

def configuration_key(conf=None):
    conf = read_case_config() if conf is None else conf
    if conf.get('portablePackage')==1:return conf['configurationKey']
    defaults = Path(conf['pipelineRoot'])/'config/defaults.py'
    if conf.get('configurationError'):raise ValueError(conf['configurationError'])
    return hashlib.sha256(json.dumps([imaging_config(conf),defaults.read_text()],sort_keys=True).encode()).hexdigest()

def configuration(conf=None):
    conf = dict(read_case_config() if conf is None else conf)
    if conf.get('configurationError'):raise ValueError(conf['configurationError'])
    defaults_path = Path(conf["pipelineRoot"]) / "config/defaults.py"
    # Parse literal assignments without importing torch, yacs, or pipeline side effects.
    values = {}
    for node in ast.walk(ast.parse(defaults_path.read_text())):
        if isinstance(node, ast.Assign):
            try:
                values[ast.unparse(node.targets[0])] = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                pass
    names = {k: values[f"_C.{v}.OUT_DIRNAME"] for k, v in {
        "lumen": "POSTPROCESSING", "segmentation": "LUMEN_SEGMENTATION",
        "cpe": "PERILUMINAL_EXTRACTION", "labeling": "CENTERLINE_LABELING",
        "mesh": "MESH_EXTRACTION", "centerline": "CENTERLINE_EXTRACTION",
        "mpr": "MPR_EXTRACTION", "radiomics": "RADIOMICS"}.items()}
    if names["cpe"] != "periluminal_r4":
        raise ValueError("Pipeline CPE output is not periluminal_r4; explicitly review configuration.")
    conf["directories"] = names
    conf["sampling"] = {k: values[f"_C.MPR_EXTRACTION.{v}"] for k, v in {
        "resolutionMm": "TARGET_RESOLUTION", "widthPixels": "MPR_WIDTH",
        "pointSpacingMm": "POINT_SPACING", "resample": "RESAMPLE_CENTERLINE"}.items()}
    conf["cpeLengthMm"] = values["_C.PERILUMINAL_EXTRACTION.LENGTH"]
    conf["skipMm"] = values["_C.PERILUMINAL_EXTRACTION.SKIP_MM"]
    out, pid = Path(conf["outputRoot"]), conf["patientId"]
    ct_id = re.fullmatch(r'(\d+)\.nii(?:\.gz)?',Path(conf['ct']).name)
    if ct_id and ct_id[1] != pid:
        raise ValueError(f'CCTA case {ct_id[1]} does not match patientId {pid}')
    paths = {"ct": Path(conf["ct"])}
    aorta=Path(conf.get('ascendingAorta',out/'cardiac_structures'/'asc_aorta_shell.nii.gz'))
    if aorta.is_file() or 'ascendingAorta' in conf:paths['ascending_aorta']=aorta
    for side in ["merged", "left", "right"]:
        paths[f"lumen_{side}"] = out / names["lumen"] / f"{pid}_lumen_mask_post_{side}.nii.gz"
    for vessel, filename in conf["centerlineFiles"].items():
        if Path(filename).name != filename or not filename.startswith(f'{pid}_'):
            raise ValueError(f'{vessel} centerline {filename} does not match case {pid}')
        paths[f"cpe_{vessel}"] = out / names["cpe"] / f"{pid}_{vessel.upper()}_periluminal.nii.gz"
        paths[f"line_{vessel}"] = out / names["labeling"] / filename
        paths[f"markup_{vessel}"] = paths[f"line_{vessel}"].with_suffix(".mrk.json")
    from .features import discover_maps
    conf['featureFiles']=discover_maps(conf.get('radiomicFeatureMaps'),pid)
    for entries in conf['featureFiles'].values():
        for entry in entries:paths['feature_'+entry['id']]=Path(entry['path'])
    missing = [str(p) for p in paths.values() if not p.is_file()]
    if missing:
        raise FileNotFoundError("Required source files unavailable (check /Volumes/X9Pro mount): " + ", ".join(missing))
    return conf, paths

def image(path):
    import nibabel as nib
    img = nib.load(str(path))
    return img, LPS_FROM_RAS @ img.affine

def sample(data, affine_lps, points, order=0, outside=0):
    from scipy.ndimage import map_coordinates
    points = np.asarray(points)
    inverse = np.linalg.inv(affine_lps)
    ijk = points.reshape(-1, 3) @ inverse[:3, :3].T + inverse[:3, 3]
    return map_coordinates(data, ijk.T, order=order, mode="constant", cval=outside,
                           prefilter=False).reshape(points.shape[:-1])

def centerline(path):
    with path.open() as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["x", "y", "z", "radius", "zone"]:
            raise ValueError(f"Unexpected inspected CSV schema: {reader.fieldnames}")
        rows = [[float(row[c]) for c in ["x", "y", "z", "radius", "zone"]] for row in reader]
    values = np.asarray(rows)
    if len(values) < 2 or not np.isfinite(values).all():
        raise ValueError("Invalid centerline")
    return values

def resample_frames(values, spacing):
    points = values[:, :3]
    keep = np.r_[True, np.linalg.norm(np.diff(points, axis=0), axis=1) > 1e-6]
    points, radii = points[keep], values[keep, 3]
    distance = np.r_[0., np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
    distances = np.unique(np.r_[np.arange(0., distance[-1], spacing), distance[-1]])
    points = np.column_stack([np.interp(distances, distance, points[:, c]) for c in range(3)])
    radius = np.interp(distances, distance, radii)
    tangent = np.gradient(points, distances, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    # Minimal-rotation parallel transport, then orthonormalize. Never reset the normal.
    axis = np.eye(3)[np.argmin(np.abs(tangent[0]))]
    u = np.zeros_like(points)
    u[0] = np.cross(tangent[0], axis)
    u[0] /= np.linalg.norm(u[0])
    for i in range(1, len(points)):
        a, b = tangent[i-1], tangent[i]
        cross = np.cross(a, b)
        cosine = np.clip(np.dot(a, b), -1., 1.)
        if cosine < -0.999999:
            raise ValueError("Centerline reverses direction; frame is ambiguous")
        u[i] = u[i-1] + np.cross(cross, u[i-1]) + np.cross(cross, np.cross(cross, u[i-1])) / (1 + cosine)
        u[i] -= np.dot(u[i], b) * b
        u[i] /= np.linalg.norm(u[i])
    v = np.cross(tangent, u)
    return {"points": points.tolist(), "distances": distances.tolist(), "radii": radius.tolist(),
            "u": u.tolist(), "v": v.tolist(), "tangents": tangent.tolist()}


def case_directory(case_id):
    if os.environ.get('CORONARY_PORTABLE_HOME'):
        from .portable import home
        return home()/'patients'/case_id
    return ROOT/'cache'/case_id
