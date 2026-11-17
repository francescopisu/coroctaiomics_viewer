"""Start the Mac viewer, optionally with --mode teaching."""
import argparse
import os
import threading
import time
import webbrowser


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',choices=['normal','teaching'],default='normal')
    parser.add_argument('--port',type=int,default=8000)
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--teaching-config')
    args=parser.parse_args()
    os.environ['CORONARY_MODE']=args.mode
    if args.teaching_config:os.environ['CORONARY_TEACHING_CONFIG']=os.path.abspath(args.teaching_config)
    import uvicorn
    from .server import app
    url=f'http://127.0.0.1:{args.port}/'
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=args.port,access_log=False))
    if not args.no_browser:
        def open_ready():
            for _ in range(600):
                if server.started:webbrowser.open(url);return
                if server.should_exit:return
                time.sleep(.1)
        threading.Thread(target=open_ready,daemon=True).start()
    print(f'CoroCTAiomics — {args.mode}: {url}',flush=True)
    server.run()


if __name__=='__main__':main()
