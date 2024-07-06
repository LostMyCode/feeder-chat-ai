const puppeteer = require('puppeteer');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config(); // dotenv を読み込む

const generativeAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Google Generative AIのAPIキーを設定してください

const repliedIdsFile = 'replied_ids.json';
const replyQueue = [];
const enableHistoryCheck = true;
let processingId = null;

// JSONファイルから返信済みIDを読み込む関数
async function loadRepliedIds() {
    try {
        const data = await fs.promises.readFile(repliedIdsFile, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        // ファイルがない場合は空の配列を返す
        return [];
    }
}

// JSONファイルに返信済みIDを保存する関数
async function saveRepliedIds(repliedIds) {
    const jsonData = JSON.stringify(repliedIds);
    await fs.promises.writeFile(repliedIdsFile, jsonData, 'utf-8');
}

async function getLatestChatId(page) {
    return await page.evaluate(() => {
        const trList = document.querySelectorAll('#feed_list tr');

        return Array.from(trList).find(tr => !!tr.id)?.id;
    });
}

async function getCurrentHistory(page) {
    return await page.evaluate(() => {
        const trList = document.querySelectorAll("#feed_list tr");
        const chatList = Array.from(trList).filter(tr => !!tr.id);

        const result = [];

        chatList.slice(0, 5).forEach((chatEl) => {
            let text = chatEl.querySelector(".comment td:first-child")?.textContent;

            if (!text) return;

            text = text.replace(/この投稿へ移動/, "");

            const name = chatEl.querySelector(".name").textContent;

            result.push({ name, text });
        });

        return result;
    });
}

async function sendMessageToGemini(message) {
    const model = generativeAi.getGenerativeModel({ model: "gemini-1.5-flash" });
    // const prompt = `以下のメッセージについて返答して!敬語は使わずフランクな感じで頼む。ちなみにあなたはチャットユーザーの一人で名前は「TEST」ですのでもし呼ばれたらあなたのことです。挨拶された場合も返答して。意図が不明だったり不適切なメッセージであれば単に"null"と４文字だけを返して\n\n${message}`;
    const prompt = `以下はチャットの発言ログです。一番最新のメッセージに対して過去の発言も加味しながら返答して!敬語は使わずフランクな感じで頼む。最新の発言と過去の発言に関連性がなければ最新の発言だけにフォーカスしてください。ちなみにあなたのユーザー名は「TEST」ですのでもし呼ばれたらあなたのことで、過去の発言者であるTESTもあなたのことです。注意点として、発言の意図がわからなければ返答の必要はないので単に"null"と４文字だけを返して\n\n${message}`;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

async function postResponse(page, responseText) {
    await page.evaluate((responseText) => {
        const nameInput = document.getElementById("post_form_name");
        const formSingleInput = document.getElementById("post_form_multi");
        const postBtn = document.getElementById("post_btn");

        nameInput.value = "TEST";
        formSingleInput.value = responseText;
        postBtn.click();
    }, responseText);
}

async function processReply(page, repliedIds) {
    if (replyQueue.length === 0) {
        // キューが空の場合は、処理を終了
        setTimeout(() => processReply(page, repliedIds), 1000);
        return;
    }

    const currentChatId = replyQueue.shift(); // キューの先頭からIDを取得

    processingId = currentChatId;

    // 返信済みのIDの場合はスキップ
    if (repliedIds.includes(currentChatId)) {
        console.log(`id ${currentChatId} は返信済みのためスキップ`);
        processingId = null;
        processReply(page, repliedIds); // 次のキュー要素を処理
        return;
    }

    try {
        const chatText = await page.evaluate((currentChatId) => {
            try {
                const chatEl = document.getElementById(`${currentChatId}`);
                let text = chatEl.querySelector(".comment td:first-child")?.textContent;

                if (text) {
                    text = text.replace(/この投稿へ移動/, "");
                }

                return text;
            } catch (e) {
                return null;
            }
        }, currentChatId);

        if (!chatText) {
            // 返信済みIDとして保存
            repliedIds.push(currentChatId);
            await saveRepliedIds(repliedIds);
            throw new Error("メッセージ内容を取得できません");
        }

        const chatUserName = await page.evaluate((currentChatId) => {
            try {
                const chatEl = document.getElementById(`${currentChatId}`);
                const text = chatEl.querySelector(".name").textContent;
                return text;
            } catch (e) {
                return null;
            }
        }, currentChatId);

        if (chatUserName === "TEST") {
            console.log("自分なのでスキップ");

            // 返信済みIDとして保存
            repliedIds.push(currentChatId);
            await saveRepliedIds(repliedIds);
            return;
        }

        let reqText = chatText;

        if (enableHistoryCheck) {
            const currentChatLog = await getCurrentHistory(page).then(list => {
                // console.log("check history", list);
                return list.map(({ name, text }, idx) => {
                    const latestStr = idx === 0 ? "(最新の発言)" : "(過去の発言)";
                    return `発言者:${name}, 発言内容「${text}」 ${latestStr}`;
                }).join("\n\n");
            });

            reqText = currentChatLog;
        }

        console.log("リクエストするログ:", reqText);

        const geminiResponse = await sendMessageToGemini(reqText);
        console.log('Gemini のレスポンス:', geminiResponse);

        if (geminiResponse?.replace(/\n/g, "")?.replace(/ /g, "") === "null") {
            console.log('返す必要がないのでスキップ');

            // 返信済みIDとして保存
            repliedIds.push(currentChatId);
            await saveRepliedIds(repliedIds);
            return;
        }

        await postResponse(page, geminiResponse);
        console.log('レスポンスを送信しました:', currentChatId);

        // 返信済みIDとして保存
        repliedIds.push(currentChatId);
        await saveRepliedIds(repliedIds);

    } catch (error) {
        console.error("エラー発生:", error);
        if (error.status === 429) { // Too Many Requests
            // 返信済みIDとして保存
            repliedIds.push(currentChatId);
            await saveRepliedIds(repliedIds);
        }
    } finally {
        // エラーの有無にかかわらず、次の処理を仕掛ける
        processingId = null;
        setTimeout(() => processReply(page, repliedIds), 500);
    }
}

(async () => {
    const browser = await puppeteer.launch({ headless: false }); // headless: false でブラウザを表示
    const page = await browser.newPage();
    // await page.goto('https://www2.x-feeder.info/tahiti/');
    await page.goto('https://www2.x-feeder.info/minnnano/');
    // await page.goto('https://www1.x-feeder.info/Zrl3B07Z/');

    await page.evaluate(() => {
        const inputTypeToggle = document.getElementById("input_type");
        inputTypeToggle?.click();
    });

    let repliedIds = await loadRepliedIds();

    setInterval(async () => {
        const currentChatId = await getLatestChatId(page);
        // 返信済みでなく、キューに存在しない場合は追加
        if (!repliedIds.includes(currentChatId) && !replyQueue.includes(currentChatId) && processingId !== currentChatId) {
            replyQueue.push(currentChatId);
            console.log("キューに追加:", currentChatId);
        }
    }, 300);

    // 返信処理を開始
    processReply(page, repliedIds);
})();