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
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || ''  // 確保有預設值
});

// 確保在使用前檢查 API 金鑰
if (!process.env.GROQ_API_KEY) {
  console.error('GROQ_API_KEY environment variable is not set');
  process.exit(1);
}

// 配置 bot 客戶端選項
const botClientConfig = {
  client: {
    timeoutSeconds: 60, // 增加超時時間
    apiRoot: "https://api.telegram.org",
    retries: 3, // 添加重試次數
    retry_after: 1000 // 重試間隔（毫秒）
  }
};

// 初始化 bot 實例
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN, botClientConfig);

// Initialize TarotCard API
const tarotAPI = new TarotCardAPI();

// 模型設置
const models = process.env.GROQ_MODELS?.split(",") || [CONFIG.defaultModel];
let currentModel = models[0];

// 常量定義
const SEPARATOR = "───────────";

// 轉義特殊字符的輔助函數
function escapeSpecialChars(text) {
  if (!text) return '';
  
  // 先轉義反斜線本身
  text = text.replace(/\\/g, '\\\\');
  
  // 然後轉義其他特殊字符
  return text.replace(/([_*\[\]()~`>#+=\-|{}.!])/g, '\\$1');
}

// 格式化塔羅牌文本的輔助函數
function formatTarotText(text, type = 'normal') {
  let formatted = '';
  
  switch(type) {
    case 'separator':
      return escapeSpecialChars(SEPARATOR);
    case 'cardName':
      formatted = `🎴 ${escapeSpecialChars(text)}`; 
      break;
    case 'cardTitle':
      // 先轉義文字內容，再加上格式標記
      const escapedTitle = escapeSpecialChars(`牌面：${text}`);
      formatted = `🎴 *${escapedTitle}*`; 
      break;
    case 'interpretation':
      // 先轉義文字，再處理格式標記
      formatted = escapeSpecialChars(text.replace(/\*\*(.+?)\*\*/g, '*$1*'));
      break;
    case 'overall':
      const escapedHeader = escapeSpecialChars('綜合解讀');
      const escapedContent = escapeSpecialChars(text);
      formatted = `🔮 *${escapedHeader}*\n\n${escapedContent}`; 
      break;
    case 'final':
      // 分別轉義每個部分
      const endTitle = escapeSpecialChars('塔羅牌占卜結束');
      const endText = escapeSpecialChars('您可以輸入 /tarot 開始新的占卜');
      formatted = `✨ *${endTitle}*\n${endText}`; 
      break;
    default:
      formatted = escapeSpecialChars(text);
  }
  
  return formatted;
}

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
  if (!groq) {
    throw new Error('Groq API not initialized');
  }

  try {
    const history = conversationManager.getHistory(userId);

    const messages = [
      { role: "system", content: CONFIG.systemPrompt },
      ...history,
      { role: "user", content: query },
    ];

    console.log('Sending request to Groq API...'); // 添加日誌
    const completion = await groq.chat.completions.create({
      messages,
      model: currentModel,
      temperature: CONFIG.temperature,
      max_tokens: CONFIG.maxTokens,
      top_p: 1,
    });
    console.log('Received response from Groq API'); // 添加日誌

    if (!completion?.choices?.[0]?.message?.content) {
      throw new Error('Invalid or empty response from Groq API');
    }

    const response = formatResponse(completion.choices[0].message.content);
    return response;
  } catch (error) {
    console.error("Groq API Error:", error);
    if (error.message.includes('not defined')) {
      console.error('API initialization error:', error);
    }
    throw new Error("與 AI 服務通訊時發生錯誤，請稍後再試");
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
          .replace(/</g, "&lt;")  // 修正這裡，原本是 /<//g
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

// 修改塔羅牌命令處理
bot.command("tarot", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const response = tarotAPI.startReading(userId);
    await ctx.reply(response);
  } catch (error) {
    console.error('Error starting tarot reading:', error);
    await ctx.reply('開始塔羅牌占卜時發生錯誤，請稍後再試');
  }
});

// 添加管理員命令來設置 bot 命令
bot.command("setupcommands", async (ctx) => {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "開始使用" },
      { command: "setmodel", description: "設定模型" },
      { command: "currentmodel", description: "顯示目前使用的模型" },
      { command: "clear", description: "清除對話歷史" },
      { command: "history", description: "查看對話歷史" },
      { command: "tarot", description: "開始塔羅牌占卜" }
    ]);
    await ctx.reply("Bot commands set successfully");
  } catch (error) {
    console.warn("Failed to set bot commands:", error.message);
    await ctx.reply("Failed to set bot commands: " + error.message);
  }
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

// 塔羅牌解讀回調函數
async function createTarotInterpretCallback(ctx) {
  return async (messages) => {
    if (!groq) {
      throw new Error('Groq API not initialized');
    }

    try {
      console.log('Sending tarot interpretation request...'); // 添加日誌
      const completion = await groq.chat.completions.create({
        messages,
        model: currentModel,
        temperature: CONFIG.temperature,
        max_tokens: CONFIG.maxTokens,
        top_p: 1,
      });
      console.log('Received tarot interpretation response'); // 添加日誌

      if (!completion?.choices?.[0]?.message?.content) {
        throw new Error('Invalid tarot interpretation response');
      }

      return completion.choices[0].message.content
        .replace(/<think>.*?<\/think>/gs, '')
        .trim();
    } catch (error) {
      console.error('Tarot interpretation error:', error);
      throw new Error('塔羅牌解讀時發生錯誤');
    }
  };
}

// 修改文字訊息處理中的塔羅牌部分
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
          
          const interpretCallback = await createTarotInterpretCallback(ctx);
          const result = await tarotAPI.selectCards(userId, userMessage, interpretCallback);

          // Send card interpretations one by one with images
          for (const cardResult of result.cards) {
            if (result.cards.indexOf(cardResult) !== 0) {
              await ctx.reply('───────────');
            }

            await ctx.replyWithPhoto(
              `https://media.virtualxnews.com${cardResult.card.image}`,
              {
                caption: `🎴 牌面：${cardResult.card.chineseName || cardResult.card.name}${cardResult.card.isReversed ? '（逆位）' : '（正位）'}`,
              }
            );

            await ctx.reply(cardResult.interpretation);
          }

          await ctx.reply('───────────');
          await ctx.reply(`🔮 綜合解讀：\n\n${result.overallInterpretation}`);
          await ctx.reply("✨ 塔羅牌占卜結束\n您可以輸入 /tarot 開始新的占卜");
          return;
      }
    } catch (error) {
      console.error('Tarot reading error:', error);
      await ctx.reply('塔羅牌占卜過程中發生錯誤，請重新開始');
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

// 全局錯誤處理
bot.catch((err) => {
  console.error("Bot error:", err);
});

// 創建啟動函數
async function startBot() {
  try {
    console.log("Starting bot...");
    await bot.start();
    console.log("Bot started successfully");
  } catch (error) {
    console.error("Failed to start bot:", error);
    process.exit(1);
  }
}

// 啟動機器人
startBot();
