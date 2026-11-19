import unittest
import numpy as np
from backend.tissue_reference import statistics,reference_anchors,sample_myocardium

class TissueReferenceTests(unittest.TestCase):
    def test_calibration_is_ordered_and_rejects_overlapping_references(self):
        fat={'p10HU':-120,'p50HU':-80,'p90HU':-40};myo={'p10HU':100,'p50HU':150};blood={'p50HU':550,'p99HU':635}
        anchors=reference_anchors(fat,myo,blood)
        self.assertTrue(all(a[1]<b[1] for a,b in zip(anchors,anchors[1:])))
        self.assertEqual(dict(anchors)[350],635)
        with self.assertRaisesRegex(ValueError,'overlap'):
            reference_anchors(fat,{'p10HU':-50,'p50HU':150},blood)

    def test_reference_statistics_keep_raw_values(self):
        values=np.arange(1000,dtype=np.int16);original=values.copy();result=statistics(values)
        self.assertEqual(result['p50HU'],499.5);np.testing.assert_array_equal(values,original)
        with self.assertRaisesRegex(ValueError,'Insufficient'):statistics([1,2,3])

    def test_myocardial_reference_avoids_bright_boundary(self):
        mask=np.zeros((48,48,32),bool);mask[8:40,8:40,3:29]=True
        ct=np.full(mask.shape,100,dtype=np.int16);ct[8:10]=1000;ct[38:40]=1000
        original=ct.copy();result=sample_myocardium(ct,mask,[1,1,1])
        self.assertEqual(result['p99HU'],100);self.assertGreater(result['voxels'],500)
        np.testing.assert_array_equal(original,ct)
