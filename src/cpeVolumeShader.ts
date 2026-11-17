// vtk.js 37.4.1's stock volume-shadow/LAO paths ignore proportional mask
// components and sample the wrong transfer-function row for multicomponent data.
// Keep its native raycaster/lighting, correcting only those mask-aware lookups.
// @ts-expect-error vtk.js does not publish types for the OpenGL factory.
import vtkOpenGLVolumeMapper from '@kitware/vtk.js/Rendering/OpenGL/VolumeMapper';
// @ts-expect-error vtk.js does not publish types for the view-node registry.
import {registerOverride} from '@kitware/vtk.js/Rendering/OpenGL/ViewNodeFactory';
import macro from '@kitware/vtk.js/macros';

const maskedOpacity=`
float cpeSampleOpacity(vec4 sampleValue) {
  float support = clamp(sampleValue.g * volume.colorTextureScale[1] + volume.colorTextureShift[1], 0.0, 1.0);
  if (support <= 0.0) return 0.0;
  float opacity = getOpacityFromTexture(sampleValue.r, 0, volume.transferFunctionsSampleHeight[0]);
  // Scale optical depth by coverage, not the step-corrected opacity of an
  // independent mask material. This keeps edge density stable with ray step.
  return 1.0 - pow(max(0.000001, 1.0 - opacity), support);
}
`;
// Component 0 stores HU*support. Reconstruct HU after trilinear sampling,
// before any transfer function. CTF domain is fixed at [-1024,4096], so HU=0
// lies at 0.2 in color-table coordinates. Recover its raw-texture coordinate
// using vtk.js's actual per-component scale/shift, including float textures.
const normalizeHu=`
  float cpeSupport = clamp(tmp.g * volume.colorTextureScale[1] + volume.colorTextureShift[1], 0.0, 1.0);
  float cpeZero = (0.2 - volume.colorTextureShift[0]) / volume.colorTextureScale[0];
  tmp.r = cpeSupport > 0.000001 ? (tmp.r - cpeZero) / cpeSupport + cpeZero : cpeZero;
`;

registerOverride('vtkVolumeMapper',macro.newInstance((mapper:any,model:any,initialValues:object={})=>{
  vtkOpenGLVolumeMapper.extend(mapper,model,initialValues);
  const template=mapper.getShaderTemplate;
  mapper.getShaderTemplate=(shaders:{Fragment:string},...args:unknown[])=>{
    template(shaders,...args);
    if(!mapper.getRenderable()?.getViewSpecificProperties()?.OpenGL?.CpeMaskedVolume)return;
    const anchors=[
      'float getRadonOpacity(vec4 tValue) {',
      'getOpacityFromTexture(getTextureValue(currPosIS).r, 0, 0.5)',
      'getOpacityFromTexture(scalar.r, 0, 0.5)',
      'vec4 getColorForDefaultIndependentPreset(vec4 tValue, vec3 posIS) {',
      'vec4 tmp = rawSampleTexture(pos);',
      'return vec4(mixedColor, alpha);',
    ];
    if(anchors.some(anchor=>!shaders.Fragment.includes(anchor)))throw new Error('Unsupported vtk.js CPE volume shader template');
    shaders.Fragment=shaders.Fragment
      .replace(anchors[0],maskedOpacity+anchors[0])
      .replace(anchors[1],'cpeSampleOpacity(getTextureValue(currPosIS))')
      .replace(anchors[2],'(1.0 - pow(max(0.000001, 1.0 - cpeSampleOpacity(scalar)), rayStepLength / max(sampleDistance, 0.000001)))')
      .replace(anchors[3],anchors[3]+'\n if (tValue.g * volume.colorTextureScale[1] + volume.colorTextureShift[1] <= 0.0) return vec4(0.0);')
      .replace(anchors[4],anchors[4]+normalizeHu)
      .replace(anchors[5],'return vec4(mixedColor, cpeSampleOpacity(tValue));');
  };
},'vtkCpeVolumeMapper'));
