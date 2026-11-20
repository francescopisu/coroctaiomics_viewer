import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.cohort_reference import references,feature_maps

class CohortReferenceTests(unittest.TestCase):
    def test_import_matches_names_and_exposes_only_display_metadata(self):
        source={'schema_version':1,'references':[{'vessel':'LCX','feature':'wavelet-LLH_glcm_ClusterShade','patient_count':16,
            'included_patients':[{'map_path':'/private/source.nii.gz'}],
            'lookup':[{'value':-10,'weight_below':0,'weight_equal':.2},{'value':0,'weight_below':.5,'weight_equal':.1},{'value':10,'weight_below':.9,'weight_equal':.1}]}]}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'reference.json';path.write_text(json.dumps(source));reference=references(path)
            self.assertEqual(reference[('LCx','wavelet-llh_glcm_clustershade')]['nPatients'],16)
            self.assertNotIn('/private',json.dumps(reference[('LCx','wavelet-llh_glcm_clustershade')]))
            maps={'LCx':[{'name':'wavelet-LLH_glcm_ClusterShade','values':'unchanged'}]}
            with patch('backend.cohort_reference.references',return_value=reference):result=feature_maps(maps)
            self.assertEqual(result['LCx'][0]['values'],'unchanged');self.assertNotIn('cohortReference',maps['LCx'][0])
            source['references'][0]['lookup'][1]['value']=-20;path.write_text(json.dumps(source))
            with self.assertRaisesRegex(ValueError,'ordered'):references(path)

    def test_missing_reference_is_optional(self):
        self.assertEqual(references(Path('/no/such/cohort-reference.json')),{})
