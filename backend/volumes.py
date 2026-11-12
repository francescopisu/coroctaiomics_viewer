"""Native-resolution, physical-coordinate crops for interactive GPU CPR."""
import numpy as np
from .data import image
from .display import display_mask

def prepare_axial_volume(directory, scalar_type, assets, prefix):
    """Export existing native arrays in x-fast order for resident browser slicing.

    This also upgrades an otherwise current cache without rereading source
    images or regenerating meshes. Integral HU are compacted losslessly.
    """
    import os
    descriptors = {'scalarType': scalar_type}
    for key, source_name, dtype in [('ct','axial.ct.npy','<i2' if scalar_type=='int16' else '<f4'),
                                     ('labels','axial.labels.npy','u1')]:
        source = np.load(directory/source_name,mmap_mode='r')
        name = f'axial.volume.{key}.bin'; temporary = directory/(name+'.tmp')
        try:
            with temporary.open('wb') as output:
                for k in range(0,source.shape[2],8):
                    original = source[:,:,k:k+8].transpose(2,1,0)
                    values = original.astype(dtype)
                    if key=='ct' and scalar_type=='int16' and not np.array_equal(values,original):
                        raise ValueError('Native CT cannot be compacted without changing HU')
                    output.write(values.tobytes())
            os.replace(temporary,directory/name)
        finally:
            temporary.unlink(missing_ok=True)
        descriptors[key] = prefix+name
        if name not in assets:assets.append(name)
    return descriptors

def crop_bounds(points, affine, shape, field_mm=25.):
    points = np.asarray(points)
    axis = points[-1]-points[0]; axis /= np.linalg.norm(axis)
    relative = points-points.mean(0)
    lateral = relative-np.outer(relative@axis, axis)
    # For every rotation, the stretched mapper samples P + (x + dot(C-P,D))*D.
    # Width is FOV + 2*max(abs(dot(P-C,D))). Bound the entire ribbon, not just P.
    margin = field_mm/2 + 2*np.linalg.norm(lateral, axis=1).max() + 2.
    inverse = np.linalg.inv(affine)
    ijk = points@inverse[:3,:3].T+inverse[:3,3]
    voxel_margin = np.linalg.norm(inverse[:3,:3], axis=1)*margin
    lo = np.maximum(0, np.floor(ijk.min(0)-voxel_margin)).astype(int)
    hi = np.minimum(shape, np.ceil(ijk.max(0)+voxel_margin)+1).astype(int)
    return lo, hi

def prepare_volumes(directory, frames, paths, ct, affine, assets, prefix):
    np.save(directory/'axial.ct.npy', ct)
    # Preserve every HU exactly while avoiding a Float32 transfer when source HU are integral.
    integer_hu = ct.min() >= -32768 and ct.max() <= 32767 and np.equal(ct,np.rint(ct)).all()
    ct_dtype = '<i2' if integer_hu else '<f4'
    bits = np.zeros(ct.shape, dtype=np.uint8)
    descriptors = {}
    for vessel, f in frames.items():
        lo, hi = crop_bounds(f['points'], affine, ct.shape)
        slices = tuple(slice(a,b) for a,b in zip(lo,hi))
        origin = affine[:3,:3]@lo+affine[:3,3]
        spacing = np.linalg.norm(affine[:3,:3], axis=0)
        name = f'{vessel}.volume.ct.bin'
        np.asarray(ct[slices], dtype=ct_dtype).ravel(order='F').tofile(directory/name)
        assets.append(name)
        descriptors[vessel] = {'dimensions': (hi-lo).tolist(), 'spacing': spacing.tolist(),
            'origin': origin.tolist(), 'direction': (affine[:3,:3]/spacing).ravel(order='F').tolist(),
            'affineLPS': np.column_stack([affine[:3,:3],origin]).tolist()+[[0.,0.,0.,1.]],
            'ct':prefix+name, 'scalarType':'int16' if integer_hu else 'float32'}
    for key, value in [('lumen_merged',1), ('cpe_LAD',2), ('cpe_LCx',4), ('cpe_RCA',8)]:
        img, mask_affine = image(paths[key])
        if img.shape != ct.shape or not np.allclose(mask_affine,affine):
            raise ValueError(f'{key}: native volume grids differ')
        mask = (np.asarray(img.dataobj)>0).astype('u1')
        bits |= mask*value
        for vessel,f in frames.items():
            if key not in ['lumen_merged',f'cpe_{vessel}']: continue
            lo,hi = crop_bounds(f['points'],affine,ct.shape)
            slices=tuple(slice(a,b) for a,b in zip(lo,hi))
            name = f'{vessel}.volume.{"lumen" if key=="lumen_merged" else "cpe"}.bin'
            mask[tuple(slice(a,b) for a,b in zip(lo,hi))].ravel(order='F').tofile(directory/name)
            assets.append(name)
            descriptors[vessel]['lumen' if key=='lumen_merged' else 'cpe'] = prefix+name
            if key.startswith('cpe_'):
                name=f'{vessel}.volume.cpe-display.bin'
                display_mask(mask[slices],np.linalg.norm(affine[:3,:3],axis=0)).ravel(order='F').tofile(directory/name)
                assets.append(name);descriptors[vessel]['cpeDisplay']=prefix+name
    np.save(directory/'axial.labels.npy',bits)
    return descriptors
