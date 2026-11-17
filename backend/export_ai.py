"""Export and verify existing trusted Cox bundles; never train or modify sources.

Run in the notebook/analysis environment (pandas, lifelines, neuroHarmonize).
The HTTP runtime subsequently needs only the viewer's existing NumPy dependency.
"""
import csv
import hashlib
import json
import os
import warnings
from pathlib import Path
import numpy as np
from . import ai

NUMERIC = ('Age at CCTA', 'Body mass index (BMI)', 'Coronary artery calcium score', 'Clinical Likelihood', 'KVP')
CLINICAL = ('Sex', 'Smoker', 'Diabetes', 'Dyslipidemia', 'Hypertension', 'Dyspnea',
            'Type of chest pain ', 'Familiarity for CAD', 'CADRADS', 'SS45', 'Clinical Likelihood Class')


def numeric(value):
    try:
        value = float(value)
        return value if np.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def load_pri_reference(path, thresholds, n):
    """Read only original OOF scores; never substitute final-model training risks."""
    with open(path) as file:
        reference = json.load(file)
    if (reference.get('model') != 'PRI-only' or
            reference.get('threshold_source') != thresholds['threshold_source'] or
            reference.get('prediction_horizon_months') != thresholds['prediction_horizon_months']):
        raise ValueError('PRI reference model, source or prediction horizon disagrees with the study thresholds.')
    values = np.asarray(reference.get('risks', []), dtype=float)
    if (values.ndim != 1 or len(values) != n or n == 0 or
            not np.isfinite(values).all() or (values < 0).any() or (values > 1).any()):
        raise ValueError('PRI reference must contain one finite probability per derivation patient.')
    if not np.allclose(np.percentile(values, [25, 75]),
                       [thresholds['q25'], thresholds['q75']], rtol=0, atol=1e-12):
        raise ValueError('PRI reference quartiles disagree with the saved out-of-fold study thresholds.')
    return sorted(values.tolist())


def load_bundle(path):
    import pandas as pd
    # pandas' documented pickle compatibility reader handles the old Index classes.
    # Serialized sklearn estimators are never invoked; only the scaler's numerical
    # means/SDs are exported. Verify exported transforms against independent math.
    with warnings.catch_warnings(record=True) as caught:
        bundle = pd.read_pickle(path)
    for warning in caught:
        if 'unpickle estimator' not in str(warning.message):
            warnings.warn(warning.message)
    return bundle


def extract(bundle, adjusted):
    model, artifacts = bundle['cph_model'], bundle['artifacts']
    features = artifacts['features']
    clinical = artifacts['clinical_features']
    expected_clinical = ['Clinical Likelihood', 'SS45'] if adjusted else []
    if len(features) != 8 or clinical != expected_clinical:
        raise ValueError('Expected the eight-feature PRI signature and Clinical Likelihood/SS45 adjusted model.')
    if artifacts['cols_with_unk'] or artifacts['numeric_with_nans']:
        raise ValueError('This export supports complete model inputs; review model-specific imputation before exporting.')
    columns = model.params_.index.tolist()
    if set(columns) != set(features + (['Clinical Likelihood', 'SS45_Yes'] if adjusted else [])):
        raise ValueError('Unexpected fitted Cox predictors; outcome/time must not be predictors.')
    scale_columns, scaler = artifacts['scale_cols'], artifacts['scaler']
    if not set(features).issubset(scale_columns) or len(scale_columns) != len(scaler.mean_):
        raise ValueError('Expected saved SD scaling of all radiomic predictors.')
    scale = {name: {'mean': float(mean), 'sd': float(sd)} for name, mean, sd in
             zip(scale_columns, scaler.mean_, scaler.scale_)}
    if any(not np.isfinite([s['mean'], s['sd']]).all() or s['sd'] <= 0 for s in scale.values()):
        raise ValueError('Invalid saved scaling parameters.')
    combat = None
    harmonizer = artifacts['harmonizer_model']
    if artifacts['harmonize_by_site']:
        if harmonizer is None:
            raise ValueError('Harmonization is enabled without a saved harmonizer.')
        sites = harmonizer['SITE_labels']
        if (harmonizer['smooth_model']['perform_smoothing'] or
                np.asarray(harmonizer['B_hat']).shape != (len(sites), len(features)) or
                harmonizer['info_dict'].get('ref_level') is not None):
            raise ValueError('Only the notebook site-only, non-reference ComBat transform is supported.')
        mean = np.asarray(harmonizer['stand_mean'])[:, 0]
        variance = np.asarray(harmonizer['var_pooled']).reshape(-1)
        if (variance <= 0).any():
            raise ValueError('Invalid ComBat pooled variance.')
        combat = {}
        for index, site in enumerate(sites):
            delta = np.asarray(harmonizer['delta_star'])[index]
            gamma = np.asarray(harmonizer['gamma_star'])[index]
            slope = 1 / np.sqrt(delta)
            intercept = mean * (1 - slope) - gamma * np.sqrt(variance) * slope
            if not np.isfinite([slope, intercept]).all() or (slope <= 0).any():
                raise ValueError('Invalid ComBat site transform.')
            combat[str(float(site))] = {'slope': slope.tolist(), 'intercept': intercept.tolist()}
    time = float(bundle['t_eval'])
    baseline = model.baseline_cumulative_hazard_
    if baseline.shape[1] != 1 or time < baseline.index.min() or time > baseline.index.max():
        raise ValueError('Prediction horizon is outside the saved baseline hazard.')
    hr = {}
    for name in features:
        interval = np.exp(model.confidence_intervals_.loc[name].to_numpy(dtype=float))
        beta = float(model.params_[name])
        hr[name] = {'coefficient': beta, 'hr': float(np.exp(beta)), 'ci': interval.tolist()}
    return {'features': features, 'clinicalFeatures': clinical, 'columns': columns,
            'coefficients': model.params_.to_numpy(dtype=float).tolist(),
            'center': model._norm_mean.loc[columns].to_numpy(dtype=float).tolist(),
            'scale': scale, 'combat': combat, 'hr': hr,
            'baselineHazard': float(np.interp(time, baseline.index, baseline.iloc[:, 0])),
            'horizonMonths': time, 'fittedAt': model._time_fit_was_called}


