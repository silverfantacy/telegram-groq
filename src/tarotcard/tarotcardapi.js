import tarotcard from "./tarotcard.js";
import { basePrompt, interpretationPrompts } from "./prompts.js";

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

    userState.cards = this.shuffleCards();

    const selectedNumbers = numbers.split(" ").map(n => parseInt(n));
    
    if (selectedNumbers.length !== 3 || 
        selectedNumbers.some(n => isNaN(n) || n < 1 || n > 78) ||
        new Set(selectedNumbers).size !== 3) {
      throw new Error("請輸入三個不重複的數字（1-78之間，用空格分開）");
    }

    const selectedCards = selectedNumbers.map(n => userState.cards[n - 1]);
    const results = [];
    
    // Interpret first card
    const card1Interpretation = await interpretCallback([{
      role: "system",
      content: basePrompt(userState.question, selectedCards)
    }, {
      role: "user",
      content: interpretationPrompts.firstCard
    }]);
    
    results.push({
      card: selectedCards[0],
      interpretation: card1Interpretation
    });

    // Interpret second card
    const card2Interpretation = await interpretCallback([{
      role: "system",
      content: basePrompt(userState.question, selectedCards)
    }, {
      role: "user",
      content: interpretationPrompts.secondCard
    }]);

    results.push({
      card: selectedCards[1],
      interpretation: card2Interpretation
    });

    // Interpret third card
    const card3Interpretation = await interpretCallback([{
      role: "system",
      content: basePrompt(userState.question, selectedCards)
    }, {
      role: "user",
      content: interpretationPrompts.thirdCard
    }]);

    results.push({
      card: selectedCards[2],
      interpretation: card3Interpretation
    });

    // Overall interpretation
    const overallInterpretation = await interpretCallback([{
      role: "system",
      content: basePrompt(userState.question, selectedCards)
    }, {
      role: "user",
      content: interpretationPrompts.overall
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