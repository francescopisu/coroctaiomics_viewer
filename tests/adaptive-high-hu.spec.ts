import {test,expect,type Locator} from '@playwright/test';
import {residentPhantoms} from './helpers/residentPhantom';
import {highHuThreshold,volumeOpacityNodes,volumeColorNodes} from '../src/cpeVolumeData';

test('blood reference changes only the upper display boundary and retains fixed fallback',()=>{
  const reference={available:true,version:1,thresholdHU:635};
  expect(highHuThreshold(reference,true)).toBe(635);expect(highHuThreshold(reference,false)).toBe(350);
  expect(highHuThreshold(undefined,true)).toBe(350);expect(highHuThreshold({...reference,thresholdHU:Infinity},true)).toBe(350);
  const gains={fat:1,low:1,intermediate:0,high:1},fixed=volumeOpacityNodes('balanced',1,gains),adaptive=volumeOpacityNodes('balanced',1,gains,635);
  expect(adaptive.filter(([x])=>x<30)).toEqual(fixed.filter(([x])=>x<30));
  const at=(x:number)=>{const upper=adaptive.findIndex(([a])=>a>=x),[lo,lv]=adaptive[upper-1],[hi,hv]=adaptive[upper];return lv+(hv-lv)*(x-lo)/(hi-lo);};
  expect(at(400)).toBe(0);expect(at(588)).toBe(0);expect(at(900)).toBeGreaterThan(0);
  for(const t of [350,635,2900])for(const nodes of [volumeOpacityNodes('balanced',1,gains,t),volumeColorNodes(t)]){
    expect(nodes[0][0]).toBe(-1024);expect(nodes.at(-1)![0]).toBe(4096);
    expect(nodes.every((node,i)=>i===0||node[0]>nodes[i-1][0])).toBe(true);
  }
});

const setSlider=(slider:Locator,value:number)=>slider.evaluate((element,newValue)=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,String(newValue));element.dispatchEvent(new Event('input',{bubbles:true}));
},value);

test('adaptive rendering suppresses blood-like HU while retaining denser material and the original CT',async({page})=>{
  const {requests}=await residentPhantoms(page,{bloodPoolThreshold:635,cpeHu:[400,900]}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  const original=await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL());
  await page.getByRole('button',{name:'Show periluminal envelopes',exact:true}).click();await expect(page.locator('.scene')).toHaveAttribute('data-volume-ready','true');
  await page.getByLabel('CPE volume settings',{exact:true}).click();await setSlider(page.getByLabel('CPE anatomical context opacity',{exact:true}),0);
  const adaptive=page.getByLabel('Tissue rendering reference',{exact:true});await expect(adaptive).toHaveValue('blood');await expect(page.getByLabel('High HU threshold')).toHaveText('635 HU · aortic P99');
  await page.getByLabel('CPE volume settings',{exact:true}).click();
  const capture=()=>page.locator('.scene').screenshot({style:'.lps-cube{visibility:hidden}'});
  const on=await capture();const before=requests.length;
  await page.getByLabel('CPE volume settings',{exact:true}).click();await adaptive.selectOption('fixed');await expect(page.getByLabel('High HU threshold')).toHaveText('350 HU · fixed');await page.getByLabel('CPE volume settings',{exact:true}).click();
  const off=await capture();
  const white=await page.evaluate(async pair=>{
    const totals:number[][]=[];
    for(const data of pair){const image=new Image();image.src=`data:image/png;base64,${data}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const p=ctx.getImageData(0,0,canvas.width,canvas.height).data;const halves=[0,0];for(let y=Math.floor(canvas.height*.25);y<canvas.height*.7;y++)for(let x=0;x<canvas.width;x++){const i=(x+y*canvas.width)*4;if(p[i]>180&&p[i+1]>180&&p[i+2]>180)halves[x<canvas.width/2?0:1]++;}totals.push(halves);}
    return totals;
  },[on.toString('base64'),off.toString('base64')]);
  expect(white[1][0]).toBeGreaterThan(20);expect(white[0][0]).toBeLessThan(white[1][0]*.4);
  expect(white[0][1]).toBeGreaterThan(20);
  await page.getByLabel('CPE volume settings',{exact:true}).click();await adaptive.selectOption('blood');await page.getByLabel('CPE volume settings',{exact:true}).click();
  expect(await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe('');
  // Hide CPE masks again; its original grayscale/contours must be unchanged.
  await page.getByRole('button',{name:'Show periluminal envelopes',exact:true}).click();
  expect(await page.locator('.cross canvas').evaluate(c=>(c as HTMLCanvasElement).toDataURL())).toBe(original);
  expect(requests.slice(before).filter(path=>path.includes('/assets/'))).toEqual([]);expect(errors).toEqual([]);
});
