import {createServer} from 'node:http';
import {Service,ApiError} from './service';
import {MemoryStore} from './store';
const service=new Service(new MemoryStore());
createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw new ApiError(413,'入力が長すぎます。');}let body;try{body=raw?JSON.parse(raw):{};}catch{throw new ApiError(400,'入力形式が無効です。');}if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'入力形式が無効です。');const url=new URL(req.url!,'http://localhost');res.end(JSON.stringify(await service.run(req.method!,url.pathname,req.headers.authorization?.replace(/^Bearer /,''),body,url.searchParams.get('cursor')??undefined)));}
 catch(e){res.statusCode=e instanceof ApiError?e.status:500;res.end(JSON.stringify({message:e instanceof ApiError?e.message:'処理に失敗しました。'}));}
}).listen(3001,'127.0.0.1',()=>console.log('Local API: http://127.0.0.1:3001 (memory; resets on restart)'));
