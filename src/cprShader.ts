// vtk.js 37.4.1's CPR renderer does not apply generic ShaderReplacements.
// Extend CT pixel-footprint filtering and feature coloring while retaining the
// native centerline geometry, orientations and physical sampling surface.
// @ts-expect-error vtk.js does not publish types for this OpenGL factory.
import vtkOpenGLImageCPRMapper from '@kitware/vtk.js/Rendering/OpenGL/ImageCPRMapper';
// @ts-expect-error vtk.js does not publish types for its view-node registry.
import {registerOverride} from '@kitware/vtk.js/Rendering/OpenGL/ViewNodeFactory';
import macro from '@kitware/vtk.js/macros';

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
  let previous:string|undefined;
  mapper.getNeedToRebuildShaders=(...args:unknown[])=>{const normal=needs(...args),s=spec(),current=JSON.stringify([s.FeatureSamplingShader,!!s.PixelFootprintAntialiasing]),changed=current!==previous;previous=current;return normal||changed;};
  mapper.buildShaders=(shaders:{Fragment:string},...args:unknown[])=>{
    build(shaders,...args);const s=spec();
    if(s.PixelFootprintAntialiasing){
      const bounds='if (any(lessThan(volumePosTC, vec3(0.0)))',sample='vec4 tvalue = texture(volumeTexture, volumePosTC);';
      if(!shaders.Fragment.includes(bounds)||!shaders.Fragment.includes(sample))throw new Error('Unsupported vtk.js CPR sampling template');
      // Compute derivatives before the volume-bounds branch, in uniform flow.
      shaders.Fragment=shaders.Fragment.replace(bounds,footprintDerivatives+'\n'+bounds).replace(sample,footprintSampling);
    }
    const custom=s.FeatureSamplingShader;if(!custom)return;
    const anchor='if (gl_FragData[0].a <= 0.0)';
    if(!shaders.Fragment.includes(anchor))throw new Error('Unsupported vtk.js CPR shader template');
    shaders.Fragment=shaders.Fragment.replace(anchor,custom+'\n'+anchor);
  };
},'vtkFeatureCPRMapper'));
