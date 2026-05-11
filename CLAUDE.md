# alexa-chatgpt

## デプロイ

```bash
cd lambda && npm run build && cd .. && ask deploy --profile stg --ignore-hash && aws lambda update-function-configuration --function-name ask-gpt-stg-default-1778390136821 --timeout 60 --region ap-northeast-1 --profile stg
```

`ask deploy` はタイムアウトを正しく設定しないため、後続の `aws lambda update-function-configuration` で 60 秒を明示的に設定する。

## ソース構成

- **編集するソース**: `lambda/src/` （こちらが本体）
- **注意**: `.ask/lambda/src/` は ask deploy 時に `lambda/` からコピーされるため、直接編集しても上書きされる
- **注意**: `lambda/index.js` は TypeScript のバンドル済みファイル。ソース変更後は必ず `npm run build` でビルドしてからデプロイすること

## Lambda

- リージョン: `ap-northeast-1` (東京)、タイムアウト 60 秒
- スキル ID: `amzn1.ask.skill.664915a9-313a-4c0c-9ddd-50fe39a5f63d` (stg)

## pairpanel 連携

- pairpanel（旧 ken-nao）のリポジトリは `/Users/ishiiken/Develop/ken-nao/` にある
- 主要サブリポジトリ:
  - `ken-nao-api-legacy/` — バックエンド API（Alexa スキルが叩く先）
  - `ken-nao-cdk/` — AWS インフラ（DynamoDB / API Gateway 等）
  - `ken-nao-frontend/` — Web ダッシュボード UI
  - `ken-nao-swagger/` — API スキーマ定義
  - `k-ui/` — 共通 UI コンポーネント
- 既存連携: `lambda/src/services/pairpanel.ts` から `/api/v1/alexa/shopping/*` を呼び出している（X-Api-Key / X-User-Id / X-Pair-Id ヘッダー認証）
- pairpanel 側の改修が必要になったら上記ディレクトリで作業すること
