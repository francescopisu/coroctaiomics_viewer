import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
from backend import data, server


class CatalogTests(unittest.TestCase):
    def test_registered_cases_have_independent_metadata_and_assets(self):
        rows=json.loads(server.get_patients().body)['patients']
        self.assertEqual({r['patientId'] for r in rows},set(data.catalog_configurations()))
        self.assertTrue(all(r['available'] for r in rows))
        self.assertNotIn('/Volumes/',json.dumps(rows))
        self.assertNotIn('features',json.dumps(rows))
        for row in rows:
            pid=row['patientId'];m=server.manifest(pid)
            self.assertEqual(m['patientId'],pid)
            self.assertTrue(m['axialVolume']['ct'].startswith(f'/api/cases/{pid}/assets/'))
            self.assertEqual(json.loads(server.get_case(pid).body)['patientId'],pid)
        with self.assertRaises(HTTPException) as error:server.get_case('unlisted')
        self.assertEqual(error.exception.status_code,404)

    def test_one_changed_case_does_not_invalidate_others(self):
        read=data.read_case_config
        def changed(case_id=None):
            conf=read(case_id)
            return {**conf,'ct':conf['ct']+'.changed'} if case_id=='1' else conf
        cases=data.catalog_configurations();cases['1']=changed('1')
        with patch.object(server,'read_case_config',side_effect=changed),patch.object(server,'catalog_configurations',return_value=cases):
            with self.assertRaises(HTTPException) as error:server.get_case('1')
            self.assertEqual(error.exception.status_code,409)
            self.assertEqual(json.loads(server.get_case('8').body)['patientId'],'8')
            rows=json.loads(server.get_patients().body)['patients']
            self.assertFalse(next(r for r in rows if r['patientId']=='1')['available'])
            self.assertTrue(next(r for r in rows if r['patientId']=='8')['available'])

    def test_duplicate_and_unsafe_catalog_ids_fail_explicitly(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);entry=root/'entry.json';catalog=root/'catalog.json'
            entry.write_text(json.dumps({'patientId':'8'}))
            catalog.write_text(json.dumps({'cases':['entry.json','entry.json']}))
            with patch.dict(os.environ,{'CORONARY_CATALOG_CONFIG':str(catalog)}):
                with self.assertRaisesRegex(ValueError,'Duplicate'):data.catalog_configurations()
                catalog.write_text(json.dumps({'cases':['entry.json']}))
                entry.write_text(json.dumps({'patientId':'../8'}))
                with self.assertRaisesRegex(ValueError,'single case identifier'):data.catalog_configurations()

    def test_legacy_single_case_override_remains_supported(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'case.json';path.write_text(json.dumps({'patientId':'single'}))
            with patch.dict(os.environ,{'CORONARY_CASE_CONFIG':str(path)}):
                self.assertEqual(list(data.catalog_configurations()),['single'])
                self.assertEqual(data.read_case_config('single')['patientId'],'single')
                with self.assertRaises(LookupError):data.read_case_config('8')


if __name__=='__main__':unittest.main()
