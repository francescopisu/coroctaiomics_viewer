import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkPlaneSource from '@kitware/vtk.js/Filters/Sources/PlaneSource';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkTexture from '@kitware/vtk.js/Rendering/Core/Texture';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';
import {binary, rgba, vessels, type Case, type Controls, type Vec3, type Vessel,type TransferProgress} from './types';
import {compositeFeature,type FeaturePlane} from './slices';
import {cameraBasis,cubeSvg,drawCube} from './orientation';

const color = (hex: string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255) as Vec3;
const plus = (p: Vec3,u: Vec3,v: Vec3,a: number,b: number) => p.map((q,i)=>q+a*u[i]+b*v[i]) as Vec3;
export class Scene {
  // vtk.js object types vary by factory; contain the dynamic API at this rendering boundary.
  private objects: any[]=[]; private actors: Record<string,any>={}; private disposed=false;private loaded=false;
  private meshData:Record<string,{poly:any;raw:Float32Array;smooth:Float32Array;normals:any}>={};private smoothed?:boolean;
  private window: any; private renderer: any; private renderWindow: any; private picker: any;
  private marker: any; private ring: any;private ringActor:any; private plane: any; private planeActor: any; private texture: any; private image: any;
  private observer: ResizeObserver; private down: number[]=[];
  private cube:SVGSVGElement;private cameraSubscription:{unsubscribe:()=>void};
  constructor(private container: HTMLElement, private data: Case, private select: (v: Vessel,index: number)=>void) {
    this.window=vtkGenericRenderWindow.newInstance({background:[0.035,0.048,0.068]});
    this.window.setContainer(container); this.renderer=this.window.getRenderer(); this.renderWindow=this.window.getRenderWindow();
    this.cube=document.createElementNS('http://www.w3.org/2000/svg','svg');this.cube.setAttribute('viewBox','0 0 68 68');this.cube.setAttribute('role','img');this.cube.setAttribute('aria-label','3D LPS orientation cube');this.cube.classList.add('lps-cube');this.cube.style.visibility='hidden';container.append(this.cube);
    this.cameraSubscription=this.renderer.getActiveCamera().onModified(()=>this.updateCube());
    this.marker=this.actor(vtkSphereSource.newInstance({radius:0.8,phiResolution:16,thetaResolution:16}));
    this.marker.setPickable(false); this.marker.getProperty().setColor(0.9,1,0.35);
    this.ring=this.track(vtkPolyData.newInstance());this.ringActor=this.actor(this.ring);this.ringActor.setPickable(false);
    this.ringActor.getProperty().setColor(0.85,0.94,0.38);this.ringActor.getProperty().setLighting(false);this.ringActor.getProperty().setLineWidth(3);
    this.plane=this.track(vtkPlaneSource.newInstance()); this.planeActor=this.actor(this.plane); this.planeActor.setPickable(false);
    this.planeActor.getProperty().setLighting(false); this.planeActor.getProperty().setOpacity(0.65);
    this.texture=this.track(vtkTexture.newInstance()); this.texture.setInterpolate(true); this.planeActor.addTexture(this.texture);
    this.image=this.track(vtkImageData.newInstance());
    this.picker=this.track(vtkCellPicker.newInstance()); this.picker.setTolerance(0.008);
    vessels.forEach(v=>{
      const poly=this.track(vtkPolyData.newInstance()); poly.getPoints().setData(new Float32Array(data.vessels[v].points.flat()),3);
      poly.getLines().setData(new Uint32Array([data.vessels[v].points.length,...data.vessels[v].points.map((_,i)=>i)]));
      const actor=this.actor(poly); actor.getProperty().setLineWidth(3); actor.getProperty().setLighting(false); this.actors[`line_${v}`]=actor;
    });
    this.observer=new ResizeObserver(()=>{if(!this.disposed){this.window.resize();this.renderWindow.render();}}); this.observer.observe(container);
    container.addEventListener('pointerdown',this.onDown); container.addEventListener('pointerup',this.onUp);
  }
  private track<T>(obj:T):T {this.objects.push(obj); return obj;}
  private actor(input:any) {
    if(input.getOutputPort) this.track(input);
    const mapper=this.track(vtkMapper.newInstance());
    if(input.getOutputPort) mapper.setInputConnection(input.getOutputPort()); else mapper.setInputData(input);
    mapper.setScalarVisibility(false); const actor=this.track(vtkActor.newInstance()); actor.setMapper(mapper);actor.setVisibility(false);
    actor.getProperty().setAmbient(0.22); actor.getProperty().setDiffuse(0.78); this.renderer.addActor(actor); return actor;
  }
  async load(signal: AbortSignal,progress?:TransferProgress) {
    await Promise.all(Object.entries(this.data.surfaces).map(async ([key, surface])=>{
      const [p,c,s,n]=await Promise.all([binary(surface.points,signal,progress),binary(surface.cells,signal,progress),surface.smoothPoints?binary(surface.smoothPoints,signal,progress):undefined,surface.normals?binary(surface.normals,signal,progress):undefined]);
      if(this.disposed)return;
      const raw=new Float32Array(p),smooth=s?new Float32Array(s):raw,normals=n?new Float32Array(n):null;
      const poly=this.track(vtkPolyData.newInstance()); poly.getPoints().setData(smooth,3); poly.getPolys().setData(new Uint32Array(c));
      const normalArray=normals?this.track(vtkDataArray.newInstance({name:'Normals',numberOfComponents:3,values:normals})):null;
      this.meshData[key]={poly,raw,smooth,normals:normalArray};if(normalArray)poly.getPointData().setNormals(normalArray);
      this.actors[key]=this.actor(poly);
      this.actors[key].getProperty().setInterpolationToPhong();
      if(key==='ascending_aorta')this.actors[key].setPickable(false);
    }));
    if(!this.disposed){this.smoothed=undefined;this.reset();this.loaded=true;}
  }
  update(c:Controls,samples?:{ct:Float32Array|Int16Array;feature?:FeaturePlane}) {
    // Do not render default-position markers or partially loaded surfaces before
    // the camera is fitted. ResizeObserver can request a frame during loading.
    if(this.disposed||!this.loaded)return;
    this.updateCube();
    if(this.smoothed!==c.smoothMeshes){for(const {poly,raw,smooth,normals} of Object.values(this.meshData)){
      poly.getPoints().setData(c.smoothMeshes?smooth:raw,3);
      poly.getPointData().setNormals(c.smoothMeshes?normals:null);poly.modified();
    }this.smoothed=c.smoothMeshes;}
    for(const [key,actor] of Object.entries(this.actors)){
      if(key==='ascending_aorta'){actor.setVisibility(c.aorta);actor.getProperty().setColor(.77,.81,.84);actor.getProperty().setOpacity(c.aortaOpacity);}
      else if(key.startsWith('lumen_')){actor.setVisibility(c.lumen && key===`lumen_${c.side}`); actor.getProperty().setColor(0.94,0.95,0.96); actor.getProperty().setOpacity(c.lumenOpacity);}
      else {const v=key.replace(/^(cpe_|line_)/,'') as Vessel; actor.setVisibility(key.startsWith('cpe_') ? c.cpeVisible&&c.cpe[v]:c.centerline); actor.getProperty().setColor(...color(c.colors[v])); actor.getProperty().setOpacity(key.startsWith('cpe_')?c.cpeOpacity:1); if(key.startsWith('line_'))actor.getProperty().setLineWidth(v===c.vessel?5:2);}
    }
    const f=this.data.vessels[c.vessel],p=f.points[c.index],u=f.u[c.index],v=f.v[c.index];
    this.marker.setPosition(...p);this.marker.setVisibility(true);
    const ringPoints=Array.from({length:65},(_,i)=>plus(p,u,v,Math.cos(i/64*Math.PI*2)*Math.max(4,f.radii[c.index]*4),Math.sin(i/64*Math.PI*2)*Math.max(4,f.radii[c.index]*4)));
    this.ring.getPoints().setData(new Float32Array(ringPoints.flat()),3);this.ring.getLines().setData(new Uint32Array([65,...ringPoints.map((_,i)=>i)]));this.ring.modified();
    this.ringActor.setVisibility(true);
    const n=samples?Math.round(Math.sqrt(samples.ct.length)):this.data.sampling.widthPixels;
    const fieldMm=this.data.sampling.widthPixels*this.data.sampling.resolutionMm,half=(fieldMm-fieldMm/n)/2;
    this.plane.setOrigin(...plus(p,u,v,-half,-half)); this.plane.setPoint1(...plus(p,u,v,half,-half)); this.plane.setPoint2(...plus(p,u,v,-half,half));
    this.planeActor.setVisibility(c.context && c.raw && !!samples);
    if(samples){this.image.setDimensions(n,n,1);
      const values=rgba(samples.ct,0,n*n,c);if(samples.feature)values.set(compositeFeature(new Uint8ClampedArray(values),samples.feature,c.featureOpacity,c.featureScale));
      const scalars=this.track(vtkDataArray.newInstance({name:'CCTA',numberOfComponents:4,values}));
      const previous=this.image.getPointData().getScalars(); this.image.getPointData().setScalars(scalars);
      if(previous){previous.delete();this.objects=this.objects.filter(x=>x!==previous);}
      this.image.modified();this.texture.setInputData(this.image);}
    this.renderWindow.render();
  }
  reset(view='anterior') {
    const camera=this.renderer.getActiveCamera(); const source=this.actors.lumen_merged?.getBounds();
    const bounds=source?Array.from(source) as number[]:undefined;
    if(!bounds)return;
    for(const v of vessels){const outer=this.actors[`cpe_${v}`]?.getBounds();if(outer)for(let i=0;i<3;i++){bounds[i*2]=Math.min(bounds[i*2],outer[i*2]);bounds[i*2+1]=Math.max(bounds[i*2+1],outer[i*2+1]);}}
    const aorta=this.actors.ascending_aorta?.getBounds();if(aorta)for(let i=0;i<3;i++){bounds[i*2]=Math.min(bounds[i*2],aorta[i*2]);bounds[i*2+1]=Math.max(bounds[i*2+1],aorta[i*2+1]);}
    const p=[(bounds[0]+bounds[1])/2,(bounds[2]+bounds[3])/2,(bounds[4]+bounds[5])/2];
    const delta=view==='left'?[220,0,0]:view==='superior'?[0,0,220]:[0,-220,0];
    camera.setFocalPoint(...p);camera.setPosition(...p.map((q,i)=>q+delta[i]));camera.setViewUp(...(view==='superior'?[0,-1,0]:[0,0,1]));
    this.renderer.resetCamera(bounds);
    const rect=this.container.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
    const horizontal=view==='left'?bounds[3]-bounds[2]:bounds[1]-bounds[0],vertical=view==='superior'?bounds[3]-bounds[2]:bounds[5]-bounds[4];
    camera.setParallelProjection(true);camera.setParallelScale(Math.max(vertical/2,horizontal/(2*aspect))*1.12);
    this.renderer.resetCameraClippingRange(bounds);this.renderWindow.render();
  }
  private onDown=(e:PointerEvent)=>{this.down=[e.clientX,e.clientY];};
  private onUp=(e:PointerEvent)=>{
    if(e.button!==0 || Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>4)return;
    const rect=this.container.getBoundingClientRect();const size=this.window.getApiSpecificRenderWindow().getSize();
    this.picker.pick([(e.clientX-rect.left)*size[0]/rect.width,(rect.bottom-e.clientY)*size[1]/rect.height,0],this.renderer);
    const actors=this.picker.getActors();if(!actors.length)return;const picked=actors[0];
    const key=Object.keys(this.actors).find(k=>this.actors[k]===picked);if(!key)return;
    if(!/^(lumen_|cpe_|line_)/.test(key))return;
    const candidates=key.startsWith('lumen_')?vessels:[key.replace(/^(cpe_|line_)/,'') as Vessel];
    const p=this.picker.getPickPosition();let best=Infinity,result: [Vessel,number]=['LAD',0];
    for(const v of candidates)this.data.vessels[v].points.forEach((q,i)=>{const d=q.reduce((s,x,j)=>s+(x-p[j])**2,0);if(d<best){best=d;result=[v,i];}});
    this.select(...result);
  };
  private basis(){const camera=this.renderer.getActiveCamera();return cameraBasis(camera.getPosition(),camera.getFocalPoint(),camera.getViewUp());}
  private updateCube(){if(!this.loaded||this.disposed)return;this.cube.style.visibility='visible';this.cube.innerHTML=cubeSvg(this.basis());}
  async capture():Promise<string> {
    const basis=this.basis(),width=this.container.clientWidth,result=await this.window.getApiSpecificRenderWindow().captureNextImage();
    const image=new Image();image.src=result;await image.decode();const out=document.createElement('canvas');out.width=image.width;out.height=image.height;
    const ctx=out.getContext('2d')!,scale=image.width/width;ctx.drawImage(image,0,0);drawCube(ctx,basis,8*scale,out.height-76*scale,68*scale);return out.toDataURL();
  }
  dispose() {
    this.disposed=true;this.observer.disconnect();this.container.removeEventListener('pointerdown',this.onDown);this.container.removeEventListener('pointerup',this.onUp);
    this.cameraSubscription.unsubscribe();this.cube.remove();
    this.renderer.removeAllActors();this.window.setContainer(null); [...new Set(this.objects)].reverse().forEach(o=>o.delete());
    const interactor=this.window.getInteractor();this.window.delete();interactor.delete();this.renderer.delete();this.renderWindow.delete();
  }
}
