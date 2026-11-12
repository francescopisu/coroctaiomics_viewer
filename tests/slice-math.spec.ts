import {test,expect} from '@playwright/test';
import {cameraBasis,planeBasis,cubeFaces,directionLabel} from '../src/orientation';
import {lumenReference} from '../src/diameter';
import {navigateAxial} from '../src/sliceNavigation';
import {axialIndex} from '../src/slices';
import {type Case,type Controls} from '../src/types';

test('orientation faces agree with LPS camera and image axes',()=>{
  expect(cubeFaces(cameraBasis([0,-10,0],[0,0,0],[0,0,1]),68).map(f=>f.label)).toEqual(['A']);
  expect(cubeFaces(cameraBasis([10,0,0],[0,0,0],[0,0,1]),68).map(f=>f.label)).toEqual(['L']);
  expect(cubeFaces(planeBasis([1,0,0],[0,1,0]),56).map(f=>f.label)).toEqual(['I']);
  expect(cubeFaces(cameraBasis([10,-10,10],[0,0,0],[0,0,1]),68).map(f=>f.label).sort()).toEqual(['A','L','S']);
  expect(directionLabel([0,-1,0])).toBe('A');expect(directionLabel([.8,0,.6])).toBe('LS');
});

test('lumen diameter uses only central unsmoothed component and rejects clipped sections',()=>{
  const n=101,res=.1,mask=new Uint8Array(n*n);let count=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(((x-50)*res/2)**2+((y-50)*res/1)**2<=1){mask[x+n*y]=1;count++;}
  // Disconnected neighbouring vessel must not affect the reference.
  for(let y=2;y<12;y++)for(let x=2;x<12;x++)mask[x+y*n]=1;
  const result=lumenReference(mask,n,n,res)!;
  expect(result.areaMm2).toBeCloseTo(count*res*res);expect(result.diameterMm).toBeCloseTo(2*Math.sqrt(2),1);expect(result.clipped).toBe(false);
  expect(lumenReference(new Uint8Array(n*n),n,n,res)).toBeNull();
  expect(lumenReference(new Uint8Array(n*n).fill(1),n,n,res)).toMatchObject({diameterMm:null,clipped:true});
  const far=new Uint8Array(n*n);far[0]=1;expect(lumenReference(far,n,n,res)).toBeNull();
});

test('native axial steps use affine geometry, clamp bounds and preserve explicit slice override',()=>{
  // Oblique/permuted affine: native k advances physical x by 0.3 mm.
  const data={geometry:{shape:[10,10,20],affineLPS:[[0,0,.3,10],[.5,0,0,20],[0,.5,0,30],[0,0,0,1]]},vessels:{LAD:{points:[[10,21,32],[10.6,21,32],[11.5,21,32]]}}} as unknown as Case;
  const controls={vessel:'LAD',index:1} as Controls;
  expect(axialIndex(data,controls)).toBe(2);const next=navigateAxial(data,controls,3);
  expect(next.axialSlice).toBe(3);expect(axialIndex(data,next)).toBe(3);expect(next.index).toBe(1);
  expect(navigateAxial(data,next,3)).toBe(next);
  expect(navigateAxial(data,controls,100)).toMatchObject({axialSlice:19,index:2});
  expect(navigateAxial(data,controls,-100)).toMatchObject({axialSlice:0,index:0});
});
