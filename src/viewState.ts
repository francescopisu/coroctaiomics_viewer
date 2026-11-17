import {vessels,type Controls} from './types';
const key=(id:string)=>`coronary-view:${id}`;
export function restoreView(id:string,initial:Controls):Controls{
  try{
    const value=JSON.parse(sessionStorage.getItem(key(id))??'null');
    if(!value||!vessels.includes(value.vessel))return initial;
    const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
    return {...initial,vessel:value.vessel,index:finite(value.index)?Math.max(0,Math.floor(value.index)):initial.index,
      curvedAngle:finite(value.curvedAngle)?((value.curvedAngle%360)+360)%360:0,
      straightAngle:finite(value.straightAngle)?((value.straightAngle%360)+360)%360:0,
      axialSlice:finite(value.axialSlice)&&value.axialSlice>=0?Math.floor(value.axialSlice):undefined};
  }catch{return initial;}
}
export function saveView(id:string,c:Controls){
  try{sessionStorage.setItem(key(id),JSON.stringify({vessel:c.vessel,index:c.index,curvedAngle:c.curvedAngle,straightAngle:c.straightAngle,axialSlice:c.axialSlice}));}catch{/* Storage may be disabled. */}
}
