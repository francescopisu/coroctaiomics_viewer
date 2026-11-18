"""Patient inputs: full eCRF row, then explicit JSON overrides; fixed models stay fixed."""
import csv
import re
from functools import lru_cache
from pathlib import Path
from threading import RLock
from .data import read_json
from .external_ai import NUMERIC, CLINICAL, numeric, load_record

CSV_LOCK = RLock()
MISSING = {'', 'nan', 'none', 'null', 'na', 'n/a', '<na>'}


def normalize_id(value):
    text = str(value).strip()
    return text.split('.')[0] if re.fullmatch(r'\d+\.0+', text) else text


def missing(value):
    return value is None or isinstance(value, str) and value.strip().lower() in MISSING


def clean(values, features):
    result = {}
    for name in (*NUMERIC, *features):
        if name in values:
            value = values[name]
            result[name] = numeric(None if missing(value) or str(value).lower()=='unknown' else value, name)
    for name in CLINICAL:
        if name in values:result[name] = None if missing(values[name]) else str(values[name]).strip()
    return result


@lru_cache(maxsize=4)
def _cohort_rows(path, modified, size, features):
    with CSV_LOCK:
        previous = csv.field_size_limit();csv.field_size_limit(64*1024**2)
        result = {}
        try:
            with open(path, newline='', encoding='utf-8-sig') as handle:
                reader = csv.DictReader(handle);fields = reader.fieldnames or []
                relevant = {'Patient ID', *NUMERIC, *CLINICAL, *features}
                if 'Patient ID' not in fields or any(fields.count(key)>1 for key in relevant):
                    raise ValueError('eCRF CSV requires Patient ID and unique clinical/model columns.')
                for raw in reader:
                    if missing(raw.get('Patient ID')):continue
                    pid = normalize_id(raw['Patient ID'])
                    if pid in result:raise ValueError(f'Duplicate eCRF records for patient {pid}.')
                    result[pid] = clean(raw, features)
        finally:csv.field_size_limit(previous)
        stat = Path(path).stat()
        if (stat.st_mtime_ns,stat.st_size)!=(modified,size):
            raise ValueError('eCRF changed while reading it; retry after saving the CSV.')
        return result


def load_patient(pid, settings, features, frozen=None):
    features = tuple(features);record = dict(frozen or {});cohort = None
    for source, filename in settings.get('sources', {}).items():
        path = Path(filename)
        if not path.is_file():continue  # Prepared reference remains usable offline.
        stat = path.stat();row = _cohort_rows(str(path),stat.st_mtime_ns,stat.st_size,features).get(pid)
        if row is None:continue
        if cohort is not None:raise ValueError(f'Patient {pid} occurs in both eCRFs; resolve the duplicate ID.')
        cohort = source;record.update(row)
    metadata = {}
    if settings.get('clinicalJson'):
        metadata = read_json(Path(settings['clinicalJson']))
        if not isinstance(metadata,dict) or metadata.get('patientId')!=pid:
            raise ValueError('Clinical JSON must contain the matching patientId.')
        if 'Dyslipdemia' in metadata:
            if 'Dyslipidemia' in metadata:raise ValueError('Use only Dyslipidemia in the clinical JSON.')
            metadata = {**metadata,'Dyslipidemia':metadata['Dyslipdemia']}
    # Cohort values (including recorded missing values) are authoritative. Use the
    # pipeline scalar CSV only for predictors absent from the patient record.
    path = Path(settings['radiomicsCsv']) if settings.get('radiomicsCsv') else None
    if any(name not in record and name not in metadata for name in features) and path and path.is_file():
        scalars = load_record({'patientId':pid,'aiInput':{'radiomicsCsv':str(path)}},features)
        for name in features:
            if name not in record:record[name] = scalars.get(name)
    record.update(clean(metadata,features))  # Explicit null clears a value; omitted keys do not.
    if not record and not metadata:return None
    result = {name:record.get(name) for name in (*NUMERIC,*CLINICAL,*features)}
    return {**result,'sourceCohort':cohort or record.get('sourceCohort','external')}
