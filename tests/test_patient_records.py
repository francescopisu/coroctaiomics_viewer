import csv
import json
import tempfile
import unittest
from pathlib import Path
from backend.patient_records import load_patient

class PatientRecordTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.csv=self.root/'der.csv';self.metadata=self.root/'patient.json'
        self.features=['original_glcm_Id_LAD','wavelet-LHL_firstorder_Mean_RCA']
        self.fields=['Patient ID','Age at CCTA','KVP','Smoker','Hypertension','EVENT','TIME',*self.features]
        self.rows=[{'Patient ID':'96.0','Age at CCTA':'78','KVP':'100','Smoker':'Yes','Hypertension':'No','EVENT':'1','TIME':'12',self.features[0]:'.3',self.features[1]:'15'}]
        self.write();self.settings={'sources':{'derivation':str(self.csv)},'radiomicsCsv':str(self.root/'absent.csv')}
    def tearDown(self):self.temp.cleanup()
    def write(self):
        with self.csv.open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=self.fields);w.writeheader();w.writerows(self.rows)
    def test_full_ecrf_and_json_overrides_are_allowlisted_and_keep_unknown_distinct(self):
        self.metadata.write_text(json.dumps({'patientId':'96','Age at CCTA':79,'Smoker':None,'secret':'hidden','EVENT':0}))
        self.settings['clinicalJson']=str(self.metadata)
        result=load_patient('96',self.settings,self.features)
        self.assertEqual(result['Age at CCTA'],79);self.assertIsNone(result['Smoker']);self.assertEqual(result['Hypertension'],'No')
        self.assertEqual(result[self.features[0]],.3);self.assertEqual(result['sourceCohort'],'derivation')
        self.assertNotIn('EVENT',result);self.assertNotIn('TIME',result);self.assertNotIn('secret',result)
    def test_external_uses_output_scalar_csv_and_manual_clinical_data(self):
        scalar=self.root/'scalar.csv'
        scalar.write_text('artery_label,original_glcm_Id,wavelet-LHL_firstorder_Mean\nLAD,0.6,\nRCA,,18\n')
        self.metadata.write_text(json.dumps({'patientId':'P001','KVP':120,'Type of chest pain ':'No chest pain'}))
        result=load_patient('P001',{**self.settings,'radiomicsCsv':str(scalar),'clinicalJson':str(self.metadata)},self.features)
        self.assertEqual(result['sourceCohort'],'external');self.assertEqual(result['KVP'],120)
        self.assertEqual([result[f] for f in self.features],[.6,18]);self.assertEqual(result['Type of chest pain '],'No chest pain')
        self.assertIsNone(result['Hypertension'])
    def test_duplicates_wrong_json_patient_and_nonfinite_input_fail(self):
        self.rows.append(self.rows[0]);self.write()
        with self.assertRaisesRegex(ValueError,'Duplicate'):load_patient('96',self.settings,self.features)
        self.rows.pop();self.write();self.settings['clinicalJson']=str(self.metadata)
        self.metadata.write_text(json.dumps({'patientId':'wrong'}))
        with self.assertRaisesRegex(ValueError,'matching'):load_patient('96',self.settings,self.features)
        self.metadata.write_text(json.dumps({'patientId':'96','KVP':'Infinity'}))
        with self.assertRaisesRegex(ValueError,'finite'):load_patient('96',self.settings,self.features)
        self.settings.pop('clinicalJson');self.settings['sources']['validation']=str(self.csv)
        with self.assertRaisesRegex(ValueError,'both eCRFs'):load_patient('96',self.settings,self.features)
    def test_missing_values_do_not_revert_to_old_reference_and_csv_edits_refresh(self):
        self.rows[0][self.features[0]]='nan';self.write()
        base={self.features[0]:99,'sourceCohort':'derivation'}
        result=load_patient('96',self.settings,self.features,base);self.assertIsNone(result[self.features[0]])
        self.rows[0][self.features[0]]='0.12345';self.write()
        self.assertEqual(load_patient('96',self.settings,self.features)[self.features[0]],.12345)
        self.csv.unlink();self.assertEqual(load_patient('96',self.settings,self.features,base)[self.features[0]],99)
