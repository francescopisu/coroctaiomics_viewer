"""Generate display-only meshes and physical-space reslices for one configured case."""
import hashlib
import json
import os
import numpy as np
from skimage.measure import marching_cubes
from .data import ROOT, configuration, configuration_key, image, centerline, resample_frames, sample, CASE_INTERPRETATION, read_case_config
from .inspect_case import inspect
from .volumes import prepare_volumes,prepare_axial_volume
from .features import prepare_features
from .display import smooth_surface,MESH_ITERATIONS,MESH_PASS_BAND

CACHE_VERSION = 9

def signature(conf, paths):
    entries = {k: [str(p), p.stat().st_size, p.stat().st_mtime_ns] for k, p in paths.items()}
    return hashlib.sha256(json.dumps([CACHE_VERSION, conf, entries], sort_keys=True).encode()).hexdigest()

def mesh(mask, affine, directory, name):
    nonzero = np.argwhere(mask)
    lo = np.maximum(nonzero.min(0)-1, 0); hi = np.minimum(nonzero.max(0)+2, mask.shape)
    crop = mask[tuple(slice(a, b) for a, b in zip(lo, hi))]
    # Pad so surfaces close even when a source mask touches an image boundary.
    vertices, faces, _, _ = marching_cubes(np.pad(crop, 1), level=0.5, allow_degenerate=False)
    points = (vertices + lo - 1) @ affine[:3, :3].T + affine[:3, 3]
    if np.linalg.det(affine[:3, :3]) < 0:
        faces = faces[:, [0, 2, 1]]
    cells = np.column_stack([np.full(len(faces), 3), faces]).astype('<u4')
    points.astype('<f4').tofile(directory / f'{name}.points.bin')
    cells.tofile(directory / f'{name}.cells.bin')
    smoothed,normals=smooth_surface(points,cells)
    smoothed.astype('<f4').tofile(directory/f'{name}.smooth.points.bin');normals.astype('<f4').tofile(directory/f'{name}.normals.bin')
    return {"points": f"{name}.points.bin", "cells": f"{name}.cells.bin",
            'smoothPoints':f'{name}.smooth.points.bin','normals':f'{name}.normals.bin',
            'smoothing':{'method':'windowed-sinc','iterations':MESH_ITERATIONS,'passBand':MESH_PASS_BAND,'maximumDisplacementMm':float(np.linalg.norm(smoothed-points,axis=1).max())},
            "vertices": len(points), "triangles": len(faces)}

