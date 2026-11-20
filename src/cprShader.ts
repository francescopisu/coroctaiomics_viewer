// vtk.js 37.4.1's CPR renderer does not apply generic ShaderReplacements.
// Extend CT pixel-footprint filtering, lumen outlines and feature coloring while retaining the
// native centerline geometry, orientations and physical sampling surface.
// @ts-expect-error vtk.js does not publish types for this OpenGL factory.
import vtkOpenGLImageCPRMapper from '@kitware/vtk.js/Rendering/OpenGL/ImageCPRMapper';
// @ts-expect-error vtk.js does not publish types for its view-node registry.
import {registerOverride} from '@kitware/vtk.js/Rendering/OpenGL/ViewNodeFactory';
import macro from '@kitware/vtk.js/macros';
import vtkOpenGLTexture from '@kitware/vtk.js/Rendering/OpenGL/Texture';
import type {CohortReference} from './cohortReference';

const footprintDerivatives=`
  vec3 pixelFootprintX = dFdx(volumePosTC);
  vec3 pixelFootprintY = dFdy(volumePosTC);
`;
const footprintSampling=`
  vec3 nativeDimensions = vec3(textureSize(volumeTexture, 0));
  float footprintXLength = length(pixelFootprintX * nativeDimensions);
  float footprintYLength = length(pixelFootprintY * nativeDimensions);
  vec3 pixelFootprint = footprintXLength > footprintYLength ? pixelFootprintX : pixelFootprintY;
  int pixelTapCount = int(clamp(ceil(max(footprintXLength, footprintYLength)), 1.0, 16.0));
  vec4 tvalue = vec4(0.0);
  float pixelWeight = 0.0;
  for (int pixelTap = 0; pixelTap < 16; ++pixelTap) {
    if (pixelTap >= pixelTapCount) break;
    float pixelOffset = (float(pixelTap) + 0.5) / float(pixelTapCount) - 0.5;
    vec3 pixelPosition = volumePosTC + pixelOffset * pixelFootprint;
    if (all(greaterThanEqual(pixelPosition, vec3(0.0))) && all(lessThanEqual(pixelPosition, vec3(1.0)))) {
      tvalue += texture(volumeTexture, pixelPosition);
      pixelWeight += 1.0;
    }
  }
  tvalue /= max(pixelWeight, 1.0);
`;

