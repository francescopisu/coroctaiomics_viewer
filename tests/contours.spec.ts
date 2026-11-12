import {test,expect} from '@playwright/test';
import {contours,type Point2} from '../src/contours';

const inside=(p:Point2,loop:Point2[])=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){
  const a=loop[i],b=loop[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
}return yes;};
test('subpixel contour follows an off-grid circle without modifying scalar data',()=>{
  const n=80,cx=.487,cy=.519,r=.273,field=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)field[x+y*n]=Math.max(0,Math.min(1,.5+(r-Math.hypot((x+.5)/n-cx,(y+.5)/n-cy))*n));
  const original=field.slice(),loops=contours(field,n,n);expect(loops).toHaveLength(1);expect(field).toEqual(original);
  expect(Math.max(...loops[0].map(p=>Math.abs(Math.hypot(p[0]-cx,p[1]-cy)-r)))).toBeLessThan(1/n);
  expect(loops[0].some(p=>Math.abs(p[0]*n-Math.round(p[0]*n))>.1)).toBe(true);
});
test('ring contours retain the lumen hole and a separate small component',()=>{
  const n=100,field=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const px=(x+.5)/n,py=(y+.5)/n,r=Math.hypot(px-.4,py-.5);
    const ring=Math.min(.3-r,r-.12),island=.035-Math.hypot(px-.88,py-.2);field[x+y*n]=Math.max(0,Math.min(1,.5+Math.max(ring,island)*n));}
  const loops=contours(field,n,n);expect(loops).toHaveLength(3);
  const filled=(p:Point2)=>loops.filter(loop=>inside(p,loop)).length%2===1;
  expect(filled([.4,.5])).toBe(false);expect(filled([.6,.5])).toBe(true);expect(filled([.88,.2])).toBe(true);expect(filled([.9,.9])).toBe(false);
});
test('ambiguous diagonal foreground samples stay separate rather than joining',()=>{
  expect(contours(new Float32Array([1,0,0,1]),2,2)).toHaveLength(2);
});
