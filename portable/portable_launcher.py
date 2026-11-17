"""Portable launcher: bundled Python, per-user patients, loopback HTTP only."""
import argparse
import json
import logging
import os
import socket
import sys
import traceback
import webbrowser
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Start the offline CoroCTAiomics viewer.')
    parser.add_argument('--data-dir', type=Path, help='Override per-user patient storage.')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--mode', choices=['normal','teaching'], default='normal')
    parser.add_argument('--teaching-config', type=Path)
    parser.add_argument('--import-patient', type=Path, help='Import a prepared patient package and exit.')
    parser.add_argument('--check', action='store_true', help='Check native dependencies and application without starting a server.')
    args = parser.parse_args()
    application = Path(__file__).resolve().parent
    distribution = application.parent
    base = Path(os.environ.get('LOCALAPPDATA', Path.home()/'.local'/'share'))
    storage = (args.data_dir or Path(os.environ.get('CORONARY_PORTABLE_HOME', base/'CoroCTAiomics'))).resolve()
    # The bundled ._pth isolates imports; external Python installations are irrelevant.
    os.environ['CORONARY_PORTABLE_HOME'] = str(storage)
    os.environ['CORONARY_MODE'] = args.mode
    if args.teaching_config:os.environ['CORONARY_TEACHING_CONFIG'] = str(args.teaching_config.resolve())
    os.environ.pop('CORONARY_CASE_CONFIG', None)
    os.environ.pop('CORONARY_CATALOG_CONFIG', None)
    os.environ.pop('CORONARY_AI_CONFIG', None)
    from backend.portable import initialize, catalogue_ids, import_package
    initialize()
    logging.basicConfig(filename=storage/'viewer.log', level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(message)s', encoding='utf-8')
    import numpy as np
    import uvicorn
    from backend.server import app
    if not (application/'dist'/'index.html').is_file():
        raise RuntimeError('Compiled viewer assets are missing. Extract the complete application ZIP first.')
    if args.check:
        # Exercise the Windows .pyd and bundled DLLs, not just Python imports.
        assert np.isfinite(np.linalg.inv(np.eye(3))).all()
        print(json.dumps({'status':'ok','python':sys.version.split()[0],'numpy':np.__version__,
                          'patients':catalogue_ids(),'storage':str(storage)}, indent=2))
        return
    if args.import_patient:
        print(json.dumps(import_package(args.import_patient)))
        return
    for seed in sorted((distribution/'seed').glob('*.cctacase')):
        import zipfile
        with zipfile.ZipFile(seed) as archive:
            pid = json.loads(archive.read('bundle.json'))['patientId']
        if pid not in catalogue_ids():
            print(f'Preparing initial patient {pid}. This is needed only on the first launch...', flush=True)
            import_package(seed)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind(('127.0.0.1', args.port))
    except OSError:
        listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    url = f'http://127.0.0.1:{port}/'
    print(f'\nCoroCTAiomics: {url}\nPatient storage: {storage}\nKeep this window open. Press Ctrl+C to stop.\n', flush=True)
    config = uvicorn.Config(app, host='127.0.0.1', port=port, access_log=False, log_level='warning')
    server = uvicorn.Server(config)
    if not args.no_browser:
        # Open only after ASGI startup has completed and the listener is serving.
        import threading
        def open_when_ready():
            import time
            for _ in range(300):
                if server.started:
                    webbrowser.open(url)
                    return
                if server.should_exit:return
                time.sleep(.1)
        threading.Thread(target=open_when_ready, daemon=True).start()
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        traceback.print_exc()
        logging.exception('Unable to start portable viewer')
        sys.exit(1)
