import csv
import json
import tempfile
import unittest
from pathlib import Path
from backend import ai
from backend.external_ai import load_patient_record
from backend.prepare_cases import clinical_rows, discover_ct, discover_centerlines, unchanged_json


class BatchPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name)

    def tearDown(self):self.temporary.cleanup()

    def csv_file(self,rows):
        path=self.root/'clinical.csv'
        fields=['Patient ID','KVP','feature','Clinical Likelihood','SS45','Age at CCTA','Dyspnea',
                'Type of chest pain ','Familiarity for CAD','EVENT','TIME','Unrelated']
        with path.open('w',newline='') as handle:
            writer=csv.DictWriter(handle,fieldnames=fields);writer.writeheader();writer.writerows(rows)
        return path

    def test_clinical_reader_selects_ids_preserves_zero_and_discards_outcomes(self):
        path=self.csv_file([{'Patient ID':'96.0','KVP':'100','feature':'.25','Clinical Likelihood':'0',
                             'SS45':'No','Age at CCTA':'78','Dyspnea':'No',
                             'Type of chest pain ':'','Familiarity for CAD':'Unknown',
                             'EVENT':'1','TIME':'3','Unrelated':'x'*200000},
                            {'Patient ID':'814','KVP':'80','feature':'.5'}])
        previous=csv.field_size_limit()
        records=clinical_rows(path,{'96'},['feature'])
        self.assertEqual(set(records),{'96'})
        self.assertEqual(records['96']['Clinical Likelihood'],0)
        self.assertIsNone(records['96']['Type of chest pain '])
        self.assertIsNone(records['96']['Familiarity for CAD'])
        self.assertNotIn('EVENT',records['96']);self.assertNotIn('TIME',records['96'])
        self.assertNotIn('Unrelated',records['96'])
        self.assertEqual(csv.field_size_limit(),previous)

    def test_missing_and_duplicate_clinical_ids_fail(self):
        path=self.csv_file([{'Patient ID':'96','KVP':'100','feature':'.2'}])
        with self.assertRaisesRegex(ValueError,'no record'):clinical_rows(path,{'893'},['feature'])
        path=self.csv_file([{'Patient ID':'96','KVP':'100','feature':'.2'},
                            {'Patient ID':'96.0','KVP':'100','feature':'.2'}])
        with self.assertRaisesRegex(ValueError,'Duplicate'):clinical_rows(path,{'96'},['feature'])

    def test_ct_discovery_refuses_ambiguous_sources_and_accepts_explicit_path(self):
        first=self.root/'1_500';first.mkdir();(first/'96.nii.gz').touch()
        self.assertEqual(discover_ct('96',[self.root]),(first/'96.nii.gz').resolve())
        second=self.root/'copy';second.mkdir();(second/'96.nii.gz').touch()
        with self.assertRaisesRegex(ValueError,'2 CCTAs'):discover_ct('96',[self.root])
        self.assertEqual(discover_ct('96',[self.root],str(first/'96.nii.gz')),(first/'96.nii.gz').resolve())

    def test_centerline_discovery_never_guesses_an_anatomical_branch(self):
        labeling=self.root/'labeling';labeling.mkdir()
        for name in ['96_LAD_1.csv','96_LCx_3.csv','96_RCA_1.csv']:(labeling/name).touch()
        self.assertEqual(discover_centerlines('96',self.root)['LCx'],'96_LCx_3.csv')
        (labeling/'96_LAD_2.csv').touch()
        with self.assertRaisesRegex(ValueError,'not be guessed'):discover_centerlines('96',self.root)
        self.assertEqual(discover_centerlines('96',self.root,{'LAD':'96_LAD_2.csv'})['LAD'],'96_LAD_2.csv')

    def test_repeated_registration_does_not_touch_unchanged_files(self):
        path=self.root/'patient.json';value={'patientId':'96','KVP':100}
        unchanged_json(path,value);before=path.stat().st_mtime_ns
        unchanged_json(path,value)
        self.assertEqual(path.stat().st_mtime_ns,before)

    def test_cohort_record_can_be_enriched_but_prediction_inputs_are_frozen(self):
        path=self.root/'patient.json'
        metadata={'patientId':'96','KVP':100,'feature':.25,'Clinical Likelihood':19,'SS45':'No',
                  'Age at CCTA':78,'Sex':'Man','EVENT':1,'TIME':2,'Unrelated':'ignore'}
        path.write_text(json.dumps(metadata))
        cohort={'sourceCohort':'derivation','KVP':100,'feature':.25,'Clinical Likelihood':19,'SS45':'No',
                'Age at CCTA':77,'Sex':'Man'}
        conf={'patientId':'96','aiRecord':str(path)}
        record=load_patient_record(conf,['feature'],cohort)
        self.assertEqual(record['Age at CCTA'],78)
        self.assertEqual(record['sourceCohort'],'derivation')
        for key in ['KVP','feature','Clinical Likelihood','SS45']:self.assertEqual(record[key],cohort[key])
        self.assertEqual(cohort['Age at CCTA'],77)
        self.assertNotIn('EVENT',record);self.assertNotIn('TIME',record)
        for key,value in [('KVP',120),('feature',.8),('Clinical Likelihood',4),('SS45','Yes')]:
            with self.subTest(key=key):
                path.write_text(json.dumps({**metadata,key:value}))
                with self.assertRaisesRegex(ValueError,'frozen cohort'):load_patient_record(conf,['feature'],cohort)

    def test_wide_patient_record_does_not_change_reference_cohort(self):
        path=self.root/'patient.json'
        path.write_text(json.dumps({'patientId':'External','KVP':120,'feature':.5}))
        reference={'models':{'pri':{'features':['feature']}},'patients':{}}
        record=ai.patient_record('External',reference,{'patientId':'External','aiRecord':str(path)})
        self.assertEqual(record['sourceCohort'],'external')
        self.assertEqual(record['feature'],.5)
        self.assertEqual(reference['patients'],{})


if __name__=='__main__':unittest.main()
