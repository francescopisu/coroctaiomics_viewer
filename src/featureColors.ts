import {cohortPosition,type CohortReference} from './cohortReference';
export const FEATURE_STOPS=['#3b9b38','#4daf4a','#ffffff','#f781bf','#e66aac'];
export const FEATURE_GRADIENT=`linear-gradient(to right,${FEATURE_STOPS.join(',')})`;
const stops=FEATURE_STOPS.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
export const FEATURE_PALETTE=Array.from({length:256},(_,i)=>{
  const x=i/255*4,j=Math.min(3,Math.floor(x)),t=x-j;
  return stops[j].map((a,k)=>Math.round(a*(1-t)+stops[j+1][k]*t));
});
export type FeatureScale=[number,number,number];
export type FeatureMode='cohort'|'raw'|'balanced';
export type ColorScale=FeatureScale|CohortReference;
export function featureScale(info:{limit:number;balanced?:FeatureScale;cohortReference?:CohortReference},mode:FeatureMode):ColorScale{
  if(mode==='cohort'&&info.cohortReference)return info.cohortReference;
  return mode!=='raw'&&info.balanced?info.balanced:[-info.limit,0,info.limit];
}
export function featurePosition(value:number,scale:ColorScale):number{
  if(!Array.isArray(scale))return cohortPosition(value,scale);
  const [lo,mid,hi]=scale;if(lo===hi||value===mid)return .5;
  return Math.max(0,Math.min(1,value<mid?.5*(value-lo)/Math.max(mid-lo,1e-30):.5+.5*(value-mid)/Math.max(hi-mid,1e-30)));
}
export function featureColor(value:number,scale:number|ColorScale):number[]{
  const t=featurePosition(value,typeof scale==='number'?[-scale,0,scale]:scale);
  if(t===.5)return [255,255,255];
  return FEATURE_PALETTE[Math.min(255,Math.floor(t*256))];
}
export function featurePixels(values:Float32Array,valid:Uint8Array,limit:number|ColorScale,opacity:number){
  const rgba=new Uint8ClampedArray(values.length*4),alpha=Math.round(Math.max(0,Math.min(1,opacity))*255);
  for(let i=0;i<values.length;i++)if(valid[i]&&Number.isFinite(values[i])){rgba.set(featureColor(values[i],limit),i*4);rgba[i*4+3]=alpha;}
  return rgba;
}
export const featureNumber=(value:number)=>value===0?'0':Math.abs(value)>=1e4||Math.abs(value)<.001?value.toExponential(2):Number(value.toPrecision(3)).toString();
