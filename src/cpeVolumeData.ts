import type {AxialVolume} from './axialVolume';
import type {BloodPoolReference,TissueReference,HuReference,Case,ImageGeometry,Vec3} from './types';

export interface CpeVolumeData {info:ImageGeometry;values:Float32Array;membership:Uint8Array;indices:Uint32Array;hu:Float32Array;start:Vec3;count:number;activeBits:number}
const yieldFrame=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Case closed','AbortError');};

/** Native HU and a separate binary support channel: no outside-mask HU sentinel.
 * Scan/pack in slice batches so an initial mode switch can be cancelled.
 */
export async function packCpeVolume(stack:AxialVolume,geometry:Case['geometry'],signal:AbortSignal):Promise<CpeVolumeData>{
  const [sx,sy,sz]=stack.shape,lo=[sx,sy,sz],hi=[-1,-1,-1];let count=0;
  for(let k=0;k<sz;k++){
    for(let j=0;j<sy;j++)for(let i=0;i<sx;i++){
      const p=i+sx*(j+sy*k),bits=stack.labels[p];
      if(!(bits&14)||(bits&1)||!Number.isFinite(stack.ct[p]))continue;
      lo[0]=Math.min(lo[0],i);lo[1]=Math.min(lo[1],j);lo[2]=Math.min(lo[2],k);
      hi[0]=Math.max(hi[0],i);hi[1]=Math.max(hi[1],j);hi[2]=Math.max(hi[2],k);count++;
    }
    if(k%16===15){check(signal);await yieldFrame();}
  }
  check(signal);if(!count)throw new Error('No finite CCTA voxels inside the saved CPE masks.');
  const start=lo.map(n=>Math.max(0,n-2)) as Vec3,dimensions=hi.map((n,i)=>Math.min(stack.shape[i]-1,n+2)-start[i]+1) as Vec3;
  const [nx,ny,nz]=dimensions,values=new Float32Array(nx*ny*nz*2),membership=new Uint8Array(count),indices=new Uint32Array(count),sourceHu=new Float32Array(count);let used=0;
  for(let k=0;k<nz;k++){
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const src=i+start[0]+sx*(j+start[1]+sy*(k+start[2])),dst=i+nx*(j+ny*k),hu=stack.ct[src];
      // Nonfinite CT has zero support and cannot contribute to color/lighting.
      const bits=Number.isFinite(hu)&&!(stack.labels[src]&1)?stack.labels[src]&14:0;
      if(bits){values[2*dst]=hu;values[2*dst+1]=1;membership[used]=bits;indices[used]=dst;sourceHu[used]=hu;used++;}
    }
    if(k%16===15){check(signal);await yieldFrame();}
  }
  check(signal);if(used!==count)throw new Error('CPE support changed while preparing the volume.');
  const a=geometry.affineLPS,spacing=a.slice(0,3).map((_,i)=>Math.hypot(a[0][i],a[1][i],a[2][i])) as Vec3;
  const origin=a.slice(0,3).map(row=>row[3]+start.reduce((sum,n,i)=>sum+row[i]*n,0)) as Vec3;
  const affineLPS=a.map(row=>row.slice());origin.forEach((n,i)=>affineLPS[i][3]=n);
  return {info:{dimensions,spacing,origin,affineLPS,direction:[0,1,2].flatMap(i=>a.slice(0,3).map(row=>row[i]/spacing[i]))},
    values,membership,indices,hu:sourceHu,start,count,activeBits:14};
}

export function setCpeMembership(data:CpeVolumeData,bits:number){
  if(data.activeBits===bits)return false;
  for(let i=0;i<data.membership.length;i++){
    const visible=!!(data.membership[i]&bits),offset=data.indices[i]*2;
    data.values[offset]=visible?data.hu[i]:0;data.values[offset+1]=visible?1:0;
  }
  data.activeBits=bits;return true;
}

