import {binary,type FeatureInfo,type Vec3} from './types';
import {imageFromValues} from './volume';
import {featureScale,type FeatureMode} from './featureColors';
import {cohortShader} from './cohortReference';
import {sampleFeature} from './featureSampling';

export class FeatureVolume {
  image;outlineImage;displayImage;private shaders=new Map<string,string>();
  constructor(public info:FeatureInfo,public values:Float32Array,public valid:Uint8Array,public cpe:Uint8Array,public display:Uint8Array){
    const [nx,ny,nz]=info.dimensions,boundary=new Uint8Array(cpe.length),slice=nx*ny,packed=new Float32Array(cpe.length*4),span=info.maximum-info.minimum;
    for(let i=0;i<cpe.length;i++){
      packed[i*4]=valid[i]?(span?(values[i]-info.minimum)/span:.5):0;packed[i*4+1]=valid[i];packed[i*4+2]=display[i]/255;packed[i*4+3]=cpe[i];
      if(cpe[i]){const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/slice);
        if(x===0||x===nx-1||y===0||y===ny-1||z===0||z===nz-1||!cpe[i-1]||!cpe[i+1]||!cpe[i-nx]||!cpe[i+nx]||!cpe[i-slice]||!cpe[i+slice])boundary[i]=1;}
    }
    this.image=imageFromValues(info,packed,4,'Feature scalar, support and display boundary');
    this.outlineImage=imageFromValues(info,boundary,1,'CPE voxel boundary');this.displayImage=imageFromValues(info,display,1,'CPE display boundary');
  }
  shader(mode:FeatureMode,smooth:boolean){
    const key=mode+smooth,cached=this.shaders.get(key);if(cached)return cached;
    const scale=featureScale(this.info,mode),[lo,mid,hi]=Array.isArray(scale)?scale:[0,0,0],f=(x:number)=>x.toExponential(12),dims=this.info.dimensions.map(f).join(',');
    const shader=`
      float support = tvalue.g;
      float coverage = ${smooth?'smoothstep(0.45, 0.55, tvalue.b)':`texture(volumeTexture, (floor(volumePosTC * vec3(${dims})) + vec3(0.5)) / vec3(${dims})).a`};
      if(support <= 1.0e-6 || coverage <= 0.0)discard;
      float value = ${f(this.info.minimum)} + (tvalue.r / max(support, 1.0e-6)) * ${f(this.info.maximum-this.info.minimum)};
      ${!Array.isArray(scale)?cohortShader():`float intensity = ${lo===hi?'0.5':`value < ${f(mid)} ? 0.5 * (value - (${f(lo)})) / ${f(Math.max(mid-lo,1e-30))} : 0.5 + 0.5 * (value - (${f(mid)})) / ${f(Math.max(hi-mid,1e-30))}`};`}
      gl_FragData[0] = vec4(texture2D(colorTexture1, vec2(clamp(intensity, 0.0, 1.0), 0.5)).rgb, support > 1.0e-6 ? coverage * opacity : 0.0);
    `;
    this.shaders.set(key,shader);return shader;
  }
  sample(p:Vec3,smooth=true){const ijk:Vec3=[0,0,0];this.image.worldToIndex(p,ijk);return sampleFeature(this.values,this.valid,this.display,this.cpe,this.info.dimensions,ijk,smooth);}
  axialField(index:number,shape:Vec3,smooth:boolean){
    const [width,height]=shape,field=new Uint8Array(width*height),[x,y,z]=this.info.startIJK,[nx,ny,nz]=this.info.dimensions,k=index-z;
    if(k>=0&&k<nz)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)field[x+i+width*(y+j)]=smooth?this.display[i+nx*(j+ny*k)]:this.cpe[i+nx*(j+ny*k)]*255;
    return field;
  }
  axialPlane(index:number,shape:Vec3,smooth:boolean){
    const [width,height]=shape,values=new Float32Array(width*height),valid=new Uint8Array(width*height),[x,y,z]=this.info.startIJK,[nx,ny,nz]=this.info.dimensions,k=index-z;
    if(k>=0&&k<nz)for(let j=0;j<ny;j++){
      const source=nx*(j+ny*k),target=x+width*(y+j);
      values.set(this.values.subarray(source,source+nx),target);valid.set(this.valid.subarray(source,source+nx),target);
    }
    return {values,valid,limit:this.info.limit,balanced:this.info.balanced,cohortReference:this.info.cohortReference,displayMask:this.axialField(index,shape,smooth)};
  }
  dispose(){for(const image of [this.image,this.outlineImage,this.displayImage]){image.getPointData().getScalars().delete();image.delete();}}
}
export async function loadFeature(info:FeatureInfo,signal:AbortSignal){
  const [values,valid,cpe,display]=await Promise.all([info.values,info.valid,info.cpe,info.cpeDisplay].map(url=>binary(url,signal)));
  const count=info.dimensions.reduce((a,b)=>a*b,1);if(values.byteLength!==count*4||valid.byteLength!==count||cpe.byteLength!==count||display.byteLength!==count)throw new Error('Feature dimensions do not match the manifest');
  return new FeatureVolume(info,new Float32Array(values),new Uint8Array(valid),new Uint8Array(cpe),new Uint8Array(display));
}
