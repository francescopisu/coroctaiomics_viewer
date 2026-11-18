"""One command for every patient registered in viewer.local.json."""
import argparse
import os
import subprocess
from pathlib import Path
from . import ai
from .data import ROOT, catalog_configurations, configuration
from .registry import patient_id, registry_path


def reference(check_only):
    try:return ai.reference()
    except (OSError,ValueError,KeyError) as error:
        if check_only:raise ValueError(f'AI reference needs preparation: {error}')
        python = Path(os.environ.get('CORONARY_ANALYSIS_PYTHON',ROOT/'.venv-ai/bin/python'))
        if not python.is_file():
            raise ValueError('The one-time model export needs the analysis environment. Set CORONARY_ANALYSIS_PYTHON to its Python executable.')
        print('Preparing the fixed AI reference once…',flush=True)
        subprocess.run([str(python),'-m','backend.export_ai'],cwd=ROOT,check=True)
        return ai.reference()


def run(ids=None,check_only=False,force=False):
    cases=catalog_configurations()
    selected=[patient_id(value) for value in ids] if ids else list(cases)
    if not selected:raise ValueError('Add at least one patient to viewer.local.json.')
    unknown=set(selected)-cases.keys()
    if unknown:raise ValueError('Patients not registered: '+', '.join(sorted(unknown)))
    # Fail on wrong source paths before starting any expensive image work.
    for pid in selected:
        conf,paths=configuration(cases[pid])
        counts={v:len(entries) for v,entries in conf['featureFiles'].items()}
        print(f'{pid}: source paths verified; maps {counts}; centerlines {conf["centerlineFiles"]}',flush=True)
    data=reference(check_only)
    for pid in selected:
        record=ai.patient_record(pid,data,cases[pid])
        for name,model in data['models'].items():
            try:
                if record is None:raise ValueError('No clinical/radiomic record available.')
                value=ai.infer(model,record)
                print(f'{pid}: {name} = {100*value["risk"]:.2f}%',flush=True)
            except ValueError as error:print(f'{pid}: {name} unavailable — {error}',flush=True)
    if not check_only:
        from .prepare import prepare
        for pid in selected:prepare(force=force,case_id=pid)
    print(f'{"Checked" if check_only else "Prepared"} {len(selected)} patients from {registry_path()}',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('patients',nargs='*',help='Patient IDs; omit to prepare all registered patients.')
    parser.add_argument('--config',help='Alternative viewer registry JSON.')
    parser.add_argument('--check',action='store_true',help='Check sources and AI inputs without generating image assets.')
    parser.add_argument('--force',action='store_true',help='Regenerate image caches even when unchanged.')
    args=parser.parse_args()
    if args.config:os.environ['CORONARY_VIEWER_CONFIG']=str(Path(args.config).expanduser().resolve())
    if os.environ.get('CORONARY_CASE_CONFIG') or os.environ.get('CORONARY_CATALOG_CONFIG'):
        parser.error('Unset legacy CORONARY_CASE_CONFIG/CORONARY_CATALOG_CONFIG; use --config instead.')
    try:run(args.patients,args.check,args.force)
    except (OSError,ValueError,KeyError,LookupError,subprocess.CalledProcessError) as error:
        parser.exit(1,f'Preparation failed: {error}\n')

if __name__=='__main__':main()
