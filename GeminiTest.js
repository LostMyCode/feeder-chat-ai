const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config(); // dotenv を読み込む

const generativeAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Google Generative AIのAPIキーを設定してください

async function sendMessageToGemini(message) {
  const model = generativeAi.getGenerativeModel({ model: "gemini-pro" });
  const prompt = `以下のメッセージについて返答して！敬語は使わずフランクな感じで頼む。返答する必要がなかったり不適切なメッセージであれば単に"null"と４文字だけを返して\n\n${message}`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// 送信するメッセージ
const message = 'こんばんは～'; 

async function main() {
  const response = await sendMessageToGemini(message);
  console.log('Gemini のレスポンス:', response);
}

main();