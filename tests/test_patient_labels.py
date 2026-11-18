import unittest
from unittest.mock import patch
from backend.registry import patient_labels

class PatientLabelTests(unittest.TestCase):
    def labels(self,mapping):
        with patch('backend.registry.read_registry',return_value={'patients':[{'id':'96'},{'id':'814'}],'patientLabels':mapping}):
            return patient_labels()

    def test_labels_preserve_case_ids_and_unmapped_fallback(self):
        self.assertEqual(self.labels({'96':' A-001 ','999':'Hidden'}),{'96':'A-001','814':'814'})

    def test_duplicate_display_names_are_rejected(self):
        with self.assertRaisesRegex(ValueError,'unique'):
            self.labels({'96':'A-001','814':'a-001'})

    def test_invalid_mapping_is_rejected(self):
        for mapping in [None,[],{'96':''},{'96':42}]:
            with self.subTest(mapping=mapping),self.assertRaisesRegex(ValueError,'patientLabels'):
                self.labels(mapping)
