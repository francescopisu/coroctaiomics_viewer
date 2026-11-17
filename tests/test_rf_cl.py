import copy
import itertools
import json
import pickle
import unittest
from pathlib import Path
import numpy as np
from backend.rf_cl import calculate_pretest, CLINICAL_DATA, RISK_FACTORS, ss45_from_cadrads


class ComponentLikelihoodTests(unittest.TestCase):
    def components(self):
        return {'Age at CCTA':42,'Sex':'Man','Hypertension':'No','Dyslipdemia':'Yes',
                'Smoker':'Yes','Diabetes':'No','Dyspnea':'No','Type of chest pain ':None,
                'Familiarity for CAD':None,'CADRADS':'Score 2','Number of risk factors':99}

    def test_patient_example_retains_unknown_history_but_has_an_unambiguous_lookup(self):
        inputs=self.components();before=copy.deepcopy(inputs)
        result=calculate_pretest(inputs,chest_pain_absent=True)
        self.assertEqual(result['Known positive risk factors'],2)
        self.assertIsNone(result['Number of risk factors'])
        self.assertEqual(result['Risk factor count range'],[2,3])
        self.assertEqual(result['Unknown risk factors'],['Familiarity for CAD'])
        self.assertEqual(result['CVRF'],'2-3');self.assertEqual(result['Age Range'],'40-49')
        self.assertEqual(result['Symptom Score'],0)
        self.assertEqual(result['Clinical Likelihood'],4)
        self.assertEqual(result['Clinical Likelihood Class'],'Very low')
        self.assertEqual(result['SS45'],'No')
        self.assertEqual(result['Type of chest pain '],'No chest pain')
        self.assertEqual(result['Dyslipidemia'],'Yes');self.assertNotIn('Dyslipdemia',result)
        self.assertEqual(inputs,before);json.dumps(result,allow_nan=False)
        for history,count in [('No',2),('Yes',3)]:
            complete=calculate_pretest({**inputs,'Familiarity for CAD':history},chest_pain_absent=True)
            self.assertEqual(complete['Number of risk factors'],count)
            self.assertEqual(complete['Clinical Likelihood'],4)

    def test_all_five_flags_recount_risk_factors_instead_of_trusting_existing_count(self):
        for flags in itertools.product([False,True],repeat=5):
            inputs=self.components();inputs.pop('Dyslipdemia');inputs.update(dict(zip(RISK_FACTORS,flags)))
            result=calculate_pretest(inputs,chest_pain_absent=True)
            self.assertEqual(result['Number of risk factors'],sum(flags))
            self.assertEqual(result['Risk factor count range'],[sum(flags),sum(flags)])
            self.assertEqual(result['CVRF'],('0-1','2-3','4-5')[min(sum(flags)//2,2)])

    def test_cohort_symptom_coding_is_preserved_and_explicit_score_is_available(self):
        inputs={**self.components(),'Familiarity for CAD':'No'}
        for pain,dyspnea,points,likelihood in [
            ('No chest pain','No',0,4),('Atypical Chest Pain','No',1,4),
            ('Typycal Chest Pain','No',2,6),('Typical Chest Pain','No',2,6),
            ('Chest Pain At Rest','No',3,20),('Atypical Chest Pain','Yes',3,20),
            ('Typycal Chest Pain','Yes',3,20),('No chest pain','Yes',2,6),
        ]:
            result=calculate_pretest({**inputs,'Type of chest pain ':pain,'Dyspnea':dyspnea})
            self.assertEqual(result['Symptom Score'],points);self.assertEqual(result['Clinical Likelihood'],likelihood)
        result=calculate_pretest(inputs,symptom_score=3)
        self.assertEqual(result['Clinical Likelihood'],20);self.assertEqual(result['RF-CL symptom coding'],'provided')

    def test_unknowns_are_not_silently_negative_and_ambiguous_lookup_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'Chest-pain type is unknown'):calculate_pretest(self.components())
        inputs={**self.components(),'Smoker':'No'}
        with self.assertRaisesRegex(ValueError,'multiple RF-CL values'):calculate_pretest(inputs,chest_pain_absent=True)
        with self.assertRaisesRegex(ValueError,'Dyspnea is unknown'):
            calculate_pretest({**self.components(),'Dyspnea':None},chest_pain_absent=True)
        with self.assertRaisesRegex(ValueError,'conflicts'):
            calculate_pretest({**self.components(),'Type of chest pain ':'Typycal Chest Pain'},chest_pain_absent=True)
        with self.assertRaisesRegex(ValueError,'must be Yes, No'):
            calculate_pretest({**self.components(),'Diabetes':'maybe'},chest_pain_absent=True)

    def test_age_boundaries_and_class_thresholds(self):
        for age,band in [(30,'30-39'),(39.9,'30-39'),(40,'40-49'),(50,'50-59'),(60,'60-69'),(70,'70-80'),(80,'70-80')]:
            self.assertEqual(calculate_pretest({**self.components(),'Age at CCTA':age},chest_pain_absent=True)['Age Range'],band)
        for age in [None,True,29,80.1,float('nan'),float('inf')]:
            with self.subTest(age=age),self.assertRaisesRegex(ValueError,'30 and 80'):
                calculate_pretest({**self.components(),'Age at CCTA':age},chest_pain_absent=True)
        for value,label in [(5,'Very low'),(15,'Low'),(16,'Moderate')]:
            table=CLINICAL_DATA.copy();table[1,1,1,0]=value;before=table.copy()
            result=calculate_pretest(self.components(),table,chest_pain_absent=True)
            self.assertEqual(result['Clinical Likelihood Class'],label);np.testing.assert_array_equal(table,before)

    def test_invalid_inputs_and_lookup_axes_fail_explicitly(self):
        for score in [True,-1,4,.5,'2',float('nan')]:
            with self.subTest(score=score),self.assertRaisesRegex(ValueError,'integer from 0 to 3'):
                calculate_pretest(self.components(),symptom_score=score)
        for table in [np.zeros((5,2,3,3)),np.full((5,3,2,3),np.nan),np.full((5,3,2,3),51)]:
            with self.assertRaisesRegex(ValueError,'shape'):
                calculate_pretest(self.components(),table,chest_pain_absent=True)
        with self.assertRaisesRegex(ValueError,'Conflicting'):
            calculate_pretest({**self.components(),'Dyslipidemia':'No'},chest_pain_absent=True)

    def test_ss45_uses_the_study_cadrads_45_definition_and_preserves_missing(self):
        for category in range(6):
            self.assertEqual(ss45_from_cadrads(f'Score {category}'),'Yes' if category>=4 else 'No')
        self.assertEqual(ss45_from_cadrads('CAD-RADS 4A'),'Yes')
        self.assertEqual(ss45_from_cadrads('4B'),'Yes');self.assertIsNone(ss45_from_cadrads(None))
        with self.assertRaisesRegex(ValueError,'cannot determine SS45'):ss45_from_cadrads('N')
        with self.assertRaisesRegex(ValueError,'cannot determine SS45'):ss45_from_cadrads('Score 2/N')

    def test_lookup_matches_all_90_cells_of_the_original_study_artifact(self):
        path=Path('/Volumes/X9Pro/output/CoroCTAiomics/analysis/v2/28072025/data/clinical_data.pkl')
        if not path.is_file():self.skipTest('Original study lookup is not mounted')
        with path.open('rb') as file:original=pickle.load(file)
        np.testing.assert_array_equal(CLINICAL_DATA,original)
        self.assertFalse(CLINICAL_DATA.flags.writeable)


if __name__=='__main__':unittest.main()
