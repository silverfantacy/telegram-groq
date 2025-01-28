import { Bot } from "grammy";
import Groq from "groq-sdk";

// Initialize Groq with API key
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Initialize Telegram bot with token
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// Parse models from environment variable
const models = process.env.GROQ_MODELS ? process.env.GROQ_MODELS.split(',') : ["deepseek-r1-distill-llama-70b"];
let currentModelIndex = 0;
let currentModel = models[currentModelIndex];

// Function to get response from Groq
async function getGroqResponse(query) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "使用繁體中文回答" },
        { role: "user", content: query }
      ],
      model: currentModel,
      temperature: 0.5,
      max_tokens: 1024,
      top_p: 1,
    });

    // Directly return the response content
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error getting Groq response:", error);
    return "抱歉，發生錯誤。請稍後再試。";
  }
}

// Command to change the model
bot.command("setmodel", (ctx) => {
  const modelOptions = models.map((model, index) => ({
    text: model,
    callback_data: `setmodel_${index}`
  }));
  ctx.reply('請選擇一個模型:', {
    reply_markup: {
      inline_keyboard: modelOptions.map(option => [option])
    }
  });
});

// Event listener for setting model via inline keyboard buttons
bot.on("callback_query:data", (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  if (callbackData.startsWith("setmodel_")) {
    const modelIndex = parseInt(callbackData.split("_")[1], 10);
    if (modelIndex >= 0 && modelIndex < models.length) {
      currentModel = models[modelIndex];
      ctx.reply(`模型已更改為 ${currentModel}`);
    } else {
      ctx.reply(`無效的模型編號。可用的模型有:\n${models.join("\n")}`);
    }
  }
});

// Event listener for text messages
bot.on("message:text", async (ctx) => {
  try {
    const response = await getGroqResponse(ctx.message.text);
    ctx.reply(response);
  } catch (error) {
    ctx.reply("處理您的訊息時發生錯誤。請稍後再試。");
  }
});

// Add command hints
bot.api.setMyCommands([
  { command: "/setmodel", description: "設置模型" },
  { command: "/listmodels", description: "列出目前可用的模型" },
]);

// Start the bot
bot.start();
