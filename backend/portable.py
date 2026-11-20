"""Self-contained prepared-patient packages and per-user portable storage.

This runtime never imports the segmentation pipeline, unpickles models, or
recomputes clinical results. Reports are exported with the validated Mac model.
"""
import contextlib
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path

FORMAT = 'coronary-ccta-patient'
VERSION = 1
MAX_BYTES = 20 * 1024**3
MAX_FILES = 2048
ID_PATTERN = re.compile(r'[A-Za-z0-9_-]{1,80}')
FILE_PATTERN = re.compile(r'[A-Za-z0-9_.-]{1,180}')
RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}


def enabled():
    return bool(os.environ.get('CORONARY_PORTABLE_HOME'))


def home():
    value = os.environ.get('CORONARY_PORTABLE_HOME')
    if not value:
        raise ValueError('Patient import is available only in the portable application.')
    return Path(value).expanduser().resolve()


def safe_id(value):
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value) or value.upper() in RESERVED:
        raise ValueError('Invalid patient identifier.')
    return value


def safe_name(value):
    if (not isinstance(value, str) or not FILE_PATTERN.fullmatch(value) or value.startswith('.') or
            value.endswith('.') or value.split('.')[0].upper() in RESERVED):
        raise ValueError('Unsafe filename in patient package.')
    return value


def read_json(path):
    def invalid(value):
        raise ValueError('Non-finite value in patient metadata.')
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=invalid)


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, allow_nan=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)


def initialize():
    root = home()
    (root/'patients').mkdir(parents=True, exist_ok=True)
    (root/'incoming').mkdir(exist_ok=True)
    # Never replace the user's catalogue when upgrading the application.
    with storage_lock():
        if not (root/'catalog.json').exists():
            write_json(root/'catalog.json', {'version': VERSION, 'cases': []})
    return root


@contextlib.contextmanager
def storage_lock():
    """OS-owned lock is released even if a launcher/import process exits."""
    root = home()
    root.mkdir(parents=True, exist_ok=True)
    with (root/'import.lock').open('a+b') as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b'0');handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def catalogue_ids():
    path = home()/'catalog.json'
    if not path.is_file():
        return []
    value = read_json(path)
    if value.get('version') != VERSION or not isinstance(value.get('cases'), list):
        raise ValueError('Unsupported portable patient catalogue.')
    ids = [safe_id(pid) for pid in value['cases']]
    if len({pid.casefold() for pid in ids}) != len(ids):
        raise ValueError('Duplicate patient identifiers in portable catalogue.')
    return ids


def configurations():
    out = {}
    for pid in catalogue_ids():
        descriptor = read_json(home()/'patients'/pid/'bundle.json')
        if descriptor.get('format') != FORMAT or descriptor.get('version') != VERSION or descriptor.get('patientId') != pid:
            raise ValueError('Invalid imported patient metadata.')
        out[pid] = {'patientId': pid, 'portablePackage': VERSION,
                    'configurationKey': descriptor['configurationKey']}
    return out


def patient_ai(pid):
    if pid not in configurations():
        raise LookupError('Patient is not in the case catalogue')
    path = home()/'patients'/pid/'ai.json'
    if not path.is_file():
        raise LookupError('No AI report was included in this patient package.')
    report = read_json(path)
    if report.get('patientId') != pid:
        raise ValueError('AI report does not match the selected patient.')
    return report


