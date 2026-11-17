"""Read one explicitly configured external patient, without changing the AI cohort."""
import csv
from functools import lru_cache
from pathlib import Path
import numpy as np
from .data import ROOT, read_json

NUMERIC = ('KVP', 'Clinical Likelihood', 'Age at CCTA', 'Body mass index (BMI)',
           'Coronary artery calcium score')
CLINICAL = ('Clinical Likelihood Class', 'SS45', 'Sex', 'CADRADS', 'Smoker',
            'Hypertension', 'Diabetes', 'Dyslipidemia', 'Dyspnea',
            'Type of chest pain ', 'Familiarity for CAD')


def numeric(value, name):
    if value is None or value == '':
        return None
    try:
        if isinstance(value, bool):
            raise ValueError()
        value = float(value)
        if not np.isfinite(value):
            raise ValueError()
        return value
    except (TypeError, ValueError):
        raise ValueError(f'External AI input {name} must be a finite number or null.')


def local_path(value):
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT/path


def load_patient_record(conf, features, cohort_record=None):
    """Allowlisted wide-CSV export, with frozen model-input checks for cohort IDs."""
    metadata = read_json(local_path(conf['aiRecord']))
    if not isinstance(metadata, dict) or metadata.get('patientId') != conf['patientId']:
        raise ValueError('Patient record does not match the configured case.')
    record = {name: numeric(metadata.get(name), name) for name in (*NUMERIC, *features)}
    record.update({name: str(metadata[name]).strip() or None if metadata.get(name) is not None else None
                   for name in CLINICAL})
    if cohort_record is not None:
        model_inputs = (*features, 'KVP', 'Clinical Likelihood', 'SS45')
        for name in model_inputs:
            expected, actual = cohort_record.get(name), record.get(name)
            same = expected == actual
            if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
                same = bool(np.isclose(expected, actual, rtol=1e-10, atol=1e-12))
            if not same:
                raise ValueError(f'{conf["patientId"]}: {name} differs from the frozen cohort record. '
                                 'Review the patient/source selection; model inputs will not be overwritten.')
        # Preserve exact frozen prediction inputs. Reporting fields may be enriched.
        return {**cohort_record, **{key: value for key, value in record.items() if key not in model_inputs}}
    return {**record, 'sourceCohort': 'external'}


@lru_cache(maxsize=8)
def _read_csv(path, modified, size):
    with open(path, newline='') as file:
        reader = csv.DictReader(file)
        fields = reader.fieldnames or []
        if 'artery_label' not in fields or len(fields) != len(set(fields)):
            raise ValueError('External radiomics CSV requires unique columns and artery_label.')
        return tuple(reader)


def load_record(conf, features):
    pid, inputs = conf['patientId'], conf['aiInput']
    path = local_path(inputs['radiomicsCsv'])
    stat = path.stat()
    rows = _read_csv(str(path), stat.st_mtime_ns, stat.st_size)
    vessels = {}
    for row in rows:
        for key in ('Patient ID', 'patientId'):
            if row.get(key) and row[key].strip() != pid:
                raise ValueError('External radiomics patient ID does not match the selected case.')
        vessel = row['artery_label'].strip().upper()
        if vessel not in ('LAD', 'LCX', 'RCA'):
            continue
        if vessel in vessels:
            raise ValueError(f'Duplicate {vessel} rows in external radiomics CSV.')
        vessels[vessel] = row
    metadata = read_json(local_path(inputs['clinicalJson'])) if inputs.get('clinicalJson') else {}
    if not isinstance(metadata, dict):
        raise ValueError('External clinical JSON must contain one patient object.')
    if metadata and metadata.get('patientId') != pid:
        raise ValueError('External clinical patient ID does not match the selected case.')
    record = {name: numeric(metadata.get(name), name) for name in NUMERIC}
    record.update({name: str(metadata[name]).strip() or None if metadata.get(name) is not None else None
                   for name in CLINICAL})
    for name in features:
        label, vessel = name.rsplit('_', 1)
        record[name] = numeric(vessels.get(vessel.upper(), {}).get(label), name)
    # Only allowlisted reporting fields and model predictors leave this loader.
    # EVENT/TIME, file paths and arbitrary metadata are never patient inputs.
    return {**record, 'sourceCohort': 'external'}
