#!/usr/bin/env python3
"""Assemble a Windows x64 embedded-Python application from macOS or Linux.

Downloads only official CPython binaries and pinned, precompiled Windows wheels.
No cross-compilation, Windows installer, system Python or target-side pip needed.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
DEFAULT_PYTHON = '3.13.17'
DEFAULT_PYTHON_SHA256 = '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38'


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(8 * 1024**2), b''):hasher.update(block)
    return hasher.hexdigest()


def member_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
        raise ValueError('Unsafe path in a runtime archive.')
    return path


def extract_runtime(source, destination):
    with zipfile.ZipFile(source) as archive:
        for info in archive.infolist():
            path = member_path(info.filename)
            if info.is_dir():continue
            target = destination.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as reader, target.open('wb') as writer:shutil.copyfileobj(reader, writer)


def extract_wheel(source, destination):
    with zipfile.ZipFile(source) as archive:
        for info in archive.infolist():
            path = member_path(info.filename)
            if info.is_dir():continue
            parts = path.parts
            if parts[0].endswith('.data'):
                if len(parts) < 3:continue
                if parts[1] == 'scripts':continue  # No CLI entry points are used by the runtime.
                if parts[1] not in ('purelib', 'platlib'):
                    raise ValueError(f'Unsupported wheel data layout: {info.filename}')
                parts = parts[2:]
            target = destination.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as reader, target.open('wb') as writer:shutil.copyfileobj(reader, writer)


def build(args):
    if not re.fullmatch(r'3\.13\.\d+', args.python_version):
        raise ValueError('This locked runtime targets CPython 3.13 x64.')
    if not re.fullmatch(r'[A-Za-z0-9_-]+',args.storage_name):raise ValueError('Use a simple portable storage folder name.')
    output = args.output.resolve()
    archive_path = output.with_suffix('.zip')
    if output.exists() or archive_path.exists():
        raise FileExistsError('Output already exists; choose a new --output directory to preserve previous packages.')
    for patient in args.patient:
        if not patient.is_file() or patient.suffix != '.cctacase':
            raise ValueError(f'Prepared patient package not found: {patient}')
    if not args.skip_frontend:
        subprocess.run(['npm', 'run', 'build'], cwd=ROOT, check=True)
    if not (ROOT/'dist/index.html').is_file():
        raise ValueError('Run npm run build before assembling the application.')
    downloads = ROOT/'.portable-build/downloads'
    wheels = downloads/'wheels'
    wheels.mkdir(parents=True, exist_ok=True)
    python_name = f'python-{args.python_version}-embed-amd64.zip'
    runtime_zip = downloads/python_name
    url = f'https://www.python.org/ftp/python/{args.python_version}/{python_name}'
    if not runtime_zip.is_file():
        if args.offline:raise FileNotFoundError('Embedded Python is not in the local download cache.')
        print(f'Downloading official runtime: {url}', flush=True)
        temporary = runtime_zip.with_suffix('.partial')
        try:
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as handle:
                shutil.copyfileobj(response, handle)
            os.replace(temporary, runtime_zip)
        finally:
            temporary.unlink(missing_ok=True)
    expected_sha = args.python_sha256 or (DEFAULT_PYTHON_SHA256 if args.python_version == DEFAULT_PYTHON else None)
    if expected_sha and digest(runtime_zip) != expected_sha:
        raise ValueError('Embedded Python SHA-256 does not match the requested checksum.')
    requirement_path = ROOT/'portable/requirements-windows.txt'
    requirements = [line.strip() for line in requirement_path.read_text().splitlines()
                    if line.strip() and not line.lstrip().startswith('#')]
    command = [sys.executable, '-m', 'pip', 'download', '--disable-pip-version-check',
               '--only-binary=:all:', '--no-deps', '--platform', 'win_amd64',
               '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313',
               '--dest', str(wheels), '-r', str(requirement_path)]
    if args.offline:command.extend(['--no-index', '--find-links', str(wheels)])
    if not args.offline:subprocess.run(command, check=True)
    selected = []
    for requirement in requirements:
        name, version = requirement.split('==')
        normalized = name.lower().replace('-', '_')
        candidates = [path for path in wheels.glob('*.whl')
                      if path.name.split('-')[0].lower().replace('-', '_') == normalized
                      and path.name.split('-')[1] == version]
        if len(candidates) != 1 or not candidates[0].name.endswith(('-win_amd64.whl', '-any.whl')):
            raise ValueError(f'Expected exactly one compatible Windows wheel for {requirement}.')
        selected.append(candidates[0])
    if args.download_only:
        print(f'Download cache ready: CPython {args.python_version}, {len(selected)} Windows wheels.', flush=True)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='windows-build-', dir=output.parent) as temporary:
        stage = Path(temporary)/'CoroCTAiomics'
        runtime = stage/'runtime'
        application = stage/'application'
        site_packages = runtime/'Lib/site-packages'
        site_packages.mkdir(parents=True)
        (application/'backend').mkdir(parents=True)
        extract_runtime(runtime_zip, runtime)
        for wheel in selected:
            print(f'Bundling {wheel.name}', flush=True)
            extract_wheel(wheel, site_packages)
        # Absolute host paths and user-site packages never enter this path file.
        (runtime/'python313._pth').write_text(
            'python313.zip\n.\nLib/site-packages\n../application\nimport site\n', encoding='utf-8')
        for name in ('__init__.py', 'data.py', 'ai.py', 'server.py', 'portable.py', 'registry.py', 'cohort_reference.py'):
            shutil.copy2(ROOT/'backend'/name, application/'backend'/name)
        shutil.copytree(ROOT/'dist', application/'dist')
        patient_ids=[]
        for package in args.patient:
            with zipfile.ZipFile(package) as reader:
                patient_ids.append(json.loads(reader.read('bundle.json'))['patientId'])
        if len(set(patient_ids))!=len(patient_ids):raise ValueError('Duplicate initial patient IDs.')
        settings=json.loads((ROOT/'config/viewer.local.json').read_text())
        configured={entry['id'] for entry in settings['patients']}
        if not set(patient_ids)<=configured:raise ValueError('All packaged patients must be in the current viewer registry.')
        labels={pid:settings.get('patientLabels',{}).get(pid,pid) for pid in patient_ids}
        (application/'config').mkdir()
        (application/'config/viewer.local.json').write_text(json.dumps({'patientLabels':labels,'patients':[{'id':pid} for pid in patient_ids]},indent=2),encoding='utf-8')
        (application/'config/portable.json').write_text(json.dumps({'edition':'openday','storageName':args.storage_name},indent=2),encoding='utf-8')
        reference=ROOT/'config/radiomic-cohort-reference.local.json'
        if not reference.is_file():raise ValueError('The openday release requires its radiomic cohort reference JSON.')
        from backend.cohort_reference import references
        lookup=references(reference)
        for package in args.patient:
            with zipfile.ZipFile(package) as reader:
                manifest=json.loads(reader.read('manifest.json'))
            for vessel,features in manifest.get('featureMaps',{}).items():
                for feature in features:
                    if (vessel,feature['name'].casefold()) not in lookup:raise ValueError(f"Missing cohort reference: {vessel}/{feature['name']}")
        shutil.copy2(reference,application/'config'/reference.name)
        shutil.copy2(ROOT/'portable/portable_launcher.py', application/'portable_launcher.py')
        for name in ('Start Viewer.cmd', 'Check Installation.cmd'):
            # cmd.exe gets CRLF even when the distribution is built on macOS.
            (stage/name).write_bytes((ROOT/'portable'/name).read_text().replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))
        shutil.copy2(ROOT/'portable/WINDOWS_README.txt', stage/'READ ME FIRST.txt')
        (stage/'seed').mkdir()
        for patient in args.patient:shutil.copy2(patient, stage/'seed'/patient.name)
        commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True)
        inventory = {'format': 'coronary-ccta-windows', 'version': 1,
                     'builtAt': datetime.now(timezone.utc).isoformat(), 'platform': 'win_amd64',
                     'sourceCommit': commit.stdout.strip() if commit.returncode == 0 else None,
                     'sourceBranch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),
                     'sourceDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),
                     'edition':'openday','patientLabels':labels,'storageName':args.storage_name,
                     'cohortReferenceSha256':digest(reference),
                     'python': {'version': args.python_version, 'url': url, 'sha256': digest(runtime_zip)},
                     'wheels': {path.name: digest(path) for path in selected},
                     'applicationFiles': {str(path.relative_to(application)): digest(path)
                                          for path in application.rglob('*') if path.is_file()},
                     'initialPatients': [path.name for path in args.patient],
                     'windowsExecutionVerified': False}
        (stage/'build-info.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
        os.replace(stage, output)
    print(f'Creating {archive_path}', flush=True)
    partial = archive_path.with_suffix('.zip.partial')
    try:
        with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for path in sorted(output.rglob('*')):
                if not path.is_file():continue
                archive.write(path, str(Path('CoroCTAiomics')/path.relative_to(output)),
                              compress_type=zipfile.ZIP_STORED if path.suffix == '.cctacase' else zipfile.ZIP_DEFLATED)
        os.replace(partial, archive_path)
    finally:
        partial.unlink(missing_ok=True)
    print(f'Ready: {archive_path} ({archive_path.stat().st_size / 1024**2:.1f} MiB)', flush=True)
    print('Assembled on this host. Run Check Installation.cmd and verify the viewer on Windows before the demo.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'releases/CoroCTAiomics-Windows-x64')
    parser.add_argument('--storage-name',default='CoroCTAiomics-OpenDay-2026',help='Separate per-user storage from older demonstration releases.')
    parser.add_argument('--python-version', default=DEFAULT_PYTHON)
    parser.add_argument('--python-sha256', help='Optional independently verified CPython archive checksum.')
    parser.add_argument('--patient', type=Path, action='append', default=[])
    parser.add_argument('--skip-frontend', action='store_true')
    parser.add_argument('--download-only', action='store_true', help='Fetch the pinned runtime before exporting large patients.')
    parser.add_argument('--offline', action='store_true', help='Rebuild entirely from the local download cache.')
    build(parser.parse_args())


if __name__ == '__main__':
    main()
