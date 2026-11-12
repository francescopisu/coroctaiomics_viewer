"""Read-only vessel-specific map discovery and CPE-clipped display derivatives."""
import hashlib
from pathlib import Path
import numpy as np
from .data import image
from .display import display_mask

VESSELS=('LAD','LCx','RCA')

def discover_maps(root):
    result={v:[] for v in VESSELS}
    if not root:return result
    root=Path(root).expanduser()
    if not root.is_dir():raise FileNotFoundError(f'Radiomic feature-map folder not found: {root}')
    folders={p.name.casefold():p for p in root.iterdir() if p.is_dir()}
    for vessel in VESSELS:
        aliases=('lad','lm-lad') if vessel=='LAD' else (vessel.casefold(),)
        matches=[folders[a] for a in aliases if a in folders]
        if len(matches)>1:raise ValueError(f'Ambiguous feature-map folders for {vessel}')
        if not matches:continue
        for path in sorted(matches[0].glob('*.nii.gz')):
            if path.name.startswith('._'):continue
            name=path.name[:-7];identifier=vessel+'-'+hashlib.sha256(name.encode()).hexdigest()[:16]
            result[vessel].append({'id':identifier,'name':name,'path':str(path)})
    if not any(result.values()):raise ValueError('No vessel-specific .nii.gz feature maps found')
    return result

def clipped_values(values,cpe):
    """Zero is valid; only CPE membership and finiteness define support."""
    valid=cpe&np.isfinite(values)
    if not valid.any():raise ValueError('Feature has no finite values within its CPE')
    v=values[valid];minimum,maximum=float(v.min()),float(v.max());limit=max(abs(minimum),abs(maximum)) or 1.
    out=np.where(valid,values,0).astype('<f4')
    if not np.isfinite(out).all():raise ValueError('Feature values cannot be represented as Float32 display data')
    return out,valid.astype('u1'),{'minimum':minimum,'maximum':maximum,'limit':limit,
        'balanced':np.percentile(v,[2,50,98]).tolist(),
        'validVoxels':int(valid.sum()),'zeroVoxels':int(((values==0)&valid).sum()),
        'nonFiniteCpeVoxels':int((cpe&~np.isfinite(values)).sum()),
        'nonzeroOutsideCpeInCrop':int((~cpe&np.isfinite(values)&(values!=0)).sum())}

def prepare_features(directory,conf,paths,geometry,assets,prefix):
    result={v:[] for v in VESSELS};shape=tuple(geometry['shape']);affine=np.array(geometry['affineLPS'])
    for vessel,entries in conf.get('featureFiles',{}).items():
        if not entries:continue
        mask_img,mask_affine=image(paths[f'cpe_{vessel}']);mask=np.asarray(mask_img.dataobj)>0
        if mask.shape!=shape or not np.allclose(mask_affine,affine):raise ValueError('CPE/CT feature grid mismatch')
        points=np.argwhere(mask);lo=np.maximum(points.min(0)-5,0);hi=np.minimum(points.max(0)+6,shape)
        slices=tuple(slice(a,b) for a,b in zip(lo,hi));cpe=mask[slices]
        origin=affine[:3,:3]@lo+affine[:3,3];spacing=np.linalg.norm(affine[:3,:3],axis=0)
        mask_name=f'feature-{vessel}.cpe.bin';cpe.astype('u1').ravel(order='F').tofile(directory/mask_name);assets.append(mask_name)
        display_name=f'feature-{vessel}.cpe-display.bin';display_mask(cpe,spacing).ravel(order='F').tofile(directory/display_name);assets.append(display_name)
        for entry in entries:
            source,source_affine=image(paths['feature_'+entry['id']])
            if source.shape!=shape or not np.allclose(source_affine,affine,atol=1e-5):
                raise ValueError(f'{vessel}/{entry["name"]}: feature grid/affine differs from CT; explicit registration/resampling is required')
            display,support,stats=clipped_values(np.asarray(source.dataobj[slices]),cpe)
            value_name=f'feature-{entry["id"]}.values.bin';support_name=f'feature-{entry["id"]}.valid.bin'
            display.ravel(order='F').tofile(directory/value_name);support.ravel(order='F').tofile(directory/support_name);assets.extend([value_name,support_name])
            result[vessel].append({'id':entry['id'],'name':entry['name'],'vessel':vessel,**stats,
                'dimensions':(hi-lo).tolist(),'startIJK':lo.tolist(),'origin':origin.tolist(),'spacing':spacing.tolist(),
                'direction':(affine[:3,:3]/spacing).ravel(order='F').tolist(),
                'affineLPS':np.column_stack([affine[:3,:3],origin]).tolist()+[[0.,0.,0.,1.]],
                'values':prefix+value_name,'valid':prefix+support_name,'cpe':prefix+mask_name,'cpeDisplay':prefix+display_name,
                'axial':f'/api/cases/{conf["patientId"]}/features/{entry["id"]}/axial'})
            print(f'Prepared {vessel}/{entry["name"]}: [{stats["minimum"]:.5g}, {stats["maximum"]:.5g}]',flush=True)
    return result
