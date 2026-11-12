import {type Vec3} from './types';
export function edgeCoverage(field:number){const t=Math.max(0,Math.min(1,(field-.45)/.1));return t*t*(3-2*t);}
/** Interpolate scalar values before mapping colors; missing neighbours carry no weight. */
export function sampleFeature(values:Float32Array,valid:Uint8Array,display:Uint8Array,cpe:Uint8Array,dimensions:Vec3,ijk:Vec3,smooth=true){
  const [nx,ny,nz]=dimensions,[x,y,z]=ijk;
  if(x<0||y<0||z<0||x>nx-1||y>ny-1||z>nz-1)return null;
  const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z),dx=x-i,dy=y-j,dz=z-k;let sum=0,weight=0,field=0;
  for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++){
    const index=Math.min(i+a,nx-1)+nx*(Math.min(j+b,ny-1)+ny*Math.min(k+c,nz-1)),w=(a?dx:1-dx)*(b?dy:1-dy)*(c?dz:1-dz);
    if(valid[index]&&Number.isFinite(values[index])){sum+=w*values[index];weight+=w;}field+=w*display[index]/255;
  }
  const nearest=Math.round(x)+nx*(Math.round(y)+ny*Math.round(z)),coverage=smooth?edgeCoverage(field):cpe[nearest];
  return weight>1e-6&&coverage>0?{value:sum/weight,coverage}:null;
}
