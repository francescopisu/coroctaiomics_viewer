"""Single-patient RF-CL lookup, preserving the study's symptom coding by default.

The 90 lookup values are a numerical copy of the study's clinical_data.pkl
(SHA256 080fe7094dd882968ba6b5635c26b5520545d0449358104a067fbea0ef8998ac).
Axes: age band, risk-factor band, sex (Woman/Man), symptom band (0-1/2/3).
No pickle, dataframe, patient record or mounted source drive is needed at runtime.

The pasted study code scores atypical=1, typical=2, rest pain=3 and adds 2
for dyspnea, capped at 3. That differs from ESC Figure 4's symptom definition:
https://doi.org/10.1093/eurheartj/ehae177 . We retain it for reproducibility;
symptom_score= accepts an independently assessed 0-3 score instead. Unknown
symptoms are never silently treated as absent, and unknown risk factors as No.
"""
from collections.abc import Mapping
import math
import re
import numpy as np

RISK_FACTORS = ('Hypertension', 'Dyslipidemia', 'Smoker', 'Diabetes', 'Familiarity for CAD')
AGE_RANGES = ('30-39', '40-49', '50-59', '60-69', '70-80')
RISK_RANGES = ('0-1', '2-3', '4-5')
SYMPTOM_RANGES = ('0-1', '2', '3')
CLINICAL_DATA = np.array([
    [[[0, 0, 2], [1, 2, 9]], [[1, 1, 5], [2, 4, 14]], [[2, 3, 10], [5, 8, 22]]],
    [[[1, 1, 4], [2, 3, 14]], [[1, 2, 7], [4, 6, 20]], [[3, 5, 12], [8, 12, 27]]],
    [[[1, 2, 6], [4, 6, 21]], [[2, 3, 10], [7, 11, 27]], [[5, 7, 15], [12, 17, 33]]],
    [[[2, 3, 10], [8, 12, 32]], [[4, 6, 14], [12, 17, 35]], [[7, 11, 19], [17, 25, 39]]],
    [[[4, 6, 16], [15, 22, 44]], [[7, 10, 19], [19, 27, 44]], [[11, 16, 23], [24, 34, 45]]],
], dtype=float)
CLINICAL_DATA.setflags(write=False)


def _yes_no(value, name):
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip().casefold()
        if text in ('', 'unknown', 'not recorded', 'not specified'):
            return None
        if text in ('yes', 'no'):
            return text == 'yes'
    elif isinstance(value, (bool, int, float, np.number)):
        if math.isnan(float(value)):
            return None
        if value in (0, 1):
            return bool(value)
    raise ValueError(f'{name} must be Yes, No, or null/Unknown.')


def _alias(record, canonical, alias):
    if alias not in record:
        return
    value = record.pop(alias)
    if canonical in record and record[canonical] != value:
        raise ValueError(f'Conflicting {canonical} and {alias} values.')
    record[canonical] = value


def ss45_from_cadrads(value):
    """Study coding: CAD-RADS 4/5 -> Yes; 0-3 -> No; absent -> unknown."""
    if value is None or value == '':
        return None
    if isinstance(value, bool):
        raise ValueError('CADRADS must be a recorded CAD-RADS category.')
    match = re.fullmatch(r'(?:(?:score|cad[- ]?rads)\s*)?([0-5]|4[ab])', str(value).strip().casefold())
    if not match:
        raise ValueError('CADRADS must be 0-5, including 4A/4B; unspecified/nondiagnostic values cannot determine SS45.')
    return 'Yes' if int(match[1][0]) >= 4 else 'No'


def _symptom_score(record, chest_pain_absent):
    dyspnea = _yes_no(record.get('Dyspnea'), 'Dyspnea')
    if dyspnea is None:
        raise ValueError('Dyspnea is unknown; provide Yes/No or an explicit symptom_score.')
    record['Dyspnea'] = 'Yes' if dyspnea else 'No'
    chest = record.get('Type of chest pain ')
    text = str(chest).strip().casefold() if chest is not None else ''
    absence = chest_pain_absent or _yes_no(record.get('Chest Pain'), 'Chest Pain') is False
    if text in ('no chest pain', 'no', 'absent'):
        absence = True
    scores = {'atypical chest pain': 1, 'typycal chest pain': 2,
              'typical chest pain': 2, 'chest pain at rest': 3}
    if absence:
        if text in scores:
            raise ValueError('Chest-pain type conflicts with confirmed absence of chest pain.')
        record['Type of chest pain '] = 'No chest pain'
        points = 0
    elif text in scores:
        points = scores[text]
    else:
        raise ValueError('Chest-pain type is unknown. Confirm absence with chest_pain_absent=True or supply a recorded type/symptom_score.')
    return min(points + 2 * dyspnea, 3)


