# おてつだいウォレット / Otetsudai Wallet

家族だけの通貨を発行・送金するMVP。ログインやブロックチェーンは使いません。

## 開発

Node.js 22以上を推奨（開発時は24.14.0）。

```sh
npm ci
npm run dev
```

http://localhost:5173 を開きます。ローカルAPIはメモリ保存で、再起動すると銀行・ウォレット・取引が消えます。localStorageの鍵は残るため、古い鍵はトップの「一覧から外す」で削除してください。ローカル用の鍵は本番には移せません。

```sh
npm run typecheck
npm test
npm run build
npm run synth
npx playwright install --with-deps chromium
npm run test:e2e
```

## AWSへのデプロイ

AWS CDKのTypeScript構成です。S3は非公開、CloudFront OAC経由で配信します。APIは同じホストの `/api/*` → API Gateway HTTP API → Lambda → DynamoDB。通常の画面リクエストはCloudFront Functionでindex.htmlへ書き換え、オリジンへ鍵を転送しません。APIはBearerヘッダーで鍵を受け取り、キャッシュしません。

対象アカウントは `209018279507`、AWSプロファイルは `ai-dev`、アプリのリージョンは `ap-northeast-1` です。公開URLは https://otetsudai-wallet.anipopina.com です。

`cdk.context.json` にアカウント、ドメイン、既存Hosted Zone ID、発行済み証明書ARNを保存しています。証明書は `OtetsudaiWalletCertificate` スタック（`us-east-1`）、アプリは `OtetsudaiWallet` スタック（東京）で管理します。証明書のDNS検証CNAMEと、CloudFront向けA/AAAA AliasもCDKが作成します。Hosted Zone自体は既存のものを参照します。

通常の更新は次の手順です。証明書スタックはアプリ更新のたびにデプロイする必要はありません。

```sh
export AWS_PROFILE=ai-dev
export AWS_REGION=ap-northeast-1
aws sts get-caller-identity --profile ai-dev
npm run typecheck
npm test
npm run build
npx cdk synth OtetsudaiWallet --strict --profile ai-dev
npx cdk diff OtetsudaiWallet --profile ai-dev
npx cdk deploy OtetsudaiWallet --profile ai-dev
```

初回bootstrapは両リージョンで実施済みです。別アカウントで使う場合は `cdk.context.json` の対象アカウント・Hosted Zone・証明書ARNをその環境のものに置き換えてください。新しい証明書を発行するときは、先に証明書スタックをデプロイし、出力されたARNをcontextへ設定してからアプリをデプロイします。DNS検証CNAMEは証明書の自動更新にも必要なので残してください。

```sh
npx cdk bootstrap aws://ACCOUNT/us-east-1 aws://ACCOUNT/ap-northeast-1 --profile PROFILE
npx cdk diff OtetsudaiWalletCertificate --profile PROFILE
npx cdk deploy OtetsudaiWalletCertificate --profile PROFILE
# 出力されたCertificateArnをcdk.context.jsonへ設定
npx cdk diff OtetsudaiWallet --profile PROFILE
npx cdk deploy OtetsudaiWallet --profile PROFILE
```

DynamoDBにはPITRとRETAIN、スタックには削除保護を設定しています。S3もRETAINです。意図的に削除しても保存データとバケットは残ります。銀行の管理鍵はDBから復元できません。各ウォレットの鍵は銀行の管理鍵で暗号化して保存し、銀行ページの一覧からコピーできます。

## 実装範囲と判断

- 銀行作成、ウォレット作成、発行、同一銀行内の送金、残高・履歴、ブラウザの鍵の記憶。
- ウォレット画面の「かんじ」スイッチで、案内を漢字なしの表現に切り替えられます。設定はウォレットごとにDBへ保存し、既存・新規とも初期値はONです。銀行名・ウォレット名・通貨名・メモなど家族が入力した内容は変換しません。
- 金額は整数、1回および各ウォレット残高の上限は1兆単位。残高不足・自己送金・別銀行送金は拒否。
- 銀行ページのウォレット一覧から、いつでも秘密URLをコピーして家族へ渡せます。旧方式（ハッシュのみ保存）で作成済みのウォレットのURLは復元できないため、作成時に保存したURLを利用してください。
- アカウント、鍵再発行、削除、換金レート、グラフ、通知は範囲外。取引にはUTC日時・日付・種別・共通取引IDを記録し、後の日次集計に対応できます。
- ブラウザ保存に失敗した場合はURLの手動保存を案内します。秘密URLはブラウザ履歴にも残ります。localStorageを削除しても鍵そのものは失効しません。
- 小規模向け実装です。ウォレット一覧・履歴は現在全件Queryしてから履歴を50件ずつ返します。件数が増える場合はDBカーソルによるQueryページングに置き換えてください。

API・データモデル・整合性については [docs/design.md](docs/design.md) を参照してください。

## 検証の限界

通常のサービステストはMemoryStore上で実行します。2026-10-06の初回デプロイ時には実際のAWSでも、発行、同一要求の再送・同時再送、送金、残高・履歴、ウォレット設定、秘密URL再取得、権限拒否、残高不足を検証しました。公開サイトのトップ・銀行・ウォレット画面とCSPもChromiumで確認済みです。検証用データは削除しました。

Route 53の権威DNSとGoogle Public DNSでAliasのIPv4応答を確認し、公開ホストのTLS証明書も検証しました。初回確認時は開発環境のローカルDNSが古い否定応答をキャッシュしていたため、公開DNSで得たIPv4をテスト用に指定して確認しています。サイトの設定を変更する回避策は入れていません。

実環境の検証を繰り返す場合は次を実行できます（検証用の銀行・ウォレット・取引を一時的に作成し、その検証で作成したレコードだけを削除します）。

```sh
AWS_PROFILE=ai-dev AWS_REGION=ap-northeast-1 \
TABLE_NAME=OtetsudaiWallet-LedgerB7379752-9EIEL7M7FIBH \
LIVE_URL=https://otetsudai-wallet.anipopina.com \
node --import tsx scripts/smoke-live.ts
```

Chromiumが利用できる場合は `VERIFY_BROWSER=1` を追加すると画面も検証します。

CDK 2.272.0に同梱された開発用依存 `brace-expansion 5.0.9` にnpm auditのhigh指摘が残っています。これはフロントエンド・Lambdaのバンドルには含まれません。CDKの同梱依存のため通常のnpm audit fixでは解消できず、上流修正版への更新が必要です。外部から取得したglob式をCDKに入力しないでください。