def summaries(cases):
    from .server import manifest
    from fastapi import HTTPException
    rows = []
    for pid in cases:
        try:
            m = manifest(pid, cases[pid])
            available = bool(m.get('axialVolume')) and all((home()/'patients'/pid/name).is_file() for name in m['assets'])
        except (HTTPException, OSError, ValueError, KeyError):
            available = False
        try:
            result = patient_ai(pid)
        except (LookupError, OSError, ValueError):
            result = {}
        patient = result.get('patient', {})
        predictions = result.get('predictions', {})
        rows.append({'patientId': pid, 'available': available, 'age': patient.get('Age at CCTA'),
                     'sex': patient.get('Sex'), 'cadRads': patient.get('CADRADS'),
                     'priRisk': predictions.get('pri', {}).get('risk'),
                     'adjustedRisk': predictions.get('adjusted', {}).get('risk'),
                     'stratum': result.get('stratum')})
    return rows


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(8 * 1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


def validate_manifest(manifest, descriptor):
    pid = safe_id(descriptor['patientId'])
    if (manifest.get('patientId') != pid or manifest.get('configurationKey') != descriptor.get('configurationKey') or
            manifest.get('coordinateSystem') != 'LPS' or manifest.get('units') != 'mm' or
            not manifest.get('axialVolume')):
        raise ValueError('Patient manifest, geometry or identity is inconsistent.')
    shape = manifest.get('geometry', {}).get('shape', [])
    if len(shape) != 3 or any(type(n) is not int or n <= 0 or n > 4096 for n in shape):
        raise ValueError('Invalid CCTA dimensions in patient package.')
    assets = manifest.get('assets', [])
    if not assets or len(set(assets)) != len(assets):
        raise ValueError('Patient package has an empty or duplicate asset list.')
    files = descriptor['files']
    for name in assets:
        safe_name(name)
        if not name.endswith('.bin') or name not in files:
            raise ValueError('Patient package is missing a listed imaging asset.')
    expected = set(assets) | {'manifest.json', 'axial.ct.npy', 'axial.labels.npy'}
    if 'ai.json' in files:
        expected.add('ai.json')
    if set(files) != expected:
        raise ValueError('Patient package contains unexpected or missing files.')
    prefix = f'/api/cases/{pid}/'
    def urls(value):
        if isinstance(value, dict):
            for item in value.values():urls(item)
        elif isinstance(value, list):
            for item in value:urls(item)
        elif isinstance(value, str):
            if value.startswith('/api/'):
                if not value.startswith(prefix):
                    raise ValueError('An imaging URL belongs to another patient.')
                if value.startswith(prefix+'assets/') and value[len(prefix+'assets/'):] not in assets:
                    raise ValueError('An imaging URL references an unlisted asset.')
            elif value.startswith(('/', 'file:', 'http:', 'https:')) or re.match(r'^[A-Za-z]:[\\/]', value):
                raise ValueError('Source filesystem paths are not allowed in portable manifests.')
    urls(manifest)
    for vessel in ('LAD', 'LCx', 'RCA'):
        if vessel not in manifest.get('vessels', {}) or vessel not in manifest.get('volumes', {}):
            raise ValueError('Patient package must contain all three prepared vessels.')


def import_package(path):
    """Stream, verify, stage, then publish a new case; existing cases are preserved."""
    initialize()
    path = Path(path)
    if path.stat().st_size > MAX_BYTES:
        raise ValueError('Patient package exceeds the 20 GiB limit.')
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(infos) > MAX_FILES or len({name.casefold() for name in names}) != len(names):
            raise ValueError('Duplicate filenames or too many files in patient package.')
        for info in infos:
            safe_name(info.filename)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                raise ValueError('Directories, links and encrypted files are not allowed in patient packages.')
        if 'bundle.json' not in names or archive.getinfo('bundle.json').file_size > 2 * 1024**2:
            raise ValueError('Missing or invalid patient package descriptor.')
        descriptor = json.loads(archive.read('bundle.json'))
        if descriptor.get('format') != FORMAT or descriptor.get('version') != VERSION:
            raise ValueError('Unsupported patient package format.')
        pid = safe_id(descriptor.get('patientId'))
        with storage_lock():
            if pid.casefold() in {value.casefold() for value in catalogue_ids()} or (home()/'patients'/pid).exists():
                raise FileExistsError(f'Patient {pid} is already imported. Existing data were preserved.')
        files = descriptor.get('files')
        if not isinstance(files, dict) or set(names) != set(files) | {'bundle.json'}:
            raise ValueError('Patient package inventory does not match its contents.')
        if sum(info.file_size for info in infos) > MAX_BYTES:
            raise ValueError('Expanded patient package exceeds the 20 GiB limit.')
        required = sum(info.file_size for info in infos)
        if shutil.disk_usage(home()).free < required + 256 * 1024**2:
            raise ValueError('Insufficient free disk space to import this patient.')
        with tempfile.TemporaryDirectory(prefix='import-', dir=home()/'incoming') as temporary:
            stage = Path(temporary)
            for name, item in files.items():
                safe_name(name)
                info = archive.getinfo(name)
                if not isinstance(item, dict) or item.get('size') != info.file_size or not re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', '')):
                    raise ValueError('Invalid patient package file inventory.')
                if name.endswith('.json') and info.file_size > 16 * 1024**2:
                    raise ValueError('Patient metadata is too large.')
                digest = hashlib.sha256()
                with archive.open(info) as source, (stage/name).open('xb') as target:
                    for block in iter(lambda: source.read(8 * 1024**2), b''):
                        target.write(block);digest.update(block)
                if digest.hexdigest() != item['sha256']:
                    raise ValueError(f'Patient package checksum failed for {name}.')
            manifest = read_json(stage/'manifest.json')
            validate_manifest(manifest, descriptor)
            if 'ai.json' in files:
                report = read_json(stage/'ai.json')
                if (report.get('patientId') != pid or not isinstance(report.get('patient'), dict) or
                        len(report.get('features', [])) != 8 or not report.get('modelRevision')):
                    raise ValueError('AI report identity or schema is invalid.')
                if report.get('horizonMonths') != 48:
                    raise ValueError('Unsupported AI report prediction horizon.')
            write_json(stage/'bundle.json', descriptor)
            with storage_lock():
                ids = catalogue_ids()
                if pid.casefold() in {value.casefold() for value in ids} or (home()/'patients'/pid).exists():
                    raise FileExistsError(f'Patient {pid} is already imported. Existing data were preserved.')
                destination = home()/'patients'/pid
                os.rename(stage, destination)
                try:
                    write_json(home()/'catalog.json', {'version': VERSION, 'cases': [*ids, pid]})
                except Exception:
                    shutil.rmtree(destination)
                    raise
    return {'patientId': pid}


async def receive_import(request):
    from fastapi import HTTPException
    from fastapi.responses import JSONResponse
    from starlette.concurrency import run_in_threadpool
    if not enabled():
        raise HTTPException(404, 'Patient import is available only in the portable application.')
    # Require same-origin browser requests, not requests from arbitrary websites.
    from urllib.parse import urlsplit
    origin = request.headers.get('origin', '')
    host = request.headers.get('host', '')
    if (urlsplit(origin).scheme != 'http' or urlsplit(origin).netloc != host or
            urlsplit(origin).hostname not in ('127.0.0.1', 'localhost') or
            request.headers.get('sec-fetch-site', 'same-origin') not in ('same-origin', 'none')):
        raise HTTPException(403, 'Patient import requires the local viewer page.')
    if request.headers.get('content-type', '').split(';')[0] != 'application/zip':
        raise HTTPException(415, 'Select a .cctacase patient package.')
    length = request.headers.get('content-length')
    if length is not None:
        try:size = int(length)
        except ValueError:raise HTTPException(400, 'Invalid upload length.')
        if size < 0:raise HTTPException(400, 'Invalid upload length.')
        if size > MAX_BYTES:raise HTTPException(413, 'Patient package exceeds the 20 GiB limit.')
    initialize()
    fd, name = tempfile.mkstemp(prefix='upload-', suffix='.cctacase', dir=home()/'incoming')
    try:
        size = 0
        with os.fdopen(fd, 'wb') as handle:
            async for block in request.stream():
                size += len(block)
                if size > MAX_BYTES:
                    raise HTTPException(413, 'Patient package exceeds the 20 GiB limit.')
                await run_in_threadpool(handle.write, block)
        try:
            result = await run_in_threadpool(import_package, Path(name))
        except FileExistsError as error:
            raise HTTPException(409, str(error))
        except (ValueError, KeyError, TypeError, zipfile.BadZipFile, EOFError) as error:
            raise HTTPException(400, f'Invalid patient package: {error}')
        except OSError:
            raise HTTPException(507, 'Unable to store patient. Check free disk space and folder permissions.')
        return JSONResponse(result, status_code=201, headers={'Cache-Control':'no-store'})
    finally:
        Path(name).unlink(missing_ok=True)
