import {test,expect} from '@playwright/test';

test('LCx and RCA straightened images at orientation sign changes',async({page})=>{
  test.setTimeout(120000);const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/viewer/1718');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:60000});
  for(const vessel of ['LCx','RCA']){
    await page.getByLabel('Vessel',{exact:true}).selectOption(vessel);
    await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:60000});
    await page.getByLabel('Coronary reconstructions',{exact:true}).screenshot({path:`test-results/seams-${vessel}-${process.env.CPR_CAPTURE_TAG??'after'}.png`,style:'.position-marker{visibility:hidden}'});
    if(vessel==='RCA'){
      const straight=page.getByLabel('Straightened reconstruction',{exact:true}),box=(await straight.boundingBox())!;
      await page.mouse.move(box.x+box.width/2-5,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width/2+5,box.y+box.height*.4,{steps:3});await page.mouse.up();
      await straight.screenshot({path:'test-results/straightened-RCA-antialias-on.png',style:'.angle,.position-marker{visibility:hidden}'});
      await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Pixel antialiasing',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();
      await straight.screenshot({path:'test-results/straightened-RCA-antialias-off.png',style:'.angle,.position-marker{visibility:hidden}'});
      await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Pixel antialiasing',exact:true}).check();await page.getByLabel('Layers',{exact:true}).click();
    }
  }
  expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
});
