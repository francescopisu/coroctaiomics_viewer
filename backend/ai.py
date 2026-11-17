"""Patient-level Cox inference from a validated numerical export. No pickle at runtime."""
import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path
import numpy as np
from .data import ROOT, read_case_config

VERSION = 1
SOURCE_KEYS = ('derivation', 'validation', 'priModel', 'adjustedModel', 'thresholds')
OPTIONAL_SOURCE_KEYS = ('priOofReference',)


def config_path():
    return Path(os.environ.get('CORONARY_AI_CONFIG', ROOT/'config/ai.local.json'))


def read_config():
    conf = json.loads(config_path().read_text())
    if any(not isinstance(conf.get(key), str) for key in SOURCE_KEYS):
        raise ValueError('Set derivation, validation, priModel, adjustedModel and thresholds in config/ai.local.json.')
    if any(key in conf and not isinstance(conf[key], str) for key in OPTIONAL_SOURCE_KEYS):
        raise ValueError('priOofReference must be a path to the exported out-of-fold PRI reference JSON.')
    return conf


def source_keys(conf):
    return (*SOURCE_KEYS, *(key for key in OPTIONAL_SOURCE_KEYS if key in conf))


def config_digest(conf):
    return hashlib.sha256(json.dumps(conf, sort_keys=True).encode()).hexdigest()


def infer(model, record):
    """The supported saved model: finite inputs -> site-only ComBat -> scaling -> Cox.

    Outcomes are never inputs. Missing model predictors fail explicitly, rather than
    using the notebook imputer, which was fitted with TIME/EVENT in its design.
    """
    features = model['features']
    values = np.array([record.get(name, np.nan) for name in features], dtype=float)
    if not np.isfinite(values).all():
        raise ValueError('Radiomic model inputs are missing; inference requires all eight feature values.')
    if model['combat'] is not None:
        try:
            site = str(float(record['KVP']))
            transform = model['combat'][site]
        except (KeyError, ValueError, TypeError):
            raise ValueError('Patient KVP is missing or was not represented in the saved harmonization model.')
        values = values * np.array(transform['slope']) + np.array(transform['intercept'])
    predictors = dict(zip(features, values))
    if model['clinicalFeatures']:
        likelihood = record.get('Clinical Likelihood')
        if not isinstance(likelihood, (int, float)) or not np.isfinite(likelihood):
            raise ValueError('The adjusted model requires a recorded numeric ESC RF-CL value.')
        if record.get('SS45') not in ('Yes', 'No'):
            raise ValueError('The adjusted model requires a recorded SS45 value (Yes/No).')
        predictors.update({'Clinical Likelihood': likelihood, 'SS45_Yes': float(record['SS45'] == 'Yes')})
    for name, scale in model['scale'].items():
        predictors[name] = (predictors[name] - scale['mean']) / scale['sd']
    x = np.array([predictors[name] for name in model['columns']])
    log_hazard = float((x - np.array(model['center'])) @ np.array(model['coefficients']))
    if not np.isfinite(log_hazard):
        raise ValueError('Model inputs produced a non-finite prediction.')
    # Stable 1 - exp(-H0(t) * exp(linear predictor)), including extreme inputs.
    risk = float(-np.expm1(-model['baselineHazard'] * np.exp(np.clip(log_hazard, -700, 700))))
    return {'risk': risk, 'logPartialHazard': log_hazard}


def risk_stratum(risk, q25, q75):
    return 'Low' if risk <= q25 else 'Intermediate' if risk <= q75 else 'High'


def percentile(values, value):
    """Empirical midrank, excluding missing values. Ties receive the same position."""
    if value is None:
        return None
    ordered = np.asarray(values, dtype=float)
    if not len(ordered):
        return None
    return float(100 * (np.searchsorted(ordered, value, 'left') +
                        np.searchsorted(ordered, value, 'right')) / (2 * len(ordered)))


def feature_reference(patients, name, value):
    """Descriptive native-value reference, before ComBat/scaling, derivation only.

    This is a cohort position, not the patient's signed Cox contribution.
    Validation patients and non-finite/missing observations never enter it.
    """
    values = sorted(float(record[name]) for record in patients
                    if record.get('sourceCohort') == 'derivation'
                    and isinstance(record.get(name), (int, float))
                    and np.isfinite(record[name]))
    if not values:
        return {'median': None, 'iqr': None, 'percentile': None, 'n': 0}
    q25, median, q75 = np.percentile(values, [25, 50, 75])
    valid = isinstance(value, (int, float)) and np.isfinite(value)
    return {'median': float(median), 'iqr': [float(q25), float(q75)],
            'percentile': percentile(values, value) if valid else None, 'n': len(values)}


