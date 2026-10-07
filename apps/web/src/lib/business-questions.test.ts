import { describe, expect, it } from 'vitest';
import { answerBusinessQuestion, type BusinessQuestionContext } from './business-questions';

const context: BusinessQuestionContext = {
  todaySalesPaisa: 125_000,
  yesterdaySalesPaisa: 98_000,
  weekSalesPaisa: 840_000,
  todayNetProfitPaisa: 32_000,
  todayGrossProfitPaisa: 40_000,
  weekNetProfitPaisa: 210_000,
  weekGrossProfitPaisa: 250_000,
  lowStockCount: 3,
  slowMovingCount: 7,
  topProducts: [
    { name: 'Chini', qty: 12 },
    { name: 'Doodh', qty: 28 },
  ],
};

describe('deterministic business questions', () => {
  it('answers supported sales questions for defined date ranges', () => {
    expect(answerBusinessQuestion('How much did we sell today?', context)).toMatchObject({ answer: 'Today’s net sales are Rs 1,250.' });
    expect(answerBusinessQuestion('Kal ki sales kitni thin?', context)).toMatchObject({ answer: 'Yesterday’s net sales were Rs 980.' });
    expect(answerBusinessQuestion('Sales this week', context)).toMatchObject({ answer: 'This week’s net sales were Rs 8,400.' });
  });

  it('answers profit, top-product and stock questions from available report data', () => {
    expect(answerBusinessQuestion('aaj ka munafa?', context)).toMatchObject({ answer: 'Today’s net profit is Rs 320.' });
    expect(answerBusinessQuestion('today gross profit', context)).toMatchObject({ answer: 'Today’s gross profit is Rs 400.' });
    expect(answerBusinessQuestion('gross profit this week', context)).toMatchObject({ answer: 'This week’s gross profit is Rs 2,500.' });
    expect(answerBusinessQuestion('Which product sold most?', context)).toMatchObject({ answer: 'Doodh is the top-selling product in the last 30 days, with 28 units sold.' });
    expect(answerBusinessQuestion('low stock?', context)).toMatchObject({ answer: '3 products need ordering now based on current stock and recent sales.' });
    expect(answerBusinessQuestion('slow moving products', context)).toMatchObject({ answer: '7 stocked products meet the configured slow-moving threshold.' });
  });

  it('does not reveal protected information without relevant permissions', () => {
    expect(answerBusinessQuestion('today profit', { ...context, todayNetProfitPaisa: null })).toMatchObject({ source: 'Profit-report permission' });
    expect(answerBusinessQuestion('low stock', { ...context, lowStockCount: null })).toMatchObject({ source: 'Inventory permission' });
    expect(answerBusinessQuestion('best selling', { ...context, topProducts: null })).toMatchObject({ source: 'Sales analytics permission' });
  });

  it('does not guess unsupported or empty questions', () => {
    expect(answerBusinessQuestion('', context)).toBeNull();
    expect(answerBusinessQuestion('What should I do with my shop?', context)).toBeNull();
  });
});
