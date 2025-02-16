import tarotcard from "./tarotcard.js";

const cards = tarotcard;

class TarotCardAPI {
  constructor() {
    this.userStates = new Map();
  }

  shuffleCards() {
    const shuffledCards = [...cards];
    for (let i = shuffledCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledCards[i], shuffledCards[j]] = [shuffledCards[j], shuffledCards[i]];
      // 隨機設置正逆位
      shuffledCards[i].isReversed = Math.random() < 0.5;
    }
    return shuffledCards;
  }

  startReading(userId) {
    this.userStates.set(userId, {
      step: "waiting_question",
      question: null,
      cards: null
    });
    return "請告訴我你想諮詢的問題（例如：感情、事業、短期發展等）";
  }

  setQuestion(userId, question) {
    const shuffledCards = this.shuffleCards();
    this.userStates.set(userId, {
      step: "waiting_numbers",
      question: question,
      cards: shuffledCards
    });
    return "牌已經洗好了。請選擇三個數字（1-78，用空格分開，例如：7 23 45）";
  }

  async selectCards(userId, numbers, interpretCallback) {
    const userState = this.userStates.get(userId);
    if (!userState) {
      throw new Error("No active reading session");
    }

    // 重新洗牌
    userState.cards = this.shuffleCards();

    const selectedNumbers = numbers.split(" ").map(n => parseInt(n));
    
    if (selectedNumbers.length !== 3 || 
        selectedNumbers.some(n => isNaN(n) || n < 1 || n > 78) ||
        new Set(selectedNumbers).size !== 3) {  // 检查重复数字
      throw new Error("請輸入三個不重複的數字（1-78之間，用空格分開）");
    }

    const selectedCards = selectedNumbers.map(n => userState.cards[n - 1]);
    
    const results = [];
    
    // Interpret first card
    const card1Interpretation = await interpretCallback([{
      role: "system",
      content: `你是一位專業的塔羅牌讀者，擅長解讀塔羅牌的深層含義。請注意以下幾點：
        1. 請使用繁體中文進行解讀
        2. 請考慮卡片的正逆位
        3. 解讀時要結合提問的具體情境
        4. 給出明確且具體的指引

        使用者的問題是：${userState.question}
        抽到的三張牌是：${selectedCards.map(card => 
          `${card.name}${card.isReversed ? '（逆位）' : '（正位）'}`
        ).join(", ")}`
    }, {
      role: "user",
      content: "第一張牌代表當前的狀況或是問題的根源，請解讀這張牌的含義："
    }]);
    
    results.push({
      card: selectedCards[0],
      interpretation: card1Interpretation
    });

    // Interpret second card
    const card2Interpretation = await interpretCallback([{
      role: "system",
      content: `你是一位專業的塔羅牌讀者，擅長解讀塔羅牌的深層含義。請注意以下幾點：
        1. 請使用繁體中文進行解讀
        2. 請考慮卡片的正逆位
        3. 解讀時要結合提問的具體情境
        4. 給出明確且具體的指引

        使用者的問題是：${userState.question}
        抽到的三張牌是：${selectedCards.map(card => 
          `${card.name}${card.isReversed ? '（逆位）' : '（正位）'}`
        ).join(", ")}`
    }, {
      role: "user",
      content: "第二張牌代表當前面臨的挑戰或機遇，請解讀這張牌的含義："
    }]);

    results.push({
      card: selectedCards[1],
      interpretation: card2Interpretation
    });

    // Interpret third card
    const card3Interpretation = await interpretCallback([{
      role: "system",
      content: `你是一位專業的塔羅牌讀者，擅長解讀塔羅牌的深層含義。請注意以下幾點：
        1. 請使用繁體中文進行解讀
        2. 請考慮卡片的正逆位
        3. 解讀時要結合提問的具體情境
        4. 給出明確且具體的指引

        使用者的問題是：${userState.question}
        抽到的三張牌是：${selectedCards.map(card => 
          `${card.name}${card.isReversed ? '（逆位）' : '（正位）'}`
        ).join(", ")}`
    }, {
      role: "user",
      content: "第三張牌代表可能的結果或建議，請解讀這張牌的含義："
    }]);

    results.push({
      card: selectedCards[2],
      interpretation: card3Interpretation
    });

    // Overall interpretation
    const overallInterpretation = await interpretCallback([{
      role: "system",
      content: `你是一位專業的塔羅牌讀者，擅長解讀塔羅牌的深層含義。請注意以下幾點：
        1. 請使用繁體中文進行解讀
        2. 請考慮卡片的正逆位
        3. 解讀時要結合提問的具體情境
        4. 給出明確且具體的指引
        5. 綜合解讀要包含時間線：過去->現在->未來/建議

        使用者的問題是：${userState.question}
        抽到的三張牌是：${selectedCards.map(card => 
          `${card.name}${card.isReversed ? '（逆位）' : '（正位）'}`
        ).join(", ")}`
    }, {
      role: "user",
      content: "請綜合三張牌的能量，給出一個完整的解讀。包含當前處境、面臨的挑戰以及未來的建議："
    }]);

    // Reset user state
    this.userStates.set(userId, {
      step: "idle",
      question: null,
      cards: null
    });

    return {
      cards: results,
      overallInterpretation
    };
  }

  getUserState(userId) {
    return this.userStates.get(userId);
  }
}

export default TarotCardAPI;