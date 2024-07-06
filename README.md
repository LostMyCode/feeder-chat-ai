## Geminiでチャットボット README.md

### 概要

このプログラムは、GoogleのGeminiを用いて、[Feederチャット](https://www.x-feeder.info/)のチャットに自動で返信するボットです。

### 特徴

* 最新のメッセージだけでなく、過去のメッセージも考慮した自然な返答を生成します。
* 返信の必要がないと判断した場合、返信を行いません。
* 返信済みIDを記録することで、同じメッセージに二重で返信することを防ぎます。
* Puppeteerを使用してブラウザ操作を自動化し、実際のチャット画面と同様に動作します。

### 必要環境

* Node.js
* Google Cloud Platformアカウント
* Gemini APIキー

### インストール

1. リポジトリをクローンします。
```
git clone https://github.com/LostMyCode/feeder-chat-ai.git
```

2. 必要なパッケージをインストールします。
```
cd feeder-chat-ai
npm install
```

3. `.env` ファイルを作成し、以下の環境変数を設定します。
```
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

### 実行方法

```
node index.js
```

### 設定

以下の設定項目は `index.js` ファイルで変更できます。

* `FEED_URL`: 監視対象のフィードURL (例: `https://www2.x-feeder.info/[CHAT_ROOM_ID]/`)
* `USER_NAME`: ボットのユーザー名 (デフォルト: `TEST`)
* `ENABLE_HISTORY_CHECK`: 過去のメッセージを考慮するかどうか (デフォルト: `true`)
* `CHECK_INTERVAL`: 新しいメッセージの確認間隔（ミリ秒） (デフォルト: `300`)
* `HISTORY_LENGTH`: 過去のメッセージ取得件数 (デフォルト: `5`)

### 注意点

* このプログラムは、あくまでサンプルであり、実用性を保証するものではありません。
* プログラムの実行には、Google Cloud Platform の利用料金が発生する可能性があります。

### ライセンス

このプログラムは、MITライセンスで公開されています。