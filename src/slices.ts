import {rgba,type Case,type Controls,type Vec3} from './types';
import {type Volume} from './volume';
import {type FeatureVolume} from './featureVolume';
import {featureColor,featureScale,type FeatureScale} from './featureColors';
import {edgeCoverage} from './featureSampling';
export interface FeaturePlane {values:Float32Array;valid:Uint8Array;limit:number;balanced?:FeatureScale;coverage?:Float32Array;displayMask?:Uint8Array}
export interface Plane {ct:Float32Array|Int16Array;lumen:Uint8Array;cpe:Uint8Array;width:number;height:number;spacingMm?:number;lumenField?:Float32Array;cpeField?:Float32Array;feature?:FeaturePlane}
export function crossSection(data:Case,c:Pick<Controls,'vessel'|'index'|'smoothEdges'>,volume:Volume):Plane {
  const f=data.vessels[c.vessel],p=f.points[c.index],u=f.u[c.index],v=f.v[c.index];
  const fieldMm=data.sampling.widthPixels*data.sampling.resolutionMm;
  const n=Math.ceil(fieldMm/0.125),res=fieldMm/n,ct=new Float32Array(n*n),lumen=new Uint8Array(n*n),cpe=new Uint8Array(n*n),lumenField=new Float32Array(n*n),cpeField=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const q=p.map((a,i)=>a+(x-(n-1)/2)*res*u[i]+(y-(n-1)/2)*res*v[i]) as Vec3,index=y*n+x;
    const ijk=volume.index(q);
    ct[index]=volume.sampleIndex(ijk,'ct');lumen[index]=volume.sampleIndex(ijk,'lumen');cpe[index]=volume.sampleIndex(ijk,'cpe');
    // Separate display geometry; binary scientific label samples remain nearest-neighbour.
    lumenField[index]=volume.sampleIndex(ijk,'lumen',true);cpeField[index]=volume.sampleIndex(ijk,c.smoothEdges?'cpeDisplay':'cpe',true);
  }
  return {ct,lumen,cpe,width:n,height:n,spacingMm:res,lumenField,cpeField};
}
export function crossFeature(data:Case,c:Pick<Controls,'vessel'|'index'|'smoothEdges'>,plane:Plane,feature:FeatureVolume):FeaturePlane{
  const f=data.vessels[c.vessel],p=f.points[c.index],u=f.u[c.index],v=f.v[c.index],n=plane.width,res=plane.spacingMm!;
  const values=new Float32Array(n*n),valid=new Uint8Array(n*n),coverage=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const q=p.map((a,i)=>a+(x-(n-1)/2)*res*u[i]+(y-(n-1)/2)*res*v[i]) as Vec3,value=feature.sample(q,c.smoothEdges),index=y*n+x;
    if(value!==null){values[index]=value.value;coverage[index]=value.coverage;valid[index]=1;}
  }
  return {values,valid,coverage,limit:feature.info.limit,balanced:feature.info.balanced};
}
export function compositeFeature(pixels:Uint8ClampedArray,feature:FeaturePlane,opacity:number,mode:'raw'|'balanced'='raw'){
  const scale=featureScale(feature,mode);
  for(let i=0;i<feature.values.length;i++)if(feature.valid[i]){const rgb=featureColor(feature.values[i],scale),a=opacity*(feature.coverage?.[i]??1);for(let j=0;j<3;j++)pixels[i*4+j]=pixels[i*4+j]*(1-a)+rgb[j]*a;}
  return pixels;
}
export function pixels(plane:Plane,c:Controls){
  const {ct,lumen,cpe,width:n}=plane,result=rgba(ct,0,ct.length,c),rgb=[1,3,5].map(i=>parseInt(c.colors[c.vessel].slice(i,i+2),16));
  if(plane.feature)result.set(compositeFeature(new Uint8ClampedArray(result),plane.feature,c.featureOpacity,c.featureScale));
  const edge=(mask:Uint8Array,i:number)=>i%n===0||i%n===n-1||i<n||i>=mask.length-n||[i-1,i+1,i-n,i+n].some(j=>!mask[j]);
  for(let i=0;i<ct.length;i++){
    if(c.cpeVisible&&c.cpe[c.vessel]&&cpe[i]){const a=edge(cpe,i)?0.9:plane.feature?0:c.cpeOpacity;for(let j=0;j<3;j++)result[i*4+j]=result[i*4+j]*(1-a)+rgb[j]*a;}
    if(c.lumen&&lumen[i]){const a=edge(lumen,i)?c.lumenOpacity:0.1*c.lumenOpacity;for(let j=0;j<3;j++)result[i*4+j]=result[i*4+j]*(1-a)+255*a;}
  }
  return new Uint8ClampedArray(result);
}
/** Native axial CT enlarged first; feature scalars are bilinearly sampled before coloring. */
export function axialFeaturePixels(plane:Plane,c:Controls,width:number){
  const height=Math.round(width*plane.height/plane.width),out=new Uint8ClampedArray(width*height*4),feature=plane.feature!,scale=featureScale(feature,c.featureScale),n=plane.width;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.max(0,Math.min(n-1,(x+.5)*n/width-.5)),sy=Math.max(0,Math.min(plane.height-1,(y+.5)*plane.height/height-.5)),ix=Math.floor(sx),iy=Math.floor(sy),dx=sx-ix,dy=sy-iy;
    let ct=0,value=0,support=0,field=0;
    for(let a=0;a<2;a++)for(let b=0;b<2;b++){
      const i=Math.min(ix+a,n-1)+n*Math.min(iy+b,plane.height-1),w=(a?dx:1-dx)*(b?dy:1-dy);ct+=plane.ct[i]*w;
      if(feature.valid[i]){value+=w*feature.values[i];support+=w;}field+=w*(feature.displayMask?.[i]??feature.valid[i]*255)/255;
    }
    const offset=(x+y*width)*4,gray=c.raw?Math.max(0,Math.min(255,(ct-c.level+c.width/2)/c.width*255)):12;
    out.set([gray,gray,gray,255],offset);
    if(support>1e-6){const a=c.featureOpacity*(c.smoothEdges?edgeCoverage(field):plane.cpe[Math.round(sx)+n*Math.round(sy)]),rgb=featureColor(value/support,scale);for(let j=0;j<3;j++)out[offset+j]=gray*(1-a)+rgb[j]*a;}
  }
  return out;
}
export function axialIndex(data:Case,c:Controls){return Math.max(0,Math.min(data.geometry.shape[2]-1,c.axialSlice??Math.round(worldIndex(data.geometry.affineLPS,data.vessels[c.vessel].points[c.index])[2])));}
export function worldIndex(a:number[][],p:Vec3):Vec3{
  const x=p[0]-a[0][3],y=p[1]-a[1][3],z=p[2]-a[2][3];
  const [b,c,d]=a[0],[e,f,g]=a[1],[h,i,j]=a[2],det=b*(f*j-g*i)-c*(e*j-g*h)+d*(e*i-f*h);
  return [((f*j-g*i)*x+(d*i-c*j)*y+(c*g-d*f)*z)/det,((g*h-e*j)*x+(b*j-d*h)*y+(d*e-b*g)*z)/det,((e*i-f*h)*x+(c*h-b*i)*y+(b*f-c*e)*z)/det];
}
