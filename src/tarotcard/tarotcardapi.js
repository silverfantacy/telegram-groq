import tarotcard from "./tarotcard";

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

    const selectedNumbers = numbers.split(" ").map(n => parseInt(n));
    
    if (selectedNumbers.length !== 3 || selectedNumbers.some(n => isNaN(n) || n < 1 || n > 78)) {
      throw new Error("請輸入有效的數字（1-78之間的三個數字，用空格分開）");
    }

    const selectedCards = selectedNumbers.map(n => userState.cards[n - 1]);
    
    const results = [];
    
    // Interpret first card
    const card1Interpretation = await interpretCallback([{
      role: "system",
      content: `你是一位塔羅牌讀者，擅長根據問題和抽到的牌提供深入的解讀。
使用者的問題是：${userState.question}
使用者抽到的三張牌是：${selectedCards.map(card => card.name).join(", ")}`
    }, {
      role: "user",
      content: "對於我的提問，抽到的第一張牌代表什麼意義？"
    }]);
    
    results.push({
      card: selectedCards[0],
      interpretation: card1Interpretation
    });

    // Interpret second card
    const card2Interpretation = await interpretCallback([{
      role: "system",
      content: `你是一位塔羅牌讀者，擅長根據問題和抽到的牌提供深入的解讀。
使用者的問題是：${userState.question}
使用者抽到的三張牌是：${selectedCards.map(card => card.name).join(", ")}`
    }, {
      role: "user",
      content: "抽到的第二張牌代表什麼意義？"
    }]);

    results.push({
      card: selectedCards[1],
      interpretation: card2Interpretation
    });

    // Interpret third card
    const card3Interpretation = await interpretCallback([{
      role: "system",
      content: `你是一位塔羅牌讀者，擅長根據問題和抽到的牌提供深入的解讀。
使用者的問題是：${userState.question}
使用者抽到的三張牌是：${selectedCards.map(card => card.name).join(", ")}`
    }, {
      role: "user",
      content: "抽到的第三張牌代表什麼意義？"
    }]);

    results.push({
      card: selectedCards[2],
      interpretation: card3Interpretation
    });

    // Overall interpretation
    const overallInterpretation = await interpretCallback([{
      role: "system",
      content: `你是一位塔羅牌讀者，擅長根據問題和抽到的牌提供深入的解讀。
使用者的問題是：${userState.question}
使用者抽到的三張牌是：${selectedCards.map(card => card.name).join(", ")}`
    }, {
      role: "user",
      content: "綜合考慮三張牌的意義後，你可以給出一個關於問題的塔羅牌解讀嗎？"
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