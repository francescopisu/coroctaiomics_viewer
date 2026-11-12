import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData.js';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray.js';
import {binary,type Vec3,type VolumeInfo,type ImageGeometry,type TransferProgress} from './types';

export const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0);
export const sub=(a:number[],b:number[])=>a.map((x,i)=>x-b[i]) as Vec3;
export const norm=(a:number[])=>{const n=Math.hypot(...a);return a.map(x=>x/n) as Vec3;};
export const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]] as Vec3;
export const hexColor=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255) as Vec3;

export function imageFromValues(info:ImageGeometry,values:Float32Array|Int16Array|Uint8Array,components:number,name:string){
  const img=vtkImageData.newInstance();img.setDimensions(info.dimensions);img.setSpacing(info.spacing);img.setOrigin(info.origin);img.setDirection(new Float32Array(info.direction));
  img.getPointData().setScalars(vtkDataArray.newInstance({name,numberOfComponents:components,values}));return img;
}

/** The axial stack and every vessel renderer share the same native CT buffer. */
export class SharedCt {
  info:ImageGeometry;image:ReturnType<typeof vtkImageData.newInstance>;
  constructor(geometry:{shape:Vec3;affineLPS:number[][]},public values:Float32Array|Int16Array){
    const a=geometry.affineLPS,spacing=a.slice(0,3).map((_,i)=>Math.hypot(a[0][i],a[1][i],a[2][i])) as Vec3;
    this.info={dimensions:geometry.shape,affineLPS:a,spacing,origin:a.slice(0,3).map(row=>row[3]) as Vec3,direction:[0,1,2].flatMap(i=>a.slice(0,3).map(row=>row[i]/spacing[i]))};
    this.image=imageFromValues(this.info,values,1,'Shared native CCTA');
  }
  dispose(){this.image.getPointData().getScalars().delete();this.image.delete();}
}

export class Volume {
  images:ReturnType<typeof vtkImageData.newInstance>[];
  displayImage?:ReturnType<typeof vtkImageData.newInstance>;
  private ctOffset:Vec3=[0,0,0];
  constructor(public info:VolumeInfo,public ct:Float32Array|Int16Array,public lumen:Uint8Array,public cpe:Uint8Array,public cpeDisplay?:Uint8Array,private shared?:SharedCt){
    this.images=[shared?.image??imageFromValues(info,ct,1,'CCTA'),imageFromValues(info,lumen,1,'Lumen'),imageFromValues(info,cpe,1,'CPE')];
    if(shared){const offset:Vec3=[0,0,0];shared.image.worldToIndex(info.origin,offset);this.ctOffset=offset.map(Math.round) as Vec3;
      if(offset.some((x,i)=>Math.abs(x-this.ctOffset[i])>1e-3))throw new Error('Vessel crop does not align with native CT');}
    if(cpeDisplay)this.displayImage=imageFromValues(info,cpeDisplay,1,'CPE display boundary');
  }
  index(p:Vec3){const out:[number,number,number]=[0,0,0];this.images[1].worldToIndex(p,out);return out;}
  sample(p:Vec3,which:'ct'|'lumen'|'cpe'){
    return this.sampleIndex(this.index(p),which,which==='ct');
  }
  sampleIndex(ijk:Vec3,which:'ct'|'lumen'|'cpe'|'cpeDisplay',linear=which==='ct'){
    const [x,y,z]=ijk,[nx,ny,nz]=this.info.dimensions;
    if(x<0||y<0||z<0||x>nx-1||y>ny-1||z>nz-1)return which==='ct'?-1024:0;
    const values=this[which]??this.cpe;const at=(i:number,j:number,k:number)=>{
      if(which==='ct'&&this.shared){const [sx,sy]=this.shared.info.dimensions,[ox,oy,oz]=this.ctOffset;return values[i+ox+sx*(j+oy+sy*(k+oz))];}
      return values[i+nx*(j+ny*k)]/(which==='cpeDisplay'&&this.cpeDisplay?255:1);
    };
    if(!linear)return at(Math.round(x),Math.round(y),Math.round(z));
    const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z),dx=x-i,dy=y-j,dz=z-k;let sum=0;
    for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++)sum+=at(Math.min(i+a,nx-1),Math.min(j+b,ny-1),Math.min(k+c,nz-1))*(a?dx:1-dx)*(b?dy:1-dy)*(c?dz:1-dz);
    return sum;
  }
  dispose(){[...this.images.slice(this.shared?1:0),...(this.displayImage?[this.displayImage]:[])].forEach(img=>{img.getPointData().getScalars().delete();img.delete();});}
}
export async function loadVolume(info:VolumeInfo,signal:AbortSignal,progress?:TransferProgress,shared?:Promise<SharedCt>){
  const [native,ct,lumen,cpe,display]=await Promise.all([shared,shared?undefined:binary(info.ct,signal,progress),binary(info.lumen,signal,progress),binary(info.cpe,signal,progress),info.cpeDisplay?binary(info.cpeDisplay,signal,progress):undefined]);
  if(signal.aborted)throw new DOMException('Case closed','AbortError');
  const count=info.dimensions.reduce((a,b)=>a*b,1);
  if(ct&&ct.byteLength!==count*(info.scalarType==='int16'?2:4)||lumen.byteLength!==count||cpe.byteLength!==count)throw new Error('Native volume dimensions do not match case metadata');
  if(display&&display.byteLength!==count)throw new Error('CPE display dimensions do not match the manifest');
  return new Volume(info,native?.values??(info.scalarType==='int16'?new Int16Array(ct!):new Float32Array(ct!)),new Uint8Array(lumen),new Uint8Array(cpe),display?new Uint8Array(display):undefined,native);
}
