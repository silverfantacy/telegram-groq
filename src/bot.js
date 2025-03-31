import { Bot } from "grammy";
import Groq from "groq-sdk";
import TarotCardAPI from "./tarotcard/tarotcardapi.js";
import OpenAI from "openai";

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

// Grok API 配置
const GROK_API_CONFIG = {
  apiKey: process.env.GROK_API_KEY || '',
  model: "grok-2-latest"
};

// 初始化 X.AI 客戶端
let xaiClient = null;
if (process.env.GROK_API_KEY) {
  xaiClient = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
}

// 確保在使用前檢查 Grok API 金鑰
if (!process.env.GROK_API_KEY) {
  console.warn('GROK_API_KEY environment variable is not set. Grok 2 model will not be available.');
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

// 初始化塔羅牌會話管理
const tarotSessions = new Map();

// 模型設置
const groqModels = process.env.GROQ_MODELS?.split(",") || [CONFIG.defaultModel];
const allModels = [...groqModels];

let currentModel = allModels[0];

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

// Grok API 請求處理
async function getGrokResponse(query, userId) {
  if (!xaiClient) {
    throw new Error('Grok API key not set');
  }

  try {
    const history = conversationManager.getHistory(userId);

    const messages = [
      { role: "system", content: CONFIG.systemPrompt },
      ...history,
      { role: "user", content: query },
    ];

    console.log('Sending request to Grok API...'); // 添加日誌
    
    const completion = await xaiClient.chat.completions.create({
      model: GROK_API_CONFIG.model,
      messages: messages,
      temperature: CONFIG.temperature,
      max_tokens: CONFIG.maxTokens,
    });

    console.log('Received response from Grok API'); // 添加日誌

    if (!completion?.choices?.[0]?.message?.content) {
      throw new Error('Invalid or empty response from Grok API');
    }

    const formattedResponse = formatResponse(completion.choices[0].message.content);
    return formattedResponse;
  } catch (error) {
    console.error("Grok API Error:", error);
    throw new Error("與 Grok AI 服務通訊時發生錯誤，請稍後再試");
  }
}

// 統一的 AI 回應處理函數
async function getAIResponse(query, userId) {
  // 根據當前模型選擇使用哪個 API
  if (currentModel === "grok-2-latest") {
    return await getGrokResponse(query, userId);
  } else {
    return await getGroqResponse(query, userId);
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
      "/model - 查看並切換 AI 模型\n" +
      "/clear - 清除對話歷史\n" +
      "/history - 查看對話歷史\n" +
      "/tarot - 塔羅牌占卜",
    { parse_mode: "HTML" }
  );
});

// 模型切換指令
bot.command("model", async (ctx) => {
  const keyboard = {
    inline_keyboard: allModels.map((model) => [
      {
        text: `${model === currentModel ? "✓ " : ""}${model}`,
        callback_data: `model:${model}`,
      },
    ]),
  };

  await ctx.reply("請選擇 AI 模型:", {
    reply_markup: keyboard,
  });
});

// 塔羅牌占卜指令
bot.command("tarot", async (ctx) => {
  const userId = ctx.from.id;
  
  // 檢查是否已經有進行中的塔羅牌會話
  if (tarotSessions.has(userId)) {
    await ctx.reply("您已經有一個進行中的塔羅牌占卜。請先完成當前的占卜，或輸入 /cancel 取消。");
    return;
  }
  
  // 創建新的塔羅牌會話
  tarotSessions.set(userId, {
    state: "waiting_for_question",
    question: null,
    spread: null,
    cards: []
  });
  
  await ctx.reply(formatTarotText("歡迎使用塔羅牌占卜功能！"));
  await ctx.reply(formatTarotText("請告訴我您想諮詢的問題（例如：感情、事業、短期發展等）"));
});

