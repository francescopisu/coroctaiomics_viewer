"""Configurable educational workflow. Passwords are demonstration gates, not authentication."""
import hmac
import os
from pathlib import Path
from fastapi import HTTPException
from .data import ROOT, read_json, catalog_configurations


def enabled():
    return os.environ.get('CORONARY_MODE', 'normal') == 'teaching'


def settings():
    if not enabled():raise HTTPException(404, 'Modalità didattica non attiva.')
    config = read_json(Path(os.environ.get('CORONARY_TEACHING_CONFIG', ROOT/'config/teaching.local.json')))
    if len(config.get('choices', [])) != 3:raise ValueError('Configure exactly three teaching management choices.')
    choices = [str(item['id']) for item in config['choices']]
    if len(set(choices)) != 3:raise ValueError('Teaching choice IDs must be unique.')
    codes = [item['code'] for item in config['cases']]
    if len(set(codes)) != len(codes):raise ValueError('Teaching case codes must be unique.')
    for item in config['cases']:
        if item.get('correctChoice') is not None and str(item['correctChoice']) not in choices:
            raise ValueError(f'{item["code"]}: correctChoice must match one of the three choice IDs.')
    return config


def case(code):
    config = settings()
    for item in config['cases']:
        if item['code'] == code:return config, item
    raise HTTPException(404, 'Caso didattico non trovato.')


def listing():
    if not enabled():return {'enabled':False}
    from .server import manifest
    config = settings()
    available = catalog_configurations()
    out = []
    for item in config['cases']:
        ready = str(item['patientId']) in available
        if ready:
            try:manifest(str(item['patientId']))
            except HTTPException:ready = False
        out.append({'code':item['code'], 'available':ready})
    return {'enabled':True, 'cases':out}


def record(patient_id):
    from . import ai
    from .portable import enabled as portable_enabled, patient_ai
    if portable_enabled():return patient_ai(patient_id)['patient']
    data = ai.reference()
    value = ai.patient_record(patient_id, data)
    if value is None:raise HTTPException(404, 'Anamnesi del caso non disponibile.')
    return value


def status(value):
    return str(value).strip().casefold() if value is not None else ''


def joined(values):
    return ', '.join(values[:-1])+' e '+values[-1] if len(values)>1 else values[0]


def risk_factors(patient):
    female = patient.get('Sex') == 'Woman'
    smoking = status(patient.get('Smoker'))
    parts = [('Fumatrice.' if female else 'Fumatore.') if smoking == 'yes' else
             ('Non fumatrice.' if female else 'Non fumatore.') if smoking == 'no' else 'Abitudine al fumo non documentata.']
    positive, negative, missing = [], [], []
    for key, label in [('Hypertension','ipertensione arteriosa'),('Diabetes','diabete mellito'),('Dyslipidemia','dislipidemia')]:
        value = status(patient.get(key))
        (positive if value=='yes' else negative if value=='no' else missing).append(label)
    if positive:parts.append(joined(positive).capitalize()+'.')
    if negative:parts.append('Assenza di '+joined(negative)+'.')
    if missing:parts.append('Dati non disponibili per '+joined(missing)+'.')
    family = status(patient.get('Familiarity for CAD'))
    parts.append('Familiarità per coronaropatia presente.' if family=='yes' else
                 'Familiarità per coronaropatia assente.' if family=='no' else 'Familiarità per coronaropatia non documentata.')
    return ' '.join(parts)


def clinical_profile(patient):
    parts = []
    bmi = patient.get('Body mass index (BMI)')
    if isinstance(bmi, (int,float)):
        parts.append(f'Indice di massa corporea: {bmi:g} kg/m².')
    else:parts.append('Indice di massa corporea non documentato.')
    likelihood = patient.get('Clinical Likelihood')
    label = {'very low':'molto bassa','low':'bassa','moderate':'moderata'}.get(status(patient.get('Clinical Likelihood Class')))
    if likelihood is not None:
        parts.append(f'Probabilità clinica di coronaropatia {label or ""} (ESC RF-CL: {likelihood:g}%).'.replace('  ',' '))
    dyspnea = status(patient.get('Dyspnea'))
    parts.append('Dispnea riferita.' if dyspnea=='yes' else 'Assenza di dispnea.' if dyspnea=='no' else 'Dispnea non documentata.')
    pain = patient.get('Type of chest pain ')
    pains = {'No chest pain':'Assenza di dolore toracico.','Typycal Chest Pain':'Dolore toracico tipico.',
             'Typical Chest Pain':'Dolore toracico tipico.','Atypical Chest Pain':'Dolore toracico atipico.',
             'Chest Pain At Rest':'Dolore toracico a riposo.','Not Specified':'Dolore toracico non specificato.'}
    parts.append(pains.get(pain,'Dolore toracico non documentato.' if not pain else str(pain)))
    return ' '.join(parts)


def profile(code):
    config, item = case(code)
    patient = record(str(item['patientId']))
    return {'code':code, 'displayName':item.get('displayName') or '[Nome fittizio da configurare]',
            'age':patient.get('Age at CCTA'), 'sex':{'Man':'M','Woman':'F'}.get(patient.get('Sex'),'Non documentato'),
            'indication':item.get('indication') or '[Motivo dell’esame da configurare]',
            'riskFactors':item.get('riskFactors') or risk_factors(patient),
            'clinicalProfile':item.get('clinicalProfile') or clinical_profile(patient),
            'choices':[{'id':str(choice['id']),'label':choice['label']} for choice in config['choices']]}


def unlock(code, password, stage):
    config, item = case(code)
    expected = str(config['passwords']['takeCharge' if stage=='takeCharge' else 'ai'])
    if not hmac.compare_digest(str(password).encode('utf-8'),expected.encode('utf-8')):raise HTTPException(403, 'Password non corretta. Riprova.')
    if stage=='takeCharge':
        from .server import manifest
        manifest(str(item['patientId']))
        return {'patientId':str(item['patientId'])}
    return {'unlocked':True}


def prognosis(code, choice):
    config, item = case(code)
    if str(choice) not in [str(value['id']) for value in config['choices']]:raise HTTPException(400, 'Seleziona una gestione del paziente.')
    answer = item.get('correctChoice')
    correct = str(choice)==str(answer) if answer is not None else None
    return {'correct':correct,
            'feedback':config.get('correctFeedback','Scelta corretta, a discrezione del medico!') if correct is True else
                       config.get('incorrectFeedback','Scelta errata!') if correct is False else 'Risposta didattica da configurare.',
            'followUpText':item.get('followUpText') or '[Follow-up a quattro anni da configurare.]'}
