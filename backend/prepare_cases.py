"""Register, prepare and export cases from one editable path configuration."""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path
from . import ai
from .data import ROOT, configuration, read_json
from .external_ai import NUMERIC, CLINICAL, numeric, load_patient_record
from .portable import safe_id, write_json

MISSING = {'', 'nan', 'none', 'null', 'unknown', 'not recorded'}


def resolve(value, base=ROOT):
    path = Path(value).expanduser()
    return (path if path.is_absolute() else base/path).resolve()


def normalize_id(value):
    text = str(value).strip()
    if re.fullmatch(r'\d+\.0+', text):text = text.split('.')[0]
    return safe_id(text)


def clinical_rows(path, ids, features):
    """Read only requested patients; never export outcomes or unrelated columns."""
    before = path.stat()
    previous_limit = csv.field_size_limit()
    csv.field_size_limit(32 * 1024**2)  # Full dataframes can contain large unrelated CSV fields.
    rows = {}
    try:
        with path.open(newline='', encoding='utf-8-sig') as handle:
            reader = csv.DictReader(handle)
            fields = reader.fieldnames or []
            if len(fields) != len(set(fields)) or not {'Patient ID', *features, 'KVP'}.issubset(fields):
                raise ValueError('Clinical CSV needs unique columns, Patient ID, KVP and the eight scalar radiomic features.')
            for raw in reader:
                value = raw.get('Patient ID', '').strip()
                if not value:continue
                pid = normalize_id(value)
                if pid not in ids:continue
                if pid in rows:raise ValueError(f'Duplicate clinical records for patient {pid}.')
                record = {'patientId': pid}
                for key in (*NUMERIC, *features):
                    value = raw.get(key)
                    record[key] = numeric(None if value is None or value.strip().lower() in MISSING else value, key)
                for key in CLINICAL:
                    value = raw.get(key)
                    record[key] = None if value is None or value.strip().lower() in MISSING else value.strip()
                rows[pid] = record
    finally:
        csv.field_size_limit(previous_limit)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError('Clinical CSV changed while reading it. Run preparation again.')
    missing = ids - rows.keys()
    if missing:raise ValueError(f'Clinical CSV has no record for: {", ".join(sorted(missing))}.')
    return rows


def discover_ct(pid, roots, explicit=None):
    if explicit:
        path = resolve(explicit)
        if not path.is_file():raise FileNotFoundError(f'CCTA not found: {path}')
        return path
    matches = set()
    for root in roots:
        root = resolve(root)
        if not root.is_dir():raise FileNotFoundError(f'CCTA root not mounted/found: {root}')
        for suffix in ('.nii.gz', '.nii'):
            direct = root/(pid+suffix)
            if direct.is_file():matches.add(direct.resolve())
            matches.update(path.resolve() for path in root.glob(f'*/{pid}{suffix}') if path.is_file())
    if len(matches) != 1:
        raise ValueError(f'{pid}: found {len(matches)} CCTAs. Set an explicit ct path for this case.')
    return next(iter(matches))


def discover_centerlines(pid, output, explicit=None):
    explicit = explicit or {}
    if set(explicit) - {'LAD', 'LCx', 'RCA'}:
        raise ValueError('centerlineFiles keys must be LAD, LCx and RCA.')
    selected = {}
    for vessel in ('LAD', 'LCx', 'RCA'):
        matches = sorted((output/'labeling').glob(f'{pid}_{vessel}_*.csv'))
        if vessel in explicit:
            selected[vessel] = explicit[vessel]
        elif len(matches) == 1:
            selected[vessel] = matches[0].name
        else:
            raise ValueError(f'{pid}/{vessel}: found {len(matches)} labelled centerlines. '
                             'Set centerlineFiles for this case; an anatomical branch will not be guessed.')
    return selected


def unchanged_json(path, value):
    if path.is_file() and read_json(path) == value:return
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, value)


def plan(config_path, selected=None):
    config = read_json(config_path)
    if os.environ.get('CORONARY_PORTABLE_HOME'):
        raise ValueError('Run prepare.sh on the Mac/preparation workstation, outside portable mode.')
    if os.environ.get('CORONARY_CASE_CONFIG') or os.environ.get('CORONARY_CATALOG_CONFIG'):
        raise ValueError('Unset CORONARY_CASE_CONFIG/CORONARY_CATALOG_CONFIG before batch registration.')
    entries = config.get('cases', [])
    if not entries:raise ValueError('Add at least one patient to the cases array.')
    ids = [normalize_id(entry['patientId']) for entry in entries]
    if len({pid.casefold() for pid in ids}) != len(ids):raise ValueError('Duplicate patient IDs in batch configuration.')
    if selected:
        unknown = set(selected) - set(ids)
        if unknown:raise ValueError(f'Patients not in batch configuration: {", ".join(sorted(unknown))}.')
        entries = [entry for entry, pid in zip(entries, ids) if pid in selected]
        ids = [normalize_id(entry['patientId']) for entry in entries]
    reference = ai.reference()
    features = reference['models']['pri']['features']
    sources = {}
    for entry in entries:
        source = resolve(entry.get('clinicalCsv', config['clinicalCsv']))
        sources.setdefault(source, set()).add(normalize_id(entry['patientId']))
    records = {}
    for source, requested in sources.items():records.update(clinical_rows(source, requested, features))
    plans = []
    for entry, pid in zip(entries, ids):
        output = resolve(entry['outputRoot']) if entry.get('outputRoot') else resolve(config['outputRoot'])/pid
        ct = discover_ct(pid, entry.get('ctRoots', config.get('ctRoots', [])), entry.get('ct'))
        case = {'patientId': pid, 'pipelineRoot': str(resolve(entry.get('pipelineRoot', config['pipelineRoot']))),
                'ct': str(ct), 'outputRoot': str(output),
                'centerlineFiles': discover_centerlines(pid, output, entry.get('centerlineFiles')),
                'radiomicFeatureMaps': str(resolve(entry['radiomicFeatureMaps']) if entry.get('radiomicFeatureMaps')
                                           else output/'radiomics_r4_iso/maps'),
                'aiRecord': f'config/patients/{pid}.json'}
        if entry.get('ascendingAorta'):case['ascendingAorta'] = str(resolve(entry['ascendingAorta']))
        configuration(case)  # Check all source paths before registering any patient.
        plans.append({'case': case, 'record': records[pid], 'casePath': ROOT/'config/cases'/f'{pid}.json',
                      'recordPath': ROOT/'config/patients'/f'{pid}.json'})
    # Validate model inputs in temporary records without writing clinical files.
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        for item in plans:
            pid = item['case']['patientId']
            path = Path(directory)/f'{pid}.json'
            path.write_text(json.dumps(item['record'], allow_nan=False), encoding='utf-8')
            record = load_patient_record({**item['case'], 'aiRecord': str(path)}, features, reference['patients'].get(pid))
            for model in reference['models'].values():ai.infer(model, record)
    return config, plans


