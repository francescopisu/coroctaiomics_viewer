import {quat} from 'gl-matrix';
import {type Line} from './types';

/** Equivalent q/-q rotations must use one continuous hemisphere for GPU SLERP. */
export function orientationQuaternions(line:Pick<Line,'u'|'v'|'tangents'>):Float32Array {
  const result=new Float32Array(line.u.length*4),previous=quat.create(),current=quat.create();
  for(let i=0;i<line.u.length;i++){
    quat.fromMat3(current,new Float32Array([...line.u[i],...line.v[i],...line.tangents[i]]));
    quat.normalize(current,current);
    if(i>0&&quat.dot(previous,current)<0)quat.scale(current,current,-1);
    result.set(current,i*4);quat.copy(previous,current);
  }
  return result;
}
