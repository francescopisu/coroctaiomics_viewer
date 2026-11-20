import asyncio
import hashlib
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
from fastapi import HTTPException
from starlette.requests import Request
from backend import ai, data, portable, server


def patient_package(path, pid='Demo-A', *, bad_checksum=False, ai_id=None, wrong_url=False, extra=None):
    prefix = f'/api/cases/{pid}/assets/'
    manifest = {'patientId': pid, 'configurationKey': 'frozen-config', 'signature': 'frozen-assets',
                'coordinateSystem': 'LPS', 'units': 'mm', 'geometry': {'shape': [2, 2, 2]},
                'assets': ['voxels.bin'], 'axialVolume': {'ct': prefix+'voxels.bin'},
                'vessels': {v: {} for v in ('LAD', 'LCx', 'RCA')},
                'volumes': {v: {} for v in ('LAD', 'LCx', 'RCA')}}
    if wrong_url:manifest['axialVolume']['ct'] = '/api/cases/Other/assets/voxels.bin'
    report = {'patientId': ai_id or pid, 'sourceCohort': 'external', 'horizonMonths': 48,
              'modelRevision': 'frozen-model', 'features': [{}]*8,
              'patient': {'Age at CCTA': 42, 'Sex': 'Man', 'CADRADS': 'Score 2'},
              'predictions': {'pri': {'risk': .121}, 'adjusted': {'risk': .097}},
              'stratum': 'High', 'priReference': {'percentile':83.9,'n':1038}}
    files = {'manifest.json':json.dumps(manifest).encode(), 'ai.json':json.dumps(report).encode(),
             'voxels.bin':np.arange(8, dtype='<f4').tobytes()}
    for name, array in [('axial.ct.npy',np.arange(8, dtype='<f4').reshape(2,2,2)),
                        ('axial.labels.npy',np.zeros((2,2,2), dtype='u1'))]:
        buffer=io.BytesIO();np.save(buffer,array);files[name]=buffer.getvalue()
    descriptor = {'format':portable.FORMAT,'version':portable.VERSION,'patientId':pid,
                  'configurationKey':'frozen-config','files':{
                      name:{'size':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}
                      for name,payload in files.items()}}
    if bad_checksum:descriptor['files']['voxels.bin']['sha256']='0'*64
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('bundle.json',json.dumps(descriptor))
        for name,payload in files.items():archive.writestr(name,payload)
        if extra:archive.writestr(extra,b'unsafe')
    return manifest, report


class PortableTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.root=Path(self.temporary.name)
        self.environment=patch.dict(os.environ,{'CORONARY_PORTABLE_HOME':str(self.root/'user-data')})
        self.environment.start()
        portable.initialize()
        self.package=self.root/'case.cctacase'

    def tearDown(self):
        self.environment.stop();self.temporary.cleanup()
        server.axial_arrays.cache_clear();server.feature_arrays.cache_clear()

    def test_relocated_case_and_frozen_ai_need_no_workstation_files(self):
        _,report=patient_package(self.package)
        before=self.package.read_bytes()
        self.assertEqual(portable.import_package(self.package),{'patientId':'Demo-A'})
        self.assertEqual(self.package.read_bytes(),before)
        self.assertEqual(list(data.catalog_configurations()),['Demo-A'])
        self.assertEqual(server.manifest('Demo-A')['signature'],'frozen-assets')
        self.assertEqual(ai.results('Demo-A'),report)
        rows=json.loads(server.get_patients().body)['patients']
        self.assertEqual(rows[0]['priRisk'],.121)
        self.assertTrue(rows[0]['available'])
        self.assertNotIn('/Volumes/',json.dumps(rows))
        response=server.get_axial('Demo-A',1)
        self.assertEqual(len(response.body),4*5)
        with self.assertRaises(HTTPException):server.get_asset('Demo-A','ai.json')
        with self.assertRaises(HTTPException):server.get_asset('Demo-A','axial.ct.npy')
        with self.assertRaises(LookupError):ai.results('Not-Imported')
        # Moving the entire storage tree must preserve the case and report.
        relocated=self.root/'different-user-directory'
        portable.home().rename(relocated)
        os.environ['CORONARY_PORTABLE_HOME']=str(relocated)
        self.assertEqual(ai.results('Demo-A'),report)
        self.assertEqual(json.loads(server.get_case('Demo-A').body)['patientId'],'Demo-A')

    def test_duplicates_are_case_insensitive_and_do_not_overwrite(self):
        patient_package(self.package);portable.import_package(self.package)
        other=self.root/'other.cctacase';patient_package(other,pid='demo-a')
        with self.assertRaises(FileExistsError):portable.import_package(other)
        self.assertEqual(portable.catalogue_ids(),['Demo-A'])
        self.assertEqual(ai.results('Demo-A')['patientId'],'Demo-A')
        self.assertEqual([path.name for path in (portable.home()/'patients').iterdir()],['Demo-A'])

    def test_failed_import_is_never_published(self):
        for changes in [{'bad_checksum':True},{'ai_id':'Other'},{'wrong_url':True},
                        {'extra':'../escape.py'},{'extra':'C:\\escape.py'}, {'extra':'unexpected.py'}]:
            with self.subTest(changes=changes):
                patient_package(self.package,**changes)
                with self.assertRaises(ValueError):portable.import_package(self.package)
                self.assertEqual(portable.catalogue_ids(),[])
                self.assertEqual(list((portable.home()/'patients').iterdir()),[])
                self.assertEqual(list((portable.home()/'incoming').iterdir()),[])
        self.assertFalse((self.root/'escape.py').exists())

    def test_reserved_windows_ids_and_filenames_are_rejected(self):
        for pid in ['../P001','CON','aux','COM1','LPT9','A/B','A\\B','']:
            with self.subTest(pid=pid),self.assertRaises(ValueError):portable.safe_id(pid)
        for name in ['../ct.bin','CON.bin','foo.','.hidden','C:foo','bad/name.bin']:
            with self.subTest(name=name),self.assertRaises(ValueError):portable.safe_name(name)

    def test_existing_catalogue_survives_initialization(self):
        patient_package(self.package);portable.import_package(self.package)
        portable.initialize()
        self.assertEqual(portable.catalogue_ids(),['Demo-A'])

    def request(self,payload,origin='http://127.0.0.1:8765',host='127.0.0.1:8765'):
        async def receive():return {'type':'http.request','body':payload,'more_body':False}
        return Request({'type':'http','method':'POST','path':'/api/patients/import',
                        'headers':[(b'host',host.encode()),(b'origin',origin.encode()),
                                   (b'content-type',b'application/zip')]},receive)

    def test_streamed_import_and_duplicate_http_status(self):
        patient_package(self.package)
        response=asyncio.run(portable.receive_import(self.request(self.package.read_bytes())))
        self.assertEqual(response.status_code,201)
        with self.assertRaises(HTTPException) as error:
            asyncio.run(portable.receive_import(self.request(self.package.read_bytes())))
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(list((portable.home()/'incoming').iterdir()),[])

    def test_cross_origin_and_nonportable_writes_are_rejected(self):
        for origin in ['https://example.com','http://localhost:8765','null','']:
            with self.subTest(origin=origin),self.assertRaises(HTTPException) as error:
                asyncio.run(portable.receive_import(self.request(b'bad',origin=origin)))
            self.assertEqual(error.exception.status_code,403)
        with patch.dict(os.environ,{'CORONARY_PORTABLE_HOME':''}):
            self.assertFalse(json.loads(server.get_runtime().body)['canImportPatients'])
            with self.assertRaises(HTTPException) as error:
                asyncio.run(portable.receive_import(self.request(b'bad')))
            self.assertEqual(error.exception.status_code,404)


if __name__=='__main__':unittest.main()
