# 設計

## 構成

```
src/         Vue 3 + Vue Router + TypeScript（SPA）
server/      共通サービス、DynamoDB実装、Lambda、ローカルAPI
infra/       AWS CDK
 tests/      サービスとブラウザの検証
```

## 秘密URL

`/bank?k=<token>` と `/wallet?k=<token>`。32バイトの暗号学的乱数をbase64url化した43文字のトークンを使用。SHA-256ハッシュからサーバーが権限・銀行・ウォレットを解決します。乱数が十分なエントロピーを持つため、パスワード用の低速ハッシュやソルトには依存しません。UUIDは識別子であり権限ではありません。

APIはAuthorization: Bearerヘッダーを使用します。銀行・ウォレットの権限は各操作で検証し、クライアントが銀行ID・送金元IDを選ぶことはできません。ウォレット一覧には他のウォレットの鍵や残高を含めません。APIはno-store、サイトはno-referrer、外部スクリプトは使用しません。CloudFront/APIのリクエストアクセスログは有効にせず、秘密URLやヘッダーの記録を避けます。Lambdaにも入力ログを出しません。ログを将来追加する場合も鍵は除去してください。

localStorageは表示名・種別・生のトークンを保存する補助的な鍵の保管場所です。利用者が鍵をコピーして別ブラウザでも使えることが正規のアクセス方式です。XSSで鍵が読まれるため、Vueの文字列エスケープとCloudFront CSPを使用し、v-htmlや外部分析ツールは追加しません。

## DynamoDB（単一テーブル、PK + SK）

| PK | SK | データ |
| --- | --- | --- |
| BANK#銀行UUID | META | 名前、通貨名、単位、作成日時 |
| BANK#銀行UUID | WALLET#ウォレットUUID | 名前、整数残高、作成日時 |
| KEY#SHA256(鍵) | META | role、bankId、walletId（walletのみ） |
| LEDGER#ウォレットUUID | TX#UTC日時#取引UUID | 共通取引ID、日時、UTC日付、符号付き金額、種別、相手名、メモ |
| REQUEST#SHA256(鍵) | 再送防止UUID | リクエスト指紋、取引UUID |

履歴は不変、相手名は取引時のスナップショット。送金では同じ取引UUIDで入出金2件を作ります。日次グラフはUTC日時を家庭のタイムゾーン（想定Asia/Tokyo）へ変換して集計します。日付だけでJSTの日を判定しないでください。全履歴から残高を再計算できます。

## API

POSTはJSON、認証が必要な操作にはBearer鍵を送ります。

| メソッド | パス | 入力 / 戻り値 |
| --- | --- | --- |
| POST | /api/banks | name, currencyName, unit → 管理token, name |
| GET | /api/bank | bank, wallets（残高含む） |
| POST | /api/bank/wallets | name → wallet token, id, name |
| POST | /api/bank/issue | toId, amount, memo, requestId → transactionId |
| GET | /api/wallet | bank, 自分のwallet, 同銀行の送金先一覧 |
| POST | /api/wallet/transfer | toId, amount, memo, requestId → transactionId |
| GET | /api/wallet/history?cursor=... | entries（新しい順、50件）, nextCursor |

400: 入力不正、401: 鍵不正、403: 権限不足、404: 対象不明、409: 残高/上限/同時更新/再送IDの内容違い。予期しないエラーの詳細は返しません。

## 整合性と再送

送金のTransactWriteには送金元の条件付き減算（balance >= amount）、送金先の条件付き加算（balance <= MAX - amount）、両側の履歴、再送防止記録を含めます。発行では送金元減算と出金履歴がありません。各Putにはattribute_not_exists(pk)条件を設定。同時処理があっても一括成功または全取消になります。残高に負数や上限超過は発生しません。

再送防止記録はTTLを設定せず保持します。DynamoDB標準の10分の冪等ウィンドウだけには依存しません。鍵単位のrequestIdと内容ハッシュを照合し、同じ内容なら元の取引IDを返し、変更した内容は拒否します。クライアントは結果が不明な通信エラー時に同じIDを再利用します。銀行・ウォレット作成は自動再送しません。

AWS資料: [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)、[CloudFront S3 OAC](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins-readme.html)。
