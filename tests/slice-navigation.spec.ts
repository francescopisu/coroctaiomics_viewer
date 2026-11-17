import {test,expect} from '@playwright/test';

test('right-hand slices support wheel, vertical drag, crosshair, diameter and camera-linked cube',async({page,request})=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const manifest=await (await request.get('/api/case')).json();
  await page.goto('/viewer/1718');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  await expect(page.getByRole('slider',{name:'Longitudinal position'})).toHaveCount(0);
  const cross=page.locator('.cross canvas'),axial=page.locator('.axial canvas'),crossNav=page.getByRole('group',{name:'Orthogonal slice navigation'}),axialNav=page.getByRole('group',{name:'Axial slice navigation'});
  const attr=async(el:typeof cross,key:string)=>Number(await el.getAttribute(key));
  const index=await attr(cross,'data-centreline-index');await crossNav.hover();await page.mouse.wheel(0,100);
  await expect(cross).toHaveAttribute('data-centreline-index',String(index+1));await page.mouse.wheel(0,-100);await expect(cross).toHaveAttribute('data-centreline-index',String(index));
  const drag=async(nav:typeof cross,dy:number)=>{const b=(await nav.boundingBox())!;await page.mouse.move(b.x+b.width*.65,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.65,b.y+b.height*.5+dy,{steps:5});await page.mouse.up();};
  await drag(crossNav,20);await expect(cross).toHaveAttribute('data-centreline-index',String(index+5));await drag(crossNav,-20);await expect(cross).toHaveAttribute('data-centreline-index',String(index));
  const slice=await attr(axial,'data-slice-index');await axialNav.hover();await page.mouse.wheel(0,100);await expect(axial).toHaveAttribute('data-slice-index',String(slice+1));
  await page.mouse.wheel(0,-100);await expect(axial).toHaveAttribute('data-slice-index',String(slice));
  await drag(axialNav,20);await expect(axial).toHaveAttribute('data-slice-index',String(slice+5));await drag(axialNav,-20);await expect(axial).toHaveAttribute('data-slice-index',String(slice));
  await axialNav.press('Home');await expect(axial).toHaveAttribute('data-slice-index','0');await page.mouse.wheel(0,-100);await expect(axial).toHaveAttribute('data-slice-index','0');
  await axialNav.press('End');await expect(axial).toHaveAttribute('data-slice-index',String(manifest.geometry.shape[2]-1));await page.mouse.wheel(0,100);await expect(axial).toHaveAttribute('data-slice-index',String(manifest.geometry.shape[2]-1));
  await crossNav.press('Home');for(let i=0;i<30;i++)await crossNav.press('ArrowDown');await expect(cross).toHaveAttribute('data-centreline-index','30');
  await expect.poll(()=>attr(cross,'data-lumen-diameter-mm')).toBeGreaterThan(0);
  await expect.poll(()=>attr(axial,'data-slice-index')).toBe(Math.round((manifest.vessels.LAD.points[30][2]-manifest.geometry.affineLPS[2][3])/manifest.geometry.affineLPS[2][2]));
  // Crosshair is rendered with red horizontal / green vertical arms, separated at centre.
  const colors=await axial.evaluate((el:HTMLCanvasElement)=>{const ctx=el.getContext('2d')!,x=Math.round(Number(el.dataset.crosshairX)),y=Math.round(Number(el.dataset.crosshairY));return [Array.from(ctx.getImageData(100,y,1,1).data),Array.from(ctx.getImageData(x,100,1,1).data)];});
  expect(colors[0][0]).toBeGreaterThan(colors[0][1]);expect(colors[1][1]).toBeGreaterThan(colors[1][0]);
  const cube=page.getByRole('img',{name:'3D LPS orientation cube'});await expect(cube).toBeVisible();const before=await cube.innerHTML();
  const scene=page.locator('.scene'),box=(await scene.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+25,{steps:6});await page.mouse.up();await expect.poll(()=>cube.innerHTML()).not.toBe(before);
  const crossBefore=await cross.evaluate((el:HTMLCanvasElement)=>el.toDataURL()),curved=page.getByLabel('Curved CPR',{exact:true}),b=(await curved.boundingBox())!;
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+60,b.y+b.height/2,{steps:4});await page.mouse.up();expect(await cross.evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(crossBefore);
  await page.screenshot({path:'test-results/slice-navigation.png'});
  expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
});
