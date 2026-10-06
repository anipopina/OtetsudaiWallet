import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Conflict,type Store,type Item,type Action} from './store';
export const MAX=1_000_000_000_000;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
export class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
function text(v:unknown,label:string,max=40){if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw new ApiError(400,`${label}は1〜${max}文字で入力してください。`);return v.trim();}
function publicWallet(w:Item){return {id:w.id,name:w.name,balance:w.balance};}
export class Service{
 constructor(private db:Store){}
 async run(method:string,path:string,key:string|undefined,body:any={},cursor?:string):Promise<Record<string,any>>{
  if(method==='POST'&&path==='/api/banks'){
   const name=text(body.name,'銀行名'),currencyName=text(body.currencyName,'通貨名'),unit=text(body.unit,'通貨単位',12);const id=randomUUID(),k=token(),createdAt=new Date().toISOString();
   await this.db.transact([{put:{pk:`BANK#${id}`,sk:'META',id,name,currencyName,unit,createdAt}},{put:{pk:`KEY#${hash(k)}`,sk:'META',role:'bank',bankId:id}}]);return {token:k,name};
  }
  if(!key||!/^[A-Za-z0-9_-]{43}$/.test(key))throw new ApiError(401,'秘密URLが無効です。保存したURLを開いてください。');
  const access=await this.db.get(`KEY#${hash(key)}`,'META');if(!access)throw new ApiError(401,'秘密URLが無効です。');
  const pk=`BANK#${access.bankId}`,bank=await this.db.get(pk,'META');if(!bank)throw new ApiError(404,'銀行が見つかりません。');
  const role=access.role;
  if(path.startsWith('/api/bank')&&role!=='bank'||path.startsWith('/api/wallet')&&role!=='wallet')throw new ApiError(403,'この鍵では操作できません。');
  if(method==='GET'&&path==='/api/bank')return {bank,wallets:(await this.db.list(pk,'WALLET#')).map(publicWallet)};
  if(method==='POST'&&path==='/api/bank/wallets'){
   const name=text(body.name,'ウォレット名'),id=randomUUID(),k=token();
   await this.db.transact([{put:{pk,sk:`WALLET#${id}`,id,name,balance:0,createdAt:new Date().toISOString()}},{put:{pk:`KEY#${hash(k)}`,sk:'META',role:'wallet',bankId:bank.id,walletId:id}}]);return {token:k,name,id};
  }
  if(method==='GET'&&path==='/api/wallet'){
   const wallet=await this.db.get(pk,`WALLET#${access.walletId}`);if(!wallet)throw new ApiError(404,'ウォレットが見つかりません。');
   return {bank,wallet:publicWallet(wallet),wallets:(await this.db.list(pk,'WALLET#')).filter(w=>w.id!==wallet.id).map(w=>({id:w.id,name:w.name}))};
  }
  if(method==='GET'&&path==='/api/wallet/history'){
   const all=(await this.db.list(`LEDGER#${access.walletId}`,'TX#')).reverse();
   let start=0;if(cursor){start=all.findIndex(x=>x.sk===cursor)+1;if(start===0)throw new ApiError(400,'履歴の位置が無効です。');}
   const entries=all.slice(start,start+50);return {entries,nextCursor:start+50<all.length?entries.at(-1)?.sk:null};
  }
  if(method==='POST'&&(path==='/api/bank/issue'||path==='/api/wallet/transfer')){
   const amount=body.amount;if(!Number.isSafeInteger(amount)||amount<=0||amount>MAX)throw new ApiError(400,'金額は1以上の整数で入力してください。');
   const memo=body.memo??'';if(typeof memo!=='string'||memo.length>200)throw new ApiError(400,'メモは200文字以内で入力してください。');
   const requestId=body.requestId;if(typeof requestId!=='string'||! /^[0-9a-f-]{36}$/.test(requestId))throw new ApiError(400,'再送防止IDが無効です。');
   const toId=text(body.toId,'送金先',64),fromId=role==='wallet'?access.walletId:null;
   if(fromId===toId)throw new ApiError(400,'自分には送金できません。');
   const fingerprint=hash(JSON.stringify({path,toId,amount,memo}));const receiptPk=`REQUEST#${hash(key)}`,receiptSk=requestId;
   const existing=await this.db.get(receiptPk,receiptSk);if(existing){if(existing.fingerprint!==fingerprint)throw new ApiError(409,'同じ再送防止IDで内容を変更できません。');return {transactionId:existing.transactionId};}
   const to=await this.db.get(pk,`WALLET#${toId}`),from=fromId?await this.db.get(pk,`WALLET#${fromId}`):undefined;
   if(!to||fromId&&!from)throw new ApiError(404,'送金先が見つかりません。');
   const transactionId=randomUUID(),at=new Date().toISOString(),day=at.slice(0,10),sk=`TX#${at}#${transactionId}`;
   const actions:Action[]=[{key:{pk,sk:`WALLET#${toId}`},delta:amount,max:MAX-amount},{put:{pk:`LEDGER#${toId}`,sk,transactionId,at,day,amount,kind:from?'transfer':'issue',counterparty:from?.name??bank.name,memo}},{put:{pk:receiptPk,sk:receiptSk,fingerprint,transactionId}}];
   if(from)actions.push({key:{pk,sk:`WALLET#${from.id}`},delta:-amount,min:amount,max:MAX},{put:{pk:`LEDGER#${from.id}`,sk,transactionId,at,day,amount:-amount,kind:'transfer',counterparty:to.name,memo}});
   try{await this.db.transact(actions);}catch(e){if(!(e instanceof Conflict))throw e;const done=await this.db.get(receiptPk,receiptSk);if(done&&done.fingerprint===fingerprint)return {transactionId:done.transactionId};throw new ApiError(409,'残高不足、残高上限、または同時操作のため処理できませんでした。残高を確認して再度お試しください。');}
   return {transactionId};
  }
  throw new ApiError(404,'操作が見つかりません。');
 }
}
