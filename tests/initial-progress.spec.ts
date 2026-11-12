import {test,expect} from '@playwright/test';
import {InitialProgress} from '../src/initialProgress';
import {binary,type Case,type TransferProgress} from '../src/types';

test('startup progress counts unique decoded bytes monotonically and waits for first render',()=>{
  const values=[0],p=new InitialProgress(n=>values.push(n));
  const data={surfaces:{lumen:{points:'/p',cells:'/c',smoothPoints:'/s',normals:'/n',vertices:3,triangles:1}},volumes:{LAD:{dimensions:[2,2,2],scalarType:'int16',ct:'/ct',lumen:'/l',cpe:'/e',cpeDisplay:'/d'}},geometry:{shape:[2,2,2]},axialVolume:{ct:'/full-ct',labels:'/bits',scalarType:'int16'}} as unknown as Case;
  p.plan(data);expect(values.at(-1)).toBe(2);
  // Crop CT is shared from the full stack; only vessel masks are downloaded.
  expect(p.expectedBytes('/ct')).toBeUndefined();p.receive('/l',8);const partial=values.at(-1)!;expect(partial).toBeGreaterThan(2);p.receive('/l',4);expect(values.at(-1)).toBe(partial);
  p.receive('/unknown',99999);expect(values.at(-1)).toBe(partial);
  for(const url of ['/p','/c','/s','/n','/l','/e','/d','/full-ct','/bits'])p.receive(url,p.expectedBytes(url)!);
  expect(values.at(-1)).toBe(98);expect(values.every((n,i)=>!i||n>=values[i-1])).toBe(true);
  p.complete();expect(values.at(-1)).toBe(100);expect(p.expectedBytes('/ct')).toBeUndefined();p.receive('/ct',0);expect(values.at(-1)).toBe(100);
});

test('streaming progress uses decoded geometry size rather than compressed Content-Length',async()=>{
  const fetchOriginal=globalThis.fetch,received:number[]=[];
  const tracker:TransferProgress={expectedBytes:()=>4,receive:(_,n)=>received.push(n)};
  try{
    globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4]));c.close();}}),{headers:{'Content-Length':'2','Content-Encoding':'gzip'}});
    expect(Array.from(new Uint8Array(await binary('/test',undefined,tracker)))).toEqual([1,2,3,4]);expect(received).toEqual([2,4]);
    globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));await expect(binary('/test',undefined,tracker)).rejects.toThrow('Incomplete case asset');
  }finally{globalThis.fetch=fetchOriginal;}
});