def calculate_pretest(components, clinical_data=None, *, chest_pain_absent=False, symptom_score=None):
    """Return a new, JSON-compatible patient dict with recomputed RF-CL fields.

    The five risk factors are hypertension, dyslipidemia, smoking (current or
    former), diabetes and premature CAD family history. A supplied/stale Number
    of risk factors is ignored. If factors are unknown, the exact count is null
    and a count range is returned. Likelihood is returned only when every
    possible count selects the same numerical lookup value; otherwise raise.

    Ages outside the published 30-80-year table are rejected rather than put
    into an edge band. Default symptom coding matches the pasted cohort code.
    For a clinician-assessed score, pass symptom_score=0/1/2/3 explicitly.
    Neither the input dict nor the lookup is modified. No patient JSON is saved.
    """
    if not isinstance(components, Mapping):
        raise TypeError('components must be a mapping of patient fields.')
    if not isinstance(chest_pain_absent, bool):
        raise ValueError('chest_pain_absent must be True or False.')
    record = dict(components)
    _alias(record, 'Dyslipidemia', 'Dyslipdemia')
    _alias(record, 'Type of chest pain ', 'Type of chest pain')
    try:
        age = float(record['Age at CCTA'])
        if isinstance(record['Age at CCTA'], bool) or not math.isfinite(age) or not 30 <= age <= 80:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise ValueError('Age at CCTA must be between 30 and 80 years for this lookup.')
    sex = {'woman': 0, 'female': 0, 'man': 1, 'male': 1}.get(str(record.get('Sex', '')).strip().casefold())
    if sex is None:
        raise ValueError('Sex must be Woman or Man for this lookup.')
    record['Sex'] = ('Woman', 'Man')[sex]
    record['Age at CCTA'] = int(age) if age.is_integer() else age
    age_index = min(int((age - 30) // 10), 4)
    factors = {name: _yes_no(record.get(name), name) for name in RISK_FACTORS}
    record.update({name: None if value is None else 'Yes' if value else 'No' for name, value in factors.items()})
    known_count = sum(value is True for value in factors.values())
    unknown = [name for name, value in factors.items() if value is None]
    count_range = [known_count, known_count + len(unknown)]
    risk_indices = sorted({min(count // 2, 2) for count in range(count_range[0], count_range[1] + 1)})
    if symptom_score is None:
        points = _symptom_score(record, chest_pain_absent)
    else:
        if isinstance(symptom_score, bool) or not isinstance(symptom_score, (int, float, np.number)) or symptom_score not in (0, 1, 2, 3):
            raise ValueError('symptom_score must be an integer from 0 to 3.')
        points = int(symptom_score)
    symptom_index = max(0, points - 1)
    table = CLINICAL_DATA if clinical_data is None else np.asarray(clinical_data, dtype=float)
    if table.shape != (5, 3, 2, 3) or not np.isfinite(table).all() or ((table < 0) | (table > 50)).any():
        raise ValueError('clinical_data must contain finite 0-50 percentages with shape (5, 3, 2, 3): age, risk factors, sex, symptoms.')
    possibilities = sorted({float(table[age_index, risk_index, sex, symptom_index]) for risk_index in risk_indices})
    if len(possibilities) != 1:
        raise ValueError(f'Unknown risk factors ({", ".join(unknown)}) permit multiple RF-CL values {possibilities}; supply the missing factors.')
    likelihood = possibilities[0]
    record.update({
        'Number of risk factors': known_count if not unknown else None,
        'Known positive risk factors': known_count,
        'Risk factor count range': count_range,
        'Unknown risk factors': unknown,
        'Age Range': AGE_RANGES[age_index],
        'CVRF': RISK_RANGES[risk_indices[0]] if len(risk_indices) == 1 else None,
        'Symptom Score': points,
        'Symptom Score Range': SYMPTOM_RANGES[symptom_index],
        'RF-CL symptom coding': 'provided' if symptom_score is not None else 'cohort',
        'Clinical Likelihood': int(likelihood) if likelihood.is_integer() else likelihood,
        'Clinical Likelihood Class': 'Very low' if likelihood <= 5 else 'Low' if likelihood <= 15 else 'Moderate',
    })
    if 'CADRADS' in record:
        record['SS45'] = ss45_from_cadrads(record['CADRADS'])
    return record