// 取消命令 - 用於取消塔羅牌占卜等進行中的操作
bot.command("cancel", async (ctx) => {
  const userId = ctx.from.id;
  
  if (tarotSessions.has(userId)) {
    tarotSessions.delete(userId);
    await ctx.reply("塔羅牌占卜已取消。");
  } else {
    await ctx.reply("您沒有進行中的操作可以取消。");
  }
});

// 處理模型選擇的回調
bot.callbackQuery(/^model:(.+)$/, async (ctx) => {
  const modelName = ctx.match[1];
  
  // 檢查模型是否在可用列表中
  if (!allModels.includes(modelName)) {
    await ctx.answerCallbackQuery({
      text: `模型 ${modelName} 不可用`,
      show_alert: true,
    });
    return;
  }
  
  // 如果選擇 Grok 2 但沒有 API 金鑰
  if (modelName === "grok-2-latest" && !GROK_API_CONFIG.apiKey) {
    await ctx.answerCallbackQuery({
      text: `Grok 2 模型不可用：缺少 API 金鑰`,
      show_alert: true,
    });
    return;
  }

  currentModel = modelName;
  await ctx.answerCallbackQuery({
    text: `已切換到模型: ${modelName}`,
    show_alert: true,
  });

  // 更新模型選擇菜單
  const keyboard = {
    inline_keyboard: allModels.map((model) => [
      {
        text: `${model === currentModel ? "✓ " : ""}${model}`,
        callback_data: `model:${model}`,
      },
    ]),
  };

  await ctx.editMessageReplyMarkup(keyboard);
});

