import {cohortPosition,type CohortReference} from './cohortReference';
// Matplotlib's standard Jet channel breakpoints, sampled into a shared LUT.
const jetChannels:number[][][]=[
  [[0,0],[.35,0],[.66,1],[.89,1],[1,.5]],
  [[0,0],[.125,0],[.375,1],[.64,1],[.91,0],[1,0]],
  [[0,.5],[.11,1],[.34,1],[.65,0],[1,0]],
];
export const FEATURE_PALETTE=Array.from({length:256},(_,i)=>jetChannels.map(channel=>{
  const t=i/255,j=channel.findIndex(([x])=>x>=t);
  if(j===0)return Math.round(channel[0][1]*255);
  const [x0,y0]=channel[j-1],[x1,y1]=channel[j];
  return Math.round((y0+(y1-y0)*(t-x0)/(x1-x0))*255);
}));
export const FEATURE_STOPS=FEATURE_PALETTE.map(rgb=>'#'+rgb.map(channel=>channel.toString(16).padStart(2,'0')).join(''));
export const FEATURE_GRADIENT=`linear-gradient(to right,${FEATURE_STOPS.join(',')})`;
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
  return FEATURE_PALETTE[Math.min(255,Math.floor(t*256))];
}
export function featurePixels(values:Float32Array,valid:Uint8Array,limit:number|ColorScale,opacity:number){
  const rgba=new Uint8ClampedArray(values.length*4),alpha=Math.round(Math.max(0,Math.min(1,opacity))*255);
  for(let i=0;i<values.length;i++)if(valid[i]&&Number.isFinite(values[i])){rgba.set(featureColor(values[i],limit),i*4);rgba[i*4+3]=alpha;}
  return rgba;
}
export const featureNumber=(value:number)=>value===0?'0':Math.abs(value)>=1e4||Math.abs(value)<.001?value.toExponential(2):Number(value.toPrecision(3)).toString();
