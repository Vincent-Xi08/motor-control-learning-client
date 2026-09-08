import { ChevronDown, Lightbulb, BookOpen, Cpu, Target, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ensureLessonsEn, getLesson, hasEnLesson as hasEnLessonEntry } from '../../content/lessons';
import type { ModuleId } from '../../simulation/engine/types';
import { useI18n } from '../../i18n/useI18n';
import type { TKey } from '../../i18n/useI18n';
import { useAssistantStore } from '../../store/assistantStore';
import { Quiz } from './Quiz';
import { CodeBlock } from './CodeBlock';

interface Props {
  moduleId: ModuleId;
}

type Tier = 'intro' | 'deep' | 'practice' | 'quiz';

const TIER_DEFS: Array<{ key: Tier; labelKey: TKey; icon: typeof Lightbulb }> = [
  { key: 'intro', labelKey: 'shell.conceptTabIntro', icon: Lightbulb },
  { key: 'deep', labelKey: 'shell.conceptTabDeep', icon: BookOpen },
  { key: 'practice', labelKey: 'shell.conceptTabPractice', icon: Cpu },
  { key: 'quiz', labelKey: 'shell.conceptTabQuiz', icon: Target },
];

export function ConceptNotes({ moduleId }: Props) {
  const { t, locale } = useI18n();
  // EN 讲义是惰性 chunk：切到 en-US 时异步填充，完成后 bump 重渲
  const [, bump] = useState(0);
  useEffect(() => {
    if (locale !== 'en-US') return;
    let cancelled = false;
    void ensureLessonsEn().then(() => {
      if (!cancelled) bump((v) => v + 1);
    });
    return () => { cancelled = true; };
  }, [locale]);
  const lesson = getLesson(moduleId, locale);
  // Only show "translation pending" when EN is active AND there is no EN lesson entry.
  const hasEnLesson = hasEnLessonEntry(moduleId);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tier>('intro');
  const tiers = TIER_DEFS.filter((tier) => {
    if (tier.key === 'intro') return !!lesson.introBeginner;
    if (tier.key === 'quiz') return !!lesson.quiz?.length;
    return true;
  });
  // 没有初识的旧模块默认开到深入
  const defaultTab: Tier = lesson.introBeginner ? 'intro' : 'deep';
  const activeTab = tiers.find((tier) => tier.key === tab) ? tab : defaultTab;

  return (
    <section className="rounded-2xl border border-line-subtle bg-bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-caption uppercase tracking-[0.18em] text-ink-muted">{t('shell.conceptEyebrow')}</p>
          <h2 className="font-display text-title text-ink-primary">{t('shell.conceptTitle')}</h2>
          {locale === 'en-US' && !hasEnLesson && (
            <p className="mt-0.5 text-[10px] text-ink-muted">{t('common.translationPending')}</p>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-ink-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-line-subtle px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-line-subtle bg-bg-base p-1">
            {tiers.map((tier) => {
              const Icon = tier.icon;
              return (
                <button
                  key={tier.key}
                  onClick={() => setTab(tier.key)}
                  className={`inline-flex items-center gap-1 rounded px-3 py-1.5 text-caption font-medium transition-colors ${
                    activeTab === tier.key
                      ? 'bg-accent-primary/15 text-accent-primary'
                      : 'text-ink-secondary hover:text-ink-primary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />{t(tier.labelKey)}
                </button>
              );
            })}
          </div>
          {activeTab === 'intro' && lesson.introBeginner && <IntroPanel intro={lesson.introBeginner} />}
          {activeTab === 'deep' && <DeepPanel lesson={lesson} />}
          {activeTab === 'practice' && <PracticePanel lesson={lesson} />}
          {activeTab === 'quiz' && lesson.quiz && (
            <div className="space-y-3">
              <AssistantHandoff quiz={lesson.quiz} />
              <Quiz items={lesson.quiz} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function IntroPanel({ intro }: { intro: NonNullable<ReturnType<typeof getLesson>['introBeginner']> }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3 text-body leading-relaxed text-ink-secondary">
      <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/[0.06] p-3">
        <p className="mb-1 text-caption font-medium uppercase tracking-[0.18em] text-accent-primary">{t('shell.lessonMetaphor')}</p>
        <p className="text-ink-primary">{intro.metaphor}</p>
      </div>
      <div className="rounded-lg border border-line-subtle bg-bg-base p-3">
        <p className="mb-1 text-caption font-medium uppercase tracking-[0.18em] text-ink-muted">{t('shell.lessonCoreIdea')}</p>
        <p className="text-ink-primary">{intro.coreIdea}</p>
      </div>
      <div>
        <p className="mb-1.5 text-caption uppercase tracking-[0.18em] text-ink-muted">{t('shell.lessonWhyCare')}</p>
        <ul className="space-y-1.5">
          {intro.whyCare.map((w) => <li key={w}>· {w}</li>)}
        </ul>
      </div>
      <div className="rounded-lg border border-accent-measure/30 bg-accent-measure/[0.06] p-3">
        <p className="mb-1 text-caption font-medium uppercase tracking-[0.18em] text-accent-measure">{t('shell.lessonFirstAction')}</p>
        <p className="text-ink-primary">{intro.firstAction}</p>
      </div>
    </div>
  );
}

function DeepPanel({ lesson }: { lesson: ReturnType<typeof getLesson> }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4 text-body leading-relaxed text-ink-secondary">
      <Section title={t('shell.lessonSecGoals')}>
        <ul className="space-y-1.5">
          {lesson.learningGoals.map((g) => <li key={g}>· {g}</li>)}
        </ul>
      </Section>
      <Section title={t('shell.lessonSecConcepts')}>
        <ul className="space-y-1.5">
          {lesson.concepts.map((c) => <li key={c}>· {c}</li>)}
        </ul>
      </Section>
      <Section title={t('shell.lessonSecFormulas')}>
        <div className="space-y-2">
          {lesson.formulas.map((f) => (
            <div key={f.title} className="rounded-lg border border-line-subtle bg-bg-base p-3">
              <p className="mb-1 text-body font-medium text-ink-primary">{f.title}</p>
              <p className="formula mb-1.5 text-accent-primary">{f.expression}</p>
              <p className="text-caption text-ink-secondary">{f.explanation}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title={t('shell.lessonSecEngineering')}>
        <ul className="space-y-1.5">
          {lesson.engineeringMeaning.map((m) => <li key={m}>· {m}</li>)}
        </ul>
      </Section>
      <Section title={t('shell.lessonSecMistakes')}>
        <div className="grid gap-3 md:grid-cols-2">
          <ul className="space-y-1.5">
            {lesson.commonMistakes.map((m) => <li key={m} className="text-accent-fault/90">· {m}</li>)}
          </ul>
          <ul className="space-y-1.5">
            {lesson.debugMethods.map((m) => <li key={m} className="text-accent-measure/90">· {m}</li>)}
          </ul>
        </div>
      </Section>
      <Section title={t('shell.lessonSecSummary')}>
        <p>{lesson.summary}</p>
      </Section>
    </div>
  );
}

function PracticePanel({ lesson }: { lesson: ReturnType<typeof getLesson> }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4 text-body leading-relaxed text-ink-secondary">
      <Section title={t('shell.lessonSecStm32')}>
        <ul className="space-y-1.5">
          {lesson.stm32Guide.map((g) => <li key={g}>· {g}</li>)}
        </ul>
      </Section>
      <Section title={t('shell.lessonSecCode')}>
        <CodeBlock code={lesson.codeExample} title={`${lesson.id}.c — ${t('shell.lessonCodeTitleSuffix')}`} />
      </Section>
      <Section title={t('shell.lessonSecExperiments')}>
        <ul className="space-y-1.5">
          {lesson.experiments.map((e) => <li key={e}>· {e}</li>)}
        </ul>
      </Section>
      <Section title={t('shell.lessonSecNext')}>
        <ul className="space-y-1.5">
          {lesson.nextSteps.map((n) => <li key={n}>→ {n}</li>)}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-caption uppercase tracking-[0.18em] text-ink-muted">{title}</p>
      {children}
    </div>
  );
}

/**
 * 把题目 / 选项预填进教学助手输入框的快捷按钮组。
 * 每题一个 "🤔 问助手：第 N 题" 按钮——点击后打开浮窗并把题面 + 选项灌进 pendingDraft，
 * 用户按 Enter 即可让助手基于内置讲义检索答案。
 */
function AssistantHandoff({ quiz }: { quiz: NonNullable<ReturnType<typeof getLesson>['quiz']> }) {
  const { t } = useI18n();
  const setOpen = useAssistantStore((s) => s.setOpen);
  const setPendingDraft = useAssistantStore((s) => s.setPendingDraft);

  const handoff = (item: NonNullable<ReturnType<typeof getLesson>['quiz']>[number]) => {
    const optionsTxt = item.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    const draft = `${item.q}\n${optionsTxt}`;
    setPendingDraft(draft);
    setOpen(true);
  };

  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-line-subtle bg-bg-base px-2.5 py-1.5">
      {quiz.map((item, i) => (
        <button
          key={i}
          type="button"
          onClick={() => handoff(item)}
          className="inline-flex items-center gap-1 rounded border border-line-subtle px-2 py-1 text-caption text-ink-secondary transition-colors hover:border-accent-primary/40 hover:text-accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          aria-label={t('assistant.askAria')}
        >
          <MessageCircleQuestion className="h-3 w-3" aria-hidden="true" />
          {t('assistant.askButton')} · {i + 1}
        </button>
      ))}
    </div>
  );
}