// 處理塔羅牌相關的回調
bot.callbackQuery(/^tarot:(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const action = ctx.match[1];
  
  // 檢查用戶是否有進行中的塔羅牌會話
  if (!tarotSessions.has(userId)) {
    await ctx.answerCallbackQuery({
      text: "您沒有進行中的塔羅牌占卜。請輸入 /tarot 開始新的占卜。",
      show_alert: true
    });
    return;
  }
  
  const session = tarotSessions.get(userId);
  
  // 處理取消操作
  if (action === "cancel") {
    tarotSessions.delete(userId);
    await ctx.answerCallbackQuery({
      text: "塔羅牌占卜已取消。",
      show_alert: true
    });
    await ctx.editMessageText("塔羅牌占卜已取消。");
    return;
  }
  
  // 處理牌陣選擇
  if (action.startsWith("spread:")) {
    const spreadType = action.split(":")[1];
    session.spread = spreadType;
    session.state = "drawing_cards";
    
    await ctx.answerCallbackQuery({
      text: `已選擇${spreadType === "single" ? "單張牌陣" : spreadType === "three" ? "三張牌陣" : "凱爾特十字牌陣"}`
    });
    
    // 根據不同牌陣類型進行處理
    if (spreadType === "single") {
      // 單張牌陣
      const shuffledCards = tarotAPI.shuffleCards();
      const randomIndex = Math.floor(Math.random() * shuffledCards.length);
      const selectedCard = shuffledCards[randomIndex];
      session.cards = [selectedCard];
      
      // 顯示抽到的牌
      await ctx.editMessageText(formatTarotText("正在解讀您抽到的牌..."));
      
      // 使用 AI 解讀塔羅牌
      try {
        const prompt = `請以塔羅牌專家的身份，解讀以下塔羅牌對於問題「${session.question}」的含義：\n\n${selectedCard.name}${selectedCard.isReversed ? "（逆位）" : "（正位）"}\n\n請提供詳細、有洞察力的解讀，包括這張牌在此問題上的象徵意義、建議和可能的結果。回答限制在300字以內，使用繁體中文。`;
        
        const interpretation = await getAIResponse(prompt, userId);
        
        // 發送解讀結果
        let message = formatTarotText(`您抽到的牌是：`, "cardTitle") + "\n\n";
        message += formatTarotText(`${selectedCard.name}${selectedCard.isReversed ? "（逆位）" : "（正位）"}`, "cardName") + "\n\n";
        message += formatTarotText(interpretation, "interpretation") + "\n\n";
        message += formatTarotText("", "final");
        
        await ctx.editMessageText(message, { parse_mode: "MarkdownV2" });
        
        // 清除會話
        tarotSessions.delete(userId);
      } catch (error) {
        console.error("Error interpreting tarot card:", error);
        await ctx.editMessageText("解讀塔羅牌時發生錯誤，請稍後再試。");
        tarotSessions.delete(userId);
      }
    } else if (spreadType === "three") {
      // 三張牌陣
      const shuffledCards = tarotAPI.shuffleCards();
      const selectedCards = [];
      
      // 隨機選擇三張不重複的牌
      const indices = new Set();
      while (indices.size < 3) {
        indices.add(Math.floor(Math.random() * shuffledCards.length));
      }
      
      const indexArray = Array.from(indices);
      selectedCards.push(shuffledCards[indexArray[0]]);
      selectedCards.push(shuffledCards[indexArray[1]]);
      selectedCards.push(shuffledCards[indexArray[2]]);
      
      session.cards = selectedCards;
      
      // 顯示抽到的牌
      await ctx.editMessageText(formatTarotText("正在解讀您抽到的三張牌..."));
      
      // 使用 AI 解讀塔羅牌
      try {
        // 過去牌的解讀
        const pastPrompt = `請以塔羅牌專家的身份，解讀以下塔羅牌作為「過去」對於問題「${session.question}」的含義：\n\n${selectedCards[0].name}${selectedCards[0].isReversed ? "（逆位）" : "（正位）"}\n\n請提供簡短但有洞察力的解讀，說明這張牌如何反映問題的過去基礎。回答限制在150字以內，使用繁體中文。`;
        
        const pastInterpretation = await getAIResponse(pastPrompt, userId);
        
        // 現在牌的解讀
        const presentPrompt = `請以塔羅牌專家的身份，解讀以下塔羅牌作為「現在」對於問題「${session.question}」的含義：\n\n${selectedCards[1].name}${selectedCards[1].isReversed ? "（逆位）" : "（正位）"}\n\n請提供簡短但有洞察力的解讀，說明這張牌如何反映問題的當前狀況。回答限制在150字以內，使用繁體中文。`;
        
        const presentInterpretation = await getAIResponse(presentPrompt, userId);
        
        // 未來牌的解讀
        const futurePrompt = `請以塔羅牌專家的身份，解讀以下塔羅牌作為「未來」對於問題「${session.question}」的含義：\n\n${selectedCards[2].name}${selectedCards[2].isReversed ? "（逆位）" : "（正位）"}\n\n請提供簡短但有洞察力的解讀，說明這張牌如何預示問題的可能發展。回答限制在150字以內，使用繁體中文。`;
        
        const futureInterpretation = await getAIResponse(futurePrompt, userId);
        
        // 綜合解讀
        const overallPrompt = `請以塔羅牌專家的身份，綜合解讀以下三張塔羅牌對於問題「${session.question}」的整體含義：\n\n過去：${selectedCards[0].name}${selectedCards[0].isReversed ? "（逆位）" : "（正位）"}\n現在：${selectedCards[1].name}${selectedCards[1].isReversed ? "（逆位）" : "（正位）"}\n未來：${selectedCards[2].name}${selectedCards[2].isReversed ? "（逆位）" : "（正位）"}\n\n請提供全面的綜合解讀，包括這三張牌如何互相關聯、整體故事線以及對問題的建議。回答限制在250字以內，使用繁體中文。`;
        
        const overallInterpretation = await getAIResponse(overallPrompt, userId);
        
        // 發送解讀結果
        let message = formatTarotText("三張牌陣解讀：過去、現在、未來", "cardTitle") + "\n\n";
        
        // 過去牌
        message += formatTarotText("過去：", "cardName") + "\n";
        message += formatTarotText(`${selectedCards[0].name}${selectedCards[0].isReversed ? "（逆位）" : "（正位）"}`, "cardName") + "\n";
        message += formatTarotText(pastInterpretation, "interpretation") + "\n\n";
        
        // 現在牌
        message += formatTarotText("現在：", "cardName") + "\n";
        message += formatTarotText(`${selectedCards[1].name}${selectedCards[1].isReversed ? "（逆位）" : "（正位）"}`, "cardName") + "\n";
        message += formatTarotText(presentInterpretation, "interpretation") + "\n\n";
        
        // 未來牌
        message += formatTarotText("未來：", "cardName") + "\n";
        message += formatTarotText(`${selectedCards[2].name}${selectedCards[2].isReversed ? "（逆位）" : "（正位）"}`, "cardName") + "\n";
        message += formatTarotText(futureInterpretation, "interpretation") + "\n\n";
        
        // 綜合解讀
        message += formatTarotText(overallInterpretation, "overall") + "\n\n";
        message += formatTarotText("", "final");
        
        await ctx.editMessageText(message, { parse_mode: "MarkdownV2" });
        
        // 清除會話
        tarotSessions.delete(userId);
      } catch (error) {
        console.error("Error interpreting tarot cards:", error);
        await ctx.editMessageText("解讀塔羅牌時發生錯誤，請稍後再試。");
        tarotSessions.delete(userId);
      }
    } else if (spreadType === "celtic") {
      // 凱爾特十字牌陣 - 由於較複雜，這裡簡化處理
      await ctx.editMessageText(formatTarotText("凱爾特十字牌陣功能正在開發中，請選擇其他牌陣。"));
      session.state = "waiting_for_question";
      await ctx.reply(formatTarotText("請從以下選項中選擇一種牌陣："), {
        reply_markup: {
          inline_keyboard: [
            [{ text: "單張牌陣 - 簡單問題的快速指引", callback_data: "tarot:spread:single" }],
            [{ text: "三張牌陣 - 過去、現在、未來", callback_data: "tarot:spread:three" }],
            [{ text: "取消占卜", callback_data: "tarot:cancel" }]
          ]
        }
      });
    }
    
    return;
  }
});

