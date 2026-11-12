import tempfile
import unittest
from pathlib import Path
import numpy as np
from backend.volumes import prepare_axial_volume

class ResidentAxialTests(unittest.TestCase):
    def test_native_order_values_and_packed_labels_are_preserved(self):
        for dtype in ['int16','float32']:
            with self.subTest(dtype=dtype),tempfile.TemporaryDirectory() as temp:
                directory=Path(temp)
                # More than eight k slices exercises the exporter block boundary.
                i,j,k=np.indices((4,3,11));ct=(100*i+10*j+k-1000).astype('f4')
                if dtype=='float32':ct+=.125
                labels=((i+j+k)%16).astype('u1')
                np.save(directory/'axial.ct.npy',ct);np.save(directory/'axial.labels.npy',labels)
                assets=[];info=prepare_axial_volume(directory,dtype,assets,'/assets/')
                native=np.fromfile(directory/'axial.volume.ct.bin',dtype='<i2' if dtype=='int16' else '<f4').reshape(11,3,4)
                bits=np.fromfile(directory/'axial.volume.labels.bin',dtype='u1').reshape(11,3,4)
                for index in range(11):
                    np.testing.assert_array_equal(native[index],ct[:,:,index].T)
                    np.testing.assert_array_equal(bits[index],labels[:,:,index].T)
                np.testing.assert_array_equal(np.load(directory/'axial.ct.npy'),ct)
                self.assertEqual(info['scalarType'],dtype);self.assertEqual(len(assets),2)

    def test_integral_compaction_rejects_loss_of_hu_and_cleans_partial_file(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);np.save(directory/'axial.ct.npy',np.full((2,3,4),.5,dtype='f4'))
            with self.assertRaisesRegex(ValueError,'changing HU'):
                prepare_axial_volume(directory,'int16',[],'/assets/')
            self.assertFalse((directory/'axial.volume.ct.bin').exists());self.assertFalse((directory/'axial.volume.ct.bin.tmp').exists())

if __name__=='__main__':unittest.main()
