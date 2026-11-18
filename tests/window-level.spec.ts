import {test,expect} from '@playwright/test';
import {residentPhantoms} from './helpers/residentPhantom';

test('right-drag windows every CCTA view without moving slices or rotating the vessel',async({page})=>{
  const {requests}=await residentPhantoms(page),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/viewer/96');
  await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  const gear=page.getByLabel('Layers',{exact:true}),width=page.getByLabel('Window width',{exact:true}),level=page.getByLabel('Window level',{exact:true});
  const cross=page.locator('.cross canvas'),axial=page.locator('.axial canvas');
  const crossIndex=await cross.getAttribute('data-centreline-index'),axialIndex=await axial.getAttribute('data-slice-index');
  const baseline=requests.length;
  for(const target of [page.getByLabel('Straightened reconstruction',{exact:true}),page.getByLabel('Curved CPR',{exact:true}),page.getByRole('group',{name:'Orthogonal slice navigation',exact:true}),page.getByRole('group',{name:'Axial slice navigation',exact:true})]){
    await gear.click();await width.fill('800');await level.fill('250');await gear.click();
    const beforeCross=await cross.evaluate(c=>(c as HTMLCanvasElement).toDataURL()),beforeAxial=await axial.evaluate(c=>(c as HTMLCanvasElement).toDataURL());
    const box=(await target.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down({button:'right'});
    await page.mouse.move(x+30,y-20,{steps:4});
    await expect(width).toHaveValue('860');await expect(level).toHaveValue('290');
    await expect(page.locator('.window-level-readout:visible')).toHaveText('W 860 · L 290');
    await page.mouse.up({button:'right'});
    await expect(page.locator('.window-level-readout')).toHaveCount(0);
    expect(await cross.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(beforeCross);
    expect(await axial.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(beforeAxial);
    await expect(cross).toHaveAttribute('data-centreline-index',crossIndex!);
    await expect(axial).toHaveAttribute('data-slice-index',axialIndex!);
    await expect(page.getByLabel('Straightened rotation')).toHaveText('0°');
    await expect(page.getByLabel('CPR rotation')).toHaveText('0°');
    expect(await target.evaluate(element=>{const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});element.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  }
  // Pointer capture keeps a right drag working after it leaves its original panel.
  const view=page.getByRole('group',{name:'Orthogonal slice navigation',exact:true}),box=(await view.boundingBox())!;
  await page.mouse.move(box.x+5,box.y+box.height/2);await page.mouse.down({button:'right'});await page.mouse.move(box.x-50,box.y+box.height/2);await page.mouse.up({button:'right'});
  const after=await width.inputValue();await page.mouse.move(box.x+30,box.y+30);await expect(width).toHaveValue(after);
  // Narrow windows stay positive, and vertical movement leaves width unchanged.
  await gear.click();await width.fill('2');await level.fill('250');await gear.click();
  await page.mouse.move(box.x+100,box.y+100);await page.mouse.down({button:'right'});await page.mouse.move(box.x+60,box.y+100);await page.mouse.up({button:'right'});await expect(width).toHaveValue('1');
  await page.mouse.down({button:'right'});await page.mouse.move(box.x+60,box.y+80);await page.mouse.up({button:'right'});await expect(width).toHaveValue('1');await expect(level).toHaveValue('255');
  // Existing left-button gestures still work after windowing.
  await page.mouse.move(box.x+100,box.y+100);await page.mouse.down();await page.mouse.move(box.x+100,box.y+92);await page.mouse.up();
  await expect(cross).toHaveAttribute('data-centreline-index',String(Number(crossIndex)-2));
  const curved=page.getByLabel('Curved CPR',{exact:true}),curvedBox=(await curved.boundingBox())!;
  await page.mouse.move(curvedBox.x+100,curvedBox.y+100);await page.mouse.down();await page.mouse.move(curvedBox.x+140,curvedBox.y+100);await page.mouse.up();
  await expect(page.getByLabel('CPR rotation')).toHaveText('24°');
  expect(requests.slice(baseline).filter(path=>path.startsWith('/api/cases/'))).toEqual([]);
  expect(errors).toEqual([]);
});
