import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {quat,vec3} from 'gl-matrix';
import {orientationQuaternions} from '../src/orientations';
import {type Case,type Vec3} from '../src/types';

const data=JSON.parse(readFileSync('cache/1/manifest.json','utf8')) as Case;
test('continuous GPU quaternions preserve each native transported frame',()=>{
  for(const f of Object.values(data.vessels)){
    const values=orientationQuaternions(f);
    for(let i=0;i<f.u.length;i++){
      const q=values.subarray(i*4,i*4+4);expect(Math.abs(quat.length(q)-1)).toBeLessThan(1e-6);
      for(const [axis,expected] of [[[1,0,0],f.u[i]],[[0,1,0],f.v[i]],[[0,0,1],f.tangents[i]]] as [Vec3,Vec3][]){
        const actual=vec3.transformQuat(vec3.create(),axis,q);expect(vec3.distance(actual,expected)).toBeLessThan(1e-6);
      }
      if(i)expect(quat.dot(values.subarray((i-1)*4,i*4),q)).toBeGreaterThan(0);
    }
  }
});
test('known LCx/RCA seams interpolate the short rotation instead of the sign-flip path',()=>{
  for(const name of ['LCx','RCA'] as const){
    const f=data.vessels[name],continuous=orientationQuaternions(f);
    const raw=f.u.map((_,i)=>quat.normalize(quat.create(),quat.fromMat3(quat.create(),new Float32Array([...f.u[i],...f.v[i],...f.tangents[i]]))));
    let flips=0;
    for(let i=1;i<raw.length;i++){
      if(quat.dot(raw[i-1],raw[i])>=0)continue;flips++;
      const a=continuous.subarray((i-1)*4,i*4),b=continuous.subarray(i*4,i*4+4);
      // The GLSL midpoint is the normalized sum in both its LERP and SLERP branches.
      // Compare it to an independent shortest-arc reference from gl-matrix.
      const reference=quat.slerp(quat.create(),raw[i-1],raw[i],.5),midpoint=quat.normalize(quat.create(),quat.lerp(quat.create(),a,b,.5));
      expect(Math.abs(quat.dot(reference,midpoint))).toBeGreaterThan(.999999);
      const wrong=quat.normalize(quat.create(),quat.lerp(quat.create(),raw[i-1],raw[i],.5));
      expect(Math.abs(quat.dot(reference,wrong))).toBeLessThan(.001);
    }
    expect(flips).toBeGreaterThan(0);
  }
});
