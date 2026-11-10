'use client';

import * as React from 'react';
import { AdminShell } from '@/components/staff/AdminShell';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { AdminRestaurantGame } from '@/components/admin/AdminRestaurantGame';
import { cn } from '@/lib/utils';
import type { StaffUser } from '@/types';
import { Download, FileUp, Medal, Plus, Trash2, Trophy } from 'lucide-react';

type Category = { id: string; name: string; emoji: string | null; is_active: boolean; sort_order: number };
type Question = {
  id: string;
  category_id: string;
  category_name: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  difficulty: number;
  is_active: boolean;
};
type Prize = { rank: number; title: string; description: string | null; is_active: boolean };
type Leaderboard = {
  date: string;
  pointsMode: 'sum' | 'average';
  rows: { rank: number; tableNumber: number; points: number; rounds: number; prize: { title: string } | null }[];
};

const CSV_TEMPLATE = `question,option1,option2,option3,option4,correct,explanation,difficulty
Which planet is known as the Red Planet?,Venus,Mars,Jupiter,Mercury,2,Iron oxide gives Mars its colour,1
What is 15% of 240?,24,32,36,42,3,10% is 24 and 5% is 12 so 15% is 36,1`;

export function AdminGames({
  user,
  categories: initialCategories,
  questions: initialQuestions,
  prizes: initialPrizes,
  leaderboard,
  showPrizes: initialShowPrizes,
}: {
  user: StaffUser;
  categories: Category[];
  questions: Question[];
  prizes: Prize[];
  leaderboard: Leaderboard;
  showPrizes: boolean;
}) {
  const { push } = useToast();
  const [categories, setCategories] = React.useState(initialCategories);
  const [questions, setQuestions] = React.useState(initialQuestions);
  const [prizes, setPrizes] = React.useState(initialPrizes);
  const [filter, setFilter] = React.useState<string | 'all'>('all');
  const [editingQuestion, setEditingQuestion] = React.useState<Question | 'new' | null>(null);
  const [editingCategory, setEditingCategory] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [editingPrize, setEditingPrize] = React.useState<Prize | 'new' | null>(null);
  const [showPrizes, setShowPrizes] = React.useState(initialShowPrizes);

  const reload = React.useCallback(async () => {
    const res = await api.get<{
      categories: Category[];
      questions: Question[];
      prizes: Prize[];
      leaderboard: Leaderboard;
      showPrizes: boolean;
    }>('/api/admin/games');
    setCategories(res.categories);
    setQuestions(res.questions);
    setPrizes(res.prizes);
    setShowPrizes(res.showPrizes);
  }, []);

  // master switch: guests see leaderboard prizes only while this is on
  async function toggleShowPrizes(next: boolean) {
    const before = showPrizes;
    setShowPrizes(next);
    try {
      await api.post('/api/admin/settings', { games: { showPrizes: next } });
      push(next ? 'Guests can now see the prizes' : 'Prizes are hidden from guests', 'success');
    } catch (err) {
      setShowPrizes(before);
      push(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  }

  const filtered = questions.filter((q) => filter === 'all' || q.category_id === filter);

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {/* start the restaurant game and see who won */}
        <AdminRestaurantGame />

        {/* categories */}
        <section className="rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Quiz categories</h2>
            <Button size="sm" variant="outline" onClick={() => setEditingCategory(true)}>
              <Plus className="h-3.5 w-3.5" /> Category
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <span
                key={c.id}
                className="rounded-lg bg-secondary px-2.5 py-1 text-xs font-semibold"
              >
                {c.name}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {questions.filter((q) => q.category_id === c.id).length}
                </span>
              </span>
            ))}
          </div>
        </section>

        {/* questions */}
        <section className="rounded-2xl border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-sm font-bold">Questions ({questions.length})</h2>
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <FileUp className="h-3.5 w-3.5" /> CSV import
            </Button>
            <Button size="sm" onClick={() => setEditingQuestion('new')}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>

          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={cn(
                'shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold',
                filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary',
              )}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilter(c.id)}
                className={cn(
                  'shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold',
                  filter === c.id ? 'bg-primary text-primary-foreground' : 'bg-secondary',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>

          <ul className="mt-2 divide-y divide-border">
            {filtered.slice(0, 60).map((q) => (
              <li key={q.id} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{q.question}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {q.category_name} · answer: {q.options[q.correct_index]}
                    {!q.is_active && ' · hidden'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingQuestion(q)}
                  className="tap rounded-lg text-xs font-semibold text-primary"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm('Delete this question?')) return;
                    await api.post('/api/admin/quiz-question-delete', { id: q.id });
                    await reload();
                    push('Question deleted', 'success');
                  }}
                  className="tap rounded-lg text-destructive"
                  aria-label="Delete question"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="py-4 text-center text-xs text-muted-foreground">No questions yet.</li>
            )}
          </ul>
          {filtered.length > 60 && (
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              Showing the first 60 — filter by category to see more.
            </p>
          )}
        </section>

        {/* prizes */}
        <section className="rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-bold">
              <Trophy className="h-4 w-4 text-amber-500" /> Leaderboard prizes
            </h2>
            <Button size="sm" variant="outline" onClick={() => setEditingPrize('new')}>
              <Plus className="h-3.5 w-3.5" /> Prize
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-border p-2.5">
            <div>
              <p className="text-sm font-semibold">Show prizes to guests</p>
              <p className="text-[11px] text-muted-foreground">
                {showPrizes
                  ? 'Guests see the active prizes next to the top ranks on the Games page.'
                  : 'Off: guests see no prize anywhere. Turn it on on the days you want to give one.'}
              </p>
            </div>
            <Switch checked={showPrizes} onCheckedChange={toggleShowPrizes} aria-label="Show prizes to guests" />
          </div>
          <ul className="mt-2 space-y-1">
            {prizes.map((p) => (
              <li key={p.rank} className="flex items-center gap-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-sm">
                <Medal className="h-4 w-4 text-amber-500" />
                <span className="font-semibold">Rank {p.rank}</span>
                <span className="flex-1 truncate">
                  {p.title}
                  {!p.is_active && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· hidden</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingPrize(p)}
                  className="text-xs font-semibold text-primary"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await api.post('/api/admin/prize-delete', { rank: p.rank });
                    await reload();
                  }}
                  className="text-destructive"
                  aria-label={`Delete prize ${p.rank}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {prizes.length === 0 && (
              <li className="py-2 text-center text-xs text-muted-foreground">No prizes configured.</li>
            )}
          </ul>

          <div className="mt-3 rounded-xl bg-secondary/60 p-2.5">
            <p className="text-[11px] font-semibold">Today’s board ({leaderboard.pointsMode === 'average' ? 'average' : 'total'} points)</p>
            <ol className="mt-1 space-y-0.5 text-xs">
              {leaderboard.rows.slice(0, 5).map((r) => (
                <li key={r.tableNumber} className="flex justify-between">
                  <span>
                    #{r.rank} Table {r.tableNumber} {r.prize && <Badge variant="success" className="ml-1 text-[9px]">{r.prize.title}</Badge>}
                  </span>
                  <span className="font-semibold">{r.points}</span>
                </li>
              ))}
              {leaderboard.rows.length === 0 && (
                <li className="text-muted-foreground">No restaurant rounds played yet today.</li>
              )}
            </ol>
          </div>
        </section>

        <p className="rounded-xl bg-secondary p-3 text-[11px] text-muted-foreground">
          Scoring is server-side: 100 points per correct answer plus up to 50 speed-bonus points that
          decay over 10 seconds. Correct answers are never sent to the browser before a player
          answers, and the daily leaderboard resets at midnight (IST).
        </p>
      </div>

      <QuestionDialog
        open={editingQuestion !== null}
        question={editingQuestion}
        categories={categories}
        onClose={() => setEditingQuestion(null)}
        onSaved={async () => {
          setEditingQuestion(null);
          await reload();
          push('Question saved', 'success');
        }}
      />
      <ImportDialog
        open={importing}
        categories={categories}
        onClose={() => setImporting(false)}
        onSaved={async () => {
          setImporting(false);
          await reload();
        }}
      />
      <CategoryDialog
        open={editingCategory}
        onClose={() => setEditingCategory(false)}
        onSaved={async () => {
          setEditingCategory(false);
          await reload();
          push('Category saved', 'success');
        }}
      />
      <PrizeDialog
        open={editingPrize !== null}
        prize={editingPrize}
        onClose={() => setEditingPrize(null)}
        onSaved={async () => {
          setEditingPrize(null);
          await reload();
          push('Prize saved', 'success');
        }}
      />
    </AdminShell>
  );
}

function QuestionDialog({
  open,
  question,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  question: Question | 'new' | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    categoryId: categories[0]?.id ?? '',
    question: '',
    options: ['', '', '', ''],
    correctIndex: 0,
    explanation: '',
    difficulty: 1,
    isActive: true,
  });

  React.useEffect(() => {
    if (question === 'new')
      setForm({
        categoryId: categories[0]?.id ?? '',
        question: '',
        options: ['', '', '', ''],
        correctIndex: 0,
        explanation: '',
        difficulty: 1,
        isActive: true,
      });
    else if (question)
      setForm({
        categoryId: question.category_id,
        question: question.question,
        options: [...question.options],
        correctIndex: question.correct_index,
        explanation: question.explanation ?? '',
        difficulty: question.difficulty,
        isActive: question.is_active,
      });
  }, [question, categories]);

  async function save() {
    setBusy(true);
    try {
      await api.post('/api/admin/quiz-question', {
        id: question !== 'new' && question ? question.id : undefined,
        categoryId: form.categoryId,
        question: form.question,
        options: form.options,
        correctIndex: Number(form.correctIndex),
        explanation: form.explanation || null,
        difficulty: Number(form.difficulty),
        isActive: form.isActive,
      });
      await onSaved();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={question === 'new' ? 'Add question' : 'Edit question'}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="q-cat">Category</Label>
            <Select
              id="q-cat"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="mt-1"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="q-text">Question</Label>
            <Textarea
              id="q-text"
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              className="mt-1"
              maxLength={300}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Options — tap the circle to mark the correct answer</Label>
            {form.options.map((option, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, correctIndex: i })}
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                    form.correctIndex === i
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-border text-muted-foreground',
                  )}
                  aria-label={`Mark option ${i + 1} correct`}
                >
                  {String.fromCharCode(65 + i)}
                </button>
                <Input
                  value={option}
                  onChange={(e) => {
                    const options = [...form.options];
                    options[i] = e.target.value;
                    setForm({ ...form, options });
                  }}
                  placeholder={`Option ${i + 1}`}
                />
              </div>
            ))}
          </div>
          <div>
            <Label htmlFor="q-exp">Explanation (shown after answering)</Label>
            <Input
              id="q-exp"
              value={form.explanation}
              onChange={(e) => setForm({ ...form, explanation: e.target.value })}
              className="mt-1"
              maxLength={300}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="q-diff" className="text-xs">
                Difficulty (1-3)
              </Label>
              <Input
                id="q-diff"
                type="number"
                min={1}
                max={3}
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div className="flex items-end justify-between rounded-xl border border-border p-2">
              <span className="text-xs">Active</span>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                aria-label="Active"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={save}
              loading={busy}
              disabled={!form.question || form.options.some((o) => !o.trim())}
            >
              Save question
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [categoryId, setCategoryId] = React.useState(categories[0]?.id ?? '');
  const [csv, setCsv] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ inserted: number; errors: { line: number; message: string }[] } | null>(
    null,
  );

  React.useEffect(() => {
    if (open) {
      setCategoryId(categories[0]?.id ?? '');
      setCsv('');
      setResult(null);
    }
  }, [open, categories]);

  async function run() {
    setBusy(true);
    try {
      const res = await api.post<{ inserted: number; errors: { line: number; message: string }[] }>(
        '/api/admin/quiz-import',
        { categoryId, csv },
      );
      setResult(res);
      push(`${res.inserted} questions imported`, 'success');
      if (res.inserted) await onSaved();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      push('CSV is too large (max 500 KB)', 'error');
      return;
    }
    setCsv(await file.text());
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Bulk import questions (CSV)"
        description="Columns: question, option1..option4, correct (1-4), explanation, difficulty"
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="i-cat">Import into category</Label>
            <Select
              id="i-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="i-file">CSV file</Label>
            <Input id="i-file" type="file" accept=".csv,text/csv" onChange={onFile} className="mt-1 py-2" />
          </div>

          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="…or paste the CSV here"
            rows={7}
            className="font-mono text-xs"
          />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCsv(CSV_TEMPLATE)}>
              Load template
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'questions-template.csv';
                a.click();
              }}
            >
              <Download className="h-3.5 w-3.5" /> Download template
            </Button>
          </div>

          {result && (
            <div className="rounded-xl bg-secondary p-2.5 text-xs">
              <p className="font-semibold">{result.inserted} imported</p>
              {result.errors.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-destructive">
                  {result.errors.slice(0, 8).map((e) => (
                    <li key={e.line}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Button className="w-full" onClick={run} loading={busy} disabled={!csv.trim() || !categoryId}>
            Import questions
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [form, setForm] = React.useState({ name: '', emoji: '', sortOrder: 0 });
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post('/api/admin/quiz-category', {
        name: form.name,
        emoji: form.emoji || null,
        sortOrder: Number(form.sortOrder),
        isActive: true,
      });
      await onSaved();
      setForm({ name: '', emoji: '', sortOrder: 0 });
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New quiz category">
        <div className="space-y-3">
          <div className="grid grid-cols-[64px_1fr] gap-2">
            <div>
              <Label htmlFor="c-emoji" className="text-xs">
                Icon
              </Label>
              <Input
                id="c-emoji"
                value={form.emoji}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                className="mt-1 text-center"
                placeholder="🎬"
                maxLength={4}
              />
            </div>
            <div>
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1"
                placeholder="Movies, Sports, History…"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} loading={busy} disabled={!form.name}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PrizeDialog({
  open,
  prize,
  onClose,
  onSaved,
}: {
  open: boolean;
  prize: Prize | 'new' | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [form, setForm] = React.useState({ rank: 1, title: '', description: '', isActive: true });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (prize === 'new') setForm({ rank: 1, title: '', description: '', isActive: true });
    else if (prize)
      setForm({
        rank: prize.rank,
        title: prize.title,
        description: prize.description ?? '',
        isActive: prize.is_active,
      });
  }, [prize]);

  async function save() {
    setBusy(true);
    try {
      await api.post('/api/admin/prize', {
        rank: Number(form.rank),
        title: form.title,
        description: form.description || null,
        isActive: form.isActive,
      });
      await onSaved();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={prize === 'new' ? 'Add prize' : 'Edit prize'}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="p-rank">Rank</Label>
            <Input
              id="p-rank"
              type="number"
              min={1}
              max={20}
              value={form.rank}
              onChange={(e) => setForm({ ...form, rank: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="p-title">Prize</Label>
            <Input
              id="p-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1"
              placeholder="Free dessert"
            />
          </div>
          <div>
            <Label htmlFor="p-desc" className="text-xs">
              Description
            </Label>
            <Input
              id="p-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-2">
            <span className="text-xs">Active (guests can see it when prizes are on)</span>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              aria-label="Prize active"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} loading={busy} disabled={!form.title}>
              Save prize
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
