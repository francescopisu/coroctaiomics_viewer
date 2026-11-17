import {test,expect,type Page} from '@playwright/test';

async function installPhantom(page:Page,textured=false){
  const center=(z:number)=>10*Math.sin(Math.PI*z/60)**2+(textured?.7*Math.sin(Math.PI*z/2):0);
  const nx=181,ny=161,nz=241,spacing=.25,count=nx*ny*nz,ct=new Int16Array(count),mask=new Uint8Array(count),empty=new Uint8Array(count);
  for(let k=0;k<nz;k++){
    const z=k*spacing,cx=center(z);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const offset=i+nx*(j+ny*k),inside=(i*spacing-15-cx)**2+(j*spacing-20)**2<=4;
      ct[offset]=inside?500:textured?(k%2?450:-100):200;mask[offset]=inside?1:0;
    }
  }
  const points=Array.from({length:textured?121:61},(_,i)=>{const z=i*(textured?.5:1);return [center(z),0,z];});
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(...points[i].map((x,j)=>x-points[i-1][j])));
  const tangents=points.map(p=>{const z=p[2],dx=10*Math.PI/60*Math.sin(2*Math.PI*z/60)+(textured?.7*Math.PI/2*Math.cos(Math.PI*z/2):0),length=Math.hypot(dx,1);return [dx/length,0,1/length];});
  const line={points,distances,tangents,u:tangents.map(t=>[t[2],0,-t[0]]),v:points.map(()=>[0,1,0]),radii:points.map(()=>2)};
  const affineLPS=[[spacing,0,0,-15],[0,spacing,0,-20],[0,0,spacing,0],[0,0,0,1]];
  const volume={dimensions:[nx,ny,nz],spacing:[spacing,spacing,spacing],origin:[-15,-20,0],direction:[1,0,0,0,1,0,0,0,1],affineLPS,scalarType:'int16',ct:'/api/test/ct',lumen:'/api/test/lumen',cpe:'/api/test/cpe'};
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/cases/synthetic')return route.fulfill({json:{patientId:'synthetic',sampling:{widthPixels:50,resolutionMm:.5,pointSpacingMm:1},geometry:{shape:[nx,ny,nz],affineLPS},vessels:{LAD:line,LCx:line,RCA:line},volumes:{LAD:volume,LCx:volume,RCA:volume},surfaces:{},featureMaps:{LAD:[],LCx:[],RCA:[]},axial:'/api/test/axial',axialVolume:{ct:'/api/test/ct',labels:'/api/test/lumen',scalarType:'int16'}}});
    if(path.startsWith('/api/test/axial/')){
      const k=Number(path.split('/').at(-1)),plane=Float32Array.from(ct.subarray(k*nx*ny,(k+1)*nx*ny));
      return route.fulfill({body:Buffer.concat([Buffer.from(plane.buffer),Buffer.from(mask.subarray(k*nx*ny,(k+1)*nx*ny))])});
    }
    return route.fulfill({body:Buffer.from(path.endsWith('/ct')?ct.buffer:path.endsWith('/lumen')?mask.buffer:empty.buffer)});
  });
}

