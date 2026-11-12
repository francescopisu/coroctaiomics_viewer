/** Resources live for one case, independently of the currently selected vessel. */
export class ResourceCache<T extends {dispose():void}> {
  private values=new Map<string,T>();private pending=new Map<string,Promise<T>>();private abort=new AbortController();
  get(key:string){return this.values.get(key);}
  load(key:string,loader:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(this.abort.signal.aborted)return Promise.reject(new DOMException('Case closed','AbortError'));
    const cached=this.values.get(key);if(cached)return Promise.resolve(cached);
    const pending=this.pending.get(key);if(pending)return pending;
    const request=loader(this.abort.signal).then(value=>{
      if(this.abort.signal.aborted){value.dispose();throw new DOMException('Case closed','AbortError');}
      this.values.set(key,value);return value;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,request);return request;
  }
  dispose(){if(this.abort.signal.aborted)return;this.abort.abort();this.values.forEach(value=>value.dispose());this.values.clear();this.pending.clear();}
}
