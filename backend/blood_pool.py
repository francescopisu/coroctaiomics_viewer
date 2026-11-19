"""Experimental aortic blood-pool reference for display only; no tissue classification."""
import argparse
import json
import os
from pathlib import Path
import numpy as np
from scipy import ndimage
from .data import ROOT, image, read_case_config, configuration_key

VERSION=2


def sample_blood_pool(ct,mask,spacing):
    if ct.shape!=mask.shape or mask.ndim!=3:raise ValueError('Aorta and native CCTA must share a 3D grid.')
    occupied=np.argwhere(mask)
    if not len(occupied):raise ValueError('Empty aorta mask.')
    lo=occupied.min(0);hi=occupied.max(0)+1
    xs,ys=slice(lo[0],hi[0]),slice(lo[1],hi[1])
    xx,yy=np.ogrid[lo[0]:hi[0],lo[1]:hi[1]]
    # Use the central half of the available aortic segment, away from its ends.
    zs=np.unique(np.linspace(lo[2]+(hi[2]-lo[2])*.25,lo[2]+(hi[2]-lo[2])*.75-1,31).astype(int))
    samples=[];rois=[]
    for z in zs:
        filled=ndimage.binary_fill_holes(mask[xs,ys,z])
        components,count=ndimage.label(filled)
        if not count:continue
        counts=np.bincount(components.ravel());counts[0]=0;filled=components==counts.argmax()
        distance=ndimage.distance_transform_edt(np.pad(filled,1),sampling=spacing[:2])[1:-1,1:-1]
        x,y=np.unravel_index(distance.argmax(),distance.shape)
        if distance[x,y]<6:continue  # A shell that cannot be filled is not blood.
        x+=lo[0];y+=lo[1]
        roi=(((xx-x)*spacing[0])**2+((yy-y)*spacing[1])**2<=9)&(distance>=3)
        values=np.asarray(ct[xs,ys,z])[roi];values=values[np.isfinite(values)]
        if not len(values):continue
        samples.append(values);rois.append({'centerIJK':[int(x),int(y),int(z)],'voxels':int(len(values))})
    if len(rois)<3 or sum(len(v) for v in samples)<500:raise ValueError('Insufficient interior aortic blood-pool samples.')
    values=np.concatenate(samples).astype(np.float64)
    p01,p10,p50,p90,p95,p99=np.percentile(values,[1,10,50,90,95,99])
    if not 0<p50<=p99<3000:raise ValueError('Aortic sample attenuation is unsuitable for this display reference.')
    return {'available':True,'method':'aortic-blood-p99','version':VERSION,'experimental':True,
            'roiRadiusMm':3,'wallMarginMm':3,'slices':len(rois),'voxels':int(len(values)),
            'meanHU':float(values.mean()),'stdHU':float(values.std()),
            'p01HU':float(p01),'p10HU':float(p10),'p50HU':float(p50),'p90HU':float(p90),'p95HU':float(p95),'p99HU':float(p99),
            'thresholdHU':float(max(350,p99)),'rois':rois}


def prepare_reference(case_id,force=False):
    conf=read_case_config(case_id);directory=ROOT/'cache'/case_id;path=directory/'manifest.json'
    manifest=json.loads(path.read_text())
    if manifest.get('patientId')!=case_id or manifest.get('configurationKey')!=configuration_key(conf):raise ValueError('Prepare the current patient images before sampling blood.')
    source=Path(conf.get('ascendingAorta',Path(conf['outputRoot'])/'cardiac_structures/asc_aorta_shell.nii.gz'))
    old=manifest.get('bloodPoolReference',{})
    stat=source.stat() if source.is_file() else None
    stamp=[stat.st_size,stat.st_mtime_ns] if stat else None
    source_key=[manifest['signature'],stamp]
    sidecar=directory/'blood-pool-reference.json'
    if not force and old.get('version')==VERSION and sidecar.is_file():
        saved=json.loads(sidecar.read_text())
        if saved.get('sourceKey')==source_key or (stat is None and saved.get('sourceKey',[None])[0]==manifest['signature']):return old
    reference={'available':False,'version':VERSION,'reason':'Aorta source mask unavailable.'}
    if stat:
        try:
            aorta,affine=image(source)
            geometry=manifest['geometry']
            if list(aorta.shape)!=geometry['shape'] or not np.allclose(affine,geometry['affineLPS'],atol=1e-5):
                raise ValueError('Aorta mask does not align with native CCTA.')
            ct=np.load(directory/'axial.ct.npy',mmap_mode='r')
            reference=sample_blood_pool(ct,np.asarray(aorta.dataobj)>0,np.linalg.norm(affine[:3,:3],axis=0))
            current=source.stat()
            if [current.st_size,current.st_mtime_ns]!=stamp:raise ValueError('Aorta mask changed during reference sampling.')
        except ValueError as error:reference={'available':False,'version':VERSION,'reason':str(error)}
    # Publish only statistics/ROI coordinates. Source paths stay out of the API.
    sidecar.write_text(json.dumps({'sourceKey':source_key,'reference':reference}))
    manifest['bloodPoolReference']=reference
    temporary=directory/'manifest.blood-pool.tmp';temporary.write_text(json.dumps(manifest));os.replace(temporary,path)
    return reference


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--case',required=True);parser.add_argument('--force',action='store_true');args=parser.parse_args()
    result=prepare_reference(args.case,args.force)
    print(json.dumps({key:value for key,value in result.items() if key!='rois'},indent=2))
