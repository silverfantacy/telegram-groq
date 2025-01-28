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
        { role: "system", content: "回覆盡量用繁體中文" },
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
  const newModel = ctx.message.text.split(" ")[1];
  if (newModel) {
    if (models.includes(newModel)) {
      currentModel = newModel;
      ctx.reply(`模型已更改為 ${currentModel}`);
    } else {
      ctx.reply(`無效的模型名稱。可用的模型有: ${models.join(', ')}`);
    }
  } else {
    ctx.reply("請提供模型名稱。");
  }
});

// Command to cycle through the models
bot.command("nextmodel", (ctx) => {
  currentModelIndex = (currentModelIndex + 1) % models.length;
  currentModel = models[currentModelIndex];
  ctx.reply(`模型已更改為 ${currentModel}`);
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

// Start the bot
bot.start();
