const puppeteer = require('puppeteer');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// .env ファイルから API キーを読み込む
const GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;

const FEED_URL = 'https://www2.x-feeder.info/minnnano/'; // 監視対象のフィードURL
const USER_NAME = "TEST"; // ボットのユーザー名
const ENABLE_HISTORY_CHECK = true; // 過去のメッセージを考慮するかどうか
const CHECK_INTERVAL = 300; // 新しいメッセージの確認間隔（ミリ秒）
const HISTORY_LENGTH = 5; // 過去のメッセージ取得件数

const repliedIdsFile = 'replied_ids.json';
const userFlip = process.env.USER_FLIP || '';
const probMessages = (() => {
    try {
        return JSON.parse(fs.readFileSync('./prob_messages.json', 'utf-8'));
    } catch (e) {
        return {};
    }
})();

const generativeAi = new GoogleGenerativeAI(GENERATIVE_AI_API_KEY);

// 返信済みIDを管理するクラス
class RepliedIdManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.repliedIds = [];
        this.load();
    }

    async load() {
        try {
            const data = await fs.promises.readFile(this.filePath, 'utf-8');
            this.repliedIds = JSON.parse(data);
        } catch (err) {
            this.repliedIds = [];
        }
    }

    async save() {
        const jsonData = JSON.stringify(this.repliedIds);
        await fs.promises.writeFile(this.filePath, jsonData, 'utf-8');
    }

    isReplied(chatId) {
        return this.repliedIds.includes(chatId);
    }

    add(chatId) {
        this.repliedIds.push(chatId);
        this.save();
    }
}

// チャットメッセージを扱うクラス
class ChatMessage {
    constructor(id, name, text) {
        this.id = id;
        this.name = name;
        this.text = text;
    }

    // evaluate() 内でオブジェクトリテラルから ChatMessage インスタンスを生成する静的メソッド
    static fromData(data) {
        return new ChatMessage(data.id, data.name, data.text);
    }
}

// メイン処理
(async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(FEED_URL);

    // 入力タイプを複数行に設定
    await page.evaluate(() => {
        const inputTypeToggle = document.getElementById("input_type");
        inputTypeToggle?.click();
    });

    const repliedIdManager = new RepliedIdManager(repliedIdsFile);

    // 処理中のメッセージIDを保持する
    let processingMessageId = null;

    // 返信処理
    async function replyToMessage(message) {
        // 既に処理中のメッセージの場合はスキップ
        if (processingMessageId === message.id) {
            console.log(`メッセージ ${message.id} は処理中のためスキップ`);
            return;
        }

        // 処理中のメッセージIDを設定
        processingMessageId = message.id;

        try {
            // 過去のメッセージを取得
            const history = ENABLE_HISTORY_CHECK
                ? await getChatHistory(page, HISTORY_LENGTH)
                : [];

            // Geminiに返信を生成してもらう
            let geminiResponse = await generateGeminiResponse(message, history);

            if (geminiResponse?.replace(/\n/g, "")?.replace(/ /g, "") === "null") {
                console.log('返す必要がないのでスキップ');
                repliedIdManager.add(message.id);
                return;
            }

            const chatRoomId = FEED_URL.match(/\.info\/([^\/]+)\//)[1];

            if (probMessages[chatRoomId] && isExecuteWithProbability(0.1)) {
                geminiResponse += probMessages[chatRoomId];
            }

            console.log("Geminiのレスポンス:", geminiResponse);

            // 返信を投稿
            await postResponse(page, geminiResponse, USER_NAME);
            console.log(`メッセージ ${message.id} に返信しました`);

            // 処理が完了したら repliedIds に追加
            repliedIdManager.add(message.id);
        } catch (error) {
            console.error("エラー発生:", error);

            // ステータスコード429の場合のみ repliedIds に追加
            if (error.status === 429) {
                repliedIdManager.add(message.id);
            } else {
                // 429以外のエラーの場合は、処理を継続して再試行
                console.log(`メッセージ ${message.id} - リトライします`);
            }
        } finally {
            // 処理中のメッセージIDをリセット
            processingMessageId = null;
        }
    }

    // 定期的に新しいメッセージを確認し、返信
    setInterval(async () => {
        const latestChatId = await getLatestChatId(page);
        if (
            latestChatId &&
            !repliedIdManager.isReplied(latestChatId) &&
            !processingMessageId // 処理中でないことを確認
        ) {
            // evaluate 内でオブジェクトリテラルを作成
            const messageData = await page.evaluate((chatId) => {
                const chatEl = document.getElementById(chatId);
                if (!chatEl) return null;

                return {
                    id: chatEl.id,
                    name: chatEl.querySelector(".name").textContent,
                    text: chatEl.querySelector(".comment td:first-child")?.textContent.replace(/この投稿へ移動/, "")
                };
            }, latestChatId);

            if (messageData) {
                // ChatMessage インスタンスに変換
                const message = ChatMessage.fromData(messageData);

                if (message.name !== USER_NAME) {
                    await replyToMessage(message);
                }
            }
        }
    }, CHECK_INTERVAL);
})();

