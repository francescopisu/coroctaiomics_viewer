import {test,expect} from '@playwright/test';
import {SharedCt,Volume} from '../src/volume';
import {type Vec3,type VolumeInfo} from '../src/types';

test('all crops share native CT while preserving oblique sampling and resource ownership',()=>{
  const shape:Vec3=[9,8,7],a=[[0,-.6,0,12],[.4,0,0,-25],[0,0,.3,1500],[0,0,0,1]],values=new Float32Array(shape[0]*shape[1]*shape[2]);
  for(let k=0;k<shape[2];k++)for(let j=0;j<shape[1];j++)for(let i=0;i<shape[0];i++)values[i+shape[0]*(j+shape[1]*k)]=2*i+3*j+5*k+.125;
  const shared=new SharedCt({shape,affineLPS:a},values),volumes:Volume[]=[];
  for(const offset of [[1,2,1],[3,1,2]] as Vec3[]){
    const dimensions:Vec3=[4,4,4],origin=a.slice(0,3).map(row=>row[3]+row[0]*offset[0]+row[1]*offset[1]+row[2]*offset[2]) as Vec3;
    const info={...shared.info,dimensions,origin,affineLPS:a.slice(0,3).map((row,i)=>[...row.slice(0,3),origin[i]]).concat([[0,0,0,1]])} as VolumeInfo;
    const volume=new Volume(info,values,new Uint8Array(64),new Uint8Array(64),undefined,shared);volumes.push(volume);
    expect(volume.images[0]).toBe(shared.image);expect(volume.ct.buffer).toBe(values.buffer);
    const ijk:Vec3=[1.25,2.1,.7],expected=2*(offset[0]+ijk[0])+3*(offset[1]+ijk[1])+5*(offset[2]+ijk[2])+.125;
    expect(volume.sampleIndex(ijk,'ct')).toBeCloseTo(expected,6);
    const world=a.slice(0,3).map((row,j)=>origin[j]+row[0]*ijk[0]+row[1]*ijk[1]+row[2]*ijk[2]) as Vec3;
    expect(volume.sample(world,'ct')).toBeCloseTo(expected,5);expect(volume.sampleIndex([-1,0,0],'ct')).toBe(-1024);
  }
  volumes[0].dispose();expect(shared.image.isDeleted()).toBe(false);expect(volumes[1].sampleIndex([1,1,1],'ct')).toBeCloseTo(2*4+3*2+5*3+.125);
  volumes[1].dispose();expect(shared.image.isDeleted()).toBe(false);shared.dispose();expect(shared.image.isDeleted()).toBe(true);
});
