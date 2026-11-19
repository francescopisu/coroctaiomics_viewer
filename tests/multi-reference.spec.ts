import {test,expect,type Locator} from '@playwright/test';
import {residentPhantoms} from './helpers/residentPhantom';
import {calibratedHu,contextAffinity,volumeColorNodes,volumeOpacityNodes} from '../src/cpeVolumeData';
import type {TissueReference,BloodPoolReference} from '../src/types';

const reference:TissueReference={available:true,version:1,
  fat:{voxels:1000,p01HU:-170,p10HU:-120,p50HU:-80,p90HU:-40,p99HU:-30},
  myocardium:{voxels:1000,p01HU:80,p10HU:110,p50HU:150,p90HU:190,p99HU:230},
  anchors:[[-1024,-1024],[-190,-190],[-165,-120],[-100,-80],[-45,-40],[-30,-30],[35,110],[120,150],[250,550],[350,635],[4096,4096]]};
const blood:BloodPoolReference={available:true,version:2,p01HU:450,p10HU:490,p50HU:550,p90HU:610,p99HU:635,thresholdHU:635};

test('multi-reference transfer calibrates all bands and keeps fades reversible',()=>{
  expect(calibratedHu(-100,reference)).toBe(-80);expect(calibratedHu(120,reference)).toBe(150);expect(calibratedHu(250,reference)).toBe(550);expect(calibratedHu(350,reference)).toBe(635);
  const gain={fat:1,low:1,intermediate:1,high:1},base=volumeOpacityNodes('balanced',1,gain,635,reference,blood,0),faded=volumeOpacityNodes('balanced',1,gain,635,reference,blood,1);
  expect(base.length).toBe(faded.length);
  for(let i=0;i<base.length;i++){
    expect(Number.isFinite(faded[i][1])).toBe(true);expect(faded[i][1]).toBeGreaterThanOrEqual(0);expect(faded[i][1]).toBeLessThanOrEqual(base[i][1]);
    if(base[i][0]<=-30||base[i][0]>=635)expect(faded[i]).toEqual(base[i]);
  }
  expect(contextAffinity(150,reference.myocardium,blood)).toBe(1);expect(contextAffinity(550,reference.myocardium,blood)).toBe(1);expect(contextAffinity(900,reference.myocardium,blood)).toBe(0);
  const colors=volumeColorNodes(635,reference);expect(colors[0][0]).toBe(-1024);expect(colors.at(-1)![0]).toBe(4096);expect(colors.every((node,i)=>!i||node[0]>colors[i-1][0])).toBe(true);
});
const slider=(element:Locator,value:number)=>element.evaluate((input,n)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,String(n));input.dispatchEvent(new Event('input',{bubbles:true}));},value);

test('multi-reference renderer switches modes and retains original images and resident data',async({page})=>{
  const {requests}=await residentPhantoms(page,{bloodPoolThreshold:635,multiReference:true,cpeHu:[150,900]}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  const original=await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL());
  await page.getByRole('button',{name:'Show periluminal envelopes',exact:true}).click();await expect(page.locator('.scene')).toHaveAttribute('data-volume-ready','true');
  await page.getByLabel('CPE volume settings',{exact:true}).click();const mode=page.getByLabel('Tissue rendering reference',{exact:true});await expect(mode).toHaveValue('multi');await expect(page.getByLabel('Tissue reference medians')).toContainText('Fat -80 · Muscle 150 HU');
  await slider(page.getByLabel('CPE anatomical context opacity',{exact:true}),0);await slider(page.getByLabel('Intermediate opacity',{exact:true}),1);
  const before=requests.length;
  await slider(page.getByLabel('Blood and muscle fade',{exact:true}),1);await page.getByLabel('CPE volume settings',{exact:true}).click();const faded=await page.locator('.scene').screenshot();
  await page.getByLabel('CPE volume settings',{exact:true}).click();await slider(page.getByLabel('Blood and muscle fade',{exact:true}),0);await page.getByLabel('CPE volume settings',{exact:true}).click();const full=await page.locator('.scene').screenshot();expect(faded.equals(full)).toBe(false);
  await page.getByLabel('CPE volume settings',{exact:true}).click();await mode.selectOption('blood');await expect(page.getByLabel('Blood and muscle fade')).toHaveCount(0);await mode.selectOption('fixed');await expect(page.getByLabel('High HU threshold')).toHaveText('350 HU · fixed');await mode.selectOption('multi');await expect(page.getByLabel('Blood and muscle fade')).toHaveValue('0');await page.getByLabel('CPE volume settings',{exact:true}).click();
  await page.getByRole('button',{name:'Show periluminal envelopes',exact:true}).click();expect(await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL())).toBe(original);
  expect(requests.slice(before).filter(path=>path.includes('/assets/'))).toEqual([]);expect(errors).toEqual([]);
});
