"""Export an already prepared Mac/cluster case as a portable .cctacase archive."""
import argparse
import hashlib
import json
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from . import ai
from .data import read_case_config, configuration_key, case_directory
from .portable import FORMAT, VERSION, safe_id, safe_name, validate_manifest


def export_patient(patient_id, output, include_ai=True):
    from .server import manifest
    pid = safe_id(patient_id)
    if os.environ.get('CORONARY_PORTABLE_HOME'):
        raise ValueError('Export patients from the preparation workstation, not from portable mode.')
    prepared = manifest(pid)
    directory = case_directory(pid)
    target = Path(output).resolve()
    if target.exists():
        raise FileExistsError(f'{target} already exists. Choose a new output filename.')
    target.parent.mkdir(parents=True, exist_ok=True)
    files = [*prepared['assets'], 'axial.ct.npy', 'axial.labels.npy']
    if len(files) != len(set(files)):
        raise ValueError('Duplicate prepared assets.')
    report = ai.results(pid) if include_ai else None
    descriptor = {'format': FORMAT, 'version': VERSION, 'patientId': pid,
                  'configurationKey': prepared['configurationKey'],
                  'exportedAt': datetime.now(timezone.utc).isoformat(),
                  'modelRevision': report['modelRevision'] if report else None, 'files': {}}
    metadata = {'manifest.json': json.dumps(prepared, allow_nan=False).encode('utf-8')}
    if report is not None:
        metadata['ai.json'] = json.dumps(report, allow_nan=False).encode('utf-8')
    fd, temporary = tempfile.mkstemp(prefix=target.stem+'-', suffix='.partial', dir=target.parent)
    os.close(fd)
    states = {}
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
            for name in files:
                safe_name(name)
                path = directory/name
                before = path.stat()
                states[name] = (before.st_size, before.st_mtime_ns)
                digest = hashlib.sha256()
                print(f'Packing {pid}: {name}', flush=True)
                with path.open('rb') as source, archive.open(name, 'w', force_zip64=True) as destination:
                    for block in iter(lambda: source.read(8 * 1024**2), b''):
                        digest.update(block);destination.write(block)
                after = path.stat()
                if states[name] != (after.st_size, after.st_mtime_ns):
                    raise RuntimeError('Prepared asset changed during export. Export again after preparation finishes.')
                descriptor['files'][name] = {'size': before.st_size, 'sha256': digest.hexdigest()}
            for name, payload in metadata.items():
                archive.writestr(name, payload)
                descriptor['files'][name] = {'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
            validate_manifest(prepared, descriptor)
            archive.writestr('bundle.json', json.dumps(descriptor, allow_nan=False, indent=2))
        for name, state in states.items():
            current = (directory/name).stat()
            if state != (current.st_size, current.st_mtime_ns):
                raise RuntimeError('Prepared case changed while exporting. Export again.')
        if configuration_key(read_case_config(pid)) != prepared['configurationKey']:
            raise RuntimeError('Case configuration changed while exporting. Export again.')
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(f'Ready: {target} ({target.stat().st_size / 1024**2:.1f} MiB)', flush=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', required=True, dest='patient_id')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--without-ai', action='store_true', help='Explicitly export images without an AI report.')
    args = parser.parse_args()
    export_patient(args.patient_id, args.output, include_ai=not args.without_ai)


if __name__ == '__main__':
    main()
