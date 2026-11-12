import {type Case,type TransferProgress} from './types';

/** Initial downloads are byte-weighted; metadata and first render are real stages. */
export class InitialProgress implements TransferProgress {
  private files=new Map<string,{size:number;received:number}>();
  private total=0;private received=0;private percent=0;private finished=false;
  constructor(private notify:(percent:number)=>void){}
  plan(data:Case){
    this.files.clear();this.total=0;this.received=0;
    const add=(url:string|undefined,size:number)=>{if(url&&!this.files.has(url)){this.files.set(url,{size,received:0});this.total+=size;}};
    for(const s of Object.values(data.surfaces)){
      add(s.points,s.vertices*12);add(s.cells,s.triangles*16);add(s.smoothPoints,s.vertices*12);add(s.normals,s.vertices*12);
    }
    for(const v of Object.values(data.volumes)){
      const count=v.dimensions.reduce((a,b)=>a*b,1);
      add(v.lumen,count);add(v.cpe,count);add(v.cpeDisplay,count);
    }
    const nativeCount=data.geometry.shape.reduce((a,b)=>a*b,1);add(data.axialVolume.ct,nativeCount*(data.axialVolume.scalarType==='int16'?2:4));add(data.axialVolume.labels,nativeCount);this.publish(2);
  }
  expectedBytes(url:string){return this.finished?undefined:this.files.get(url)?.size;}
  receive(url:string,bytes:number){
    const file=this.files.get(url);if(this.finished||!file)return;
    const loaded=Math.max(file.received,Math.min(bytes,file.size));this.received+=loaded-file.received;file.received=loaded;
    this.publish(2+Math.floor(96*this.received/Math.max(1,this.total)));
  }
  complete(){if(!this.finished){this.finished=true;this.publish(100);}}
  private publish(value:number){const next=Math.max(this.percent,Math.min(100,value));if(next!==this.percent){this.percent=next;this.notify(next);}}
}
