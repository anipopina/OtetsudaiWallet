export type SavedKey={type:'bank'|'wallet';name:string;token:string};
const storageKey='otetsudai-wallet.keys.v1';
export function readKeys():SavedKey[]{try{const data=JSON.parse(localStorage.getItem(storageKey)??'[]');return Array.isArray(data)?data.filter(x=>x&&['bank','wallet'].includes(x.type)&&typeof x.name==='string'&&typeof x.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x.token)).sort((a,b)=>a.name.localeCompare(b.name,'ja')):[];}catch{return [];}}
export function saveKey(key:SavedKey){const keys=readKeys().filter(x=>x.token!==key.token);keys.push(key);try{localStorage.setItem(storageKey,JSON.stringify(keys));return true;}catch{return false;}}
export function forgetKey(token:string){try{localStorage.setItem(storageKey,JSON.stringify(readKeys().filter(x=>x.token!==token)));return true;}catch{return false;}}