// 最新のチャットIDを取得する関数
async function getLatestChatId(page) {
    return await page.evaluate(() => {
        const trList = document.querySelectorAll('#feed_list tr');
        return Array.from(trList).find(tr => !!tr.id)?.id;
    });
}

// 過去のチャット履歴を取得する関数
async function getChatHistory(page, length) {
    return await page.evaluate((length) => {
        const trList = document.querySelectorAll("#feed_list tr");
        const chatList = Array.from(trList).filter(tr => !!tr.id);

        return chatList
            .slice(0, length)
            .map((chatEl) => {
                return {
                    id: chatEl.id,
                    name: chatEl.querySelector(".name").textContent,
                    text: chatEl.querySelector(".comment td:first-child")?.textContent.replace(/この投稿へ移動/, "")
                };
            });
    }, length)
        .then(data => data.map(ChatMessage.fromData)); // ChatMessage インスタンスに変換
}

// Geminiに返信を生成してもらう関数
async function generateGeminiResponse(message, history) {
    const model = generativeAi.getGenerativeModel({ model: "gemini-1.5-flash" });

    let prompt = `チャットメッセージに返信してほしいです。一番最新のメッセージに対して過去の発言も加味しながら返答して!敬語は使わずフランクな感じで頼む。最新の発言と過去の発言に関連性がなければ最新の発言だけにフォーカスしてください。ちなみにあなたのユーザー名は「${USER_NAME}」ですのでもし呼ばれたらあなたのことで、過去の発言者である${USER_NAME}もあなたのことです。注意点として、発言の意図がわからなければ返答の必要はないので単に"null"と４文字だけを返してください。これ以降がチャットメッセージのログになります:\n\n`;

    if (history.length > 0) {
        prompt += history
            .map((msg, idx) => {
                const latestStr = idx === 0 ? "(最新の発言)" : "(過去の発言)";
                return `発言者:${msg.name}, 発言内容「${msg.text}」 ${latestStr}`;
            })
            .join("\n\n");
    } else {
        prompt += `発言者:${message.name}, 発言内容「${message.text}」(最新の発言)`;
    }

    console.log("リクエストするログ:", prompt);
    const result = await model.generateContent(prompt);
    return result.response.text();
}

// 返信を投稿する関数
async function postResponse(page, responseText, userName) {
    await page.evaluate((responseText, userName, userFlip) => {
        const nameInput = document.getElementById("post_form_name");
        const formSingleInput = document.getElementById("post_form_multi");
        const postBtn = document.getElementById("post_btn");

        nameInput.value = userName + userFlip;
        formSingleInput.value = responseText;
        postBtn.click();
    }, responseText, userName, userFlip);
}

function isExecuteWithProbability(probability) {
    // 0から1未満の乱数を生成
    const randomValue = Math.random();

    // 生成した乱数が確率以下ならtrueを返す
    return randomValue < probability;
}