registerOverride('vtkImageCPRMapper',macro.newInstance((mapper:any,model:any,initialValues:object={})=>{
  // Extend before vtk.js freezes its public API at the end of construction.
  vtkOpenGLImageCPRMapper.extend(mapper,model,initialValues);
  const build=mapper.buildShaders,needs=mapper.getNeedToRebuildShaders;
  const spec=()=>mapper.getRenderable()?.getViewSpecificProperties()?.OpenGL??{};
  let cohortTexture:any,textureReference:CohortReference|undefined;
  const draw=mapper.renderPieceDraw,parameters=mapper.setMapperShaderParameters;
  mapper.renderPieceDraw=(...args:unknown[])=>{
    const reference=spec().FeatureCohortReference as CohortReference|undefined;
    if(!reference)return draw(...args);
    if(reference!==textureReference||!cohortTexture?.getHandle()){
      cohortTexture?.releaseGraphicsResources();cohortTexture?.delete();
      const count=reference.knots.length,gl=model.context;
      if(!count||count>Math.min(65536,gl.getParameter(gl.MAX_TEXTURE_SIZE)))throw new Error('Unsupported cohort reference texture size.');
      const values=new Float32Array(count*4);reference.knots.forEach((k,i)=>values.set(k,i*4));
      cohortTexture=vtkOpenGLTexture.newInstance();cohortTexture.setOpenGLRenderWindow(model._openGLRenderWindow);cohortTexture.enableUseHalfFloat(false);cohortTexture.setInternalFormat(gl.RGBA32F);
      if(!cohortTexture.create2DFromRaw({width:count,height:1,numComps:4,dataType:'Float32Array',data:values}))throw new Error('Unable to upload cohort reference.');
      textureReference=reference;
    }
    cohortTexture.activate();try{return draw(...args);}finally{cohortTexture.deactivate();}
  };
  mapper.setMapperShaderParameters=(cellBO:any,...args:unknown[])=>{
    parameters(cellBO,...args);const reference=spec().FeatureCohortReference as CohortReference|undefined,program=cellBO.getProgram();
    if(reference&&program.isUniformUsed('cohortReferenceTexture')){program.setUniformi('cohortReferenceTexture',cohortTexture.getTextureUnit());program.setUniformi('cohortKnotCount',reference.knots.length);}
  };
  mapper.delete=macro.chain(()=>{cohortTexture?.releaseGraphicsResources();cohortTexture?.delete();},mapper.delete);
  let previous:string|undefined;
  mapper.getNeedToRebuildShaders=(...args:unknown[])=>{const normal=needs(...args),s=spec(),current=JSON.stringify([s.FeatureSamplingShader,!!s.PixelFootprintAntialiasing,s.LumenOutlineWidth,s.LumenSmoothingOffset]),changed=current!==previous;previous=current;return normal||changed;};
  mapper.buildShaders=(shaders:{Fragment:string},...args:unknown[])=>{
    build(shaders,...args);const s=spec();
    if(s.FeatureCohortReference)shaders.Fragment=shaders.Fragment.replace('void main()', 'uniform sampler2D cohortReferenceTexture;\nuniform int cohortKnotCount;\nvoid main()');
    if(s.PixelFootprintAntialiasing){
      const bounds='if (any(lessThan(volumePosTC, vec3(0.0)))',sample='vec4 tvalue = texture(volumeTexture, volumePosTC);';
      if(!shaders.Fragment.includes(bounds)||!shaders.Fragment.includes(sample))throw new Error('Unsupported vtk.js CPR sampling template');
      // Compute derivatives before the volume-bounds branch, in uniform flow.
      shaders.Fragment=shaders.Fragment.replace(bounds,footprintDerivatives+'\n'+bounds).replace(sample,footprintSampling);
    }
    // Linear sampling gives a continuous 0.5 boundary through the native mask.
    // Convert distance from that boundary into screen pixels so only a thin,
    // antialiased contour is drawn, with no tint inside the lumen.
    const custom=s.FeatureSamplingShader??(s.LumenOutlineWidth?`
      float lumenValue = tvalue.r * cscale0 + cshift0;
      ${s.LumenSmoothingOffset?`
      // Eight symmetric trilinear taps round the display boundary in 3D,
      // before CPR resampling. The same field is used at every rotation.
      // Offsets are capped at half a native voxel / 0.25 mm per axis.
      vec3 lumenOffset = vec3(${s.LumenSmoothingOffset.map((v:number)=>v.toExponential(8)).join(',')}) / vec3(textureSize(volumeTexture, 0));
      float lumenAverage = 0.0;
      for (int lx = -1; lx <= 1; lx += 2)
        for (int ly = -1; ly <= 1; ly += 2)
          for (int lz = -1; lz <= 1; lz += 2)
            lumenAverage += texture(volumeTexture, volumePosTC + vec3(float(lx), float(ly), float(lz)) * lumenOffset).r;
      lumenValue = (lumenAverage * 0.125) * cscale0 + cshift0;
      `:''}
      float lumenGradient = max(length(vec2(dFdx(lumenValue), dFdy(lumenValue))), 1.0e-6);
      float lumenDistance = abs(lumenValue - 0.5) / lumenGradient;
      float lumenCoverage = 1.0 - smoothstep(${Math.max(0,s.LumenOutlineWidth/2-.5).toFixed(4)}, ${(s.LumenOutlineWidth/2+.5).toFixed(4)}, lumenDistance);
      gl_FragData[0] = vec4(vec3(1.0), lumenCoverage * opacity);
    `:undefined);if(!custom)return;
    const anchor='if (gl_FragData[0].a <= 0.0)';
    if(!shaders.Fragment.includes(anchor))throw new Error('Unsupported vtk.js CPR shader template');
    shaders.Fragment=shaders.Fragment.replace(anchor,custom+'\n'+anchor);
  };
},'vtkFeatureCPRMapper'));
