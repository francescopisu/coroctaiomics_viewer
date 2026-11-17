import {test,expect} from '@playwright/test';

for(const dpr of [1,2])test.describe(`patient antialiasing at device scale ${dpr}`,()=>{
  test.use({deviceScaleFactor:dpr});
  test('toggle changes eligible straightened pixels and preserves core and linked views',async({page,request})=>{
    test.setTimeout(180000);const data=await (await request.get('/api/case')).json();test.skip(data.patientId!=='1718','Patient-specific sampling audit');
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('/viewer/1718');const viewer=page.locator('main');await expect(viewer).toHaveAttribute('aria-busy','false',{timeout:90000});
    await page.getByRole('button',{name:'CPE masks',exact:true}).click();await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Lumen',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();
    const results:Record<string,unknown>[]=[];
    for(const vessel of ['LAD','RCA']){
      await page.getByLabel('Vessel',{exact:true}).selectOption(vessel);await expect(viewer).toHaveAttribute('aria-busy','false',{timeout:90000});await expect(page.locator('.recon .loading')).toHaveCount(0);
      const straight=page.getByLabel('Straightened reconstruction',{exact:true}),curved=page.getByLabel('Curved CPR',{exact:true}),box=(await straight.boundingBox())!;
      await page.mouse.move(box.x+box.width/2-5,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width/2+5,box.y+box.height*.4,{steps:3});await page.mouse.up();
      const on=await straight.screenshot({path:`test-results/patient-${vessel}-dpr${dpr}-AA-on.png`,style:'.angle,.position-marker{visibility:hidden}'}),other=await curved.screenshot(),cross=await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
      await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Pixel antialiasing',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();
      const off=await straight.screenshot({path:`test-results/patient-${vessel}-dpr${dpr}-AA-off.png`,style:'.angle,.position-marker{visibility:hidden}'});
      const metrics=await page.evaluate(async({pair,scale})=>{
        const arrays=[];let width=0,height=0;
        for(const data of pair){const im=new Image();im.src=`data:image/png;base64,${data}`;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;width=c.width;height=c.height;const ctx=c.getContext('2d')!;ctx.drawImage(im,0,0);arrays.push(ctx.getImageData(0,0,width,height).data);}
        let changed=0,total=0,sum=0,max=0,coreMax=0;
        for(let y=35*scale;y<height-30*scale;y++)for(let x=0;x<width;x++){
          const i=(x+y*width)*4,d=Math.max(...[0,1,2].map(j=>Math.abs(arrays[0][i+j]-arrays[1][i+j])));changed+=d>0?1:0;sum+=d;max=Math.max(max,d);total++;
          if(x===Math.floor(width/2))coreMax=Math.max(coreMax,d);
        }
        return {changedPercent:changed/total*100,meanByteDifference:sum/total,maxByteDifference:max,coreMax};
      },{pair:[on.toString('base64'),off.toString('base64')],scale:dpr});
      // A high-density display may legitimately leave almost every pixel unchanged.
      expect(metrics.coreMax).toBe(0);expect((await curved.screenshot()).equals(other)).toBe(true);expect(await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(cross);
      results.push({vessel,dpr,...metrics});console.log(JSON.stringify(results.at(-1)));
      await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Pixel antialiasing',exact:true}).check();await page.getByLabel('Layers',{exact:true}).click();
      expect((await straight.screenshot({style:'.angle,.position-marker{visibility:hidden}'})).equals(on)).toBe(true);
    }
    expect(results.some(r=>Number(r.changedPercent)>0)).toBe(true);await test.info().attach('pixel-differences.json',{body:JSON.stringify(results,null,2),contentType:'application/json'});expect(errors).toEqual([]);
  });
});