def validate(portable, bundle, records):
    """Cross-check every record against neuroHarmonize + the saved lifelines Cox.

    Clinical encoding is fixed from model schema, never inferred from a single
    row's dtype/nunique. TIME/EVENT never enter either prediction calculation.
    """
    import pandas as pd
    from neuroHarmonize import harmonizationApply
    features = portable['features']
    frame = pd.DataFrame(records)
    values = frame[features].to_numpy(dtype=float)
    artifacts = bundle['artifacts']
    if portable['combat']:
        sites = frame['KVP'].astype(float).astype(str).to_frame('SITE')
        missing = [s for s in artifacts['harmonizer_model']['SITE_labels'] if s not in set(sites['SITE'])]
        augmented = np.vstack([values, np.repeat(values[:1], len(missing), axis=0)])
        covars = pd.concat([sites, pd.DataFrame({'SITE': missing})], ignore_index=True)
        values = harmonizationApply(augmented, covars, artifacts['harmonizer_model'])[:len(frame)]
    design = pd.DataFrame(values, columns=features)
    if portable['clinicalFeatures']:
        design['Clinical Likelihood'] = frame['Clinical Likelihood'].astype(float).to_numpy()
        design['SS45_Yes'] = (frame['SS45'] == 'Yes').astype(float).to_numpy()
    for name, scale in portable['scale'].items():
        design[name] = (design[name] - scale['mean']) / scale['sd']
    design = design[portable['columns']]
    expected = 1 - bundle['cph_model'].predict_survival_function(design, times=[portable['horizonMonths']]).iloc[0].to_numpy()
    actual = np.array([ai.infer(portable, r)['risk'] for r in records])
    np.testing.assert_allclose(actual, expected, atol=2e-12, rtol=2e-12)
    # Also check each site's transform on one row with the notebook's dummy-site
    # augmentation. A single patient's result must match the batch result.
    for site in sorted(set(frame['KVP'])):
        index = next(i for i, record in enumerate(records) if record['KVP'] == site)
        if len(records) > 1:
            validate_single(portable, bundle, records[index], expected[index])
    return float(np.max(np.abs(actual - expected)))


def validate_single(portable, bundle, record, expected):
    # Pass three identical values with each training site so neuroHarmonize's
    # design matrix has all known columns even for one original patient.
    from neuroHarmonize import harmonizationApply
    import pandas as pd
    features = portable['features']
    raw = np.array([[record[name] for name in features]], dtype=float)
    if portable['combat']:
        sites = list(portable['combat'])
        harmonized = harmonizationApply(np.repeat(raw, len(sites), axis=0),
                                       pd.DataFrame({'SITE': sites}), bundle['artifacts']['harmonizer_model'])
        index = sites.index(str(float(record['KVP'])))
        transform = portable['combat'][str(float(record['KVP']))]
        np.testing.assert_allclose(raw[0] * transform['slope'] + transform['intercept'],
                                   harmonized[index], atol=1e-10, rtol=1e-12)
    np.testing.assert_allclose(ai.infer(portable, record)['risk'], expected, atol=2e-12, rtol=2e-12)


