import type {AxialVolume} from './axialVolume';
import type {Case,ImageGeometry,Vec3} from './types';

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
export function volumeOpacityNodes(preset:VolumePreset,density:number,gain:Record<AttenuationBand,number>):[number,number][]{
  const scale=preset==='fat'?[2,.65,.45,.7]:preset==='dense'?[.18,.8,1.2,1.5]:[1,1,1,1];
  const [fat,low,mid,high]=attenuationBands.map((b,i)=>Math.max(0,gain[b.id])*scale[i]*density);
  return [[-1024,0],[-200,0],[-190,.012*fat],[-165,.07*fat],[-45,.07*fat],[-30,.025*fat],
    [-25,.14*low],[25,.14*low],[35,.18*mid],[250,.18*mid],[340,.24*mid],
    [360,.4*high],[650,.65*high],[1500,.85*high],[4096,.9*high]].map(([x,y])=>[x,Math.min(.98,Math.max(0,y))]);
}
