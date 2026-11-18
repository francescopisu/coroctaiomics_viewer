import {test,expect} from '@playwright/test';
import {FEATURE_PALETTE,featureColor,featurePixels} from '../src/featureColors';

test('256-color Jet scale is zero centered and clamped',()=>{
  expect(FEATURE_PALETTE).toHaveLength(256);expect(featureColor(-2,2)).toEqual([0,0,128]);expect(featureColor(0,2)).toEqual([125,255,122]);expect(featureColor(2,2)).toEqual([128,0,0]);
  expect(featureColor(-9,2)).toEqual(featureColor(-2,2));expect(featureColor(9,2)).toEqual(featureColor(2,2));
});
test('valid zero uses the opaque Jet midpoint while masked and non-finite values are transparent',()=>{
  const pixels=featurePixels(new Float32Array([0,-1,1,0,NaN]),new Uint8Array([1,1,1,0,1]),1,.5);
  expect(Array.from(pixels.slice(0,4))).toEqual([125,255,122,128]);expect(pixels[7]).toBe(128);expect(pixels[11]).toBe(128);expect(pixels[15]).toBe(0);expect(pixels[19]).toBe(0);
});
