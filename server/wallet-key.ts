import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
function encryptionKey(bankToken:string,bankId:string){return Buffer.from(hkdfSync('sha256',bankToken,bankId,'otetsudai-wallet/wallet-key/v1',32));}
export function encryptWalletKey(token:string,bankToken:string,bankId:string,walletId:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(bankToken,bankId),iv);
 cipher.setAAD(Buffer.from(`${bankId}/${walletId}`));
 const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');
}
export function decryptWalletKey(encrypted:string,bankToken:string,bankId:string,walletId:string){
 const bytes=Buffer.from(encrypted,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(bankToken,bankId),bytes.subarray(0,12));
 decipher.setAAD(Buffer.from(`${bankId}/${walletId}`));decipher.setAuthTag(bytes.subarray(12,28));
 return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
}
