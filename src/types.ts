import type {CohortReference} from './cohortReference';
export const vessels = ['LAD', 'LCx', 'RCA'] as const;
export type Vessel = typeof vessels[number];
export type Vec3 = [number, number, number];
export interface CpeVolumeControls {
  render3d:'anatomy'|'cpe';volumePreset:'balanced'|'fat'|'dense';volumeDensity:number;
  volumeBands:Record<'fat'|'low'|'intermediate'|'high',number>;
  volumeLighting:'cinematic'|'surface'|'unlit';volumeContext:number;volumeAdaptiveHighHu:boolean;volumeAdaptiveTissues:boolean;volumeReferenceFade:number;
}
export interface Line {points: Vec3[]; distances: number[]; u: Vec3[]; v: Vec3[]; tangents: Vec3[]; radii: number[]; cpeSliceRangeMm: number[] | null; ct: string; lumen: string; cpe: string; ctCPR: string; lumenCPR: string; cpeCPR: string}
export interface Surface {points: string; cells: string; smoothPoints?:string;normals?:string;vertices: number; triangles: number}
export interface ImageGeometry {dimensions:Vec3;spacing:Vec3;origin:Vec3;direction:number[];affineLPS:number[][]}
export interface VolumeInfo extends ImageGeometry {ct:string;lumen:string;cpe:string;cpeDisplay?:string;scalarType:'int16'|'float32'}
export interface AxialVolumeInfo {ct:string;labels:string;scalarType:'int16'|'float32'}
export interface FeatureInfo extends ImageGeometry {cohortReference?:CohortReference;id:string;name:string;vessel:Vessel;startIJK:Vec3;minimum:number;maximum:number;limit:number;balanced:[number,number,number];values:string;valid:string;cpe:string;cpeDisplay:string;axial:string;validVoxels:number;zeroVoxels:number;nonFiniteCpeVoxels:number;nonzeroOutsideCpeInCrop:number}
export interface HuReference {voxels:number;p01HU:number;p10HU:number;p50HU:number;p90HU:number;p99HU:number}
export interface TissueReference {available:boolean;version:number;experimental?:boolean;method?:string;fat?:HuReference;myocardium?:HuReference;anchors?:number[][];reason?:string}
export interface BloodPoolReference {p01HU?:number;p10HU?:number;p90HU?:number;available:boolean;method?:string;version:number;experimental?:boolean;thresholdHU?:number;p50HU?:number;p95HU?:number;p99HU?:number;meanHU?:number;stdHU?:number;voxels?:number;slices?:number;reason?:string}
export interface Case {tissueReference?:TissueReference;bloodPoolReference?:BloodPoolReference;patientId: string; coordinateSystem: string; sampling: {resolutionMm: number; widthPixels: number; pointSpacingMm: number}; cpe: {nominalLengthMm: number; output: string; radialFactor: number}; vessels: Record<Vessel, Line>; surfaces: Record<string, Surface>; alignment: Record<Vessel, {insideLumenFraction: number; maxDistanceToLumenVoxelMm: number}>; interpretation: string; volumes:Record<Vessel,VolumeInfo>;featureMaps:Record<Vessel,FeatureInfo[]>;axial:string;axialVolume:AxialVolumeInfo;geometry:{shape:Vec3;affineLPS:number[][]}}
export interface Controls extends CpeVolumeControls {vessel: Vessel; index: number; axialSlice?:number; curvedAngle:number; straightAngle:number; featureIds:Record<Vessel,string>;featureOpacity:number;featureScale:'cohort'|'balanced'|'raw';cpeVisible:boolean;cprAntialias:boolean;smoothEdges:boolean;smoothMeshes:boolean;aorta:boolean;lumen: boolean; centerline: boolean; cpe: Record<Vessel, boolean>; cpeOpacity: number; lumenOpacity: number; raw: boolean; context: boolean; width: number; level: number; colors: Record<Vessel, string>; side: 'merged' | 'left' | 'right'}
export interface TransferProgress {expectedBytes(url:string):number|undefined;receive(url:string,bytes:number):void}
export async function binary(url:string,signal?:AbortSignal,progress?:TransferProgress){
  const r=await fetch(url,{signal});if(!r.ok)throw new Error(`Case asset failed (${r.status}): ${url}`);
  const expected=progress?.expectedBytes(url);
  if(expected===undefined)return r.arrayBuffer();
  // Fetch streams are decompressed. Geometry supplies the decoded size even
  // when Content-Length describes compressed bytes or is absent entirely.
  if(!r.body){const buffer=await r.arrayBuffer();if(buffer.byteLength!==expected)throw new Error(`Incomplete case asset: ${url}`);progress!.receive(url,buffer.byteLength);return buffer;}
  const bytes=new Uint8Array(expected),reader=r.body.getReader();let offset=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      if(offset+value.byteLength>expected)throw new Error(`Case asset dimensions changed: ${url}`);
      bytes.set(value,offset);offset+=value.byteLength;progress!.receive(url,offset);
    }
    if(offset!==expected)throw new Error(`Incomplete case asset: ${url}`);
    return bytes.buffer;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
export function rgba(ct: Float32Array|Int16Array, offset: number, count: number, c: Controls) {const bytes = new Uint8Array(count*4); for(let i=0;i<count;i++){const value=c.raw ? Math.max(0,Math.min(255,(ct[offset+i]-c.level+c.width/2)/c.width*255)):12; bytes.set([value,value,value,255],i*4);} return bytes;}
