import {test,expect} from '@playwright/test';
import {ResourceCache} from '../src/resourceCache';

test('case resources survive deselection, share pending loads and are released once',async()=>{
  let calls=0,released=0,finish!:(value:{dispose():void})=>void;const cache=new ResourceCache<{dispose():void}>(),load=()=>{calls++;return new Promise<{dispose():void}>(resolve=>{finish=resolve;});};
  const first=cache.load('map',load),second=cache.load('map',load);expect(first).toBe(second);expect(calls).toBe(1);
  const value={dispose(){released++;}};finish(value);await first;expect(cache.get('map')).toBe(value);expect(await cache.load('map',load)).toBe(value);expect(calls).toBe(1);
  cache.dispose();cache.dispose();expect(released).toBe(1);await expect(cache.load('map',load)).rejects.toMatchObject({name:'AbortError'});
});
test('failed resources can retry and late results are disposed after closing the case',async()=>{
  const cache=new ResourceCache<{dispose():void}>();await expect(cache.load('bad',async()=>{throw new Error('Offline');})).rejects.toThrow('Offline');
  let finish!:(value:{dispose():void})=>void,released=0,signal:AbortSignal|undefined;
  const request=cache.load('bad',s=>{signal=s;return new Promise(resolve=>{finish=resolve;});});cache.dispose();expect(signal!.aborted).toBe(true);
  finish({dispose(){released++;}});await expect(request).rejects.toMatchObject({name:'AbortError'});expect(released).toBe(1);expect(cache.get('bad')).toBeUndefined();
});
