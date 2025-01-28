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

// In-memory storage for user conversation history
const userConversations = {};

// Function to get response from Groq
async function getGroqResponse(query, userId) {
  try {
    // Get the user's conversation history
    const conversationHistory = userConversations[userId] || [];

    // Create the messages array including the user's conversation history
    const messages = [
      { role: "system", content: "使用繁體中文回答" },
      ...conversationHistory.map(msg => ({ role: "user", content: msg })),
      { role: "user", content: query }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: currentModel,
      temperature: 0.5,
      max_tokens: 1024,
      top_p: 1,
    });

    // Directly return the response content
    let response = completion.choices[0].message.content;

    // Remove any <think> tags from the response
    response = response.replace(/<\/?think>/g, '');

    return response;
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

// Command to display the current model
bot.command("currentmodel", (ctx) => {
  ctx.reply(`目前使用的模型是 ${currentModel}`);
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
  const userId = ctx.message.from.id;
  const userMessage = ctx.message.text;

  // Get the user's conversation history or initialize it
  userConversations[userId] = userConversations[userId] || [];

  // Add the new message to the user's conversation history
  userConversations[userId].push(userMessage);

  // Keep only the latest 3 messages in the history
  if (userConversations[userId].length > 3) {
    userConversations[userId].shift();
  }

  try {
    const response = await getGroqResponse(userMessage, userId);
    ctx.reply(response);
  } catch (error) {
    ctx.reply("處理您的訊息時發生錯誤。請稍後再試。");
  }
});

// Add command hints
bot.api.setMyCommands([
  { command: "/setmodel", description: "設定模型" },
  { command: "/currentmodel", description: "顯示目前使用的模型" },
]);

// Start the bot
bot.start();