@lru_cache(maxsize=2)
def _read_reference(path, modified, size):
    with open(path) as file:
        data = json.load(file)
    if data.get('version') != VERSION:
        raise ValueError('AI export version changed. Run python -m backend.export_ai again.')
    return data


def reference():
    conf = read_config()
    path = ROOT/'cache/ai/reference.json'
    try:
        stat = path.stat()
    except FileNotFoundError:
        raise ValueError('AI results are not prepared. Run python -m backend.export_ai in the analysis environment.')
    data = _read_reference(str(path), stat.st_mtime_ns, stat.st_size)
    if data['configurationDigest'] != config_digest(conf):
        raise ValueError('AI configuration changed. Run python -m backend.export_ai again.')
    # Source availability is optional after export, just as for the imaging cache.
    # If a source is mounted and changed, never silently serve old results.
    for key in source_keys(conf):
        source = Path(conf[key])
        if source.is_file():
            state = source.stat()
            if [state.st_size, state.st_mtime_ns] != data['sources'][key]['stat']:
                raise ValueError('AI source files changed. Run python -m backend.export_ai again.')
    return data


def patient_record(patient_id, data, case_config=None):
    if case_config is None:
        try:
            case_config = read_case_config(patient_id)
        except LookupError:
            case_config = None
    if case_config and case_config.get('aiRecord'):
        if case_config.get('aiInput'):
            raise ValueError('Choose aiRecord or aiInput for this case, not both.')
        from .external_ai import load_patient_record
        return load_patient_record(case_config, data['models']['pri']['features'], data['patients'].get(patient_id))
    if case_config and case_config.get('aiInput'):
        if patient_id in data['patients']:
            raise ValueError('External AI input conflicts with an existing cohort patient ID.')
        from .external_ai import load_record
        return load_record(case_config, data['models']['pri']['features'])
    return data['patients'].get(patient_id)


def results(patient_id):
    if os.environ.get('CORONARY_PORTABLE_HOME'):
        read_case_config(patient_id)
        from .portable import patient_ai
        return patient_ai(patient_id)
    data = reference()
    record = patient_record(patient_id, data)
    if record is None:
        raise LookupError('No patient record matching this configured case in the AI datasets.')
    models = data['models']
    predictions = {}
    for name in ('pri', 'adjusted'):
        try:
            predictions[name] = {**infer(models[name], record), 'error': None}
        except ValueError as error:
            predictions[name] = {'risk': None, 'error': str(error)}
    pri = predictions['pri']['risk']
    thresholds = data['thresholds']
    stratum = risk_stratum(pri, thresholds['q25'], thresholds['q75']) if pri is not None else None
    pri_values = data['distributions'].get('PRI-only', [])
    pri_reference = {'percentile': percentile(pri_values, pri), 'n': len(pri_values),
                     'source': thresholds['source']}
    comparisons = []
    if pri_values:
        comparisons.append({'name': 'PRI-only', 'label': 'PRI-only', 'value': pri,
                            'median': float(np.median(pri_values)),
                            'percentile': pri_reference['percentile'], 'n': len(pri_values)})
    for name, label in [('Age at CCTA', 'Age'), ('Coronary artery calcium score', 'Agatston'),
                        ('Clinical Likelihood', 'ESC RF-CL')]:
        values = data['distributions'][name]
        value = record.get(name)
        comparisons.append({'name': name, 'label': label, 'value': value,
                            'median': float(np.median(values)) if values else None,
                            'percentile': percentile(values, value), 'n': len(values)})
    features = []
    for name in models['pri']['features']:
        label, vessel = name.rsplit('_', 1)
        features.append({'name': name, 'mapName': label, 'vessel': 'LCx' if vessel == 'LCX' else vessel,
                         'value': record.get(name),
                         'reference': feature_reference(data['patients'].values(), name, record.get(name)),
                         'models': {key: model['hr'][name] for key, model in models.items()}})
    return {'patientId': patient_id, 'sourceCohort': record['sourceCohort'],
            'horizonMonths': data['horizonMonths'], 'predictions': predictions,
            'stratum': stratum, 'thresholds': thresholds, 'priReference': pri_reference, 'patient': record,
            'cohort': {**data['cohort'], 'comparisons': comparisons}, 'features': features,
            'modelRevision': data['modelRevision']}
