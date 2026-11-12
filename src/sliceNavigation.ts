import {worldIndex,axialIndex} from './slices';
import {type Case,type Controls,type Vec3} from './types';

export const clampSlice=(index:number,count:number)=>Math.max(0,Math.min(count-1,Math.round(index)));
export function nearestCentreline(data:Case,vessel:Controls['vessel'],point:Vec3){
  const points=data.vessels[vessel].points;let best=0,distance=Infinity;
  points.forEach((p,i)=>{const d=p.reduce((s,x,j)=>s+(x-point[j])**2,0);if(d<distance){distance=d;best=i;}});return best;
}
export function navigateAxial(data:Case,c:Controls,index:number):Controls{
  const axialSlice=clampSlice(index,data.geometry.shape[2]);if(axialSlice===axialIndex(data,c))return c;
  const a=data.geometry.affineLPS,ijk=worldIndex(a,data.vessels[c.vessel].points[c.index]);
  const point=a.slice(0,3).map(row=>row[0]*ijk[0]+row[1]*ijk[1]+row[2]*axialSlice+row[3]) as Vec3;
  return {...c,axialSlice,index:nearestCentreline(data,c.vessel,point)};
}
