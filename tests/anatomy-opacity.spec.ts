import {test,expect,type Locator} from '@playwright/test';
import {residentPhantoms} from './helpers/residentPhantom';

const setSlider=(slider:Locator,value:number)=>slider.evaluate((element,newValue)=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,String(newValue));
  element.dispatchEvent(new Event('input',{bubbles:true}));
},value);

test('all anatomy opacity sliders share a full-range value across anatomy and CPE volume modes',async({page})=>{
  const {requests}=await residentPhantoms(page,{aorta:true}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  const scene=page.locator('.resident-viewer.is-active .scene'),gear=page.getByLabel('Layers',{exact:true});
  const aorta=page.getByLabel('Aorta opacity',{exact:true}),lumen=page.getByLabel('Lumen opacity',{exact:true}),context=page.getByLabel('CPE anatomical context opacity',{exact:true});
  const envelopes=page.getByRole('button',{name:'Show periluminal envelopes',exact:true});
  const check=async(value:number)=>{
    await expect(aorta).toHaveValue(String(value));await expect(lumen).toHaveValue(String(value));
    await expect(scene).toHaveAttribute('data-aorta-opacity',String(value));await expect(scene).toHaveAttribute('data-lumen-opacity',String(value));
  };
  await expect(scene).toHaveAttribute('data-render-mode','anatomy');await check(.5);
  const cross=await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL()),baseline=requests.length;
  await gear.click();await setSlider(aorta,.37);await check(.37);
  await setSlider(lumen,.68);await check(.68);await gear.click();
  expect(await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL())).toBe(cross);
  await envelopes.click();await expect(scene).toHaveAttribute('data-volume-ready','true');await expect(scene).toHaveAttribute('data-render-mode','cpe');
  await page.getByLabel('CPE volume settings',{exact:true}).click();await expect(context).toHaveValue('0.68');await check(.68);
  await setSlider(context,1);await check(1);await setSlider(context,.25);await check(.25);
  await envelopes.click();await expect(scene).toHaveAttribute('data-render-mode','anatomy');await check(.25);
  await gear.click();await setSlider(lumen,0);await check(0);await setSlider(aorta,1);await check(1);await gear.click();
  await envelopes.click();await expect(scene).toHaveAttribute('data-render-mode','cpe');await check(1);await expect(context).toHaveValue('1');
  expect(requests.slice(baseline).filter(path=>path.includes('/assets/'))).toEqual([]);expect(errors).toEqual([]);
});