// 修改文字訊息處理中的塔羅牌部分
bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;

  // 處理塔羅牌占卜狀態
  if (tarotSessions.has(userId)) {
    const session = tarotSessions.get(userId);
    
    // 處理各種塔羅牌狀態
    if (session.state === "waiting_for_question") {
      // 用戶已輸入問題，進入抽牌階段
      session.question = userMessage;
      session.state = "drawing_cards";
      
      await ctx.reply(formatTarotText(`您的問題是：${session.question}`));
      await ctx.reply(formatTarotText("請從以下選項中選擇一種牌陣："), {
        reply_markup: {
          inline_keyboard: [
            [{ text: "單張牌陣 - 簡單問題的快速指引", callback_data: "tarot:spread:single" }],
            [{ text: "三張牌陣 - 過去、現在、未來", callback_data: "tarot:spread:three" }],
            [{ text: "凱爾特十字牌陣 - 複雜問題的深入分析", callback_data: "tarot:spread:celtic" }],
            [{ text: "取消占卜", callback_data: "tarot:cancel" }]
          ]
        }
      });
      return;
    }
    
    // 如果用戶在其他塔羅牌狀態中輸入文本，提醒他們當前正在進行占卜
    await ctx.reply("您正在進行塔羅牌占卜。請按照指示操作，或輸入 /cancel 取消占卜。");
    return;
  }

  // 一般對話處理
  try {
    // 顯示「正在輸入...」狀態
    await ctx.replyWithChatAction("typing");

    // 獲取 AI 回應
    const response = await getAIResponse(userMessage, userId);

    // 儲存對話
    conversationManager.addMessage(userMessage, response, userId);

    // 發送回應
    await ctx.reply(response, { parse_mode: "MarkdownV2" });
  } catch (error) {
    console.error("Error processing message:", error);
    await ctx.reply(`😕 ${error.message || "處理訊息時發生錯誤，請稍後再試。"}`);
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
