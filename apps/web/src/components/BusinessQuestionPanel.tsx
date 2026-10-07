import { MessageCircleQuestion, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { answerBusinessQuestion, type BusinessQuestionContext } from '../lib/business-questions';
import { Button, Card, Input } from './ui';

const EXAMPLES = [
  'How much did we sell today?',
  'Aaj ka munafa?',
  'Which product sold most?',
  'How many products are low stock?',
];

export function BusinessQuestionPanel({ context }: { context: BusinessQuestionContext }) {
  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuestion(question.trim());
  };
  const answer = submittedQuestion ? answerBusinessQuestion(submittedQuestion, context) : null;

  return (
    <Card title={<span className="flex items-center gap-2"><MessageCircleQuestion size={17} className="text-brand-600" /> Ask about your shop</span>}>
      <div className="space-y-3 p-4">
        <form className="flex gap-2" onSubmit={submit}>
          <Input
            aria-label="Ask a business question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. How much did we sell today?"
          />
          <Button type="submit" aria-label="Ask question" disabled={!question.trim()}>
            <Search size={16} />
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </form>
        <div className="flex flex-wrap gap-2" aria-label="Example questions">
          {EXAMPLES.map((example) => (
            <Button
              key={example}
              size="sm"
              variant="secondary"
              onClick={() => {
                setQuestion(example);
                setSubmittedQuestion(example);
              }}
            >
              {example}
            </Button>
          ))}
        </div>
        {submittedQuestion && (
          <div aria-live="polite" className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-500">{submittedQuestion}</p>
            {answer ? (
              <>
                <p className="mt-1 text-sm font-semibold text-slate-900">{answer.answer}</p>
                <p className="mt-1 text-xs text-slate-500">Source: {answer.source}</p>
                {answer.to && <Link to={answer.to} className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">Open details</Link>}
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-700">I don’t have a verified answer for that question yet. Try one of the examples above.</p>
            )}
          </div>
        )}
        <p className="text-xs text-slate-500">Answers come from recorded shop reports. This assistant does not change prices, stock, or orders.</p>
      </div>
    </Card>
  );
}
