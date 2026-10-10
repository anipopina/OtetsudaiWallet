# 設計

## 構成

```
src/         Vue 3 + Vue Router + TypeScript（SPA）
server/      共通サービス、DynamoDB実装、Lambda、ローカルAPI
infra/       AWS CDK
 tests/      サービスとブラウザの検証
```

## 秘密URL

`/bank?k=<token>` と `/wallet?k=<token>`。16バイト（128bit）の暗号学的乱数をbase64url化した22文字のトークンを使用。SHA-256ハッシュからサーバーが権限・銀行・ウォレットを解決します。乱数が十分なエントロピーを持つため、パスワード用の低速ハッシュやソルトには依存しません。UUIDは識別子であり権限ではありません。

ウォレットの鍵は再コピー用にAES-256-GCMで暗号化してウォレットレコードに保存します。暗号化鍵は銀行の管理トークンからHKDF-SHA256（salt:銀行ID、用途別info）で導出し、銀行・ウォレットIDをAADで結び付けます。銀行の管理鍵自体は保存しません。再取得APIは銀行権限と所属銀行を検証し、通常の一覧・ウォレットAPIに暗号文や他の鍵を含めません。

APIはAuthorization: Bearerヘッダーを使用します。銀行・ウォレットの権限は各操作で検証し、クライアントが銀行ID・送金元IDを選ぶことはできません。ウォレット一覧には他のウォレットの鍵や残高を含めません。APIはno-store、サイトはno-referrer、外部スクリプトは使用しません。CloudFront/APIのリクエストアクセスログは有効にせず、秘密URLやヘッダーの記録を避けます。Lambdaにも入力ログを出しません。ログを将来追加する場合も鍵は除去してください。

localStorageは表示名・種別・生のトークンを保存する補助的な鍵の保管場所です。利用者が鍵をコピーして別ブラウザでも使えることが正規のアクセス方式です。XSSで鍵が読まれるため、Vueの文字列エスケープとCloudFront CSPを使用し、v-htmlや外部分析ツールは追加しません。

## DynamoDB（単一テーブル、PK + SK）

| PK | SK | データ |
| --- | --- | --- |
| BANK#銀行UUID | META | 名前、通貨名、単位、作成日時 |
| BANK#銀行UUID | WALLET#ウォレットUUID | 名前、整数残高、作成日時、暗号化されたウォレット鍵、kanjiEnabled |
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
| GET | /api/bank/wallets/:id/key | 管理権限で同銀行のwallet tokenを再取得 |
| POST | /api/bank/issue | toId, amount, memo, requestId → transactionId |
| GET | /api/wallet | bank, 自分のwallet, 同銀行の送金先一覧 |
| POST | /api/wallet/settings | kanjiEnabled（boolean）→ 保存した設定。自分のウォレットのみ更新 |
| POST | /api/wallet/transfer | toId, amount, memo, requestId → transactionId |
| GET | /api/wallet/history?cursor=... | entries（新しい順、50件）, nextCursor |

400: 入力不正、401: 鍵不正、403: 権限不足、404: 対象不明、409: 残高/上限/同時更新/再送IDの内容違い。予期しないエラーの詳細は返しません。

## 整合性と再送

送金のTransactWriteには送金元の条件付き減算（balance >= amount）、送金先の条件付き加算（balance <= MAX - amount）、両側の履歴、再送防止記録を含めます。発行では送金元減算と出金履歴がありません。各Putにはattribute_not_exists(pk)条件を設定。同時処理があっても一括成功または全取消になります。残高に負数や上限超過は発生しません。

再送防止記録はTTLを設定せず保持します。DynamoDB標準の10分の冪等ウィンドウだけには依存しません。鍵単位のrequestIdと内容ハッシュを照合し、同じ内容なら元の取引IDを返し、変更した内容は拒否します。クライアントは結果が不明な通信エラー時に同じIDを再利用します。銀行・ウォレット作成は自動再送しません。

AWS資料: [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)、[CloudFront S3 OAC](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins-readme.html)。

「かんじ」の設定はウォレットレコードのkanjiEnabledに保存します。作成時にtrue（ON）を保存します。設定更新はattribute_exists条件付きで当該属性のみ更新し、残高や鍵を書き戻しません。クライアントは保存成功後に表示を切り替え、失敗した場合は元の表示を維持します。銀行画面にはスイッチを表示しません。

## 初回デプロイ環境

アプリ: OtetsudaiWallet / ap-northeast-1。証明書: OtetsudaiWalletCertificate / us-east-1。アカウント: 209018279507、プロファイル: ai-dev。既存のanipopina.com公開Hosted Zoneを参照し、ACMのDNS検証CNAME、CloudFront向けA/AAAA Aliasを作成します。環境値と証明書ARNはcdk.context.jsonで管理し、証明書を別スタックにすることでアプリ更新と分離しています。
