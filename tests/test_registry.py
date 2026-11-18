import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import registry
from backend.data import configuration_key
from backend.prepare import signature

class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.path=self.root/'viewer.json';self.output=self.root/'arbitrary-output-folder'
        (self.output/'labeling').mkdir(parents=True)
        for vessel in registry.VESSELS:(self.output/'labeling'/f'96_{vessel}_1.csv').touch()
        (self.root/'pipeline/config').mkdir(parents=True);(self.root/'pipeline/config/defaults.py').write_text('# fixed pipeline defaults')
        self.conf={'pipelineRoot':'pipeline','clinicalSources':{'derivation':'derivation.csv'},'patients':[{'id':96,'ct':'scan.nii.gz','output':str(self.output)}]}
        self.save();self.env=patch.dict(os.environ,{'CORONARY_VIEWER_CONFIG':str(self.path)});self.env.start()
        self.root_patch=patch.object(registry,'ROOT',self.root);self.root_patch.start()
    def tearDown(self):self.root_patch.stop();self.env.stop();self.temp.cleanup()
    def save(self):self.path.write_text(json.dumps(self.conf))
    def test_minimal_patient_discovers_structure_and_resolves_paths(self):
        case=registry.cases()['96']
        self.assertEqual(case['ct'],str(self.root/'scan.nii.gz'))
        self.assertEqual(case['outputRoot'],str(self.output))
        self.assertEqual(case['centerlineFiles'],{v:f'96_{v}_1.csv' for v in registry.VESSELS})
        self.assertEqual(case['patientData']['radiomicsCsv'],str(self.output/'radiomics_r4_iso/96_radiomics.csv'))
        self.assertEqual(case['patientData']['sources']['derivation'],str(self.root/'derivation.csv'))
    def test_ambiguous_branch_needs_explicit_selection_and_does_not_break_other_cases(self):
        (self.output/'labeling/96_LAD_2.csv').touch()
        case=registry.cases()['96'];self.assertIn('set centerlines',case['configurationError'])
        with self.assertRaisesRegex(ValueError,'expected one centerline'):configuration_key(case)
        self.conf['patients'][0]['centerlines']={'LAD':'96_LAD_2.csv'};self.save()
        self.assertEqual(registry.cases()['96']['centerlineFiles']['LAD'],'96_LAD_2.csv')
        self.conf['patients'].append({'id':'missing','ct':'missing.nii.gz','output':'missing-output'});self.save()
        cases=registry.cases();self.assertNotIn('configurationError',cases['96']);self.assertIn('configurationError',cases['missing'])
    def test_duplicate_ids_and_cross_patient_centerline_are_rejected(self):
        self.conf['patients'].append({**self.conf['patients'][0],'id':'96'});self.save()
        with self.assertRaisesRegex(ValueError,'Duplicate'):registry.cases()
        self.conf['patients'].pop();self.conf['patients'][0]['centerlines']={'LAD':'8_LAD_1.csv'};self.save()
        self.assertIn('invalid centerline',registry.cases()['96']['configurationError'])
    def test_clinical_edits_do_not_invalidate_images(self):
        case=registry.cases()['96'];other={**case,'patientData':{'clinicalJson':'different.json'}}
        self.assertEqual(configuration_key(case),configuration_key(other))
        self.assertEqual(signature(case,{}),signature(other,{}))
        self.assertNotEqual(configuration_key(case),configuration_key({**case,'ct':'different.nii.gz'}))
    def test_prepared_source_descriptor_supports_disconnected_source_drive(self):
        case=registry.cases()['96'];saved={k:v for k,v in case.items() if k!='patientData'}
        folder=self.root/'cache/96';folder.mkdir(parents=True);(folder/'manifest.json').write_text(json.dumps({'sourceConfig':saved}))
        (self.output/'labeling').rename(self.output/'disconnected')
        self.assertEqual(registry.cases()['96']['centerlineFiles'],case['centerlineFiles'])
        self.conf['patients'][0]['ct']='different.nii.gz';self.save()
        self.assertIn('configurationError',registry.cases()['96'])
