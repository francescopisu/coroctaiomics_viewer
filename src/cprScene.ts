import '@kitware/vtk.js/Rendering/Profiles/Volume';
import './cprShader';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import {quat} from 'gl-matrix';
import {type Case,type Controls,type Vec3} from './types';
import {cross,dot,hexColor,norm,sub,type Volume} from './volume';
import {orientationQuaternions} from './orientations';
import {type FeatureVolume} from './featureVolume';
import {FEATURE_PALETTE} from './featureColors';
import {curvedSectionMarker,screenSectionMarker,type CprMarker,type Point2} from './curvedMarker';
import {cprLayout} from './cprLayout';

// Both viewports share one WebGL context, so native CT and label textures are shared.
export class CprScene {
  private window:any;private renderers:any[];private objects:any[]=[];private layers:{mapper:any;actor:any;tf:any;alpha:any}[][]=[];
  private poly:any;private observer:ResizeObserver;private volume?:Volume;private feature?:FeatureVolume;private current?:Controls;private distances:number[][]=[[],[]];private sizes:number[][]=[];
  private points:Vec3[]=[];private disposed=false;private active=true;private centers:Vec3[]=[];private curvedSection:Vec3[]=[];private markerLength=96;
  constructor(private host:HTMLElement,private data:Case,private marker:(positions:CprMarker[])=>void){
    this.window=vtkGenericRenderWindow.newInstance({background:[0,0,0],listenWindowResize:false});this.window.setContainer(host);
    this.window.getInteractor().unbindEvents(host);
    this.renderers=[this.window.getRenderer(),this.track(vtkRenderer.newInstance({background:[0,0,0]}))];
    this.window.getRenderWindow().addRenderer(this.renderers[1]);
    this.poly=this.track(vtkPolyData.newInstance());
    this.renderers.forEach((renderer,view)=>{
      renderer.setViewport(view/2,0,(view+1)/2,1);renderer.getActiveCamera().setParallelProjection(true);
      this.layers[view]=[0,1,2,3].map(index=>{
        const mapper=this.track(vtkImageCPRMapper.newInstance());mapper.setCenterlineData(this.poly);
        if(index>0)(mapper as any).setBackgroundColor([0,0,0,0]);
        const actor=this.track(vtkImageSlice.newInstance());actor.setMapper(mapper as any);actor.setPosition(0,0,[0,.02,.03,.01][index]);actor.setPickable(false);actor.setForceOpaque(true);actor.setVisibility(false);
        const tf=this.track(vtkColorTransferFunction.newInstance()),alpha=this.track(vtkPiecewiseFunction.newInstance());
        const property=actor.getProperty();property.setIndependentComponents(index!==3);property.setUseLookupTableScalarRange(true);property.setRGBTransferFunction(0,tf);property.setScalarOpacity(0,alpha);
        if(index===0)property.setInterpolationTypeToLinear();else property.setInterpolationTypeToNearest();
        return {mapper,actor,tf,alpha};
      });
      [0,3,1,2].forEach(index=>renderer.addViewProp(this.layers[view][index].actor));
    });
    this.observer=new ResizeObserver(()=>{if(!this.disposed&&this.active){this.window.resize();if(this.current)this.update(this.current);}});this.observer.observe(host);
  }
  setActive(active:boolean){
    if(this.disposed||this.active===active)return;
    this.active=active;this.window.getInteractor().setEnableRender(active);
    if(active){this.window.resize();if(this.current)this.update(this.current);}
  }
  private track<T>(object:T):T {this.objects.push(object);return object;}
  private bindImages(){this.layers.forEach(layers=>layers.forEach((l,index)=>{
    const smooth=this.current?.smoothEdges;
    const image=index===3?this.feature?.image:index===2?(smooth?(this.feature?.displayImage??this.volume?.displayImage??this.volume?.images[2]):(this.feature?.outlineImage??this.volume?.images[2])):this.volume?.images[index];
    l.actor.setVisibility(!!this.volume&&!!image);l.mapper.setImageData(image??null);
  }));}
  setVolume(volume?:Volume){this.volume=volume;this.bindImages();}
  setFeature(feature?:FeatureVolume){this.feature=feature;this.bindImages();}
  update(c:Controls){
    this.current=c;if(!this.volume||this.disposed||!this.active)return;this.bindImages();
    const f=this.data.vessels[c.vessel],points=f.points;this.points=points;
    // vtkImageCPRMapper 37 maps model indices to texture coordinates as ijk/dim.
    // Texture centres lie at (ijk+0.5)/dim. Compensate only at the GPU boundary;
    // the source affine, navigation points and CPU cross-sections stay unchanged.
    const halfVoxel=this.volume.info.affineLPS.slice(0,3).map(row=>(row[0]+row[1]+row[2])/2);
    this.poly.getPoints().setData(new Float32Array(points.flatMap(p=>p.map((x,i)=>x+halfVoxel[i]))),3);
    this.poly.getLines().setData(new Uint32Array([points.length,...points.map((_,i)=>i)]));
    const old=this.poly.getPointData().getArrayByName('Orientation');
    // Independent matrix->quaternion conversions can switch between q and -q.
    // Supply sign-continuous quaternions directly: vtk's GPU SLERP does not
    // choose the shortest arc when adjacent equivalent rotations change sign.
    const orientations=vtkDataArray.newInstance({name:'Orientation',numberOfComponents:4,values:orientationQuaternions(f)});
    this.poly.getPointData().addArray(orientations);if(old)old.delete();this.poly.modified();
    const a=c.curvedAngle*Math.PI/180;const axis=norm(sub(points.at(-1)!,points[0]));
    const u=norm(sub(f.u[0],axis.map(x=>x*dot(f.u[0],axis)))),v=cross(axis,u);
    const d=u.map((x,i)=>x*Math.cos(a)+v[i]*Math.sin(a)) as Vec3,e=cross(axis,d);
    // The OpenGL uniform path requires an actual quaternion, even though the core API also accepts matrices.
    const orientation=quat.create();quat.fromMat3(orientation,new Float32Array([...d,...e,...axis]));quat.normalize(orientation,orientation);
    const center=points[0].map((_,i)=>points.reduce((s,p)=>s+p[i],0)/points.length) as Vec3;
    const rect=this.host.getBoundingClientRect(),aspect=rect.width/2/rect.height;
    // Both panels share the same horizontal physical scale and longitudinal
    // display extent. Normalize the longitudinal display coordinate to fill the
    // available height even when a wide rotation envelope controls camera fit.
    const {width,displayHeight,parallelScale,markerLength}=cprLayout(f,[rect.width/2,rect.height],this.data.sampling.widthPixels*this.data.sampling.resolutionMm);this.markerLength=markerLength;
    this.layers.forEach((layers,view)=>{
      layers.forEach(({mapper,actor,tf,alpha},index)=>{
        if(view===0){const straight=c.straightAngle*Math.PI/180;mapper.useStraightenedMode();mapper.setTangentDirection([Math.cos(straight),Math.sin(straight),0]);mapper.setWidth(width);}
        else {mapper.setTangentDirection([1,0,0]);mapper.setUniformOrientation(Array.from(orientation));mapper.useStretchedMode(center.map((x,i)=>x+halfVoxel[i]));
          mapper.getOrientedCenterline().setDistanceFunction((p:number[],q:number[])=>{const r=sub(p,q);return Math.max(1e-6,Math.sqrt(Math.max(0,dot(r,r)-dot(r,d)**2)));});mapper.setWidth(width);}
        tf.removeAllPoints();alpha.removeAllPoints();
        if(index===0){tf.addRGBPoint(c.level-c.width/2,0,0,0);tf.addRGBPoint(c.level+c.width/2,1,1,1);alpha.addPoint(0,1);actor.setVisibility(c.raw);actor.getProperty().setOpacity(1);
          mapper.setViewSpecificProperties({OpenGL:{PixelFootprintAntialiasing:view===0&&c.cprAntialias}});}
        else if(index===3){
          FEATURE_PALETTE.forEach((rgb,i)=>tf.addRGBPoint(i/255,...rgb.map(x=>x/255)));tf.addRGBPoint(.5,1,1,1);alpha.addPoint(0,0);alpha.addPoint(1,1);
          actor.getProperty().setInterpolationTypeToLinear();actor.setVisibility(!!this.feature);actor.getProperty().setOpacity(c.featureOpacity);
          if(this.feature)mapper.setViewSpecificProperties({OpenGL:{FeatureSamplingShader:this.feature.shader(c.featureScale,c.smoothEdges)}});
        }
        else {const rgb=index===1?[1,1,1]:hexColor(c.colors[c.vessel]);tf.addRGBPoint(0,...rgb);tf.addRGBPoint(1,...rgb);alpha.addPoint(0,0);alpha.addPoint(0.49,0);alpha.addPoint(0.5,1);alpha.addPoint(1,1);
          if(index===2&&c.smoothEdges&&(this.feature||this.volume?.displayImage)){
            tf.removeAllPoints();alpha.removeAllPoints();tf.addRGBPoint(0,...rgb);tf.addRGBPoint(255,...rgb);
            alpha.addPoint(0,0);alpha.addPoint(114.75,0);alpha.addPoint(127.5,1);if(this.feature){alpha.addPoint(140.25,0);alpha.addPoint(255,0);}else alpha.addPoint(255,1);
            actor.getProperty().setInterpolationTypeToLinear();
          }else actor.getProperty().setInterpolationTypeToNearest();
          actor.setVisibility(index===1?c.lumen:c.cpeVisible&&c.cpe[c.vessel]);actor.getProperty().setOpacity(index===1?0.12*c.lumenOpacity:(this.feature?0.9:c.cpeOpacity));}
      });
      const mapper=layers[0].mapper,height=mapper.getHeight(),w=mapper.getWidth();
      const yScale=displayHeight/height;
      layers.forEach(({actor})=>actor.setScale(1,yScale,1));
      this.distances[view]=Array.from(mapper.getOrientedCenterline().getDistancesToFirstPoint());this.sizes[view]=[w,displayHeight];
      const camera=this.renderers[view].getActiveCamera();
      camera.setFocalPoint(w/2,displayHeight/2,0);camera.setPosition(w/2,displayHeight/2,200);camera.setViewUp(0,1,0);
      camera.setParallelScale(parallelScale);this.renderers[view].resetCameraClippingRange();
      this.centers[view]=[view===0?w/2:w/2+dot(sub(points[c.index],center),d),(height-this.distances[view][c.index])*yScale,0];
      if(view===1)this.curvedSection=curvedSectionMarker(f,c.index,d,center,w,this.distances[view],displayHeight,this.data.sampling.widthPixels*this.data.sampling.resolutionMm);
      // Expose the visible image extent for UI verification, independent of markers.
      const bounds=layers[0].actor.getBounds(),extent=(bounds[3]-bounds[2])/(2*camera.getParallelScale())*100;
      this.host.dataset[view===0?'straightHeight':'curvedHeight']=extent.toFixed(6);
      this.host.dataset[view===0?'straightWidth':'curvedWidth']=((bounds[1]-bounds[0])/(2*camera.getParallelScale()*aspect)*100).toFixed(6);
      this.host.dataset[view===0?'straightPixelsPerMm':'curvedPixelsPerMm']=(rect.height/(2*camera.getParallelScale())).toFixed(6);
    });
    this.window.getRenderWindow().render();this.updateMarkers();
  }
  private project(point:Vec3,view:number){
    // Use the renderer's viewport transform, matching GPU rasterization. The
    // vtkCoordinate pixel-centre transform contracts positions by (size-1)/size.
    return this.window.getApiSpecificRenderWindow().worldToDisplay(...point,this.renderers[view]);
  }
  private updateMarkers(){
    const size=this.window.getApiSpecificRenderWindow().getSize(),rect=this.host.getBoundingClientRect(),cssSize:Point2=[rect.width/2,rect.height];
    const percent=(p:Vec3,view:number):Point2=>{const q=this.project(p,view);return [(q[0]-size[0]*view/2)/(size[0]/2)*100,(1-q[1]/size[1])*100];};
    this.marker(this.centers.map((p,view)=>{const center=percent(p,view);return {center,line:view===0?[[0,center[1]],[100,center[1]]]:screenSectionMarker(center,this.curvedSection.map(p=>percent(p,view)),cssSize,this.markerLength)};}));
  }
  indexAt(clientY:number,view:number){
    const rect=this.host.getBoundingClientRect(),dist=this.distances[view];if(!dist.length)return 0;
    const top=this.project([0,this.sizes[view][1],0],view)[1],bottom=this.project([0,0,0],view)[1],height=this.window.getApiSpecificRenderWindow().getSize()[1];
    const y=(rect.bottom-clientY)/rect.height*height;
    const distance=Math.max(0,Math.min(1,(top-y)/(top-bottom)))*dist.at(-1)!;
    return dist.reduce((best,s,i)=>Math.abs(s-distance)<Math.abs(dist[best]-distance)?i:best,0);
  }
  async capture(){const capture=this.window.getApiSpecificRenderWindow().captureNextImage();this.window.getRenderWindow().render();return capture as Promise<string>;}
  dispose(){this.disposed=true;this.observer.disconnect();this.window.setContainer(null);this.renderers.forEach(r=>r.removeAllViewProps());this.poly.getPointData().getArrayByName('Orientation')?.delete();
    [...new Set(this.objects)].reverse().forEach(o=>o.delete());const interactor=this.window.getInteractor(),renderer=this.window.getRenderer(),rw=this.window.getRenderWindow();this.window.delete();interactor.delete();renderer.delete();rw.delete();}
}
