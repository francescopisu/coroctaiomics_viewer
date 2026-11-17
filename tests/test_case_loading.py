import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from fastapi import HTTPException
from backend import server
from backend.data import configuration, configuration_key

class ConfiguredCaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        directory=self.root/'cache/8';directory.mkdir(parents=True)
        self.path=directory/'manifest.json'
        self.path.write_text(json.dumps({'patientId':'8','signature':'revision-a','configurationKey':'configured-a','assets':[]}))
        np.save(directory/'axial.ct.npy',np.full((2,3,4),21,dtype='f4'))
        np.save(directory/'axial.labels.npy',np.zeros((2,3,4),dtype='u1'))
        self.patches=[patch.object(server,'ROOT',self.root),patch.object(server,'read_case_config',return_value={'patientId':'8'}),patch.object(server,'configuration_key',return_value='configured-a')]
        for p in self.patches:p.start()
        server.axial_arrays.cache_clear()

    def tearDown(self):
        server.axial_arrays.cache_clear()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()

    def test_current_endpoint_uses_configured_id_and_hides_source_fingerprint(self):
        response=server.get_current_case();body=json.loads(response.body)
        self.assertEqual(body['patientId'],'8');self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertNotIn('signature',body);self.assertNotIn('configurationKey',body)
        with self.assertRaises(HTTPException) as error:server.manifest('1')
        self.assertEqual(error.exception.status_code,404)

    def test_changed_configuration_refuses_old_cache(self):
        with patch.object(server,'configuration_key',return_value='configured-b'):
            with self.assertRaises(HTTPException) as error:server.get_current_case()
            self.assertEqual(error.exception.status_code,409);self.assertIn('backend.prepare',error.exception.detail)

    def test_new_preparation_reopens_axial_arrays(self):
        first=server.get_axial('8',1);self.assertEqual(np.frombuffer(first.body,dtype='<f4',count=6).mean(),21)
        m=json.loads(self.path.read_text());m['signature']='revision-b';self.path.write_text(json.dumps(m))
        np.save(self.root/'cache/8/axial.ct.npy',np.full((2,3,4),42,dtype='f4'))
        second=server.get_axial('8',1);self.assertEqual(np.frombuffer(second.body,dtype='<f4',count=6).mean(),42)
        self.assertEqual(server.axial_arrays.cache_info().misses,2)

class ConfigurationValidationTests(unittest.TestCase):
    def test_mixed_patient_paths_and_centerlines_are_rejected(self):
        import backend.data as data
        original=data.read_case_config()
        for update in [{'outputRoot':str(Path(original['outputRoot']).parent/'different-case')},
                       {'outputRoot':str(Path(original['outputRoot']).parent/'different-case'/'output')},
                       {'centerlineFiles':{**original['centerlineFiles'],'LAD':'1_LAD_3.csv'}}]:
            with self.subTest(update=update),patch.object(data,'read_case_config',return_value={**original,**update}):
                with self.assertRaisesRegex(ValueError,'does not match case|does not match patientId'):configuration()

    def test_nested_external_output_folder_is_supported(self):
        from backend.data import read_case_config
        conf,paths=configuration(read_case_config('P001'))
        self.assertEqual(Path(conf['outputRoot']).parent.name,'P001')
        self.assertEqual(Path(conf['outputRoot']).name,'output')
        self.assertEqual({v:len(maps) for v,maps in conf['featureFiles'].items()},{'LAD':3,'LCx':4,'RCA':4})
        self.assertEqual(paths['line_LCx'].name,'P001_LCx_2.csv')

    def test_configuration_digest_tracks_semantics(self):
        import backend.data as data
        conf=data.read_case_config();before=configuration_key()
        with patch.object(data,'read_case_config',return_value={**conf,'ct':conf['ct']+'.changed'}):
            self.assertNotEqual(configuration_key(),before)

if __name__=='__main__':unittest.main()
