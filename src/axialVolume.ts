import {binary,type AxialVolumeInfo,type Vec3,type Vessel,type TransferProgress} from './types';
import {type Plane} from './slices';

/** One native CT stack and one packed mask stack; no GPU copy or resampling. */
export class AxialVolume {
  constructor(readonly shape:Vec3,readonly ct:Int16Array|Float32Array,readonly labels:Uint8Array){
    const count=shape.reduce((a,b)=>a*b,1);
    if(ct.length!==count||labels.length!==count)throw new Error('Native axial dimensions do not match CT');
  }
  slice(index:number,vessel:Vessel):Plane{
    if(!Number.isInteger(index)||index<0||index>=this.shape[2])throw new Error('Axial slice outside case');
    const [width,height]=this.shape,count=width*height,start=index*count,bits=this.labels.subarray(start,start+count),lumen=new Uint8Array(count),cpe=new Uint8Array(count),bit={LAD:2,LCx:4,RCA:8}[vessel];
    for(let i=0;i<count;i++){lumen[i]=bits[i]&1;cpe[i]=(bits[i]&bit)?1:0;}
    return {ct:this.ct.subarray(start,start+count),lumen,cpe,width,height};
  }
}
export async function loadAxialVolume(info:AxialVolumeInfo,shape:Vec3,signal:AbortSignal,progress?:TransferProgress){
  const [ct,labels]=await Promise.all([binary(info.ct,signal,progress),binary(info.labels,signal,progress)]),count=shape.reduce((a,b)=>a*b,1);
  if(ct.byteLength!==count*(info.scalarType==='int16'?2:4)||labels.byteLength!==count)throw new Error('Native axial dimensions do not match CT');
  return new AxialVolume(shape,info.scalarType==='int16'?new Int16Array(ct):new Float32Array(ct),new Uint8Array(labels));
}
