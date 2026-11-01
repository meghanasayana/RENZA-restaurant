'use client';

import { useState } from 'react';
import { Wand2, AlertTriangle, Check, X, Search } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

/**
 * Changing the menu by typing what you want.
 *
 * Two steps on purpose. Typing asks the server what it WOULD do and shows it;
 * nothing is written until the admin reads that and presses Apply. A sentence
 * never changes a menu on its own.
 *
 * Deleting asks a second time, in its own words, because it cannot be undone.
 */
export default function MenuAssistantPanel({ onChanged }) {
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState(null);
  const [applying, setApplying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const look = async () => {
    const instruction = text.trim();
    if (!instruction) return;

    setThinking(true);
    setResult(null);
    setConfirmingDelete(false);
    try {
      const res = await api.post('/api/restaurant/assistant/preview', { text: instruction });
      setResult(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not read that.');
    } finally {
      setThinking(false);
    }
  };

  const applyIt = async (confirmDelete = false) => {
    if (!result?.intent) return;

    setApplying(true);
    try {
      await api.post('/api/restaurant/assistant/apply', {
        intent: result.intent,
        confirmDelete,
      });
      toast.success('Done.');
      setText('');
      setResult(null);
      setConfirmingDelete(false);
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.response?.data?.error || 'Could not apply that.');
    } finally {
      setApplying(false);
    }
  };

  const plan = result?.plan;
  const blocked = plan && !plan.canApply;
  const answer = result?.kind === 'answer' ? result : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Wand2 className="w-4 h-4 text-orange-500 flex-shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-900">Menu Assistant</h3>
        <span className="text-[11px] text-slate-500">
          ask about the menu, or tell it what to change
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              look();
            }
          }}
          placeholder='Ask or change: "what is under 250", "Gobi 65 is sold out", "change Chicken Biryani to 300"'
          className="flex-1 min-w-0 text-sm rounded-lg border border-slate-200 px-3 py-1.5
                     focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
        <button
          type="button"
          onClick={look}
          disabled={thinking || !text.trim()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 text-white
                     disabled:bg-slate-200 disabled:text-slate-400"
        >
          {thinking ? '…' : 'Check'}
        </button>
      </div>

      {/*
        A question is answered straight away. Nothing was written, so there is
        nothing to confirm - only a list to read.
      */}
      {answer && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Search className="w-3 h-3" aria-hidden="true" />
            {answer.summary}
          </p>

          {answer.dishes.length > 0 && (
            <div className="mt-2 max-h-80 overflow-y-auto pr-1 divide-y divide-slate-100">
              {answer.dishes.map((d, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5">
                  {/* The green/red square every Indian menu uses. */}
                  <span
                    className={`mt-1 w-2.5 h-2.5 border flex-shrink-0 ${
                      d.isVeg ? 'border-green-600' : 'border-red-600'
                    }`}
                    title={d.isVeg ? 'Veg' : 'Non-veg'}
                  >
                    <span
                      className={`block w-1.5 h-1.5 rounded-full m-[1.5px] ${
                        d.isVeg ? 'bg-green-600' : 'bg-red-600'
                      }`}
                    />
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-900 leading-tight">
                      {d.name}
                      {!d.isAvailable && (
                        <span className="ml-1.5 text-[10px] font-semibold text-red-600 uppercase">
                          sold out
                        </span>
                      )}
                    </p>
                    {d.categoryName && (
                      <p className="text-[10px] text-slate-400 leading-tight">{d.categoryName}</p>
                    )}
                  </div>

                  {/* Every price the dish is sold at, labelled. */}
                  <div className="flex-shrink-0 text-right">
                    {d.portions?.length > 0 ? (
                      d.portions.map((p, j) => (
                        <p key={j} className="text-[11px] text-slate-700 leading-tight">
                          <span className="text-slate-400">{p.portion} </span>
                          <span className="font-semibold">{p.price}</span>
                        </p>
                      ))
                    ) : (
                      <p className="text-xs font-semibold text-slate-900">{d.price}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {answer.total > answer.dishes.length && (
            <p className="text-[10px] text-slate-400 mt-1">
              Showing {answer.dishes.length} of {answer.total}.
            </p>
          )}
        </div>
      )}

      {result && !result.understood && (
        <p className="text-[11px] text-amber-700 mt-2">{result.message}</p>
      )}

      {plan && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <p className="text-sm font-semibold text-slate-900">{plan.summary}</p>

          {/* What would change, line by line, before anything happens. */}
          {plan.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {plan.changes.map((c, i) => (
                <li key={i} className="text-xs text-slate-700">
                  <span className="text-slate-500">{c.field.replace('portion:', '')}: </span>
                  {c.from === null || c.from === undefined ? (
                    <span>{String(c.to)}</span>
                  ) : (
                    <>
                      <span className="line-through text-slate-400">{String(c.from)}</span>
                      <span> → </span>
                      <span className="font-semibold">{String(c.to)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {plan.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-700 mt-1 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
              {w.message}
            </p>
          ))}

          {/* The planner refused. It says why, and often which dishes it meant. */}
          {blocked && (
            <p className="text-[11px] text-slate-600 mt-1">
              {plan.warnings.length === 0 && 'That cannot be applied as described.'}
            </p>
          )}

          {plan.candidates?.length > 0 && (
            <p className="text-[11px] text-slate-600 mt-1">
              Did you mean: {plan.candidates.map((c) => c.name).join(', ')}?
            </p>
          )}

          {plan.canApply && !confirmingDelete && (
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => (plan.destructive ? setConfirmingDelete(true) : applyIt(false))}
                disabled={applying}
                className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white
                           ${plan.destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'}`}
              >
                <Check className="w-3 h-3" aria-hidden="true" />
                {applying ? '…' : plan.destructive ? 'Delete it' : 'Apply'}
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg
                           border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                <X className="w-3 h-3" aria-hidden="true" />
                Cancel
              </button>
            </div>
          )}

          {/* Deleting asks again, in its own words. */}
          {confirmingDelete && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
              <p className="text-xs text-red-800 font-semibold">
                This permanently deletes the dish. It cannot be undone.
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => applyIt(true)}
                  disabled={applying}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
                >
                  {applying ? '…' : 'Yes, delete it'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-xs px-2 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-white"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
