import unittest
import numpy as np
from backend.blood_pool import sample_blood_pool

class BloodPoolTests(unittest.TestCase):
    def setUp(self):
        x,y,z=np.indices((64,64,12));radius=np.hypot((x-32)*.5,(y-32)*.5)
        self.shell=(radius>=10)&(radius<=11)
        self.ct=(500+(x+3*y+5*z)%101).astype(np.int16)
        self.ct[self.shell]=2000  # Bright wall must not enter the blood sample.

    def test_shell_is_filled_then_only_central_blood_is_sampled(self):
        original=self.ct.copy();mask=self.shell.copy()
        result=sample_blood_pool(self.ct,self.shell,[.5,.5,.5])
        self.assertTrue(result['available']);self.assertGreaterEqual(result['slices'],3)
        self.assertLessEqual(result['p99HU'],600);self.assertGreaterEqual(result['p50HU'],500)
        self.assertEqual(result['thresholdHU'],max(350,result['p99HU']))
        np.testing.assert_array_equal(self.ct,original);np.testing.assert_array_equal(self.shell,mask)

    def test_open_shell_is_rejected_instead_of_sampling_its_wall(self):
        self.shell[32:,:, :][:,31:34,:]=False
        with self.assertRaisesRegex(ValueError,'Insufficient'):
            sample_blood_pool(self.ct,self.shell,[.5,.5,.5])

    def test_grids_must_match(self):
        with self.assertRaisesRegex(ValueError,'grid'):
            sample_blood_pool(self.ct[:32],self.shell,[.5,.5,.5])
