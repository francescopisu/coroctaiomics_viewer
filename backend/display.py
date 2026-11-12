"""Display derivatives only; input label arrays and NIfTI files are never changed."""
import numpy as np
from scipy.ndimage import gaussian_filter

EDGE_SIGMA_MM = .35
MESH_ITERATIONS = 40
MESH_PASS_BAND = .03

def display_mask(mask, spacing):
    field=gaussian_filter(mask.astype('f4'),sigma=EDGE_SIGMA_MM/np.asarray(spacing),mode='constant',cval=0)
    return np.rint(np.clip(field,0,1)*255).astype('u1')

def smooth_surface(points, cells):
    import vtk
    from vtk.util.numpy_support import numpy_to_vtk,numpy_to_vtkIdTypeArray,vtk_to_numpy
    poly=vtk.vtkPolyData();p=vtk.vtkPoints();p.SetData(numpy_to_vtk(points,deep=True));poly.SetPoints(p)
    triangles=vtk.vtkCellArray();triangles.ImportLegacyFormat(numpy_to_vtkIdTypeArray(cells.astype(np.int64).ravel(),deep=True));poly.SetPolys(triangles)
    smooth=vtk.vtkWindowedSincPolyDataFilter();smooth.SetInputData(poly);smooth.SetNumberOfIterations(MESH_ITERATIONS);smooth.SetPassBand(MESH_PASS_BAND)
    smooth.NormalizeCoordinatesOn();smooth.BoundarySmoothingOff();smooth.FeatureEdgeSmoothingOff();smooth.NonManifoldSmoothingOff()
    normals=vtk.vtkPolyDataNormals();normals.SetInputConnection(smooth.GetOutputPort());normals.SplittingOff();normals.ConsistencyOn();normals.ComputePointNormalsOn();normals.Update()
    result=normals.GetOutput()
    return vtk_to_numpy(result.GetPoints().GetData()).copy(),vtk_to_numpy(result.GetPointData().GetNormals()).copy()
