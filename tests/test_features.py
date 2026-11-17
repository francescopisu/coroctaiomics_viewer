import json
import tempfile
import unittest
from pathlib import Path
import nibabel as nib
import numpy as np
from backend.data import ROOT,configuration
from backend.features import clipped_values,discover_maps,prepare_features
from backend.server import get_feature_axial

class FeatureProcessingTests(unittest.TestCase):
    def test_cpe_support_keeps_zero_and_excludes_nan_and_outside_values(self):
        values=np.array([-2.,0.,4.,np.nan,17.]);cpe=np.array([1,1,1,1,0],dtype=bool);before=values.copy()
        out,valid,stats=clipped_values(values,cpe)
        np.testing.assert_equal(values,before);np.testing.assert_array_equal(valid,[1,1,1,0,0]);np.testing.assert_array_equal(out,[-2,0,4,0,0])
        self.assertEqual(stats['limit'],4);self.assertEqual(stats['zeroVoxels'],1);self.assertEqual(stats['nonFiniteCpeVoxels'],1);self.assertEqual(stats['nonzeroOutsideCpeInCrop'],1)
        _,valid,stats=clipped_values(np.zeros(4),np.ones(4,dtype=bool));self.assertEqual(stats['limit'],1);self.assertTrue(valid.all())

    def test_discovery_is_vessel_dependent_and_ignores_resource_forks(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            for vessel in ['LM-LAD','LCx','RCA']:
                (root/vessel).mkdir();(root/vessel/'example.nii.gz').touch();(root/vessel/'._example.nii.gz').touch()
            maps=discover_maps(root);self.assertEqual({v:len(f) for v,f in maps.items()},{'LAD':1,'LCx':1,'RCA':1})
            self.assertNotEqual(maps['LAD'][0]['id'],maps['RCA'][0]['id'])
            (root/'LAD').mkdir()
            with self.assertRaisesRegex(ValueError,'Ambiguous'):discover_maps(root)

    def test_flat_pipeline_maps_preserve_feature_names_and_reject_mixed_patients(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            for vessel in ['LAD','LCX','RCA']:(root/f'P001_{vessel}_wavelet-LHL_glcm_Idn.nii.gz').touch()
            (root/'._P001_LAD_example.nii.gz').touch()
            maps=discover_maps(root,'P001')
            self.assertEqual({v:len(f) for v,f in maps.items()},{'LAD':1,'LCx':1,'RCA':1})
            self.assertEqual(maps['LCx'][0]['name'],'wavelet-LHL_glcm_Idn')
            with self.assertRaisesRegex(ValueError,'patient prefix'):discover_maps(root,'P002')
            (root/'LAD').mkdir()
            with self.assertRaisesRegex(ValueError,'Ambiguous'):discover_maps(root,'P001')

    def test_grid_mismatch_is_rejected_instead_of_visual_axis_guessing(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);mask=np.zeros((6,6,6),dtype='u1');mask[2:4,2:4,2:4]=1
            nib.save(nib.Nifti1Image(mask,np.eye(4)),root/'cpe.nii.gz')
            affine=np.eye(4);affine[0,3]=10;nib.save(nib.Nifti1Image(np.ones((6,6,6)),affine),root/'feature.nii.gz')
            conf={'patientId':'test','featureFiles':{'LAD':[{'id':'a','name':'a'}]}}
            paths={'cpe_LAD':root/'cpe.nii.gz','feature_a':root/'feature.nii.gz'}
            from backend.data import LPS_FROM_RAS
            with self.assertRaisesRegex(ValueError,'differs from CT'):
                prepare_features(root,conf,paths,{'shape':[6,6,6],'affineLPS':LPS_FROM_RAS.tolist()},[],'/assets/')

class PreparedFeatureTests(unittest.TestCase):
    def test_real_feature_values_masks_and_axial_planes_are_aligned(self):
        conf,paths=configuration();directory=ROOT/'cache'/conf['patientId'];m=json.loads((directory/'manifest.json').read_text())
        if not any(m.get('featureMaps',{}).values()):self.skipTest('No configured feature maps')
        nx,ny,_=m['geometry']['shape']
        for entries in m['featureMaps'].values():
            for f in entries:
                shape=tuple(f['dimensions']);read=lambda key,dtype:np.fromfile(directory/f[key].rsplit('/',1)[-1],dtype=dtype).reshape(shape,order='F')
                values,valid,cpe=read('values','<f4'),read('valid','u1'),read('cpe','u1')
                self.assertFalse((valid&~cpe).any());self.assertTrue(np.isfinite(values).all());self.assertTrue((values[valid==0]==0).all())
                lo=np.array(f['startIJK']);hi=lo+shape;sl=tuple(slice(a,b) for a,b in zip(lo,hi))
                source=nib.load(paths['feature_'+f['id']]);original=np.asarray(source.dataobj[sl])
                np.testing.assert_allclose(values[valid>0],original[valid>0],rtol=1e-6,atol=1e-7)
                self.assertEqual(int(((values==0)&(valid>0)).sum()),f['zeroVoxels'])
                k=int(lo[2]+shape[2]//2);response=get_feature_axial(conf['patientId'],f['id'],k)
                plane=np.frombuffer(response.body,dtype='<f4',count=nx*ny).reshape(ny,nx);support=np.frombuffer(response.body,dtype='u1',offset=nx*ny*4).reshape(ny,nx)
                np.testing.assert_array_equal(plane[lo[1]:hi[1],lo[0]:hi[0]],values[:,:,k-lo[2]].T)
                np.testing.assert_array_equal(support[lo[1]:hi[1],lo[0]:hi[0]],valid[:,:,k-lo[2]].T)
                self.assertEqual(int(support.sum()),int(valid[:,:,k-lo[2]].sum()))

if __name__=='__main__':unittest.main()
