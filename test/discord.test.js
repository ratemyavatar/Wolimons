const test=require('node:test');const assert=require('node:assert');
const api=require('../proxy/api.js');
const real=global.fetch;
const stub=map=>{global.fetch=async url=>{const u=String(url);
  for(const [frag,body] of map){ if(u.includes(frag)) return {ok:body!==null,status:body===null?404:200,json:async()=>body}; }
  return {ok:false,status:404,json:async()=>null};};};
test('widget enabled -> real members', async () => {
  stub([['widget.json',{name:'Wanwood',instant_invite:'https://discord.gg/x',presence_count:3,
      members:[{id:'1',username:'Nun',avatar_url:'https://cdn/a.png',status:'online',game:{name:'Wanwood'}},
               {id:'2',username:'luke',avatar_url:'',status:'dnd'},
               {id:'3',username:'x_x',avatar_url:'',status:'bogus'}]}],
    ['invites/',{guild:{name:'Wanwood'},approximate_member_count:344,approximate_presence_count:47}]]);
  const d=await api.discordPresence({fresh:true});
  assert.strictEqual(d.enabled,true);
  assert.strictEqual(d.online,3);
  assert.strictEqual(d.total,344,'the total still comes from the invite');
  assert.strictEqual(d.members.length,3);
  assert.strictEqual(d.members[0].game,'Wanwood');
  assert.strictEqual(d.members[2].status,'online','an unknown status is not passed through');
});
test('widget disabled -> counts only, still usable', async () => {
  stub([['widget.json',null],
        ['invites/',{guild:{name:'Wanwood'},approximate_member_count:344,approximate_presence_count:47}]]);
  const d=await api.discordPresence({fresh:true});
  assert.strictEqual(d.enabled,false);
  assert.strictEqual(d.online,47,'online count comes from the invite');
  assert.strictEqual(d.total,344);
  assert.deepStrictEqual(d.members,[]);
  assert.strictEqual(d.ok,true,'a disabled widget is not a failure');
});
test('discord unreachable -> reported, not faked', async () => {
  stub([]);
  const d=await api.discordPresence({fresh:true});
  assert.strictEqual(d.ok,false);
  assert.strictEqual(d.online,null,'no invented numbers');
});
test('answers are cached', async () => {
  stub([['widget.json',null],['invites/',{guild:{name:'Wanwood'},approximate_member_count:1,approximate_presence_count:2}]]);
  const first=await api.discordPresence({fresh:true});
  let calls=0; const inner=global.fetch;
  global.fetch=async(...a)=>{calls++;return inner(...a);};
  const second=await api.discordPresence();
  assert.strictEqual(calls,0,'the cached answer was refetched');
  assert.deepStrictEqual(second,first);
});
test.after(()=>{global.fetch=real;});
