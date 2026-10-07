export interface BusinessQuestionContext {
  todaySalesPaisa: number;
  yesterdaySalesPaisa: number;
  weekSalesPaisa: number;
  todayNetProfitPaisa: number | null;
  todayGrossProfitPaisa: number | null;
  weekNetProfitPaisa: number | null;
  weekGrossProfitPaisa: number | null;
  lowStockCount: number | null;
  slowMovingCount: number | null;
  topProducts: { name: string; qty: number }[] | null;
}

export interface BusinessQuestionAnswer {
  answer: string;
  source: string;
  to?: string;
}

function normalize(question: string): string {
  return question
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function answerBusinessQuestion(question: string, context: BusinessQuestionContext): BusinessQuestionAnswer | null {
  const text = normalize(question);
  if (!text) return null;

  const asksToday = hasAny(text, ['today', 'aaj', 'aj']);
  const asksYesterday = hasAny(text, ['yesterday', 'kal']);
  const asksWeek = hasAny(text, ['this week', 'weekly', 'haftay', 'hafte', 'is haftay']);
  const asksProfit = hasAny(text, ['profit', 'munafa']);
  const asksGrossProfit = hasAny(text, ['gross profit', 'gross munafa']);
  const asksTopProduct = hasAny(text, ['best selling', 'top selling', 'most sold', 'sold most', 'sell most', 'top product', 'best seller', 'sab se zyada', 'zyada bik']);
  const asksSlowMoving = hasAny(text, ['slow moving', 'slow stock', 'not selling', 'no sale', 'nahi bik', 'kam bik']);
  const asksLowStock = hasAny(text, ['low stock', 'low inventory', 'stock kam', 'khatam', 'reorder', 'order now']);
  const asksSales = hasAny(text, ['sales', 'sale', 'sell', 'sold', 'revenue', 'bikri', 'kitna bika', 'kitni sale']);

  if (asksTopProduct) {
    if (context.topProducts === null) return { answer: 'Product sales ranking is not available for your account.', source: 'Sales analytics permission', to: '/reports' };
    const best = [...context.topProducts].sort((a, b) => b.qty - a.qty)[0];
    return best
      ? { answer: `${best.name} is the top-selling product in the last 30 days, with ${best.qty} units sold.`, source: 'Completed sales · last 30 days', to: '/reports' }
      : { answer: 'There are no completed product sales in the last 30 days to rank.', source: 'Completed sales · last 30 days', to: '/reports' };
  }

  if (asksSlowMoving) {
    if (context.slowMovingCount === null) return { answer: 'Stock movement details are not available for your account.', source: 'Inventory permission', to: '/inventory' };
    return { answer: `${context.slowMovingCount} stocked products meet the configured slow-moving threshold.`, source: 'Current stock and configured no-sale period', to: '/inventory' };
  }

  if (asksLowStock) {
    if (context.lowStockCount === null) return { answer: 'Stock forecasts are not available for your account.', source: 'Inventory permission', to: '/inventory' };
    return { answer: `${context.lowStockCount} products need ordering now based on current stock and recent sales.`, source: 'Current stock and sales velocity', to: '/inventory' };
  }

  if (asksProfit) {
    const value = asksGrossProfit
      ? asksWeek ? context.weekGrossProfitPaisa : context.todayGrossProfitPaisa
      : asksWeek ? context.weekNetProfitPaisa : context.todayNetProfitPaisa;
    if (value === null) return { answer: 'Profit figures are not available for your account.', source: 'Profit-report permission', to: '/reports' };
    if (asksGrossProfit) {
      return {
        answer: `${asksWeek ? 'This week' : 'Today'}’s gross profit is ${formatPaisa(value)}.`,
        source: `${asksWeek ? 'This week' : 'Today'} · sales less cost of goods`,
        to: '/reports',
      };
    }
    return {
      answer: `${asksWeek ? 'This week' : 'Today'}’s net profit is ${formatPaisa(value)}.`,
      source: asksWeek ? 'This week · verified profit report' : 'Today · verified profit report',
      to: '/reports',
    };
  }

  if (asksSales) {
    if (asksYesterday) return { answer: `Yesterday’s net sales were ${formatPaisa(context.yesterdaySalesPaisa)}.`, source: 'Sales less returns · yesterday', to: '/reports' };
    if (asksWeek) return { answer: `This week’s net sales were ${formatPaisa(context.weekSalesPaisa)}.`, source: 'Sales less returns · this week', to: '/reports' };
    return { answer: `Today’s net sales are ${formatPaisa(context.todaySalesPaisa)}.`, source: 'Sales less returns · today', to: '/reports' };
  }

  return null;
}

function formatPaisa(paisa: number): string {
  const wholeRupees = Math.round(paisa) / 100;
  return `Rs ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(wholeRupees)}`;
}
