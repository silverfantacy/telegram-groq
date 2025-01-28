import { Bot } from "grammy";
import Groq from "groq-sdk";

// 配置
const CONFIG = {
  maxHistoryLength: 5, // 保存多少組對話(一組包含user和assistant的對話)
  defaultModel: "deepseek-r1-distill-llama-70b",
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: `你是專業的AI助手，請：
    - 使用繁體中文回答
    - 給出精簡且實用的答案
    - 避免贅字和不必要的禮貌用語
    - 適時使用emoji增加親和力
    - 確保回答準確性
    - 不確定時清楚說明`,
};

// 初始化 SDK
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// 模型設置
const models = process.env.GROQ_MODELS?.split(",") || [CONFIG.defaultModel];
let currentModel = models[0];

// 對話管理器
class ConversationManager {
  constructor() {
    this.conversations = new Map();
  }

  addMessage(userId, userMessage, assistantMessage) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }

    const history = this.conversations.get(userId);
    history.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: assistantMessage },
    );

    // 保持歷史記錄在限定長度內
    while (history.length > CONFIG.maxHistoryLength * 2) {
      history.shift();
      history.shift();
    }
  }

  getHistory(userId) {
    return this.conversations.get(userId) || [];
  }

  clearHistory(userId) {
    this.conversations.delete(userId);
  }

  // 獲取可讀性的歷史記錄
  getReadableHistory(userId) {
    const history = this.getHistory(userId);
    if (history.length === 0) return "<i>暫無對話記錄</i>";

    return history
      .map((msg, index) => {
        const prefix =
          msg.role === "user" ? "👤 <b>使用者</b>" : "🤖 <b>AI助手</b>";
        const content = msg.content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        // 用 <code> 標籤包裝程式碼片段（如果需要的話）
        return `${prefix}\n<pre>${content}</pre>`;
      })
      .join("\n\n");
  }
}

const conversationManager = new ConversationManager();

// API 請求處理
async function getGroqResponse(query, userId) {
  try {
    const history = conversationManager.getHistory(userId);

    const messages = [
      { role: "system", content: CONFIG.systemPrompt },
      ...history,
      { role: "user", content: query },
    ];

    const completion = await groq.chat.completions.create({
      messages,
      model: currentModel,
      temperature: CONFIG.temperature,
      max_tokens: CONFIG.maxTokens,
      top_p: 1,
    });

    const response = completion.choices[0].message.content
      .replace(/<think>[^]*?<\/think>/g, "")
      .trim();

    return response;
  } catch (error) {
    console.error("Groq API Error:", error);
    throw new Error("與 AI 服務通訊時發生錯誤");
  }
}

// 指令處理
bot.command("start", (ctx) => {
  ctx.reply(
    "歡迎使用 AI 助手! 您可以直接輸入問題與我對話。\n\n" +
      "可用指令:\n" +
      "/setmodel - 切換模型\n" +
      "/currentmodel - 查看當前模型\n" +
      "/clear - 清除對話歷史\n" +
      "/history - 查看對話歷史",
  );
});

bot.command("setmodel", (ctx) => {
  const modelButtons = models.map((model) => [
    {
      text: model,
      callback_data: `model:${model}`,
    },
  ]);

  ctx.reply("請選擇要使用的模型:", {
    reply_markup: { inline_keyboard: modelButtons },
  });
});

bot.command("currentmodel", (ctx) => {
  ctx.reply(`目前使用的模型是: ${currentModel}`);
});

bot.command("clear", (ctx) => {
  const userId = ctx.from.id;
  conversationManager.clearHistory(userId);
  ctx.reply("已清除您的對話歷史");
});

bot.command("history", async (ctx) => {
  const userId = ctx.from.id;
  const history = conversationManager.getReadableHistory(userId);
  await ctx.reply(history, {
    parse_mode: "HTML",
    // 可選：如果訊息太長，可以設置禁用網頁預覽
    disable_web_page_preview: true,
  });
});

// 按鈕回調處理
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith("model:")) {
    const newModel = data.split(":")[1];
    if (models.includes(newModel)) {
      currentModel = newModel;
      await ctx.reply(`已切換至模型: ${newModel}`);
    }
  }

  await ctx.answerCallbackQuery();
});

// 文字訊息處理
bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;

  try {
    // 顯示正在輸入狀態
    await ctx.replyWithChatAction("typing");

    // 獲取 AI 回應
    const response = await getGroqResponse(userMessage, userId);

    // 添加對話到歷史記錄
    conversationManager.addMessage(userId, userMessage, response);

    await ctx.reply(response, {
      reply_to_message_id: ctx.message.message_id,
    });
  } catch (error) {
    console.error("Error:", error);
    await ctx.reply("抱歉,處理您的訊息時發生錯誤。請稍後再試。");
  }
});

// 設置命令提示
bot.api.setMyCommands([
  { command: "start", description: "開始使用" },
  { command: "setmodel", description: "設定模型" },
  { command: "currentmodel", description: "顯示目前使用的模型" },
  { command: "clear", description: "清除對話歷史" },
  { command: "history", description: "查看對話歷史" },
]);

// 全局錯誤處理
bot.catch((err) => {
  console.error("Bot error:", err);
});

// 啟動機器人
bot.start();
