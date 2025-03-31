設計塔羅牌的機制
// 使用者狀態管理
const userStates = new Map();

// 處理事件的主要函數
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const userMessage = event.message.text;

  // 取得使用者當前狀態
  let userState = userStates.get(userId) || {
    step: "idle",
    question: null,
    cards: null,
  };

  // 根據使用者當前狀態處理訊息
  switch (userState.step) {
    case "idle":
      if (userMessage.includes("抽牌")) {
        return handleStartReading(event, userId);
      }
      return handleHelp(event);

    case "waiting_question":
      return handleQuestion(event, userId, userMessage);

    case "waiting_numbers":
      return handleCardSelection(event, userId, userMessage);

    default:
      return handleHelp(event);
  }
}
​
當使用者不知道怎麼用
// 處理幫助訊息
async function handleHelp(event) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "歡迎使用塔羅牌機器人！\n輸入「抽牌」開始新的塔羅牌諮詢。",
  });
}
​
當使用者說「抽牌」
// 開始抽牌流程
async function handleStartReading(event, userId) {
  userStates.set(userId, {
    step: "waiting_question",
    question: null,
    cards: null,
  });

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "請告訴我你想諮詢的問題（例如：感情、事業、短期發展等）",
  });
}
​
當使用者回答了自己想算命的題目
// 處理使用者的問題
async function handleQuestion(event, userId, question) {
  // 洗牌
  const shuffledCards = shuffleCards([...cards]);

  userStates.set(userId, {
    step: "waiting_numbers",
    question: question,
    cards: shuffledCards,
  });

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "牌已經洗好了。請選擇三個數字（1-78，用空格分開，例如：7 23 45）",
  });
}
​
// 洗牌函數
function shuffleCards(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
​
當使用者選好三張牌 
// 處理使用者選擇的牌
async function handleCardSelection(event, userId, numbers) {
  const userState = userStates.get(userId);
  const selectedNumbers = numbers.split(" ").map((n) => parseInt(n));

  // 驗證數字格式
  if (
    selectedNumbers.length !== 3 ||
    selectedNumbers.some((n) => isNaN(n) || n < 1 || n > 78)
  ) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "請輸入有效的數字（1-78之間的三個數字，用空格分開）",
    });
  }

  // 取得選中的牌
  const selectedCards = selectedNumbers.map((n) => userState.cards[n - 1]);
  const cardImages = selectedCards.map(
    (card) =>
      `https://raw.githubusercontent.com/krates98/tarotcardapi/refs/heads/main/images/${card.image
        .split("/")
        .pop()}`
  );

  const messages = [
    {
      role: "system",
      content: `你是一位塔羅牌讀者，擅長根據問題和抽到的牌提供深入的解讀。
	使用者現在想知道的問題是： ${userState.question}
	使用者抽到的三張牌是：${selectedCards.map((card) => card.name).join(", ")}
	接下來他會問你問題，請你直接給出文字，不需要 markdown 語法。`,
    },
    { role: "user", content: "對於我的提問，抽到的第一張牌代表什麼意義？" },
  ];

  const card1 = await askGPT(messages);
  await client.pushMessage(userId, { type: "text", text: card1 });

  await client.pushMessage(userId, {
    type: "image",
    originalContentUrl: cardImages[0],
    previewImageUrl: cardImages[0],
  });

  messages.push({
    role: "assistant",
    content: card1,
  });

  messages.push({
    role: "user",
    content: "抽到的第二張牌代表什麼意義？",
  });

  const card2 = await askGPT(messages);
  await client.pushMessage(userId, {
    type: "text",
    text: card2,
  });

  await client.pushMessage(userId, {
    type: "image",
    originalContentUrl: cardImages[1],
    previewImageUrl: cardImages[1],
  });

  messages.push({
    role: "assistant",
    content: card2,
  });

  messages.push({
    role: "user",
    content: "抽到的第三張牌代表什麼意義？",
  });

  const card3 = await askGPT(messages);
  await client.pushMessage(userId, {
    type: "text",
    text: card3,
  });

  await client.pushMessage(userId, {
    type: "image",
    originalContentUrl: cardImages[2],
    previewImageUrl: cardImages[2],
  });

  messages.push({
    role: "assistant",
    content: card3,
  });

  messages.push({
    role: "user",
    content: "綜合考慮三張牌的意義後，你可以給出一個關於問題的塔羅牌解讀嗎？",
  });

  const reading = await askGPT(messages);
  await client.pushMessage(userId, {
    type: "text",
    text: reading,
  });

  // 重置使用者狀態
  userStates.set(userId, {
    step: "idle",
    question: null,
    cards: null,
  });

  return;
}
​
async function askGPT(messages) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer {API_KEY}`,
    },
    body: JSON.stringify({
      model: "chatgpt-4o-latest",
      messages,
      max_tokens: 400, // 設置生成的文本最大長度
      temperature: 0.7, // 控制生成內容的隨機性，0.7 是一個常見的選擇
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return JSON.stringify(data);
  }

  // 返回生成的解讀
  return data.choices[0].message.content;
}