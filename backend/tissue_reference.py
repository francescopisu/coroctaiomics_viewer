"""Experimental multi-reference display calibration. Never modifies analytical inputs."""
import argparse
import json
import os
from pathlib import Path
import numpy as np
from scipy import ndimage
from .blood_pool import prepare_reference
from .data import ROOT, image, read_case_config

VERSION=2


def statistics(values):
    values=np.asarray(values,dtype=np.float64);values=values[np.isfinite(values)]
    if len(values)<500:raise ValueError('Insufficient reference voxels.')
    q=np.percentile(values,[1,10,50,90,99])
    return {'voxels':len(values),'p01HU':float(q[0]),'p10HU':float(q[1]),'p50HU':float(q[2]),'p90HU':float(q[3]),'p99HU':float(q[4])}


def sample_myocardium(ct,mask,spacing):
    if ct.shape!=mask.shape:raise ValueError('Myocardium and native CT grids differ.')
    slices=np.flatnonzero(mask.any(axis=(0,1)))
    if not len(slices):raise ValueError('Empty myocardium mask.')
    margin=int(np.ceil(3/spacing[2]));start=slices[0]+margin;end=slices[-1]-margin
    if end<start:raise ValueError('Myocardium segment too short.')
    samples=[];rois=[]
    for z in np.unique(np.linspace(start,end,31).astype(int)):
        distance=ndimage.distance_transform_edt(np.pad(mask[:,:,z],1),sampling=spacing[:2])[1:-1,1:-1]
        roi=distance>2;values=ct[:,:,z][roi]
        if len(values):samples.append(values);rois.append({'sliceIJK':int(z),'voxels':int(len(values))})
    if len(rois)<3:raise ValueError('Insufficient interior myocardium slices.')
    return {**statistics(np.concatenate(samples)),'erosionMm':2,'endMarginMm':3,'slices':len(rois),'rois':rois}


def reference_anchors(fat,myocardium,blood):
    # HU coordinates remain physical. Only color/opacity knots are mapped back
    # from these canonical display coordinates into each patient's native HU.
    native=[-1024,-190,fat['p10HU'],fat['p50HU'],fat['p90HU'],-30,
            myocardium['p10HU'],myocardium['p50HU'],blood['p50HU'],max(350,blood['p99HU']),4096]
    canonical=[-1024,-190,-165,-100,-45,-30,35,120,250,350,4096]
    if any(not np.isfinite(v) for v in native) or any(b<=a for a,b in zip(native,native[1:])):
        raise ValueError('Reference distributions overlap too strongly for an ordered display calibration.')
    return [[float(x),float(y)] for x,y in zip(canonical,native)]


def prepare_tissue_reference(case_id,force=False):
    blood=prepare_reference(case_id)
    conf=read_case_config(case_id);directory=ROOT/'cache'/case_id;path=directory/'manifest.json';manifest=json.loads(path.read_text())
    source=Path(conf['outputRoot'])/'cardiac_structures/heart_myocardium.nii.gz';stat=source.stat() if source.is_file() else None
    key=[manifest['signature'],[stat.st_size,stat.st_mtime_ns] if stat else None,blood]
    sidecar=directory/'tissue-reference.json';old=manifest.get('tissueReference',{})
    if not force and old.get('version')==VERSION and sidecar.is_file():
        saved=json.loads(sidecar.read_text())
        if saved.get('sourceKey')==key or (stat is None and saved.get('sourceKey',[None])[0]==manifest['signature']):return old
    result={'available':False,'version':VERSION,'reason':'Myocardium source or blood reference unavailable.'}
    if stat and blood.get('available'):
        try:
            img,affine=image(source);geometry=manifest['geometry']
            if list(img.shape)!=geometry['shape'] or not np.allclose(affine,geometry['affineLPS'],atol=1e-5):raise ValueError('Myocardium mask is not on the native CT grid.')
            ct=np.load(directory/'axial.ct.npy',mmap_mode='r');labels=np.load(directory/'axial.labels.npy',mmap_mode='r')
            myocardium=sample_myocardium(ct,np.asarray(img.dataobj)>0,np.linalg.norm(affine[:3,:3],axis=0))
            fat=[]
            for k in range(0,ct.shape[2],16):
                hu=ct[:,:,k:k+16];bits=labels[:,:,k:k+16]
                fat.append(hu[((bits&14)>0)&((bits&1)==0)&(hu>=-190)&(hu<=-30)])
            fat=statistics(np.concatenate(fat))
            result={'available':True,'version':VERSION,'experimental':True,'method':'fat-myocardium-blood-display',
                    'fat':fat,'myocardium':myocardium,'anchors':reference_anchors(fat,myocardium,blood)}
            current=source.stat()
            if [current.st_size,current.st_mtime_ns]!=key[1]:raise ValueError('Myocardium mask changed during sampling.')
        except ValueError as error:result={'available':False,'version':VERSION,'reason':str(error)}
    sidecar.write_text(json.dumps({'sourceKey':key,'reference':result}))
    manifest['tissueReference']=result;temporary=directory/'manifest.tissue-reference.tmp';temporary.write_text(json.dumps(manifest));os.replace(temporary,path)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--case',required=True);parser.add_argument('--force',action='store_true');args=parser.parse_args()
    value=prepare_tissue_reference(args.case,args.force)
    print(json.dumps(value,indent=2))
