import {request as httpsRequest} from 'node:https';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,BatchWriteCommand,QueryCommand} from '@aws-sdk/lib-dynamodb';
const base=process.env.LIVE_URL,table=process.env.TABLE_NAME;
if(!base||!table||process.env.AWS_PROFILE!=='ai-dev')throw new Error('LIVE_URL, TABLE_NAME, AWS_PROFILE=ai-dev are required');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const walletIds:string[]=[];
const cleanup=new Map<string,{pk:string;sk:string}>();
const remember=(pk:string,sk:string)=>cleanup.set(JSON.stringify([pk,sk]),{pk,sk});
// Optional address override for testing while the local DNS resolver caches an old negative answer.
// TLS still verifies the public hostname; Host and browser origin remain unchanged.
async function request(url:string,options:RequestInit={}):Promise<Response>{
 if(!process.env.SMOKE_IPV4)return fetch(url,options);
 const target=new URL(url);assert.equal(target.origin,new URL(base!).origin);
 return new Promise((resolve,reject)=>{const req=httpsRequest(target,{hostname:process.env.SMOKE_IPV4,servername:target.hostname,method:options.method??'GET',headers:{...(options.headers as Record<string,string>??{}),Host:target.hostname}},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(new Response(body,{status:res.statusCode})));});req.on('error',reject);req.setTimeout(20000,()=>req.destroy(new Error('HTTPS request timed out')));if(options.body)req.write(options.body);req.end();});
}
async function api(path:string,key?:string,body?:unknown){const res=await request(`${base}/api/${path}`,{method:body?'POST':'GET',headers:{...(key?{Authorization:`Bearer ${key}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await res.json();assert.equal(res.status,200,result.message);return result;}
try{
 const bank=await api('banks',undefined,{name:'デプロイ検証専用銀行',currencyName:'テストコイン',unit:'TEST'});assert.ok(/^[A-Za-z0-9_-]{22}$/.test(bank.token),'Bank token must be 22 characters');remember(`KEY#${hash(bank.token)}`,'META');
 const info=await api('bank',bank.token);const pk=`BANK#${info.bank.id}`;remember(pk,'META');
 const make=async(name:string)=>{const w=await api('bank/wallets',bank.token,{name});assert.ok(/^[A-Za-z0-9_-]{22}$/.test(w.token),'Wallet token must be 22 characters');remember(pk,`WALLET#${w.id}`);remember(`KEY#${hash(w.token)}`,'META');walletIds.push(w.id);return w;};
 const a=await make('検証用こども'),b=await make('検証用おや');
 assert.ok((await api(`bank/wallets/${a.id}/key`,bank.token)).token===a.token,'Wallet key recovery mismatch');
 const issue={toId:a.id,amount:30,memo:'発行検証',requestId:randomUUID()};remember(`REQUEST#${hash(bank.token)}`,issue.requestId);
 const issued=await api('bank/issue',bank.token,issue);assert.equal((await api('bank/issue',bank.token,issue)).transactionId,issued.transactionId);
 const transfer={toId:b.id,amount:20,memo:'送金検証',requestId:randomUUID()};remember(`REQUEST#${hash(a.token)}`,transfer.requestId);
 await Promise.all([api('wallet/transfer',a.token,transfer),api('wallet/transfer',a.token,transfer)]);
 assert.equal((await api('wallet',a.token)).wallet.balance,10);assert.equal((await api('wallet',b.token)).wallet.balance,20);
 await api('wallet/settings',a.token,{kanjiEnabled:false});assert.equal((await api('wallet',a.token)).wallet.kanjiEnabled,false);assert.equal((await api('wallet',b.token)).wallet.kanjiEnabled,true);
 for(const w of [a,b]){const h=await api('wallet/history',w.token);assert.equal(h.entries.length,w===a?2:1);for(const e of h.entries)remember(`LEDGER#${w.id}`,e.sk);}
 const forbidden=await request(`${base}/api/bank`,{headers:{Authorization:`Bearer ${a.token}`}});assert.equal(forbidden.status,403);
 const insufficient=await request(`${base}/api/wallet/transfer`,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify({...transfer,amount:11,requestId:randomUUID()})});assert.equal(insufficient.status,409);
 if(process.env.VERIFY_BROWSER==='1'){
  const {chromium}=await import('@playwright/test');const browser=await chromium.launch({args:process.env.SMOKE_IPV4?[`--host-resolver-rules=MAP ${new URL(base!).hostname} ${process.env.SMOKE_IPV4}`]:[]});
  try{const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|Refused to/.test(m.text()))errors.push(m.text());});
   await page.goto(base!);await page.getByRole('heading',{name:'新しい銀行を作る'}).waitFor();
   await page.goto(`${base}/wallet?k=${a.token}`);await page.getByRole('heading',{name:'コインのきろく'}).waitFor();assert.equal(await page.getByRole('switch',{name:'かんじ'}).getAttribute('aria-checked'),'false');assert.equal((await page.locator('.balance-card strong').innerText()).replace(/\s+/g,' ').trim(),'10 TEST');
   await page.getByRole('switch',{name:'かんじ'}).click();await page.getByRole('heading',{name:'入出金の履歴'}).waitFor();assert.equal((await api('wallet',a.token)).wallet.kanjiEnabled,true);
   await page.goto(`${base}/bank?k=${bank.token}`);await page.getByRole('heading',{name:'家族のウォレット'}).waitFor();assert.equal(await page.locator('.wallet-row').count(),2);assert.deepEqual(errors,[]);
   console.log('Live browser: home, wallet, kanji settings, bank and CSP checks passed.');
  }finally{await browser.close();}
 }
 console.log('Live API: issue, duplicate retries, concurrent transfer, balances, history, settings, key recovery and authorization passed.');
}finally{
 const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:'ap-northeast-1'}));
 for(const id of walletIds){const pk=`LEDGER#${id}`;const result=await client.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :p',ExpressionAttributeValues:{':p':pk},ConsistentRead:true}));for(const item of result.Items??[])remember(pk,item.sk);}
 const keys=[...cleanup.values()];
 for(let i=0;i<keys.length;i+=25){let requests=keys.slice(i,i+25).map(Key=>({DeleteRequest:{Key}}));for(let retry=0;requests.length&&retry<5;retry++){const result=await client.send(new BatchWriteCommand({RequestItems:{[table]:requests}}));requests=result.UnprocessedItems?.[table] as typeof requests??[];if(requests.length)await new Promise(r=>setTimeout(r,200*(retry+1)));}assert.equal(requests.length,0,'Smoke-test cleanup incomplete');}
 console.log('Only the records created by this smoke test were removed.');
}
