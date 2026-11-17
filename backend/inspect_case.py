"""Inspect headers, source masks, Slicer markups and optional VTP geometry."""
import json
import numpy as np
from scipy.spatial import cKDTree
from vtkmodules.vtkIOXML import vtkXMLPolyDataReader
from vtkmodules.util.numpy_support import vtk_to_numpy
from .data import ROOT, configuration, image, centerline, sample, read_case_config

def inspect(case_config=None):
    conf, paths = configuration(case_config)
    report = {"patientId": conf["patientId"], "directories": conf["directories"],
              "sampling": conf["sampling"], "images": {}, "centerlines": {}, "polydata": {}}
    ct, ct_affine = image(paths["ct"])
    lumen_img, lumen_affine = image(paths["lumen_merged"])
    lumen = np.asarray(lumen_img.dataobj) > 0
    lumen_xyz = np.argwhere(lumen)
    tree = cKDTree(lumen_xyz @ lumen_affine[:3, :3].T + lumen_affine[:3, 3])
    for name, path in paths.items():
        if not name.startswith(("ct", "lumen", "cpe")):
            continue
        img, affine = image(path)
        same = img.shape == ct.shape and np.allclose(affine, ct_affine, atol=1e-5)
        report["images"][name] = {"shape": list(img.shape), "spacingMm": list(map(float, img.header.get_zooms())),
            "originLPS": affine[:3, 3].tolist(), "directionLPS": (affine[:3, :3] / img.header.get_zooms()).tolist(),
            "affineRAS": img.affine.tolist(), "affineLPS": affine.tolist(), "dtype": str(img.get_data_dtype()),
            "qformCode": int(img.header['qform_code']), "sformCode": int(img.header['sform_code']), "sameGridAsCT": same}
        if not same:
            raise ValueError(f"{name} not on CT grid; review geometry before preparing.")
        if name.startswith("cpe"):
            mask = np.asarray(img.dataobj) > 0
            report["images"][name]["voxels"] = int(mask.sum())
            report["images"][name]["lumenOverlapVoxels"] = int((mask & lumen).sum())
            if (mask & lumen).any():
                raise ValueError(f"{name} overlaps merged lumen; source review required")
    for vessel in conf["centerlineFiles"]:
        values = centerline(paths[f"line_{vessel}"])
        points = values[:, :3]
        markup = json.loads(paths[f"markup_{vessel}"].read_text())["markups"][0]
        if markup["coordinateSystem"] != "LPS" or markup["coordinateUnits"] != "mm":
            raise ValueError("Centerline markup is not LPS millimetres")
        markup_points = np.asarray([p["position"] for p in markup["controlPoints"]])
        distances = tree.query(points)[0]
        hits = sample(lumen.astype(np.uint8), lumen_affine, points)
        # Every source point must be inside or within 1 mm of the voxel centres in lumen.
        if distances.max() > 1.:
            raise ValueError(f"{vessel} centerline is not aligned with lumen: {distances.max():.3f} mm")
        report["centerlines"][vessel] = {"columns": ["x", "y", "z", "radius", "zone"],
            "coordinateSystem": "LPS", "points": len(points), "lengthMm": float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum()),
            "insideLumenFraction": float(hits.mean()), "maxDistanceToLumenVoxelMm": float(distances.max()),
            "markupPoints": len(markup_points), "csvToMarkupMaxNearestMm": float(cKDTree(markup_points).query(points)[0].max())}
    out = paths["lumen_merged"].parent.parent
    for folder, pattern in [("mesh", "*subtree.vtp"), ("centerline", "*combined*.vtp")]:
        for path in (out / conf["directories"][folder]).glob(pattern):
            reader = vtkXMLPolyDataReader(); reader.SetFileName(str(path)); reader.Update()
            poly = reader.GetOutput(); pts = vtk_to_numpy(poly.GetPoints().GetData())
            attrs = lambda d: [d.GetArrayName(i) for i in range(d.GetNumberOfArrays())]
            # Check actual points in native and explicitly sign-converted coordinates.
            lps = tree.query(pts)[0]; ras = tree.query(pts * [-1, -1, 1])[0]
            report["polydata"][path.name] = {"points": poly.GetNumberOfPoints(), "polys": poly.GetNumberOfPolys(),
                "lines": poly.GetNumberOfLines(), "bounds": list(poly.GetBounds()),
                "pointData": attrs(poly.GetPointData()), "cellData": attrs(poly.GetCellData()), "fieldData": attrs(poly.GetFieldData()),
                "nativeLPSDistanceMedianMm": float(np.median(lps)), "ifRASDistanceMedianMm": float(np.median(ras)),
                "coordinateEvidence": "Native points align as LPS; no coordinate-system field metadata. Not used for display."}
    directory=ROOT/'cache'/conf['patientId'];directory.mkdir(parents=True,exist_ok=True)
    encoded=json.dumps(report,indent=2)
    (directory/'inspection.json').write_text(encoded)
    # Preserve the default-case report for existing diagnostics. Preparing another
    # catalogue patient must not replace a report identified as the default case.
    if conf['patientId']==read_case_config()['patientId']:
        ROOT.joinpath('cache/inspection.json').write_text(encoded)
    return report

if __name__ == "__main__":
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--case',dest='case_id');args=parser.parse_args()
    r = inspect(read_case_config(args.case_id))
    print(json.dumps({"centerlines": r["centerlines"], "polydata": r["polydata"],
        "CPE": {k: {x: v[x] for x in ["voxels", "lumenOverlapVoxels"]} for k, v in r["images"].items() if k.startswith("cpe")}}, indent=2))
