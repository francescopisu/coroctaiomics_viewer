import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from fastapi import HTTPException
from backend import ai, server
from backend.export_ai import load_pri_reference


class CoxInferenceTests(unittest.TestCase):
    def model(self):
        return {'features': ['feature'], 'clinicalFeatures': ['Clinical Likelihood', 'SS45'],
                'combat': {'120.0': {'slope': [2.0], 'intercept': [-1.0]}},
                'scale': {'feature': {'mean': 3.0, 'sd': 2.0},
                          'Clinical Likelihood': {'mean': 10.0, 'sd': 5.0}},
                'columns': ['feature', 'Clinical Likelihood', 'SS45_Yes'],
                'coefficients': [-0.2, 0.1, 0.4], 'center': [0.0, 0.0, 0.25], 'baselineHazard': 0.08}

    def test_preprocessing_and_cox_survival_match_analytical_prediction(self):
        model = self.model()
        record = {'feature': 3.0, 'KVP': 120, 'Clinical Likelihood': 20, 'SS45': 'No'}
        # ComBat -> 5; scaled feature -> 1; scaled CL -> 2; centered SS45 -> -0.25.
        expected_log = -0.2 + 0.2 - 0.1
        actual = ai.infer(model, record)
        self.assertAlmostEqual(actual['logPartialHazard'], expected_log)
        self.assertAlmostEqual(actual['risk'], 1-math.exp(-0.08*math.exp(expected_log)))
        self.assertEqual(actual, ai.infer(model, {**record, 'TIME': 1, 'EVENT': 1}))
        self.assertEqual(actual, ai.infer(model, {**record, 'TIME': 100, 'EVENT': 0}))
        self.assertLess(ai.infer(model, {**record, 'feature': 5.0})['risk'], actual['risk'])
        self.assertGreater(ai.infer(model, {**record, 'Clinical Likelihood': 40})['risk'], actual['risk'])

    def test_missing_inputs_and_unseen_kvp_are_not_silently_imputed(self):
        record = {'feature': 3.0, 'KVP': 120, 'Clinical Likelihood': 20, 'SS45': 'No'}
        for change in [{'feature': None}, {'KVP': 90}, {'SS45': 'Unknown'}, {'Clinical Likelihood': None}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                ai.infer(self.model(), {**record, **change})

    def test_stratum_boundaries_match_study_and_percentiles_handle_ties(self):
        self.assertEqual(ai.risk_stratum(0.06, 0.06, 0.1), 'Low')
        self.assertEqual(ai.risk_stratum(np.nextafter(0.06, 1), 0.06, 0.1), 'Intermediate')
        self.assertEqual(ai.risk_stratum(0.1, 0.06, 0.1), 'Intermediate')
        self.assertEqual(ai.risk_stratum(np.nextafter(0.1, 1), 0.06, 0.1), 'High')
        self.assertEqual(ai.percentile([1, 2, 2, 4], 2), 50)
        self.assertEqual(ai.percentile([1, 2, 2, 4], 0), 0)
        self.assertEqual(ai.percentile([1, 2, 2, 4], 5), 100)
        self.assertIsNone(ai.percentile([], 2))
        self.assertIsNone(ai.percentile([1, 2], None))

    def test_native_feature_reference_excludes_validation_missing_and_nonfinite_values(self):
        records = [{'sourceCohort': 'derivation', 'feature': value}
                   for value in [1, 2, 2, 4, None, float('nan'), float('inf')]]
        records.append({'sourceCohort': 'validation', 'feature': 1000000})
        expected = {'median': 2.0, 'iqr': [1.75, 2.5], 'percentile': 50.0, 'n': 4}
        self.assertEqual(ai.feature_reference(records, 'feature', 2), expected)
        for absent in [None, float('nan'), float('inf')]:
            with self.subTest(value=absent):
                self.assertEqual(ai.feature_reference(records, 'feature', absent),
                                 {**expected, 'percentile': None})
        self.assertEqual(ai.feature_reference(records, 'unrecorded', 1),
                         {'median': None, 'iqr': None, 'percentile': None, 'n': 0})


class AiReferenceTests(unittest.TestCase):
    def test_oof_reference_rejects_wrong_distribution_and_horizon(self):
        thresholds = {'threshold_source': 'Derivation OOF', 'prediction_horizon_months': 48,
                      'q25': 0.04, 'q75': 0.08}
        reference = {'model': 'PRI-only', 'threshold_source': 'Derivation OOF',
                     'prediction_horizon_months': 48, 'risks': [0.1, 0.02, 0.06]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'oof.json'
            path.write_text(json.dumps(reference))
            self.assertEqual(load_pri_reference(path, thresholds, 3), [0.02, 0.06, 0.1])
            for change in [{'prediction_horizon_months': 24}, {'model': 'Adjusted'},
                           {'threshold_source': 'In-sample'}, {'risks': [0.02, 0.06]},
                           {'risks': [0.02, 0.06, 0.2]}, {'risks': [0.02, float('nan'), 0.1]}]:
                with self.subTest(change=change):
                    path.write_text(json.dumps({**reference, **change}))
                    with self.assertRaises(ValueError):
                        load_pri_reference(path, thresholds, 3)

    def test_patient_percentile_uses_frozen_oof_scores_and_is_absent_without_them(self):
        data = ai.reference()
        scores = np.asarray(data['distributions']['PRI-only'])
        result = ai.results('P001')
        risk = result['predictions']['pri']['risk']
        expected = 100 * (sum(scores < risk) + 0.5 * sum(scores == risk)) / len(scores)
        self.assertEqual(result['priReference']['percentile'], expected)
        self.assertEqual(result['priReference']['n'], 1038)
        self.assertEqual(result['cohort']['comparisons'][0]['percentile'], expected)
        self.assertEqual(result['cohort']['comparisons'][0]['value'], risk)
        # Missing patient inputs must never produce an apparent percentile.
        record = ai.patient_record('P001', data)
        with patch.object(ai, 'patient_record', return_value={**record, data['models']['pri']['features'][0]: None}):
            self.assertIsNone(ai.results('P001')['priReference']['percentile'])
        without_oof = copy.deepcopy(data)
        without_oof['distributions'].pop('PRI-only')
        without_oof['thresholds']['exactPercentileAvailable'] = False
        with patch.object(ai, 'reference', return_value=without_oof):
            self.assertIsNone(ai.results('P001')['priReference']['percentile'])
            self.assertEqual(ai.results('P001')['priReference']['n'], 0)

    def test_export_validation_and_configured_patient_results(self):
        data = ai.reference()
        for value in data['validation'].values():
            self.assertEqual(value['records'], 1410)
            self.assertLess(value['maximumAbsoluteRiskError'], 2e-12)
        result = ai.results('1718')
        self.assertAlmostEqual(result['predictions']['pri']['risk'], 0.12485872256367218, places=12)
        self.assertAlmostEqual(result['predictions']['adjusted']['risk'], 0.1094015349960236, places=12)
        self.assertEqual(result['stratum'], 'High')
        self.assertEqual(result['patient']['Clinical Likelihood'], 12)
        self.assertEqual(result['patient']['CADRADS'], 'Score 3')
        self.assertEqual(len(result['features']), 8)
        self.assertTrue(all(feature['reference']['n'] == 1038 for feature in result['features']))
        # User's GLDM example: compare raw/native values against the derivation
        # distribution, rather than the scaler's harmonized training mean.
        example = ai.results('8')['features'][0]
        self.assertAlmostEqual(example['value'], 0.0087000209147388)
        self.assertAlmostEqual(example['reference']['median'], 0.0048846624923491)
        self.assertAlmostEqual(example['reference']['percentile'], 70.56840077071291)
        np.testing.assert_allclose(example['reference']['iqr'],
                                   [0.002431397057647425, 0.009661227186251675])
        self.assertNotIn('EVENT', result['patient'])
        self.assertNotIn('TIME', result['patient'])
        self.assertTrue(result['thresholds']['exactPercentileAvailable'])
        # Correct continuous CL encoding: one-row prediction must use 19, not an
        # inferred category/dummy that loses the original value.
        self.assertAlmostEqual(ai.results('96')['predictions']['adjusted']['risk'], 0.11489939418742486, places=12)
        with self.assertRaises(LookupError):
            ai.results('not-a-patient')

    def test_runtime_rejects_config_and_mounted_source_changes(self):
        config = ai.read_config()
        with patch.object(ai, 'read_config', return_value={**config, 'derivation': 'changed'}):
            with self.assertRaisesRegex(ValueError, 'configuration changed'):
                ai.reference()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'source.csv'
            source.write_text('changed')
            updated = {**config, 'derivation': str(source)}
            data = copy.deepcopy(ai.reference())
            data['configurationDigest'] = ai.config_digest(updated)
            with patch.object(ai, 'read_config', return_value=updated), patch.object(ai, '_read_reference', return_value=data):
                with self.assertRaisesRegex(ValueError, 'source files changed'):
                    ai.reference()

    def test_ai_endpoint_has_same_case_access_boundary_and_hides_reference_data(self):
        response = server.get_ai('1718')
        body = json.loads(response.body)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(body['patientId'], '1718')
        self.assertNotIn('patients', body)
        self.assertNotIn('distributions', body)
        self.assertNotIn('/Volumes/', response.body.decode())
        with self.assertRaises(HTTPException) as error:
            server.get_ai('not-in-catalog')
        self.assertEqual(error.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
