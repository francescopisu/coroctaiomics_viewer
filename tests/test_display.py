import json
import unittest
import numpy as np
from backend.data import ROOT,read_case_config
from backend.display import display_mask

class DisplayDerivativeTests(unittest.TestCase):
    def test_display_field_removes_voxel_specks_and_preserves_the_lumen_hole(self):
        x,y,z=np.indices((48,48,32));r=np.hypot(x-24,y-24)
        mask=(r>=5)&(r<=13)&(z>=5)&(z<=27);mask[42,12:30,16]=1;before=mask.copy()
        field=display_mask(mask,[.42,.42,.3])/255
        np.testing.assert_array_equal(mask,before)
        self.assertLess(field[42,:,16].max(),.5);self.assertLess(field[24,24,16],.01);self.assertGreater(field[33,24,16],.99)

    def test_prepared_meshes_keep_geometry_scale_and_have_smooth_normals(self):
        directory=ROOT/'cache'/read_case_config()['patientId'];m=json.loads((directory/'manifest.json').read_text())
        if not any(s.get('smoothPoints') for s in m['surfaces'].values()):self.skipTest('No smoothed derivatives prepared')
        for s in m['surfaces'].values():
            read=lambda key,dtype:np.fromfile(directory/s[key].rsplit('/',1)[-1],dtype=dtype)
            raw=read('points','<f4').reshape(-1,3).astype('f8');smooth=read('smoothPoints','<f4').reshape(-1,3).astype('f8');normals=read('normals','<f4').reshape(-1,3)
            self.assertEqual(raw.shape,smooth.shape);self.assertEqual(normals.shape,raw.shape);self.assertTrue(np.isfinite(smooth).all())
            np.testing.assert_allclose(np.linalg.norm(normals,axis=1),1,atol=1e-5)
            self.assertLess(np.linalg.norm(smooth-raw,axis=1).max(),.5)
            f=read('cells','<u4').reshape(-1,4)[:,1:];origin=raw.mean(0)
            volume=lambda p:abs(np.einsum('ij,ij->i',(p-origin)[f[:,0]],np.cross((p-origin)[f[:,1]],(p-origin)[f[:,2]])).sum()/6)
            self.assertLess(abs(volume(smooth)/volume(raw)-1),.01)
        if 'ascending_aorta' in m['surfaces']:self.assertGreater(m['surfaces']['ascending_aorta']['triangles'],100)

    def test_each_vessel_display_field_uses_its_own_native_crop(self):
        directory=ROOT/'cache'/read_case_config()['patientId'];m=json.loads((directory/'manifest.json').read_text())
        for v,info in m['volumes'].items():
            if not info.get('cpeDisplay'):self.skipTest('No display fields prepared')
            read=lambda key:np.fromfile(directory/info[key].rsplit('/',1)[-1],dtype='u1').reshape(info['dimensions'],order='F')
            original=read('cpe');field=read('cpeDisplay')
            np.testing.assert_array_equal(field,display_mask(original,info['spacing']))
