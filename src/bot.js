import { Bot } from "grammy";
import Groq from "groq-sdk";
import TarotCardAPI from "./tarotcard/tarotcardapi.js";

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

// Initialize TarotCard API
const tarotAPI = new TarotCardAPI();

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

    const response = formatResponse(completion.choices[0].message.content);

    return response;
  } catch (error) {
    console.error("Groq API Error:", error);
    throw new Error("與 AI 服務通訊時發生錯誤");
  }
}

function formatResponse(text) {
  // 首先移除第一個 think 標籤區塊
  text = text.replace(/<think>.*?<\/think>/s, "").trim();

  // 處理程式碼區塊
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, language, code) => {
    code = code.trim();
    const languageLabel = language ? `${language}:\n` : "";
    return `${languageLabel}<pre><code>${code}</code></pre>`;
  });

  // 處理 Markdown 風格的程式碼區塊標記
  text = text.replace(/###\s+(.*?)\n/g, "<b>$1</b>\n");

  // 處理一般文本中的 HTML 特殊字符
  text = text
    .split(/<pre><code>|<\/code><\/pre>/g)
    .map((part, index) => {
      if (index % 2 === 0) {
        // 非代碼區塊：轉義 HTML 特殊字符
        return part
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      } else {
        // 代碼區塊：保持原樣
        return `<pre><code>${part}</code></pre>`;
      }
    })
    .join("");

  return text;
}

// 指令處理
bot.command("start", (ctx) => {
  ctx.reply(
    "歡迎使用 AI 助手! 您可以直接輸入問題與我對話。\n\n" +
      "可用指令:\n" +
      "/setmodel - 切換模型\n" +
      "/currentmodel - 查看當前模型\n" +
      "/clear - 清除對話歷史\n" +
      "/history - 查看對話歷史\n" +
      "/tarot - 開始塔羅牌占卜"
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

// Add tarot command
bot.command("tarot", async (ctx) => {
  const userId = ctx.from.id;
  const response = tarotAPI.startReading(userId);
  await ctx.reply(response);
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

  // Check if user is in a tarot reading session
  const tarotState = tarotAPI.getUserState(userId);
  
  if (tarotState) {
    try {
      switch (tarotState.step) {
        case "waiting_question":
          const questionResponse = tarotAPI.setQuestion(userId, userMessage);
          await ctx.reply(questionResponse);
          return;

        case "waiting_numbers":
          await ctx.replyWithChatAction("typing");
          
          const interpretCallback = async (messages) => {
            const completion = await groq.chat.completions.create({
              messages,
              model: currentModel,
              temperature: CONFIG.temperature,
              max_tokens: CONFIG.maxTokens,
              top_p: 1,
            });
            return completion.choices[0].message.content;
          };

          const result = await tarotAPI.selectCards(userId, userMessage, interpretCallback);

          // Send card interpretations one by one with images
          for (const cardResult of result.cards) {
            const formattedCaption = `🎴 *牌面：${cardResult.card.name}*\n\n${cardResult.interpretation}`
              .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

            await ctx.replyWithPhoto(
              `https://media.virtualxnews.com${cardResult.card.image}`,
              {
                caption: formattedCaption,
                parse_mode: "MarkdownV2"
              }
            );
          }

          // Send overall interpretation
          const formattedOverall = `🔮 *綜合解讀：*\n\n${result.overallInterpretation}`
              .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

          await ctx.reply(formattedOverall, {
            parse_mode: "MarkdownV2"
          });
          
          // Final message
          await ctx.reply("✨ *塔羅牌占卜結束*\\. 您可以輸入 /tarot 開始新的占卜\\.", {
            parse_mode: "MarkdownV2"
          });
          return;
      }
    } catch (error) {
      await ctx.reply(error.message);
      return;
    }
  }

  // Handle regular chat if not in tarot session
  try {
    await ctx.replyWithChatAction("typing");

    const response = await getGroqResponse(userMessage, userId);

    // 分段發送較長的消息
    const maxLength = 4000; // Telegram 消息長度限制
    if (response.length > maxLength) {
      const chunks = response.match(new RegExp(`.{1,${maxLength}}`, "g")) || [];
      for (const chunk of chunks) {
        await ctx.reply(chunk, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      }
    } else {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }

    // 儲存純文本版本到歷史記錄
    const plainResponse = response.replace(/<[^>]+>/g, "").trim();

    conversationManager.addMessage(userId, userMessage, plainResponse);
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
  { command: "tarot", description: "開始塔羅牌占卜" }
]);

// 全局錯誤處理
bot.catch((err) => {
  console.error("Bot error:", err);
});

// 啟動機器人
bot.start();
