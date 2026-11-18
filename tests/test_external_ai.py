import copy
import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import ai
from backend.external_ai import load_record
from backend.data import read_case_config


class ExternalAiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.source=self.root/'radiomics.csv'
        self.clinical=self.root/'clinical.json'
        self.fields=['artery_label','original_glcm_Id','wavelet-LHL_firstorder_Mean']
        self.rows=[{'artery_label':'LAD','original_glcm_Id':.2},
                   {'artery_label':'LCX','original_glcm_Id':.3},
                   {'artery_label':'RCA','wavelet-LHL_firstorder_Mean':12}]
        self.write_csv()
        self.metadata={'patientId':'external','KVP':120,'Clinical Likelihood':12,'SS45':'No',
                       'Age at CCTA':65,'EVENT':1,'TIME':3,'secret':'excluded'}
        self.clinical.write_text(json.dumps(self.metadata))
        self.conf={'patientId':'external','aiInput':{'radiomicsCsv':str(self.source),'clinicalJson':str(self.clinical)}}
        self.features=['original_glcm_Id_LAD','original_glcm_Id_LCX','wavelet-LHL_firstorder_Mean_RCA']

    def tearDown(self):
        self.temp.cleanup()

    def write_csv(self):
        with self.source.open('w',newline='') as file:
            writer=csv.DictWriter(file,fieldnames=self.fields);writer.writeheader();writer.writerows(self.rows)

    def test_feature_join_uses_vessel_labels_and_ignores_outcomes_and_other_metadata(self):
        record=load_record(self.conf,self.features)
        self.assertEqual([record[name] for name in self.features],[.2,.3,12])
        self.assertEqual(record['sourceCohort'],'external')
        self.assertEqual(record['KVP'],120)
        self.assertNotIn('EVENT',record);self.assertNotIn('TIME',record);self.assertNotIn('secret',record)
        self.rows.reverse();self.write_csv()
        self.assertEqual(load_record(self.conf,self.features),record)

    def test_missing_predictors_stay_missing_and_duplicate_or_wrong_patients_fail(self):
        self.clinical.write_text(json.dumps({'patientId':'external'}))
        record=load_record(self.conf,self.features+['missing_LAD'])
        self.assertIsNone(record['KVP']);self.assertIsNone(record['Clinical Likelihood']);self.assertIsNone(record['missing_LAD'])
        self.rows.append(self.rows[0]);self.write_csv()
        with self.assertRaisesRegex(ValueError,'Duplicate LAD'):load_record(self.conf,self.features)
        self.rows.pop();self.write_csv();self.clinical.write_text(json.dumps({'patientId':'wrong'}))
        with self.assertRaisesRegex(ValueError,'does not match'):load_record(self.conf,self.features)

    def test_nonfinite_metadata_and_id_collisions_are_rejected(self):
        self.clinical.write_text(json.dumps({**self.metadata,'KVP':'NaN'}))
        with self.assertRaisesRegex(ValueError,'finite number'):load_record(self.conf,self.features)
        with self.assertRaisesRegex(ValueError,'conflicts'):
            ai.patient_record('external',{'patients':{'external':{}}},self.conf)

    def test_new_patient_reuses_fixed_models_and_derivation_reference(self):
        data=ai.reference();before=copy.deepcopy(data)
        actual=ai.results('P001')
        self.assertEqual(actual['sourceCohort'],'external');self.assertNotIn('P001',data['patients'])
        self.assertTrue(all(f['value'] is not None and f['reference']['n']==1038 for f in actual['features']))
        self.assertIsNone(actual['predictions']['pri']['error'])
        # External scalar exports are editable inputs, unlike the frozen cohort
        # reference. Re-extraction must not require a hard-coded old risk value.
        pri=actual['predictions']['pri']['risk']
        self.assertGreater(pri,0);self.assertLess(pri,1)
        self.assertEqual(actual['stratum'],ai.risk_stratum(pri,data['thresholds']['q25'],data['thresholds']['q75']))
        conf=read_case_config('P001')
        self.clinical.write_text(json.dumps({**self.metadata,'patientId':'P001'}))
        conf={**conf,'patientData':{**conf['patientData'],'clinicalJson':str(self.clinical)}}
        with patch.object(ai,'read_case_config',return_value=conf):
            complete=ai.results('P001')
        self.assertIsNone(complete['predictions']['adjusted']['error'])
        self.assertEqual(complete['cohort']['n'],1038)
        for feature in complete['features']:
            original=next(f for f in actual['features'] if f['name']==feature['name'])
            self.assertEqual(feature['reference'],original['reference'])
        self.assertEqual(data,before)


if __name__=='__main__':unittest.main()