def register(plans):
    catalog_path = ROOT/'config/catalog.local.json'
    catalog = dict(read_json(catalog_path))
    cases = list(catalog['cases'])
    registered = {}
    for value in cases:
        path = resolve(value, catalog_path.parent)
        pid = normalize_id(read_json(path)['patientId'])
        if pid.casefold() in registered:raise ValueError('Existing catalogue has duplicate patient IDs.')
        registered[pid.casefold()] = path
    for item in plans:
        pid = item['case']['patientId']
        existing = registered.get(pid.casefold())
        if existing and existing != item['casePath']:
            raise ValueError(f'{pid} is already registered in another configuration: {existing.name}')
    for item in plans:
        unchanged_json(item['recordPath'], item['record'])
        unchanged_json(item['casePath'], item['case'])
        if item['case']['patientId'].casefold() not in registered:
            cases.append(f'cases/{item["case"]["patientId"]}.json')
    unchanged_json(catalog_path, {**catalog, 'cases': cases})


def current_package(path, manifest, report):
    if not path.is_file():return False
    try:
        with zipfile.ZipFile(path) as archive:
            return (json.loads(archive.read('manifest.json')) == manifest and
                    json.loads(archive.read('ai.json')) == report)
    except (zipfile.BadZipFile, ValueError, KeyError):return False


def run(config_path, selected=None, check_only=False, skip_export=False, force=False):
    config, plans = plan(config_path, selected)
    print(f'Checked {len(plans)} cases: CT, masks, centerlines, maps, clinical rows and frozen model inputs.', flush=True)
    if check_only:
        for item in plans:
            print(f'{item["case"]["patientId"]}: {item["case"]["centerlineFiles"]}', flush=True)
        return []
    register(plans)
    from .prepare import prepare
    from .server import manifest
    from .export_patient import export_patient
    export_directory = resolve(config.get('exportDirectory', 'releases/patients'))
    export_directory.mkdir(parents=True, exist_ok=True)
    results = []
    for item in plans:
        pid = item['case']['patientId']
        print(f'\nPreparing patient {pid}...', flush=True)
        try:
            prepare(force=force, case_id=pid)
            report = ai.results(pid)
            package = None
            if not skip_export:
                prepared = manifest(pid)
                package = export_directory/f'{pid}.cctacase'
                if package.exists() and not current_package(package, prepared, report):
                    revision = hashlib.sha256(json.dumps([prepared, report], sort_keys=True).encode()).hexdigest()[:12]
                    package = export_directory/f'{pid}-{revision}.cctacase'
                if current_package(package, prepared, report):
                    print(f'Existing export is current: {package}', flush=True)
                else:
                    export_patient(pid, package)
            results.append({'patientId':pid, 'status':'ready', 'package':str(package) if package else None,
                            'priRisk':report['predictions']['pri']['risk'],
                            'adjustedRisk':report['predictions']['adjusted']['risk'],
                            'priPercentile':report['priReference']['percentile'], 'riskCategory':report['stratum']})
        except Exception as error:
            print(f'Patient {pid} failed: {error}', file=sys.stderr, flush=True)
            results.append({'patientId':pid, 'status':'failed', 'error':str(error)})
    write_json(export_directory/'prepare-report.json', {'cases':results})
    print('\nBatch complete:', flush=True)
    for result in results:
        print(f'{result["patientId"]}: {result["status"]} {result.get("package") or result.get("error", "")}', flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', nargs='?', type=Path, default=ROOT/'config/prepare.local.json')
    parser.add_argument('--case', action='append', dest='selected', help='Prepare only this ID; repeat to select several.')
    parser.add_argument('--check-only', action='store_true', help='Validate/discover all inputs without changing files.')
    parser.add_argument('--skip-export', action='store_true', help='Register and prepare only the Mac viewer.')
    parser.add_argument('--force', action='store_true', help='Rebuild prepared assets even if current.')
    args = parser.parse_args()
    try:
        results = run(resolve(args.config), args.selected, args.check_only, args.skip_export, args.force)
    except Exception as error:
        parser.exit(1, f'Preparation failed: {error}\n')
    if any(result['status'] == 'failed' for result in results):sys.exit(1)


if __name__ == '__main__':main()
