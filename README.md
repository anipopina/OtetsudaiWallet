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

AWSへのデプロイはまだ実行していません。認証済みAWSプロファイルと対象アカウントを確認してから実行してください。

```sh
export AWS_PROFILE=your-profile
export AWS_REGION=ap-northeast-1
aws sts get-caller-identity
npx cdk bootstrap
npm run build
npm run synth
npx cdk diff
npx cdk deploy
```

初回はCloudFront既定ドメインで利用できます。予定ホスト名 `otetsudai-wallet.anipopina.com` を使う場合は、先に **us-east-1** のACMでこのホストの証明書を発行・検証し、ARNを指定します。

```sh
npx cdk diff -c certificateArn=arn:aws:acm:us-east-1:ACCOUNT:certificate/ID
npx cdk deploy -c certificateArn=arn:aws:acm:us-east-1:ACCOUNT:certificate/ID
```

DNSで出力されたDistributionDomainへCNAME（またはDNSプロバイダーのALIAS）を設定してください。DNSは既存環境が不明なためIaCに含めていません。別ホスト名は `-c domainName=...` を併用します。以後のdiff/deployでも同じcontextを指定してください。

DynamoDBにはPITRとRETAIN、スタックには削除保護を設定しています。S3もRETAINです。意図的に削除しても保存データとバケットは残ります。銀行の管理鍵と各ウォレットの鍵はDBから復元できません。

## 実装範囲と判断

- 銀行作成、ウォレット作成、発行、同一銀行内の送金、残高・履歴、ブラウザの鍵の記憶。
- 金額は整数、1回および各ウォレット残高の上限は1兆単位。残高不足・自己送金・別銀行送金は拒否。
- ウォレットURLは作成直後に一度だけ表示。銀行はウォレット一覧と残高を見られますが、ウォレットの鍵を再取得できません。作成直後にコピーして家族へ渡してください。
- アカウント、鍵再発行、削除、換金レート、グラフ、通知は範囲外。取引にはUTC日時・日付・種別・共通取引IDを記録し、後の日次集計に対応できます。
- ブラウザ保存に失敗した場合はURLの手動保存を案内します。秘密URLはブラウザ履歴にも残ります。localStorageを削除しても鍵そのものは失効しません。
- 小規模向け実装です。ウォレット一覧・履歴は現在全件Queryしてから履歴を50件ずつ返します。件数が増える場合はDBカーソルによるQueryページングに置き換えてください。

API・データモデル・整合性については [docs/design.md](docs/design.md) を参照してください。

## 検証の限界

サービスの自動テストはMemoryStore上で実行します。DynamoDB用の条件付きトランザクションは実装済みですが、実際のAWSでの疎通・同時送金はデプロイ後に検証してください。

CDK 2.272.0に同梱された開発用依存 `brace-expansion 5.0.9` にnpm auditのhigh指摘が残っています。これはフロントエンド・Lambdaのバンドルには含まれません。CDKの同梱依存のため通常のnpm audit fixでは解消できず、上流修正版への更新が必要です。外部から取得したglob式をCDKに入力しないでください。
