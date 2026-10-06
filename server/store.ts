import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
export type Item = Record<string, any> & { pk: string; sk: string };
export type Action = { put: Item } | { key: {pk:string;sk:string}; kanjiEnabled:boolean } | { key: {pk:string;sk:string}; delta:number; min?:number; max:number };
export interface Store { get(pk:string,sk:string):Promise<Item|undefined>; list(pk:string,prefix:string):Promise<Item[]>; transact(actions:Action[]):Promise<void> }
export class Conflict extends Error {}
export class MemoryStore implements Store {
  items = new Map<string,Item>();
  private key(pk:string,sk:string){return JSON.stringify([pk,sk]);}
  async get(pk:string,sk:string){const v=this.items.get(this.key(pk,sk)); return v && structuredClone(v);}
  async list(pk:string,prefix:string){return [...this.items.values()].filter(x=>x.pk===pk&&x.sk.startsWith(prefix)).sort((a,b)=>a.sk.localeCompare(b.sk)).map(x=>structuredClone(x));}
  async transact(actions:Action[]){
    const next=new Map(this.items);
    for(const a of actions){
      if('put' in a){const k=this.key(a.put.pk,a.put.sk);if(next.has(k))throw new Conflict();next.set(k,structuredClone(a.put));}
      else if('kanjiEnabled' in a){const k=this.key(a.key.pk,a.key.sk),old=next.get(k);if(!old)throw new Conflict();next.set(k,{...old,kanjiEnabled:a.kanjiEnabled});}
      else {const k=this.key(a.key.pk,a.key.sk);const old=next.get(k);if(!old || old.balance < (a.min??0) || old.balance>a.max)throw new Conflict();next.set(k,{...old,balance:old.balance+a.delta});}
    }
    this.items=next;
  }
}
export class DynamoStore implements Store {
  private client=DynamoDBDocumentClient.from(new DynamoDBClient({}));
  constructor(private table:string){}
  async get(pk:string,sk:string){return (await this.client.send(new GetCommand({TableName:this.table,Key:{pk,sk},ConsistentRead:true}))).Item as Item|undefined;}
  async list(pk:string,prefix:string){
    const items:Item[]=[];let cursor:Record<string,any>|undefined;
    do{const page=await this.client.send(new QueryCommand({TableName:this.table,KeyConditionExpression:'pk = :p AND begins_with(sk, :s)',ExpressionAttributeValues:{':p':pk,':s':prefix},ConsistentRead:true,ExclusiveStartKey:cursor}));items.push(...(page.Items??[]) as Item[]);cursor=page.LastEvaluatedKey;}while(cursor);
    return items;
  }
  async transact(actions:Action[]){
    try{await this.client.send(new TransactWriteCommand({TransactItems:actions.map(a=>'put' in a?{Put:{TableName:this.table,Item:a.put,ConditionExpression:'attribute_not_exists(pk)'}}:'kanjiEnabled' in a?{Update:{TableName:this.table,Key:a.key,UpdateExpression:'SET kanjiEnabled = :enabled',ConditionExpression:'attribute_exists(pk)',ExpressionAttributeValues:{':enabled':a.kanjiEnabled}}}:{Update:{TableName:this.table,Key:a.key,UpdateExpression:'SET balance = balance + :d',ConditionExpression:'attribute_exists(pk) AND balance >= :min AND balance <= :max',ExpressionAttributeValues:{':d':a.delta,':min':a.min??0,':max':a.max}}})}));}
    catch(e){if((e as Error).name==='TransactionCanceledException')throw new Conflict();throw e;}
  }
}
