# Alexa × ChatGPT スキル

Alexaから ChatGPT（gpt-4.1-mini）と会話したり、ウェブ検索して調べ物ができる自分専用スキルです。

## アーキテクチャ

```
[Alexa] → [AWS Lambda] → [OpenAI Responses API + web_search_preview]
```

- 「チャッピーを開いて」で起動
- セッション内は会話の文脈を保持（previous_response_id）
- 最新情報はモデルが自律的にウェブ検索して回答

---

## セットアップ手順

### 1. ask-cli のインストール

```bash
npm install -g ask-cli
ask configure
```

`ask configure` を実行するとブラウザが開き、以下を順番に設定します：
- Amazon 開発者アカウントでログイン
- AWS クレデンシャル設定（IAM ユーザーの Access Key / Secret Key）

> **IAM ポリシー**: ask-cli が Lambda と CloudFormation を操作できる権限が必要です。
> `AdministratorAccess` か `AmazonDynamoDBFullAccess` + `AWSLambdaFullAccess` + `IAMFullAccess` + `CloudFormationFullAccess`

### 2. 依存パッケージのインストール

```bash
cd lambda && npm install
```

### 3. デプロイ

stgのprofileとしてアクセストークンをセットする

```bash
# プロジェクトルートで実行
ask deploy --profile stg
```

初回デプロイ時に AWS Lambda 関数と Alexa スキルが自動作成されます。

### 4. Lambda 環境変数の設定

AWS コンソール → Lambda → 作成された関数 → 設定 → 環境変数

| キー | 値 |
|------|-----|
| `OPENAI_API_KEY` | `sk-xxxxxxxxxxxxxxxx` |
| `OPENAI_MODEL` | `gpt-4.1-mini`（省略時: gpt-4.1-mini） |
| ENABLE_WEB_SEARCH | `true` |

> または ask-cli の `ask lambda update-function-configuration` コマンドでも設定できます。

### 5. テスト

[Alexa 開発者コンソール](https://developer.amazon.com/alexa/console/ask) → スキル → テストタブ

テキストで試す例：
- 「チャッピーを開いて」（スキル起動のみ）
- 「チャッピーで今日のニュースを調べて」（ワンショット）
- 「チャッピーを使ってRustのエラーを解決して」（ワンショット）
- 「東京の人口は？」（スキル起動後）
- 「今日のニュースを教えて」（ウェブ検索が走ります）

---

## 開発

```bash
cd lambda
npm run build:dev   # 開発用ビルド（minifyなし）
npm run watch       # ウォッチモード
npm run build       # 本番用ビルド
```

## ファイル構成

```
alexa-chatgpt/
├── ask-resources.json          # ASK CLI v2 設定
├── skill-package/
│   ├── skill.json              # スキルマニフェスト
│   └── interactionModels/custom/ja-JP.json   # 日本語インタラクションモデル
└── lambda/
    ├── package.json
    ├── tsconfig.json
    ├── index.js                # ビルド成果物（ask deploy で使用）
    └── src/
        ├── index.ts
        ├── handlers/
        │   ├── LaunchRequestHandler.ts
        │   ├── ChatIntentHandler.ts
        │   ├── HelpIntentHandler.ts
        │   └── CancelAndStopHandler.ts
        └── services/
            └── openai.ts
```
