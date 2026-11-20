import {test,expect} from '@playwright/test';
import {cohortPosition,type CohortReference} from '../src/cohortReference';
import {featureScale,featureColor} from '../src/featureColors';
import {residentPhantoms} from './helpers/residentPhantom';

const tied:CohortReference={id:'test',nPatients:16,knots:[[-2,0,.1],[0,.3,.7],[2,.9,1]]};
test('cohort percentiles preserve ties, tails and shared colors independently of patient ranges',()=>{
  expect(cohortPosition(-3,tied)).toBe(0);expect(cohortPosition(-2,tied)).toBe(.05);expect(cohortPosition(0,tied)).toBe(.5);
  expect(cohortPosition(-1,tied)).toBeCloseTo(.2);expect(cohortPosition(1,tied)).toBeCloseTo(.8);expect(cohortPosition(2,tied)).toBe(.95);expect(cohortPosition(3,tied)).toBe(1);
  expect(cohortPosition(4,{id:'constant',nPatients:16,knots:[[4,0,1]]})).toBe(.5);
  const one={limit:2,balanced:[-2,0,2] as [number,number,number],cohortReference:tied},two={...one,limit:1000,balanced:[-1000,100,1000] as [number,number,number]};
  expect(featureColor(1,featureScale(one,'cohort'))).toEqual(featureColor(1,featureScale(two,'cohort')));
  expect(featureScale({limit:2,balanced:[-1,0,1]},'cohort')).toEqual([-1,0,1]);
});

const dense:CohortReference={id:'dense-test',nPatients:16,knots:Array.from({length:1001},(_,i)=>[(2*i/1000-1)**3,Math.max(0,i/1000-.0002),Math.min(1,i/1000+.0002)])};
const slider=async(page:any,value:number)=>page.getByLabel('Feature map opacity',{exact:true}).evaluate((el:HTMLInputElement,n:number)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,String(n));el.dispatchEvent(new Event('input',{bubbles:true}));},value);

test('all four image views use cohort colors with a full-size lookup and no extra asset downloads on scale changes',async({page})=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const {requests}=await residentPhantoms(page,{cohortReference:dense,featureValue:.25});
  await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  const native=await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL());
  await page.getByRole('button',{name:'Show radiomic maps',exact:true}).click();await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  await expect(page.getByLabel('Feature scale',{exact:true})).toHaveValue('cohort');await expect(page.getByLabel('Feature color scale',{exact:true})).toHaveText('P0P50P100');await expect(page.getByText('16 reference patients',{exact:true})).toBeVisible();
  await page.getByLabel('Layers',{exact:true}).click();await slider(page,1);await page.getByLabel('Layers',{exact:true}).click();
  const rgb=featureColor(.25,dense);
  // Count the expected color in both GPU CPRs and both CPU slice views.
  for(const selector of ['.straight','.curved','.cross','.axial']){
    const png=await page.locator(selector).screenshot();
    const count=await page.evaluate(async({base64,rgb})=>{
      const im=new Image();im.src=`data:image/png;base64,${base64}`;await im.decode();const canvas=document.createElement('canvas');canvas.width=im.width;canvas.height=im.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(im,0,0);
      const data=ctx.getImageData(0,0,im.width,im.height).data;let count=0;for(let i=0;i<data.length;i+=4)if(rgb.every((v,j)=>Math.abs(v-data[i+j])<=6))count++;return count;
    },{base64:png.toString('base64'),rgb});expect(count,selector).toBeGreaterThan(10);
  }
  const before=requests.length;
  await page.getByLabel('Feature scale',{exact:true}).selectOption('balanced');await expect(page.getByLabel('Feature color scale')).not.toHaveText('P0P50P100');
  await page.getByLabel('Feature scale',{exact:true}).selectOption('raw');await page.getByLabel('Feature scale',{exact:true}).selectOption('cohort');
  expect(requests.slice(before).filter(p=>p.includes('/assets/'))).toEqual([]);
  await page.screenshot({path:'test-results/cohort-colors.png'});
  await page.getByRole('button',{name:'Show radiomic maps',exact:true}).click();expect(await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL())).toBe(native);
  expect(errors).toEqual([]);
});

test('unmatched maps retain balanced coloring and disable the cohort option',async({page})=>{
  await residentPhantoms(page);await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  await page.getByRole('button',{name:'Show radiomic maps',exact:true}).click();await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  await expect(page.getByLabel('Feature scale',{exact:true})).toHaveValue('balanced');await expect(page.locator('.scale-select option[value=cohort]')).toBeDisabled();
  await expect(page.getByText('16 reference patients',{exact:true})).toHaveCount(0);
});
