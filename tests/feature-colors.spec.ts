import {test,expect} from '@playwright/test';
import {FEATURE_PALETTE,featureColor,featurePixels} from '../src/featureColors';

test('1024-color sunset palette preserves its endpoints, gold midpoint and clamping',()=>{
  expect(FEATURE_PALETTE).toHaveLength(1024);expect(featureColor(-2,2)).toEqual([99,167,142]);expect(featureColor(0,2)).toEqual([223,196,141]);expect(featureColor(2,2)).toEqual([197,31,54]);
  expect(featureColor(-9,2)).toEqual(featureColor(-2,2));expect(featureColor(9,2)).toEqual(featureColor(2,2));
});
test('valid zero is opaque gold while masked and non-finite values are transparent',()=>{
  const pixels=featurePixels(new Float32Array([0,-1,1,0,NaN]),new Uint8Array([1,1,1,0,1]),1,.5);
  expect(Array.from(pixels.slice(0,4))).toEqual([223,196,141,128]);expect(pixels[7]).toBe(128);expect(pixels[11]).toBe(128);expect(pixels[15]).toBe(0);expect(pixels[19]).toBe(0);
});
