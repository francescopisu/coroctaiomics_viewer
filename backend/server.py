"""Loopback-only read-only HTTP layer. No arbitrary filesystem or patient access."""
import json
from functools import lru_cache
import numpy as np
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from .data import ROOT, read_case_config, configuration_key

app = FastAPI(title='Coronary CPE viewer', docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)

def manifest(case_id):
    try: configured_id=read_case_config()['patientId']
    except (OSError,ValueError,KeyError) as error: raise HTTPException(503,f'Invalid case configuration: {error}')
    if case_id != configured_id:
        raise HTTPException(404, 'Only the configured case is available')
    path = ROOT / 'cache' / case_id / 'manifest.json'
    if not path.is_file():
        raise HTTPException(503, 'Case cache missing. Run python -m backend.prepare first.')
    m=json.loads(path.read_text())
    try: key=configuration_key()
    except (OSError,ValueError,KeyError) as error: raise HTTPException(503,f'Invalid case configuration: {error}')
    if m.get('configurationKey')!=key or m.get('patientId')!=configured_id:
        raise HTTPException(409,'Case configuration changed. Run python -m backend.prepare, then reload the viewer.')
    return m

@app.get('/api/case')
def get_current_case():
    try: case_id=read_case_config()['patientId']
    except (OSError,ValueError,KeyError) as error: raise HTTPException(503,f'Invalid case configuration: {error}')
    return get_case(case_id)

@app.get('/api/cases/{case_id}')
def get_case(case_id: str):
    m = manifest(case_id)
    return JSONResponse({k:v for k,v in m.items() if k not in ['assets','signature','configurationKey']},headers={'Cache-Control':'no-store'})

@app.get('/api/cases/{case_id}/assets/{name}')
def get_asset(case_id: str, name: str):
    m = manifest(case_id)
    if name not in m['assets']:
        raise HTTPException(404, 'Unknown case asset')
    path = ROOT / 'cache' / case_id / name
    if not path.is_file():
        raise HTTPException(503, 'Incomplete cache; rerun preparation')
    return FileResponse(path, media_type='application/octet-stream', headers={'Cache-Control': 'no-cache'})

@lru_cache(maxsize=1)
def axial_arrays(case_id, revision):
    directory = ROOT/'cache'/case_id
    return (np.load(directory/'axial.ct.npy',mmap_mode='r'),np.load(directory/'axial.labels.npy',mmap_mode='r'))

@app.get('/api/cases/{case_id}/axial/{index}')
def get_axial(case_id: str, index: int):
    m=manifest(case_id)
    try: ct,labels=axial_arrays(case_id,m['signature'])
    except FileNotFoundError: raise HTTPException(503,'Run backend.prepare to prepare interactive volumes')
    if index<0 or index>=ct.shape[2]: raise HTTPException(404,'Axial slice outside case')
    # Rows j, columns i; x is contiguous, as in vtkImageData and the NIfTI grid.
    payload = ct[:,:,index].T.astype('<f4').tobytes()+labels[:,:,index].T.tobytes()
    return Response(payload, media_type='application/octet-stream',headers={'Cache-Control':'no-cache'})

def find_feature(m,feature_id):
    for entries in m.get('featureMaps',{}).values():
        for feature in entries:
            if feature['id']==feature_id:return feature
    raise HTTPException(404,'Unknown configured feature map')

@lru_cache(maxsize=1)
def feature_arrays(case_id,revision,feature_id):
    m=manifest(case_id);f=find_feature(m,feature_id);directory=ROOT/'cache'/case_id
    names=[f[k].rsplit('/',1)[-1] for k in ['values','valid']]
    if any(name not in m['assets'] for name in names):raise HTTPException(404,'Unlisted feature asset')
    shape=tuple(f['dimensions'])
    return (np.memmap(directory/names[0],mode='r',dtype='<f4',shape=shape,order='F'),
            np.memmap(directory/names[1],mode='r',dtype='u1',shape=shape,order='F'))

@app.get('/api/cases/{case_id}/features/{feature_id}/axial/{index}')
def get_feature_axial(case_id:str,feature_id:str,index:int):
    m=manifest(case_id);f=find_feature(m,feature_id);nx,ny,nz=m['geometry']['shape']
    if index<0 or index>=nz:raise HTTPException(404,'Axial slice outside case')
    values=np.zeros((ny,nx),dtype='<f4');valid=np.zeros((ny,nx),dtype='u1')
    x,y,z=f['startIJK'];dx,dy,dz=f['dimensions'];k=index-z
    if 0<=k<dz:
        source,support=feature_arrays(case_id,m['signature'],feature_id)
        values[y:y+dy,x:x+dx]=source[:,:,k].T;valid[y:y+dy,x:x+dx]=support[:,:,k].T
    return Response(values.tobytes()+valid.tobytes(),media_type='application/octet-stream',headers={'Cache-Control':'no-cache'})

if (ROOT / 'dist').is_dir():
    app.mount('/', StaticFiles(directory=ROOT/'dist', html=True), name='viewer')
