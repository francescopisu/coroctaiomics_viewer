import {test,expect} from '@playwright/test';
import {residentPhantoms} from './helpers/residentPhantom';

test('default CPR lumen overlays are thin contours with untouched interiors',async({page})=>{
  await residentPhantoms(page);const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  const views=[page.getByLabel('Straightened reconstruction',{exact:true}),page.getByLabel('Curved CPR',{exact:true})];
  const captures=()=>Promise.all(views.map(view=>view.screenshot({style:'.angle,.position-marker{visibility:hidden}'})));
  const on=await captures();
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Lumen',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();
  const off=await captures();
  for(let view=0;view<2;view++){
    const metric=await page.evaluate(async pair=>{
      const rows:number[][]=[];
      for(const source of pair){const image=new Image();image.src=`data:image/png;base64,${source}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);rows.push(Array.from(context.getImageData(0,Math.floor(canvas.height*.55),canvas.width,1).data));}
      const width=rows[0].length/4,centre=Math.floor(width/2)*4;
      return {centreOn:rows[0].slice(centre,centre+3),centreOff:rows[1].slice(centre,centre+3),changed:Array.from({length:width},(_,x)=>x).filter(x=>Math.abs(rows[0][x*4]-rows[1][x*4])>3).length,bright:Array.from({length:width},(_,x)=>x).filter(x=>rows[0][x*4]>220).length};
    },[on[view].toString('base64'),off[view].toString('base64')]);
    expect(metric.centreOn).toEqual(metric.centreOff);
    expect(metric.changed).toBeGreaterThan(0);expect(metric.changed).toBeLessThanOrEqual(8);
    expect(metric.bright).toBeGreaterThan(0);expect(metric.bright).toBeLessThanOrEqual(6);
  }
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Lumen',exact:true}).check();await page.getByLabel('Layers',{exact:true}).click();
  await views[1].screenshot({path:'test-results/cpr-lumen-outline.png'});
  expect(errors).toEqual([]);
});

test('Smooth edges suppresses voxel-scale lumen zigzags without changing the CCTA',async({page})=>{
  await residentPhantoms(page,{jaggedLumen:true});const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  const views=[page.getByLabel('Straightened reconstruction',{exact:true}),page.getByLabel('Curved CPR',{exact:true})],gear=page.getByLabel('Layers',{exact:true});
  const captures=()=>Promise.all(views.map(view=>view.screenshot({style:'.angle,.position-marker{visibility:hidden}'})));
  const smooth=await captures();
  await gear.click();await page.getByRole('checkbox',{name:'Smooth edges',exact:true}).uncheck();await gear.click();
  const raw=await captures();
  for(let view=0;view<2;view++){
    const roughness=await page.evaluate(async pair=>{
      const metrics:number[]=[];
      for(const source of pair){
        const image=new Image();image.src=`data:image/png;base64,${source}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const p=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        const edge:number[]=[];
        for(let y=Math.floor(canvas.height*.2);y<canvas.height*.8;y+=2){let sum=0,weight=0;for(let x=0;x<canvas.width/2-4;x++){const value=Math.max(0,p[(x+y*canvas.width)*4]-180);sum+=x*value;weight+=value;}if(weight)edge.push(sum/weight);}
        let variation=0;for(let i=2;i<edge.length;i++)variation+=Math.abs(edge[i]-2*edge[i-1]+edge[i-2]);metrics.push(variation/Math.max(1,edge.length-2));
      }
      return metrics;
    },[smooth[view].toString('base64'),raw[view].toString('base64')]);
    expect(roughness[1]).toBeGreaterThan(.01);expect(roughness[0]).toBeLessThan(roughness[1]*.9);
  }
  await gear.click();await page.getByRole('checkbox',{name:'Lumen',exact:true}).uncheck();await gear.click();const ctRaw=await captures();
  await gear.click();await page.getByRole('checkbox',{name:'Smooth edges',exact:true}).check();await gear.click();const ctSmooth=await captures();
  expect(ctSmooth[0].equals(ctRaw[0])).toBe(true);expect(ctSmooth[1].equals(ctRaw[1])).toBe(true);
  await gear.click();await page.getByRole('checkbox',{name:'Lumen',exact:true}).check();await gear.click();
  await page.locator('.recon').screenshot({path:'test-results/smoothed-lumen-contours.png'});
  expect(errors).toEqual([]);
});
