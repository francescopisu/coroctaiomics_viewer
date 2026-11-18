"""One user-editable registry; legacy case dictionaries are an internal adapter."""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VESSELS = ('LAD', 'LCx', 'RCA')


def registry_path():
    return Path(os.environ.get('CORONARY_VIEWER_CONFIG', ROOT/'config/viewer.local.json')).expanduser().resolve()


def resolve(value, base):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Paths must be nonempty strings.')
    path = Path(value).expanduser()
    return str((path if path.is_absolute() else base/path).resolve())


def patient_id(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('Patient id must be a string or integer.')
    value = str(value).strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError('Patient id must contain only letters, numbers, underscores or hyphens.')
    return value


def read_registry():
    from .data import read_json
    path = registry_path()
    conf = read_json(path)
    if not isinstance(conf, dict) or not isinstance(conf.get('patients'), list):
        raise ValueError('Set a patients array in config/viewer.local.json.')
    if any(not isinstance(entry,dict) for entry in conf['patients']):
        raise ValueError('Each patients entry must be an object with id, ct and output.')
    ids = [patient_id(entry['id']) for entry in conf['patients']]
    if len(ids) != len({pid.casefold() for pid in ids}):
        raise ValueError('Duplicate patient IDs in viewer.local.json.')
    if not isinstance(conf.get('clinicalSources', {}), dict):
        raise ValueError('clinicalSources must map derivation/validation to eCRF CSV paths.')
    if set(conf.get('clinicalSources', {})) - {'derivation', 'validation'}:
        raise ValueError('clinicalSources keys must be derivation and validation.')
    return conf


def patient_labels():
    """Presentation aliases only; never change case IDs or imaging signatures."""
    conf=read_registry();mapping=conf.get('patientLabels', {})
    if not isinstance(mapping,dict) or any(not isinstance(value,str) or not value.strip() for value in mapping.values()):
        raise ValueError('patientLabels must map patient IDs to nonempty display names.')
    labels={patient_id(entry['id']):mapping.get(patient_id(entry['id']),patient_id(entry['id'])).strip() for entry in conf['patients']}
    if len({label.casefold() for label in labels.values()})!=len(labels):
        raise ValueError('Patient display names must be unique.')
    return labels


def cached_source(pid, core):
    """Allow prepared imaging to remain usable with the source drive unplugged."""
    from .data import read_json
    path = ROOT/'cache'/pid/'manifest.json'
    try:
        saved = read_json(path).get('sourceConfig', {})
    except (OSError, ValueError):
        return {}
    return saved if all(saved.get(key) == value for key, value in core.items()) else {}


def centerlines(pid, output, explicit=None, cached=None):
    explicit = explicit or {}
    if not isinstance(explicit, dict) or set(explicit) - set(VESSELS):
        raise ValueError('centerlines keys must be LAD, LCx and RCA.')
    directory = Path(output)/'labeling'
    result = {}
    for vessel in VESSELS:
        if vessel in explicit:
            name = explicit[vessel]
        elif not directory.is_dir() and cached and vessel in cached:
            name = cached[vessel]
        else:
            matches = sorted(directory.glob(f'{pid}_{vessel}_*.csv'))
            if len(matches) != 1:
                names = ', '.join(p.name for p in matches) or 'none'
                raise ValueError(f'{pid}/{vessel}: expected one centerline in {directory}, found {names}. '
                                 'If several branches exist, set centerlines for this patient.')
            name = matches[0].name
        if not isinstance(name, str) or Path(name).name != name or not name.startswith(f'{pid}_'):
            raise ValueError(f'{pid}/{vessel}: invalid centerline filename.')
        result[vessel] = name
    return result


def cases():
    settings = read_registry();base = registry_path().parent
    pipeline = resolve(settings['pipelineRoot'], base)
    sources = {key: resolve(value, base) for key, value in settings.get('clinicalSources', {}).items()}
    result = {}
    for entry in settings['patients']:
        pid = patient_id(entry['id'])
        allowed = {'id', 'ct', 'output', 'clinical', 'centerlines', 'maps', 'radiomicsCsv', 'ascendingAorta'}
        if set(entry) - allowed:
            raise ValueError(f'{pid}: unknown patient fields: {", ".join(sorted(set(entry)-allowed))}.')
        core = {'patientId': pid, 'pipelineRoot': pipeline, 'ct': resolve(entry['ct'], base),
                'outputRoot': resolve(entry['output'], base)}
        saved = cached_source(pid, core)
        conf = dict(core)
        try:conf['centerlineFiles'] = centerlines(pid, core['outputRoot'], entry.get('centerlines'), saved.get('centerlineFiles'))
        except ValueError as error:conf.update(centerlineFiles={},configurationError=str(error))
        standard_maps = Path(core['outputRoot'])/'radiomics_r4_iso/maps'
        if entry.get('maps'):
            conf['radiomicFeatureMaps'] = resolve(entry['maps'], base)
        elif standard_maps.is_dir():
            conf['radiomicFeatureMaps'] = str(standard_maps)
        elif saved.get('radiomicFeatureMaps') == str(standard_maps):
            conf['radiomicFeatureMaps'] = saved['radiomicFeatureMaps']
        if entry.get('ascendingAorta'):
            conf['ascendingAorta'] = resolve(entry['ascendingAorta'], base)
        conf['patientData'] = {'sources': sources,
            'radiomicsCsv': resolve(entry['radiomicsCsv'], base) if entry.get('radiomicsCsv') else str(Path(core['outputRoot'])/'radiomics_r4_iso'/f'{pid}_radiomics.csv')}
        if entry.get('clinical'):
            conf['patientData']['clinicalJson'] = resolve(entry['clinical'], base)
        result[pid] = conf
    return result
