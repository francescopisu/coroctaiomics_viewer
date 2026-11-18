import type {Page} from '@playwright/test';

/** Small but real WebGL/CPR/volume sessions, with separate data for each patient. */
export async function residentPhantoms(page:Page,options:{jaggedLumen?:boolean;aorta?:boolean}={}){
  const ids=['96','814','893','fourth'],shape=[64,32,64],n=shape.reduce((a,b)=>a*b,1),spacing=.5;
  const requests:string[]=[];
  const points=Array.from({length:33},(_,i)=>[0,0,-8+i*.5]);
  const line={points,distances:points.map((_,i)=>i*.5),radii:points.map(()=>1),tangents:points.map(()=>[0,0,1]),u:points.map(()=>[1,0,0]),v:points.map(()=>[0,1,0])};
  const vertices=new Float32Array([-2,-2,-8,2,-2,-8,2,2,-8,-2,2,-8,-2,-2,8,2,-2,8,2,2,8,-2,2,8]);
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]],cells=new Uint32Array(faces.flatMap(f=>[3,...f]));
  const fixtures=new Map(ids.map((id,index)=>{
    const ct=new Int16Array(n).fill(-800),labels=new Uint8Array(n),lumen=new Uint8Array(n),cpe=new Uint8Array(n),display=new Uint8Array(n),values=new Float32Array(n),valid=new Uint8Array(n);
    for(let k=0;k<shape[2];k++)for(let j=0;j<shape[1];j++)for(let i=0;i<shape[0];i++){
      const p=i+shape[0]*(j+shape[1]*k),r=Math.hypot(i*spacing-16,j*spacing-8);
      if(r<1){ct[p]=300+index*100;labels[p]=1;lumen[p]=1;}
      else if(r<3){ct[p]=-100+index*20;labels[p]=2;cpe[p]=1;display[p]=255;valid[p]=1;values[p]=(i-32)/6;}
      if(options.jaggedLumen)lumen[p]=Math.hypot(i*spacing-16-(k%2?.4:-.4),j*spacing-8)<1?1:0;
    }
    const base=`/api/cases/${id}/assets/`,affineLPS=[[spacing,0,0,-16],[0,spacing,0,-8],[0,0,spacing,-16],[0,0,0,1]];
    const volume={dimensions:shape,spacing:[spacing,spacing,spacing],origin:[-16,-8,-16],direction:[1,0,0,0,1,0,0,0,1],affineLPS,scalarType:'int16',ct:base+'ct',lumen:base+'lumen',cpe:base+'cpe',cpeDisplay:base+'display'};
    const feature={...volume,id:`feature-${id}`,name:`test_feature_${id}`,vessel:'LAD',startIJK:[0,0,0],minimum:-1,maximum:1,limit:1,balanced:[-1,0,1],values:base+'values',valid:base+'valid',axial:''};
    const data={patientId:id,geometry:{shape,affineLPS},sampling:{widthPixels:50,resolutionMm:.5,pointSpacingMm:.5},vessels:{LAD:line,LCx:line,RCA:line},volumes:{LAD:volume,LCx:volume,RCA:volume},featureMaps:{LAD:[feature],LCx:[],RCA:[]},surfaces:{lumen_merged:{points:base+'points',cells:base+'cells',vertices:8,triangles:12},...(options.aorta?{ascending_aorta:{points:base+'points',cells:base+'cells',vertices:8,triangles:12}}:{})},axialVolume:{ct:base+'ct',labels:base+'labels',scalarType:'int16'}};
    const assets:Record<string,ArrayBufferView>={ct,labels,lumen,cpe,display,values,valid,points:vertices,cells};
    return [id,{data,assets}] as const;
  }));
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;requests.push(path);
    if(path==='/api/patient-labels')return route.fulfill({json:{labels:{}}});
    if(path==='/api/patients')return route.fulfill({json:{patients:ids.map(patientId=>({patientId,available:true,age:50,sex:'Man',cadRads:'Score 2',priRisk:.1,adjustedRisk:.08,stratum:'High'}))}});
    const match=/^\/api\/cases\/([^/]+)(?:\/assets\/(.+))?$/.exec(path),fixture=match&&fixtures.get(match[1]);
    if(!fixture)return route.fulfill({status:404,json:{detail:'Unknown phantom'}});
    if(!match[2])return route.fulfill({json:fixture.data});
    const array=fixture.assets[match[2]];
    return array?route.fulfill({body:Buffer.from(array.buffer)}):route.fulfill({status:404});
  });
  return {ids,requests};
}
