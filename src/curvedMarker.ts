import {type Line,type Vec3} from './types';

export type Point2=[number,number];
export interface CprMarker {center:Point2;line:Point2[]}

/** Preserve orientation while giving the UI indicator a constant CSS length. */
export function screenSectionMarker(center:Point2,line:Point2[],size:Point2,length:number):Point2[]{
  const dx=(line[1][0]-line[0][0])*size[0]/100,dy=(line[1][1]-line[0][1])*size[1]/100,magnitude=Math.hypot(dx,dy);
  const unit=magnitude>1e-12?[dx/magnitude,dy/magnitude]:[1,0];
  return [-1,1].map(sign=>[center[0]+sign*length/2*unit[0]/size[0]*100,center[1]+sign*length/2*unit[1]/size[1]*100]);
}
const dot=(a:Vec3,b:Vec3)=>a.reduce((s,x,i)=>s+x*b[i],0);
const sub=(a:Vec3,b:Vec3)=>a.map((x,i)=>x-b[i]) as Vec3;
const cross=(a:Vec3,b:Vec3)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]] as Vec3;
const unit=(a:Vec3)=>{const length=Math.hypot(...a);return a.map(x=>x/length) as Vec3;};

/** Straight section marker in the tangent plane of the CPR at the selected point.
 * Its physical direction lies in the orthogonal U/V frame; the model direction
 * includes the longitudinal display scale. Distant bends never deform the line.
 */
export function curvedSectionMarker(line:Pick<Line,'points'|'u'|'v'>,index:number,direction:Vec3,center:Vec3,width:number,distances:number[],displayHeight:number,fieldMm:number):Vec3[]{
  const origin=line.points[index],u=line.u[index],v=line.v[index];
  const normal=unit(cross(u,v)),d=unit(direction),a=dot(normal,d),b=Math.hypot(...cross(normal,d));
  const height=distances.at(-1)!,scale=displayHeight/height;
  const anchor=[width/2+dot(sub(origin,center),d),(height-distances[index])*scale,0] as Vec3;
  // B=(N-aD)/b is the local longitudinal direction of the stretched ribbon.
  // W=bD-aB lies in the orthogonal plane. Its model coordinates are (b,a*scale).
  const physical=b>1e-8?unit(d.map((x,i)=>x-a*normal[i]) as Vec3):u;
  const extent=Math.min(...[dot(physical,u),dot(physical,v)].map(x=>Math.abs(x)>1e-12?fieldMm/2/Math.abs(x):Infinity));
  const delta=[b,a*scale,0] as Vec3;let lo=-extent,hi=extent;
  for(const [axis,limit] of [[0,width],[1,displayHeight]])if(Math.abs(delta[axis])>1e-12){
    const t0=-anchor[axis]/delta[axis],t1=(limit-anchor[axis])/delta[axis];
    lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));
  }
  return [lo,hi].map(t=>anchor.map((x,i)=>x+t*delta[i]) as Vec3);
}
