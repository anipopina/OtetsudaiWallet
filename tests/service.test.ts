import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Service,ApiError} from '../server/service';
import {MemoryStore} from '../server/store';
async function setup(){const db=new MemoryStore(),s=new Service(db);const bank=await s.run('POST','/api/banks',undefined,{name:'太郎銀行',currencyName:'太郎コイン',unit:'TARO'});const a=await s.run('POST','/api/bank/wallets',bank.token,{name:'太郎'}),b=await s.run('POST','/api/bank/wallets',bank.token,{name:'パパ'});return {s,db,bank,a,b};}
const post=(s:Service,path:string,key:string,toId:string,amount:number,requestId=randomUUID())=>s.run('POST',path,key,{toId,amount,memo:'おふろ洗い',requestId});
test('issue and transfer record both histories and conserve balances',async()=>{const {s,bank,a,b}=await setup();await post(s,'/api/bank/issue',bank.token,a.id,30);await post(s,'/api/wallet/transfer',a.token,b.id,20);assert.equal((await s.run('GET','/api/wallet',a.token)).wallet.balance,10);assert.equal((await s.run('GET','/api/wallet',b.token)).wallet.balance,20);const h=await s.run('GET','/api/wallet/history',a.token);assert.deepEqual(h.entries.map((e:any)=>e.amount).sort((a:number,b:number)=>a-b),[-20,30]);assert.equal(h.entries[0].memo,'おふろ洗い');});
test('concurrent double spend is rejected atomically',async()=>{const {s,bank,a,b}=await setup();await post(s,'/api/bank/issue',bank.token,a.id,30);const results=await Promise.allSettled([post(s,'/api/wallet/transfer',a.token,b.id,20),post(s,'/api/wallet/transfer',a.token,b.id,20)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await s.run('GET','/api/wallet',a.token)).wallet.balance,10);assert.equal((await s.run('GET','/api/wallet/history',b.token)).entries.length,1);});
test('duplicate concurrent requests and retries move money once',async()=>{const {s,bank,a}=await setup();const id=randomUUID();const result=await Promise.all([post(s,'/api/bank/issue',bank.token,a.id,30,id),post(s,'/api/bank/issue',bank.token,a.id,30,id)]);assert.equal(result[0].transactionId,result[1].transactionId);await post(s,'/api/bank/issue',bank.token,a.id,30,id);assert.equal((await s.run('GET','/api/wallet',a.token)).wallet.balance,30);await assert.rejects(post(s,'/api/bank/issue',bank.token,a.id,31,id),{status:409});});
test('wallet cannot manage bank; cross-bank and self transfers denied; raw tokens absent',async()=>{const {s,db,bank,a}=await setup();await assert.rejects(s.run('POST','/api/bank/wallets',a.token,{name:'bad'}),{status:403});await assert.rejects(s.run('GET','/api/wallet',bank.token),{status:403});await assert.rejects(s.run('GET','/api/bank','x'.repeat(43)),{status:401});await assert.rejects(post(s,'/api/wallet/transfer',a.token,a.id,1),{status:400});const other=await s.run('POST','/api/banks',undefined,{name:'別銀行',currencyName:'別コイン',unit:'OTHER'});const w=await s.run('POST','/api/bank/wallets',other.token,{name:'別'});await assert.rejects(post(s,'/api/wallet/transfer',a.token,w.id,1),{status:404});const serialized=JSON.stringify([...db.items]);assert.ok(!serialized.includes(bank.token));assert.ok(!serialized.includes(a.token));});
test('invalid amounts leave no records',async()=>{const {s,bank,a}=await setup();for(const amount of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])await assert.rejects(post(s,'/api/bank/issue',bank.token,a.id,amount),ApiError);assert.equal((await s.run('GET','/api/wallet/history',a.token)).entries.length,0);});
test('history pagination has no gaps',async()=>{const {s,bank,a}=await setup();for(let i=0;i<53;i++)await post(s,'/api/bank/issue',bank.token,a.id,1);const first=await s.run('GET','/api/wallet/history',a.token);const second=await s.run('GET','/api/wallet/history',a.token,{},first.nextCursor);assert.equal(first.entries.length,50);assert.equal(second.entries.length,3);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.transactionId)).size,53);});
test('bank can recover wallet keys without storing plaintext or exposing keys to wallets',async()=>{
 const {s,db,bank,a,b}=await setup();
 assert.equal((await s.run('GET',`/api/bank/wallets/${a.id}/key`,bank.token)).token,a.token);
 assert.equal((await s.run('GET',`/api/bank/wallets/${b.id}/key`,bank.token)).token,b.token);
 await assert.rejects(s.run('GET',`/api/bank/wallets/${b.id}/key`,a.token),{status:403});
 const other=await s.run('POST','/api/banks',undefined,{name:'別銀行',currencyName:'別コイン',unit:'OTHER'});
 await assert.rejects(s.run('GET',`/api/bank/wallets/${a.id}/key`,other.token),{status:404});
 assert.ok(!JSON.stringify([...db.items]).includes(a.token));
 const info=await s.run('GET','/api/wallet',a.token);assert.ok(!JSON.stringify(info).includes('encryptedToken'));
 const stored=[...db.items.values()].find(x=>x.id===a.id)!;delete stored.encryptedToken;
 await assert.rejects(s.run('GET',`/api/bank/wallets/${a.id}/key`,bank.token),{status:409});
});
test('wallet listings use Japanese name order',async()=>{
 const {s,bank,a}=await setup();for(const name of ['わかば','あおい','なつ'])await s.run('POST','/api/bank/wallets',bank.token,{name});
 for(const [path,key] of [['/api/bank',bank.token],['/api/wallet',a.token]]){const names=(await s.run('GET',path,key)).wallets.map((w:any)=>w.name);assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b,'ja')));}
});
test('kanji preference persists per wallet, defaults on, and cannot be changed by another role',async()=>{
 const {s,db,bank,a,b}=await setup();
 assert.equal((await s.run('GET','/api/wallet',a.token)).wallet.kanjiEnabled,true);
 await s.run('POST','/api/wallet/settings',a.token,{kanjiEnabled:false,walletId:b.id});
 assert.equal((await new Service(db).run('GET','/api/wallet',a.token)).wallet.kanjiEnabled,false);
 assert.equal((await s.run('GET','/api/wallet',b.token)).wallet.kanjiEnabled,true);
 await assert.rejects(s.run('POST','/api/wallet/settings',bank.token,{kanjiEnabled:false}),{status:403});
 await assert.rejects(s.run('POST','/api/wallet/settings',a.token,{kanjiEnabled:'false'}),{status:400});
 await post(s,'/api/bank/issue',bank.token,a.id,30);
 assert.equal((await s.run('GET','/api/wallet',a.token)).wallet.kanjiEnabled,false);
 assert.equal((await s.run('GET','/api/wallet',a.token)).wallet.balance,30);
 const stored=[...db.items.values()].find(x=>x.id===b.id)!;delete stored.kanjiEnabled;
 assert.equal((await s.run('GET','/api/wallet',b.token)).wallet.kanjiEnabled,true);
});