def prepare(force=False,case_id=None):
    raw=read_case_config(case_id)
    configured_key=configuration_key(raw)
    conf, paths = configuration(raw)
    if configuration_key(read_case_config(case_id))!=configured_key:
        raise RuntimeError('Case configuration changed while reading it. Run preparation again.')
    sig = signature(conf, paths)
    directory = ROOT / 'cache' / conf['patientId']
    directory.mkdir(parents=True, exist_ok=True)
    manifest_path = directory / 'manifest.json'
    if not force and manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        if old.get('signature') == sig and old.get('configurationKey')==configured_key and all((directory / a).is_file() for a in old['assets']) and all((directory/a).is_file() for a in ['axial.ct.npy','axial.labels.npy']):
            if not old.get('axialVolume'):
                print('Adding resident native axial volume to the current cache...',flush=True)
                old['axialVolume']=prepare_axial_volume(directory,old['volumes']['LAD']['scalarType'],old['assets'],f'/api/cases/{conf["patientId"]}/assets/')
                temp=directory/'manifest.tmp';temp.write_text(json.dumps(old));os.replace(temp,manifest_path)
            print('Verified source fingerprint; cache is current.'); return
    report = inspect(raw)
    print('Source geometry and centerline alignment passed.', flush=True)
    n = int(conf['sampling']['widthPixels']); resolution = float(conf['sampling']['resolutionMm'])
    # Pixel centres: even-sized 50-pixel plane has its centre between the central pixels.
    offsets = (np.arange(n) - (n-1)/2) * resolution
    x, y = np.meshgrid(offsets, offsets)
    frames = {v: resample_frames(centerline(paths[f'line_{v}']), conf['sampling']['pointSpacingMm'])
              for v in conf['centerlineFiles']}
    grids = {v: np.asarray(f['points'])[:, None, None, :] + x[None, :, :, None]*np.asarray(f['u'])[:, None, None, :]
             + y[None, :, :, None]*np.asarray(f['v'])[:, None, None, :] for v, f in frames.items()}
    cpr_grids = {v: np.asarray(f['points'])[:, None, :] + offsets[None, :, None]*np.asarray(f['u'])[:, None, :]
                 for v, f in frames.items()}
    assets, surfaces = [], {}
    for key in ['lumen_merged', 'lumen_left', 'lumen_right', 'cpe_LAD', 'cpe_LCx', 'cpe_RCA']+(['ascending_aorta'] if 'ascending_aorta' in paths else []):
        img, affine = image(paths[key]); mask = np.asarray(img.dataobj) > 0
        print(f'Extracting {key} surface...', flush=True)
        surfaces[key] = mesh(mask, affine, directory, key)
        assets += [surfaces[key]['points'], surfaces[key]['cells']]
        assets += [surfaces[key]['smoothPoints'],surfaces[key]['normals']]
        targets = frames if key == 'lumen_merged' else {key[4:]: frames[key[4:]]} if key.startswith('cpe_') else {}
        for vessel in targets:
            name = f'{vessel}.{"lumen" if key == "lumen_merged" else "cpe"}.bin'
            sample(mask.astype(np.uint8), affine, grids[vessel], order=0).astype('u1').tofile(directory/name)
            assets.append(name)
            name = f'{vessel}.{"lumen" if key == "lumen_merged" else "cpe"}.cpr.bin'
            sample(mask.astype(np.uint8), affine, cpr_grids[vessel], order=0).astype('u1').tofile(directory/name)
            assets.append(name)
        del mask
    img, affine = image(paths['ct'])
    # Apply NIfTI intensity scaling via dataobj. No spatial resampling or downsampling of the source.
    ct = np.asarray(img.dataobj, dtype=np.float32)
    for vessel in frames:
        print(f'Sampling full-resolution CCTA along {vessel}...', flush=True)
        name = f'{vessel}.ct.bin'
        values = sample(ct, affine, grids[vessel], order=1, outside=-1024).astype('<f4')
        values.tofile(directory/name); assets.append(name)
        name = f'{vessel}.ct.cpr.bin'
        sample(ct, affine, cpr_grids[vessel], order=1, outside=-1024).astype('<f4').tofile(directory/name)
        assets.append(name)
        cpe = np.fromfile(directory/f'{vessel}.cpe.bin', dtype='u1').reshape(values.shape)
        coverage = cpe.any(axis=(1, 2))
        frames[vessel]['cpeSliceRangeMm'] = [float(np.asarray(frames[vessel]['distances'])[coverage][i]) for i in [0, -1]] if coverage.any() else None
    prefix = f'/api/cases/{conf["patientId"]}/assets/'
    print('Preparing native-resolution CPR volumes and axial cache...',flush=True)
    volumes = prepare_volumes(directory,frames,paths,ct,affine,assets,prefix)
    axial_volume=prepare_axial_volume(directory,volumes['LAD']['scalarType'],assets,prefix)
    features=prepare_features(directory,conf,paths,report['images']['ct'],assets,prefix)
    for s in surfaces.values():
        s['points'], s['cells'] = prefix+s['points'], prefix+s['cells']
        s['smoothPoints'],s['normals']=prefix+s['smoothPoints'],prefix+s['normals']
    if configuration_key(read_case_config(case_id))!=configured_key or signature(conf,paths)!=sig:
        raise RuntimeError('Case configuration or source files changed during preparation. Run preparation again.')
    manifest = {"patientId": conf['patientId'], "signature": sig, "configurationKey":configured_key, "coordinateSystem": "LPS", "units": "mm",
        "sampling": conf['sampling'], "cpe": {"output": conf['directories']['cpe'], "nominalLengthMm": conf['cpeLengthMm'], "radialFactor": 4},
        "geometry": report['images']['ct'], "alignment": report['centerlines'], "surfaces": surfaces,
        "volumes":volumes, "axial":f'/api/cases/{conf["patientId"]}/axial',"axialVolume":axial_volume,"featureMaps":features,
        "vessels": {v: {**f, "ct": prefix+f'{v}.ct.bin', "lumen": prefix+f'{v}.lumen.bin', "cpe": prefix+f'{v}.cpe.bin',
                        "ctCPR": prefix+f'{v}.ct.cpr.bin', "lumenCPR": prefix+f'{v}.lumen.cpr.bin', "cpeCPR": prefix+f'{v}.cpe.cpr.bin'} for v, f in frames.items()},
        "assets": assets,
        "interpretation": CASE_INTERPRETATION}
    temp = directory/'manifest.tmp'; temp.write_text(json.dumps(manifest)); os.replace(temp, manifest_path)
    print(f'Ready: {directory}; {sum((directory / a).stat().st_size for a in assets)/1e6:.1f} MB of viewer assets.', flush=True)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument('--force', action='store_true');parser.add_argument('--case',dest='case_id')
    args=parser.parse_args();prepare(args.force,args.case_id)