export const volumePresets={balanced:'Balanced',fat:'Fat emphasis',dense:'Dense emphasis'} as const;
export type VolumePreset=keyof typeof volumePresets;
export type AttenuationBand='fat'|'low'|'intermediate'|'high';
export const attenuationBands:{id:AttenuationBand;label:string;range:string;color:string}[]=[
  {id:'fat',label:'Fat range',range:'−190 to −30 HU',color:'#dcb872'},
  {id:'low',label:'Low HU',range:'−30 to 30 HU',color:'#b85b62'},
  {id:'intermediate',label:'Intermediate',range:'30 to 350 HU',color:'#bb9680'},
  {id:'high',label:'High HU',range:'≥350 HU',color:'#e4edf3'},
];
// Simplified teaching legend; rendering bands remain separate display controls.
export const attenuationLegend=[
  {...attenuationBands[0],label:'Fat',description:'Fat'},
  {...attenuationBands[1],label:'Soft tissue (coronary wall, non-calcified plaque, connective tissue)',description:'Coronary wall, non-calcified plaque and connective tissue'},
  {...attenuationBands[3],label:'Calcified plaque and other dense structures',description:'Calcified plaque and other dense structures'},
];
/** Inverse piecewise display calibration; source HU remain unchanged. */
export function calibratedHu(value:number,reference:TissueReference){
  const anchors=reference.anchors!;
  if(value<=anchors[0][0])return anchors[0][1];
  for(let i=1;i<anchors.length;i++)if(value<=anchors[i][0]){
    const [x0,y0]=anchors[i-1],[x1,y1]=anchors[i];return y0+(y1-y0)*(value-x0)/(x1-x0);
  }
  return anchors.at(-1)![1];
}
export function attenuationRange(id:AttenuationBand,reference:TissueReference){
  const threshold=calibratedHu(350,reference),lower=Math.round(calibratedHu(-30,reference)),soft=Math.round(calibratedHu(30,reference));
  return id==='high'?`≥${Math.round(threshold)} HU`:id==='intermediate'?`${soft} to ${Math.round(threshold)} HU`:id==='low'?`${lower} to ${soft} HU`:attenuationBands[0].range;
}
export function volumeColorNodes(reference:TissueReference):number[][]{
  const t=350;
  return [[-1024,.32,.22,.12],[-190,.68,.44,.16],[-140,.86,.72,.45],[-35,.91,.75,.48],
    [-25,.68,.22,.28],[25,.78,.35,.39],[40,.61,.38,.28],[180,.78,.63,.51],
    [t-15,.8,.71,.61],[t+15,.82,.9,.96],[Math.max(700,t+100),.96,.97,1],[4096,1,1,1]]
    .map(([x,r,g,b])=>[calibratedHu(x,reference),r,g,b]);
}
function referenceAffinity(hu:number,reference:Partial<HuReference>|undefined){
  const {p01HU:lo,p10HU:a,p90HU:b,p99HU:hi}=reference??{};
  if(lo==null||a==null||b==null||hi==null||hu<=lo||hu>=hi)return 0;
  return Math.max(0,Math.min(1,(hu-lo)/Math.max(a-lo,1),(hi-hu)/Math.max(hi-b,1)));
}
export function contextAffinity(hu:number,myocardium:Partial<HuReference>|undefined,blood:Partial<HuReference>|undefined){
  return hu<=-30?0:Math.max(referenceAffinity(hu,myocardium),referenceAffinity(hu,blood));
}
export function volumeOpacityNodes(preset:VolumePreset,density:number,gain:Record<AttenuationBand,number>,reference:TissueReference,blood:BloodPoolReference,fade=.8):[number,number][]{
  const scale=preset==='fat'?[2,.65,.45,.7]:preset==='dense'?[.18,.8,1.2,1.5]:[1,1,1,1];
  const [fat,low,mid,high]=attenuationBands.map((b,i)=>Math.max(0,gain[b.id])*scale[i]*density),t=350;
  const base:[number,number][]=[[-1024,0],[-200,0],[-190,.012*fat],[-165,.07*fat],[-45,.07*fat],[-30,.025*fat],
    [-25,.14*low],[25,.14*low],[35,.18*mid],[250,.18*mid],[t-10,.24*mid],
    [t+10,.4*high],[Math.max(650,t+100),.65*high],[Math.max(1500,t+200),.85*high],[4096,.9*high]]
    .map(([x,y])=>[calibratedHu(x,reference),Math.min(.98,Math.max(0,y))]);
  // Fine HU sampling keeps reference-dependent fades continuous on the GPU.
  const xs=[...new Set([...base.map(([x])=>x),...Array.from({length:2561},(_,i)=>-1024+2*i)])].sort((a,b)=>a-b);
  let upper=1;
  return xs.map(x=>{
    while(upper<base.length-1&&base[upper][0]<x)upper++;
    const [lo,lv]=base[upper-1],[hi,hv]=base[upper];const opacity=lv+(hv-lv)*(x-lo)/(hi-lo);
    return [x,opacity*(1-Math.max(0,Math.min(1,fade))*contextAffinity(x,reference.myocardium,blood))];
  });
}
