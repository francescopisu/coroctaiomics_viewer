import '@kitware/vtk.js/Rendering/Profiles/Volume';
import './cpeVolumeShader';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';
import {OpacityMode} from '@kitware/vtk.js/Rendering/Core/VolumeProperty/Constants';
import {imageFromValues} from './volume';
import {setCpeMembership,volumeOpacityNodes,type CpeVolumeData} from './cpeVolumeData';
import type {Case,Controls} from './types';

export class CpeVolumeRenderer {
  private image;private mapper;private actor;private color=vtkColorTransferFunction.newInstance();private opacity=vtkPiecewiseFunction.newInstance();
  private maskOpacity=vtkPiecewiseFunction.newInstance();private maskColor=vtkColorTransferFunction.newInstance();
  private key=vtkLight.newInstance();private fill=vtkLight.newInstance();
  private controlsKey='';private lightsActive=false;private previousLights:any[]=[];private autoLight=true;
  constructor(private renderer:any,private data:Case,readonly packed:CpeVolumeData){
    this.image=imageFromValues(packed.info,packed.values,2,'Native CCTA and CPE support');
    this.mapper=vtkVolumeMapper.newInstance();this.mapper.setInputData(this.image);this.mapper.setBlendModeToComposite();
    this.mapper.setColorTextureWidth(4096);this.mapper.setOpacityTextureWidth(4096);
    this.mapper.setSampleDistance(Math.max(.25,Math.min(...packed.info.spacing)));this.mapper.setMaximumSamplesPerRay(1600);
    this.mapper.setAutoAdjustSampleDistances(true);this.mapper.setInitialInteractionScale(1.5);this.mapper.setInteractionSampleDistanceFactor(2);
    this.mapper.setVolumeShadowSamplingDistFactor(3);
    // @ts-expect-error Inherited vtkAbstractMapper3D API is omitted from vtk.js's types.
    this.mapper.setViewSpecificProperties({OpenGL:{CpeMaskedVolume:true}});
    this.actor=vtkVolume.newInstance();this.actor.setMapper(this.mapper);this.actor.setVisibility(false);this.actor.setPickable(false);
    const p=this.actor.getProperty();p.setIndependentComponents(true);p.setInterpolationTypeToLinear();
    p.setComponentWeight(0,1);p.setComponentWeight(1,1);p.setOpacityMode(1,OpacityMode.PROPORTIONAL);
    this.maskOpacity.addPoint(0,0);this.maskOpacity.addPoint(1,1);this.maskColor.addRGBPoint(0,0,0,0);this.maskColor.addRGBPoint(1,0,0,0);
    p.setRGBTransferFunction(0,this.color);p.setScalarOpacity(0,this.opacity);p.setScalarOpacityUnitDistance(0,1);
    p.setRGBTransferFunction(1,this.maskColor);p.setScalarOpacity(1,this.maskOpacity);p.setScalarOpacityUnitDistance(1,1);
    for(const [x,r,g,b] of [[-1024,.32,.22,.12],[-190,.68,.44,.16],[-140,.86,.72,.45],[-35,.91,.75,.48],
      [-25,.68,.22,.28],[25,.78,.35,.39],[40,.61,.38,.28],[180,.78,.63,.51],[335,.8,.71,.61],
      [365,.82,.9,.96],[700,.96,.97,1],[4096,1,1,1]])this.color.addRGBPoint(x,r,g,b);
    p.setAmbient(.25);p.setDiffuse(.8);p.setSpecular(.25);p.setSpecularPower(18);p.setLAOKernelSize(6);p.setLAOKernelRadius(3);
    const center=this.image.getCenter();
    this.key.setPosition(center[0]-100,center[1]-150,center[2]+140);this.key.setFocalPoint(...center);this.key.setIntensity(.9);this.key.setColor(1,.96,.9);
    this.fill.setPosition(center[0]+130,center[1]-50,center[2]+30);this.fill.setFocalPoint(...center);this.fill.setIntensity(.4);this.fill.setColor(.82,.9,1);
    this.renderer.addVolume(this.actor);
  }
  update(c:Controls){
    const visible=c.render3d==='cpe';
    this.actor.setVisibility(visible);
    if(visible!==this.lightsActive){
      if(visible){this.previousLights=[...this.renderer.getLights()];this.autoLight=this.renderer.getAutomaticLightCreation();this.renderer.setAutomaticLightCreation(false);this.renderer.removeAllLights();this.renderer.addLight(this.key);this.renderer.addLight(this.fill);}
      else{this.renderer.removeAllLights();this.previousLights.forEach(light=>this.renderer.addLight(light));this.renderer.setAutomaticLightCreation(this.autoLight);}
      this.lightsActive=visible;
    }
    if(!visible)return;
    const bits=(c.cpe.LAD?2:0)|(c.cpe.LCx?4:0)|(c.cpe.RCA?8:0);
    if(setCpeMembership(this.packed,bits)){this.image.getPointData().getScalars().dataChange();this.image.modified();}
    const key=JSON.stringify([c.volumePreset,c.volumeDensity,c.volumeBands,c.volumeLighting]);
    if(key!==this.controlsKey){
      this.opacity.removeAllPoints();volumeOpacityNodes(c.volumePreset,c.volumeDensity,c.volumeBands).forEach(([x,y])=>this.opacity.addPoint(x,y));
      const p=this.actor.getProperty(),cinematic=c.volumeLighting==='cinematic',unlit=c.volumeLighting==='unlit';
      p.setShade(!unlit);p.setAmbient(unlit?1:.25);p.setDiffuse(unlit?0:.8);p.setSpecular(unlit?0:.25);
      p.setVolumetricScatteringBlending(cinematic?.45:0);p.setGlobalIlluminationReach(cinematic?.15:0);p.setAnisotropy(.15);
      p.setLocalAmbientOcclusion(c.volumeLighting==='surface');this.controlsKey=key;
    }
  }
  captureQuality(enabled:boolean){this.mapper.setAutoAdjustSampleDistances(!enabled);this.mapper.setImageSampleDistance(1);}
  dispose(){
    if(this.lightsActive){this.renderer.removeAllLights();this.previousLights.forEach(light=>this.renderer.addLight(light));this.renderer.setAutomaticLightCreation(this.autoLight);}
    this.renderer.removeVolume(this.actor);this.actor.delete();this.mapper.delete();
    this.image.getPointData().getScalars().delete();this.image.delete();
    [this.color,this.opacity,this.maskColor,this.maskOpacity,this.key,this.fill].forEach(obj=>obj.delete());
  }
}
