"""Patient-level Cox inference from a validated numerical export. No pickle at runtime."""
import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path
import numpy as np
from .data import ROOT

VERSION = 1
SOURCE_KEYS = ('derivation', 'validation', 'priModel', 'adjustedModel', 'thresholds')


def config_path():
    return Path(os.environ.get('CORONARY_AI_CONFIG', ROOT/'config/ai.local.json'))


def read_config():
    conf = json.loads(config_path().read_text())
    if any(not isinstance(conf.get(key), str) for key in SOURCE_KEYS):
        raise ValueError('Set derivation, validation, priModel, adjustedModel and thresholds in config/ai.local.json.')
    return conf


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
    for key in SOURCE_KEYS:
        source = Path(conf[key])
        if source.is_file():
            state = source.stat()
            if [state.st_size, state.st_mtime_ns] != data['sources'][key]['stat']:
                raise ValueError('AI source files changed. Run python -m backend.export_ai again.')
    return data


def results(patient_id):
    data = reference()
    record = data['patients'].get(patient_id)
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
    comparisons = []
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
                         'models': {key: model['hr'][name] for key, model in models.items()}})
    return {'patientId': patient_id, 'sourceCohort': record['sourceCohort'],
            'horizonMonths': data['horizonMonths'], 'predictions': predictions,
            'stratum': stratum, 'thresholds': thresholds, 'patient': record,
            'cohort': {**data['cohort'], 'comparisons': comparisons}, 'features': features,
            'modelRevision': data['modelRevision']}
