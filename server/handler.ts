import {DynamoStore} from './store';
import {Service,ApiError} from './service';
const service=new Service(new DynamoStore(process.env.TABLE_NAME!));
export async function handler(event:any){
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'};
 try{if(event.body?.length>8192)throw new ApiError(413,'入力が長すぎます。');let body={};try{body=event.body?JSON.parse(event.body):{};}catch{throw new ApiError(400,'入力形式が無効です。');}if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'入力形式が無効です。');
 const result=await service.run(event.requestContext.http.method,event.rawPath,event.headers?.authorization?.replace(/^Bearer /,''),body,event.queryStringParameters?.cursor);return {statusCode:200,headers,body:JSON.stringify(result)};
 }catch(e){return {statusCode:e instanceof ApiError?e.status:500,headers,body:JSON.stringify({message:e instanceof ApiError?e.message:'処理に失敗しました。時間をおいて再度お試しください。'})};}
}
