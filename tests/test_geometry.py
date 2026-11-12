import json
import unittest
import numpy as np
from backend.data import ROOT, LPS_FROM_RAS, sample, resample_frames, configuration, image, centerline
from backend.volumes import crop_bounds

class PhysicalSamplingTests(unittest.TestCase):
    def test_oblique_affine_linear_intensity_and_nearest_labels(self):
        theta = 0.6
        rot = np.array([[np.cos(theta), -np.sin(theta), 0], [np.sin(theta), np.cos(theta), 0], [0, 0, 1]])
        affine = np.eye(4); affine[:3, :3] = rot @ np.diag([0.4, 0.7, 1.3]); affine[:3, 3] = [-120, -180, -330]
        grid = np.indices((8, 9, 10)); intensity = (grid[0]*2 + grid[1]*3 + grid[2]*5).astype(np.float32)
        ijk = np.array([[2.2, 3.6, 4.1], [1.8, 2.2, 5.7]])
        world = ijk @ affine[:3, :3].T + affine[:3, 3]
        np.testing.assert_allclose(sample(intensity, affine, world, 1), ijk @ [2, 3, 5], atol=1e-5)
        labels = (grid[1] > 3).astype(np.uint8)
        np.testing.assert_array_equal(sample(labels, affine, world, 0), [1, 0])
        self.assertEqual(sample(intensity, affine, [[-1000, 0, 0]], 1, -1024)[0], -1024)

    def test_ras_lps_round_trip_and_no_half_voxel_offset(self):
        ras = np.diag([-0.431640625, -0.431640625, 0.3, 1.]); ras[:3, 3] = [73.2841796875, 318.2841796875, -346.5]
        lps = LPS_FROM_RAS @ ras
        np.testing.assert_allclose(lps[:3, 3], [-73.2841796875, -318.2841796875, -346.5])
        voxel = np.array([31., 282., 145., 1.])
        np.testing.assert_allclose(np.linalg.inv(lps) @ lps @ voxel, voxel, atol=1e-10)
        data = np.arange(64, dtype=np.float32).reshape(4,4,4)
        affine = np.eye(4); affine[:3, 3] = [-10, -20, -30]
        self.assertEqual(sample(data, affine, [[-9, -18, -27]], 1)[0], data[1,2,3])

    def test_transport_is_orthonormal_and_continuous(self):
        angle = np.linspace(0, 3, 100)
        points = np.column_stack([10*np.cos(angle), 10*np.sin(angle), 3*angle])
        f = resample_frames(np.column_stack([points, np.ones(100), np.zeros(100)]), 0.5)
        u,v,t = [np.asarray(f[k]) for k in ['u','v','tangents']]
        for axis in [u,v,t]: np.testing.assert_allclose(np.linalg.norm(axis, axis=1), 1., atol=1e-10)
        np.testing.assert_allclose(np.sum(u*t,axis=1), 0., atol=1e-10)
        np.testing.assert_allclose(np.cross(u,v), t, atol=1e-10)
        self.assertGreater(np.min(np.sum(u[1:]*u[:-1],axis=1)), 0.99)
        np.testing.assert_allclose(np.diff(f['distances'])[:-1], 0.5, atol=1e-10)

class RealCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        conf,_ = configuration()
        cls.case_dir = ROOT/'cache'/conf['patientId']
        cls.report = json.loads((ROOT/'cache/inspection.json').read_text())
        assert cls.report['patientId'] == conf['patientId']
        cls.manifest = json.loads((cls.case_dir/'manifest.json').read_text())

    def test_source_alignment_and_lumen_exclusion(self):
        for img in self.report['images'].values(): self.assertTrue(img['sameGridAsCT'])
        for vessel in ['LAD', 'LCx', 'RCA']:
            self.assertEqual(self.report['centerlines'][vessel]['insideLumenFraction'], 1.)
            self.assertLess(self.report['centerlines'][vessel]['maxDistanceToLumenVoxelMm'], 0.5)
            self.assertEqual(self.report['images'][f'cpe_{vessel}']['lumenOverlapVoxels'], 0)
            count = len(self.manifest['vessels'][vessel]['points']); n = self.manifest['sampling']['widthPixels']
            for suffix,size in [('',count*n*n),('.cpr',count*n)]:
                lm = np.fromfile(self.case_dir/f'{vessel}.lumen{suffix}.bin',dtype='u1')
                cpe = np.fromfile(self.case_dir/f'{vessel}.cpe{suffix}.bin',dtype='u1')
                ct = np.fromfile(self.case_dir/f'{vessel}.ct{suffix}.bin',dtype='<f4')
                self.assertEqual(ct.size,size); self.assertEqual(lm.size,size); self.assertEqual(cpe.size,size)
                self.assertFalse((lm & cpe).any());self.assertTrue(np.isfinite(ct).all());self.assertGreater(np.ptp(ct),100)

    def test_cached_ct_matches_direct_source_sampling(self):
        conf,paths=configuration(); img,affine=image(paths['ct']); ct=np.asarray(img.dataobj,dtype=np.float32)
        n=conf['sampling']['widthPixels']; r=conf['sampling']['resolutionMm']
        for vessel in conf['centerlineFiles']:
            f=self.manifest['vessels'][vessel]; rows=np.array([0,len(f['points'])//2,len(f['points'])-1]); pixels=np.array([4,n//2,n-5])
            points=np.asarray(f['points'])[rows]+((pixels-(n-1)/2)*r)[:,None]*np.asarray(f['u'])[rows]
            cached=np.fromfile(self.case_dir/f'{vessel}.ct.cpr.bin',dtype='<f4').reshape(-1,n)
            np.testing.assert_allclose(cached[rows,pixels],sample(ct,affine,points,1,-1024),atol=1e-4)
            frames=resample_frames(centerline(paths[f'line_{vessel}']),conf['sampling']['pointSpacingMm'])
            lm,la=image(paths['lumen_merged']); hits=sample((np.asarray(lm.dataobj)>0).astype('u1'),la,frames['points'])
            self.assertGreater(hits.mean(),0.99)

    def test_native_volume_order_affine_hu_and_masks(self):
        full = np.load(self.case_dir/'axial.ct.npy',mmap_mode='r')
        bits = np.load(self.case_dir/'axial.labels.npy',mmap_mode='r')
        affine = np.array(self.manifest['geometry']['affineLPS'])
        for vessel,info in self.manifest['volumes'].items():
            shape=tuple(info['dimensions']);dtype='<i2' if info['scalarType']=='int16' else '<f4'
            ct=np.fromfile(self.case_dir/f'{vessel}.volume.ct.bin',dtype=dtype).reshape(shape,order='F')
            lm=np.fromfile(self.case_dir/f'{vessel}.volume.lumen.bin',dtype='u1').reshape(shape,order='F')
            cpe=np.fromfile(self.case_dir/f'{vessel}.volume.cpe.bin',dtype='u1').reshape(shape,order='F')
            local_affine=np.array(info['affineLPS'])
            local=np.array([[3,8,11],np.array(shape)//2,np.array(shape)-4])
            world=local@local_affine[:3,:3].T+local_affine[:3,3]
            global_ijk=np.rint(world@np.linalg.inv(affine)[:3,:3].T+np.linalg.inv(affine)[:3,3]).astype(int)
            np.testing.assert_array_equal(ct[tuple(local.T)],full[tuple(global_ijk.T)])
            np.testing.assert_array_equal(lm[tuple(local.T)],bits[tuple(global_ijk.T)]&1)
            bit={'LAD':2,'LCx':4,'RCA':8}[vessel]
            np.testing.assert_array_equal(cpe[tuple(local.T)],(bits[tuple(global_ijk.T)]&bit)>0)
            self.assertFalse((lm&cpe).any())
            # A lossless native crop must still reproduce the prior source-space CPR samples.
            f=self.manifest['vessels'][vessel];n=self.manifest['sampling']['widthPixels'];res=self.manifest['sampling']['resolutionMm']
            indices=np.array([0,len(f['points'])//2,len(f['points'])-1]);x=np.array([4,n//2,n-4])
            points=np.asarray(f['points'])[indices]+((x-(n-1)/2)*res)[:,None]*np.asarray(f['u'])[indices]
            expected=np.fromfile(self.case_dir/f'{vessel}.ct.cpr.bin',dtype='<f4').reshape(-1,n)[indices,x]
            np.testing.assert_allclose(sample(ct.astype('f4'),local_affine,points,1,-1024),expected,atol=1e-4)

    def test_curved_crop_contains_ribbon_for_all_rotations_within_source(self):
        affine=np.array(self.manifest['geometry']['affineLPS']);inv=np.linalg.inv(affine);shape=np.array(self.manifest['geometry']['shape'])
        for f in self.manifest['vessels'].values():
            points=np.asarray(f['points']);lo,hi=crop_bounds(points,affine,shape)
            axis=points[-1]-points[0];axis/=np.linalg.norm(axis);u=np.array(f['u'][0]);u-=np.dot(u,axis)*axis;u/=np.linalg.norm(u);v=np.cross(axis,u);center=points.mean(0)
            for angle in np.linspace(0,2*np.pi,73):
                direction=u*np.cos(angle)+v*np.sin(angle);lateral=(points-center)@direction;width=25+2*np.abs(lateral).max()
                for offset in [-width/2,width/2]:
                    world=points+(offset-lateral)[:,None]*direction;ijk=world@inv[:3,:3].T+inv[:3,3]
                    inside=((ijk>=0)&(ijk<=shape-1)).all(axis=1);valid=ijk[inside]
                    self.assertTrue(((valid>=lo)&(valid<hi)).all())

if __name__=='__main__': unittest.main()