test('a known-diameter vessel retains horizontal scale through curved CPR rotation',async({page})=>{
  // Circular tube around a bowed centerline. Its midpoint tangent is axial, so
  // every rotating sampling direction must show the same 4 mm diameter.
  await installPhantom(page);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/viewer/synthetic');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:60000});
  const curved=page.getByLabel('Curved CPR',{exact:true}),straight=page.getByLabel('Straightened reconstruction',{exact:true});
  const widths:number[]=[];
  for(let step=0;step<8;step++){
    if(step){const box=(await curved.boundingBox())!;await page.mouse.move(box.x+box.width/2-37.5,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width/2+37.5,box.y+box.height*.4,{steps:3});await page.mouse.up();}
    await expect(page.getByLabel('CPR rotation')).toHaveText(`${step*45}°`);
    const dimensions=await page.locator('.cpr-render').evaluate(el=>({...((el as HTMLElement).dataset)}));
    expect(dimensions.straightPixelsPerMm).toBe(dimensions.curvedPixelsPerMm);expect(dimensions.straightHeight).toBe(dimensions.curvedHeight);
    expect(dimensions.straightWidth).toBe(dimensions.curvedWidth);
    expect(Number(dimensions.curvedHeight)).toBeGreaterThan(80);
    const measure=async(view:typeof curved)=>{
      const shot=await view.screenshot({style:'.angle,.position-marker{visibility:hidden}'});
      return page.evaluate(async base64=>{
        const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,Math.floor(canvas.height/2),canvas.width,1).data;
        // 350 HU is halfway between the 500 HU tube and 200 HU backdrop;
        // it maps to 159.375 at the viewer's W=800/L=250 window.
        const foreground=Array.from({length:canvas.width},(_,i)=>i).filter(i=>pixels[i*4]>159&&pixels[i*4+1]>159&&pixels[i*4+2]>159);
        const background=Array.from({length:canvas.width},(_,i)=>i).filter(i=>pixels[i*4]>64&&pixels[i*4+1]>64&&pixels[i*4+2]>64);
        return {lumen:foreground.length?foreground.at(-1)!-foreground[0]+1:0,image:background.length?background.at(-1)!-background[0]+1:0};
      },shot.toString('base64'));
    };
    const curvedSize=await measure(curved),straightSize=await measure(straight),width=curvedSize.lumen;widths.push(width);
    expect(width).toBeGreaterThan(0);expect(Math.abs(width-4*Number(dimensions.curvedPixelsPerMm))).toBeLessThan(2);
    expect(Math.abs(width-straightSize.lumen)).toBeLessThanOrEqual(2);
    // Visible CT image extents must match too, rather than only the panel CSS.
    expect(Math.abs(curvedSize.image-straightSize.image)).toBeLessThanOrEqual(2);expect(curvedSize.image).toBeGreaterThan(width*4);
    if(step===0||step===2)await curved.screenshot({path:`test-results/constant-diameter-${step*45}.png`});
  }
  // Rasterization may move an edge by one screen pixel; magnification may not.
  expect(Math.max(...widths)-Math.min(...widths)).toBeLessThanOrEqual(2);expect(errors).toEqual([]);
});

test('adaptive CPR antialiasing reduces undersampled background while preserving the vessel core',async({page})=>{
  await installPhantom(page,true);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/viewer/synthetic');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:60000});
  const straight=page.getByLabel('Straightened reconstruction',{exact:true}),curved=page.getByLabel('Curved CPR',{exact:true});
  const capture=(path?:string)=>straight.screenshot({path,style:'.angle,.position-marker{visibility:hidden}'});
  const on=await capture('test-results/antialias-phantom-on.png'),curvedOn=await curved.screenshot(),crossOn=await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Pixel antialiasing',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();const off=await capture('test-results/antialias-phantom-off.png');
  const metric=async(buffer:Buffer)=>page.evaluate(async base64=>{
    const im=new Image();im.src=`data:image/png;base64,${base64}`;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d')!;ctx.drawImage(im,0,0);const a=ctx.getImageData(0,0,c.width,c.height).data;
    const background:number[]=[],core:number[]=[];for(let y=Math.floor(c.height*.3);y<c.height*.7;y++){
      for(let x=Math.floor(c.width*.1);x<c.width*.25;x++)background.push(a[(x+y*c.width)*4]);core.push(a[(Math.floor(c.width/2)+y*c.width)*4]);
    }
    const mean=background.reduce((s,x)=>s+x,0)/background.length,variance=background.reduce((s,x)=>s+(x-mean)**2,0)/background.length;
    return {variance,core};
  },buffer.toString('base64'));
  const a=await metric(on),b=await metric(off);console.log('Background variance AA on/off:',a.variance,b.variance);
  expect(a.variance).toBeLessThan(b.variance*.85);expect(a.core).toEqual(b.core);
  expect((await curved.screenshot()).equals(curvedOn)).toBe(true);expect(await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(crossOn);
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Pixel antialiasing',exact:true}).check();await page.getByLabel('Layers',{exact:true}).click();expect((await capture()).equals(on)).toBe(true);
  await test.info().attach('antialias-on.png',{body:on,contentType:'image/png'});await test.info().attach('antialias-off.png',{body:off,contentType:'image/png'});expect(errors).toEqual([]);
});
