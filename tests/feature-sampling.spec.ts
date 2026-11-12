import {test,expect} from '@playwright/test';
import {sampleFeature} from '../src/featureSampling';
import {featureColor,featurePosition,featureScale} from '../src/featureColors';

test('feature scalars interpolate linearly and masked neighbours do not bias values toward zero',()=>{
  const values=new Float32Array([0,2,2,4,2,4,4,6]),valid=new Uint8Array(8).fill(1),field=new Uint8Array(8).fill(255);
  expect(sampleFeature(values,valid,field,valid,[2,2,2],[.25,.5,.75])!.value).toBeCloseTo(3);
  values.fill(7);valid[0]=0;values[0]=NaN;
  expect(sampleFeature(values,valid,field,field,[2,2,2],[.25,.5,.75])!.value).toBeCloseTo(7);
  valid.fill(0);expect(sampleFeature(values,valid,field,field,[2,2,2],[.5,.5,.5])).toBeNull();
  valid.fill(1);values.fill(0);expect(sampleFeature(values,valid,field,valid,[2,2,2],[.5,.5,.5])!.value).toBe(0);
  expect(sampleFeature(values,valid,new Uint8Array(8),valid,[2,2,2],[.5,.5,.5])).toBeNull();
});
test('balanced positive features span green to pink with a white median; raw mode retains sign',()=>{
  const info={limit:1,balanced:[.2,.7,.9] as [number,number,number]},balanced=featureScale(info,'balanced');
  expect(featurePosition(.2,balanced)).toBe(0);expect(featurePosition(.7,balanced)).toBe(.5);expect(featurePosition(.9,balanced)).toBe(1);
  expect(featureColor(.7,balanced)).toEqual([255,255,255]);expect(featurePosition(.5,balanced)).toBeLessThan(.5);
  expect(featurePosition(.5,featureScale(info,'raw'))).toBeGreaterThan(.5);expect(featureColor(0,featureScale(info,'raw'))).toEqual([255,255,255]);
  expect(featurePosition(9,[2,2,2])).toBe(.5);
});