def export():
    conf = ai.read_config()
    sources = {}
    for key in ai.source_keys(conf):
        path = Path(conf[key])
        stat = path.stat()
        sources[key] = {'stat': [stat.st_size, stat.st_mtime_ns],
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    bundles = {name: load_bundle(conf[key]) for name, key in [('pri', 'priModel'), ('adjusted', 'adjustedModel')]}
    models = {name: extract(bundle, name == 'adjusted') for name, bundle in bundles.items()}
    if models['pri']['features'] != models['adjusted']['features']:
        raise ValueError('The two model signatures differ.')
    horizon = models['pri']['horizonMonths']
    thresholds = json.loads(Path(conf['thresholds']).read_text())
    bundled_thresholds = bundles['pri'].get('strata', {})
    if (horizon != models['adjusted']['horizonMonths'] or horizon != thresholds['prediction_horizon_months'] or
            not 0 < thresholds['q25'] < thresholds['q75'] < 1 or
            any(thresholds[k] != bundled_thresholds.get(k) for k in ('q25', 'q75'))):
        raise ValueError('Prediction horizons or saved PRI stratum thresholds disagree.')
    features = models['pri']['features']
    patients, derivation, events = {}, [], []
    for source in ('derivation', 'validation'):
        with open(conf[source], newline='') as file:
            reader = csv.DictReader(file)
            required = ['Patient ID', *NUMERIC, *CLINICAL, *features, 'EVENT']
            if not set(required).issubset(reader.fieldnames):
                raise ValueError('AI dataset schema is missing expected patient/model fields.')
            for raw in reader:
                pid = raw['Patient ID'].strip()
                if pid.endswith('.0'):
                    pid = pid[:-2]
                if not pid or pid in patients:
                    raise ValueError('Duplicate or missing patient ID across AI datasets; resolve before export.')
                record = {name: numeric(raw[name]) for name in [*NUMERIC, *features]}
                record.update({name: raw[name].strip() or None for name in CLINICAL})
                record['sourceCohort'] = source
                patients[pid] = record
                if source == 'derivation':
                    derivation.append(record)
                    event = numeric(raw['EVENT'])
                    if event not in (0, 1):
                        raise ValueError('Derivation event status must be 0/1.')
                    events.append(event)
    validations = {}
    for name, model in models.items():
        complete = []
        for record in patients.values():
            try:
                ai.infer(model, record)
                complete.append(record)
            except ValueError:
                pass
        if not complete:
            raise ValueError('No complete records to validate model export.')
        validations[name] = {'records': len(complete), 'maximumAbsoluteRiskError': validate(model, bundles[name], complete)}
    distributions = {key: sorted(r[key] for r in derivation if r[key] is not None)
                     for key in ('Age at CCTA', 'Coronary artery calcium score', 'Clinical Likelihood')}
    if 'priOofReference' in conf:
        distributions['PRI-only'] = load_pri_reference(conf['priOofReference'], thresholds, len(derivation))
    sex_known = [r for r in derivation if r['Sex'] in ('Man', 'Woman')]
    out = {'version': ai.VERSION, 'configurationDigest': ai.config_digest(conf), 'sources': sources,
           'modelRevision': hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()[:16],
           'horizonMonths': horizon, 'models': models, 'patients': patients,
           'thresholds': {'q25': thresholds['q25'], 'q75': thresholds['q75'],
                          'source': thresholds['threshold_source'],
                          'exactPercentileAvailable': 'PRI-only' in distributions},
           'cohort': {'n': len(derivation), 'events': int(sum(events)), 'sexKnown': len(sex_known),
                      'womenPercent': 100 * sum(r['Sex'] == 'Woman' for r in sex_known) / len(sex_known),
                      'medianAge': float(np.median(distributions['Age at CCTA']))},
           'distributions': distributions, 'validation': validations}
    # Detect source changes during export before publishing anything.
    for key, old in sources.items():
        stat = Path(conf[key]).stat()
        if old['stat'] != [stat.st_size, stat.st_mtime_ns]:
            raise RuntimeError('AI inputs changed during export. Run export again.')
    directory = ai.ROOT/'cache/ai'
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory/'reference.tmp'
    temporary.write_text(json.dumps(out, allow_nan=False))
    os.replace(temporary, directory/'reference.json')
    print(json.dumps({'patients': len(patients), 'cohort': out['cohort'], 'validation': validations}, indent=2))


if __name__ == '__main__':
    export()
