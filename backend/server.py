"""Loopback-only read-only HTTP layer. No arbitrary filesystem or patient access."""
import json
from functools import lru_cache
import numpy as np
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from .data import ROOT, read_case_config, configuration_key, CASE_INTERPRETATION, catalog_configurations, case_directory

class ViewerGZipMiddleware(GZipMiddleware):
    async def __call__(self, scope, receive, send):
        # Native CT has relatively little compression benefit. Over loopback,
        # direct transfer avoids both server compression and browser inflation.
        path=scope.get('path','');client=scope.get('client') or ('',0)
        local_ct=(scope['type']=='http' and client[0] in ('127.0.0.1','::1')
                  and '/assets/' in path and path.endswith('.volume.ct.bin'))
        if local_ct:
            await self.app(scope,receive,send)
        else:
            await super().__call__(scope,receive,send)

app = FastAPI(title='Coronary CPE viewer', docs_url=None, redoc_url=None)
# Sparse masks, meshes and non-local responses still benefit from fast gzip.
app.add_middleware(ViewerGZipMiddleware, minimum_size=1024, compresslevel=1)

def manifest(case_id,case_config=None):
    try: conf=read_case_config(case_id) if case_config is None else case_config;configured_id=conf['patientId']
    except LookupError:raise HTTPException(404,'Patient is not in the case catalogue')
    except (OSError,ValueError,KeyError) as error: raise HTTPException(503,f'Invalid case configuration: {error}')
    if case_id != configured_id:
        raise HTTPException(404, 'Patient is not in the case catalogue')
    path = case_directory(case_id) / 'manifest.json'
    if not path.is_file():
        raise HTTPException(503, 'Case cache missing. Run python -m backend.prepare first.')
    m=json.loads(path.read_text())
    try: key=configuration_key(conf)
    except (OSError,ValueError,KeyError) as error: raise HTTPException(503,f'Invalid case configuration: {error}')
    if m.get('configurationKey')!=key or m.get('patientId')!=configured_id:
        raise HTTPException(409,'Case configuration changed. Run python -m backend.prepare, then reload the viewer.')
    return m

@app.get('/api/patient-labels')
def get_patient_labels():
    from .registry import patient_labels
    try: labels=patient_labels()
    except (OSError,ValueError,KeyError) as error:raise HTTPException(503,f'Invalid patient labels: {error}')
    return JSONResponse({'labels':labels},headers={'Cache-Control':'no-store'})


@app.get('/api/patients')
def get_patients():
    try: cases=catalog_configurations()
    except (OSError,ValueError,KeyError):raise HTTPException(503,'Patient registry unavailable. Check config/viewer.local.json.')
    from .portable import enabled, summaries
    if enabled():return JSONResponse({'patients':summaries(cases)},headers={'Cache-Control':'no-store'})
    from .ai import reference, infer, risk_stratum, patient_record
    try: ai=reference()
    except (OSError,ValueError,KeyError,TypeError):ai=None
    rows=[]
    for pid in cases:
        try:
            m=manifest(pid,cases[pid])
            available=bool(m.get('axialVolume')) and all((case_directory(pid)/name).is_file() for name in m['assets'])
        except HTTPException:available=False
        try:record=patient_record(pid,ai,cases[pid]) if ai else None
        except (OSError,ValueError,TypeError,KeyError):record=None
        predictions={}
        for model in ('pri','adjusted'):
            try: predictions[model]=infer(ai['models'][model],record)['risk'] if record else None
            except (ValueError,TypeError,KeyError):predictions[model]=None
        pri=predictions['pri']
        rows.append({'patientId':pid,'available':available,'age':record.get('Age at CCTA') if record else None,
                     'sex':record.get('Sex') if record else None,'cadRads':record.get('CADRADS') if record else None,
                     'priRisk':pri,'adjustedRisk':predictions['adjusted'],
                     'stratum':risk_stratum(pri,ai['thresholds']['q25'],ai['thresholds']['q75']) if pri is not None else None})
    return JSONResponse({'patients':rows},headers={'Cache-Control':'no-store'})

@app.get('/api/case')
def get_current_case():
    try: case_id=read_case_config()['patientId']
    except (OSError,ValueError,KeyError) as error: raise HTTPException(503,f'Invalid case configuration: {error}')
    return get_case(case_id)

@app.get('/api/cases/{case_id}')
def get_case(case_id: str):
    m = manifest(case_id)
    from .cohort_reference import feature_maps
    try: maps=feature_maps(m.get('featureMaps',{}))
    except (OSError,ValueError,KeyError,TypeError) as error:raise HTTPException(503,f'Invalid radiomic cohort reference: {error}')
    return JSONResponse({**{k:v for k,v in m.items() if k not in ['assets','signature','configurationKey','sourceConfig']},
                         'featureMaps':maps,'interpretation':CASE_INTERPRETATION},headers={'Cache-Control':'no-store'})

@app.get('/api/cases/{case_id}/assets/{name}')
def get_asset(case_id: str, name: str):
    m = manifest(case_id)
    if name not in m['assets']:
        raise HTTPException(404, 'Unknown case asset')
    path = case_directory(case_id) / name
    if not path.is_file():
        raise HTTPException(503, 'Incomplete cache; rerun preparation')
    return FileResponse(path, media_type='application/octet-stream', headers={'Cache-Control': 'no-cache'})

@app.get('/api/cases/{case_id}/ai')
def get_ai(case_id: str):
    manifest(case_id)  # Same configured-patient access boundary as the imaging API.
    from .ai import results
    try:
        return JSONResponse(results(case_id), headers={'Cache-Control': 'no-store'})
    except LookupError as error:
        raise HTTPException(404, str(error))
    except ValueError as error:
        raise HTTPException(503, str(error))
    except (OSError, KeyError, TypeError):
        raise HTTPException(503, 'AI reference or patient inputs unavailable. Check config/viewer.local.json and prepare.sh.')

@lru_cache(maxsize=1)
def axial_arrays(case_id, revision):
    directory = case_directory(case_id)
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
    m=manifest(case_id);f=find_feature(m,feature_id);directory=case_directory(case_id)
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

@app.get('/api/runtime')
def get_runtime():
    from .portable import enabled
    return JSONResponse({'application':'CoroCTAiomics','edition':'openday','portable':enabled(),'canImportPatients':enabled()},headers={'Cache-Control':'no-store'})

@app.post('/api/patients/import')
async def import_patient(request:Request):
    from .portable import receive_import
    return await receive_import(request)

if (ROOT / 'dist').is_dir():
    @app.get('/viewer/{case_id}',include_in_schema=False)
    @app.get('/patients',include_in_schema=False)
    def viewer_page(case_id:str=''):
        return FileResponse(ROOT/'dist/index.html',headers={'Cache-Control':'no-cache'})
    app.mount('/', StaticFiles(directory=ROOT/'dist', html=True), name='viewer')
