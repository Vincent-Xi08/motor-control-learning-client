import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import {
  type AssistantProvider,
  useLLMStore,
} from '../../store/llmStore';
import {
  LLMError,
  MODEL_CATALOG,
  type LLMProviderName,
  testProviderKey,
} from '../../utils/llmProviders';
import { Button } from '../ui/Button';
import { useFocusTrap } from '../../utils/useFocusTrap';

/**
 * LLM 接入设置面板（轮 8 · BYOK）
 *
 * 7 段 UI 由上到下：
 *   1. Header（title + close）
 *   2. 隐私警示横幅（amber / ShieldAlert，反复强调 sessionStorage 与第三方传输）
 *   3. provider 选择（4 chip：本地 / OpenAI / Anthropic / Gemini；切换写 store + 切换默认模型）
 *   4. API key 输入 + 显隐切换 + 测试连接（仅在非 local provider 时显示）
 *   5. 模型下拉 + maxTokens 滑块
 *   6. RAG 模式 segmented control（always / when_relevant / never）
 *   7. 用量统计（累计 USD + tokens + 清零按钮）+ 价格表来源链接
 *
 * a11y：
 *   - role="dialog" + aria-modal="true" + aria-labelledby
 *   - useFocusTrap 包裹（Tab/Shift+Tab 循环 + Esc 调 onClose）
 *   - 所有 chip / radio 用 aria-pressed / aria-checked
 *   - API key 输入 type 默认 password，"显示/隐藏"切换 + aria-label
 *
 * 视觉令牌：accent.primary 主态 / measure 绑定成功 / warn 警示 / fault 失败
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS: AssistantProvider[] = ['local', 'openai', 'anthropic', 'gemini'];

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; sample: string }
  | { kind: 'fail'; messageKey: string; detail?: string };

function placeholderKeyFor(provider: LLMProviderName, t: ReturnType<typeof useI18n>['t']): string {
  if (provider === 'openai') return t('llmSettings.apiKeyPlaceholderOpenAI');
  if (provider === 'anthropic') return t('llmSettings.apiKeyPlaceholderAnthropic');
  return t('llmSettings.apiKeyPlaceholderGemini');
}

/** 把 LLMError.code 映射成 i18n key（保留 code 让测试可断言映射） */
export function mapTestErrorMessageKey(err: unknown): { messageKey: string; detail?: string } {
  if (err instanceof LLMError) {
    if (err.code === 'unauthorized') return { messageKey: 'llmSettings.testFailUnauthorized', detail: err.message };
    if (err.code === 'rate-limit') return { messageKey: 'llmSettings.testFailRateLimit', detail: err.message };
    if (err.code === 'network') return { messageKey: 'llmSettings.testFailNetwork', detail: err.message };
    return { messageKey: 'llmSettings.testFailOther', detail: err.message };
  }
  return { messageKey: 'llmSettings.testFailOther', detail: (err as Error)?.message ?? '' };
}

export function LLMSettingsModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const provider = useLLMStore((s) => s.provider);
  const apiKeys = useLLMStore((s) => s.apiKeys);
  const model = useLLMStore((s) => s.model);
  const ragMode = useLLMStore((s) => s.ragMode);
  const maxTokens = useLLMStore((s) => s.maxTokens);
  const monthlyBudgetUsd = useLLMStore((s) => s.monthlyBudgetUsd);
  const spentUsd = useLLMStore((s) => s.spentUsd);
  const spentTokens = useLLMStore((s) => s.spentTokens);
  const setProvider = useLLMStore((s) => s.setProvider);
  const setKey = useLLMStore((s) => s.setKey);
  const setModel = useLLMStore((s) => s.setModel);
  const setRagMode = useLLMStore((s) => s.setRagMode);
  const setMaxTokens = useLLMStore((s) => s.setMaxTokens);
  const setMonthlyBudgetUsd = useLLMStore((s) => s.setMonthlyBudgetUsd);
  const resetSpend = useLLMStore((s) => s.resetSpend);
  const clearAll = useLLMStore((s) => s.clearAll);
  const isOverBudget = useLLMStore((s) => s.isOverBudget());

  const dialogRef = useRef<HTMLDivElement>(null);
  const [revealKey, setRevealKey] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const testAbortRef = useRef<AbortController | null>(null);

  // provider 切换或重开面板时刷新 draftKey
  useEffect(() => {
    if (provider === 'local') {
      setDraftKey('');
      return;
    }
    setDraftKey(apiKeys[provider] ?? '');
    setTest({ kind: 'idle' });
  }, [provider, apiKeys, open]);

  // 关闭时 abort 进行中的测试
  useEffect(() => {
    if (!open) {
      testAbortRef.current?.abort();
      testAbortRef.current = null;
      setTest({ kind: 'idle' });
    }
  }, [open]);

  useFocusTrap(open, dialogRef, { onEscape: onClose, autoFocusFirst: true });

  const isLLM = provider !== 'local';
  const providerNonLocal: LLMProviderName | null = isLLM ? (provider as LLMProviderName) : null;
  const modelOptions = useMemo(
    () => (providerNonLocal ? MODEL_CATALOG[providerNonLocal] : []),
    [providerNonLocal],
  );

  const handleProviderChange = useCallback(
    (next: AssistantProvider) => {
      if (next === provider) return;
      setProvider(next);
    },
    [provider, setProvider],
  );

  const handleKeyCommit = useCallback(() => {
    if (!providerNonLocal) return;
    setKey(providerNonLocal, draftKey);
  }, [providerNonLocal, draftKey, setKey]);

  const handleTest = useCallback(async () => {
    if (!providerNonLocal) return;
    const candidate = draftKey.trim();
    if (!candidate) {
      setTest({ kind: 'fail', messageKey: 'llmSettings.testFailUnauthorized' });
      return;
    }
    // 先保存 key，再发起测试（这样后续 chat 拿到的是同一份）
    setKey(providerNonLocal, candidate);
    testAbortRef.current?.abort();
    const ctrl = new AbortController();
    testAbortRef.current = ctrl;
    setTest({ kind: 'testing' });
    try {
      const result = await testProviderKey(providerNonLocal, candidate, model, ctrl.signal);
      if (!ctrl.signal.aborted) setTest({ kind: 'ok', sample: result.sample });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const mapped = mapTestErrorMessageKey(err);
      setTest({ kind: 'fail', ...mapped });
    } finally {
      if (testAbortRef.current === ctrl) testAbortRef.current = null;
    }
  }, [providerNonLocal, draftKey, model, setKey]);

  const handleClearAll = useCallback(() => {
    clearAll();
    setDraftKey('');
    setTest({ kind: 'idle' });
  }, [clearAll]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
        >
          <m.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="llm-settings-title"
            className="scrollbar-thin relative flex max-h-[min(720px,calc(100vh-3rem))] w-full max-w-[480px] flex-col overflow-y-auto rounded-2xl border border-line-subtle bg-bg-surface shadow-2xl"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. Header */}
            <header className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div>
                <p className="text-caption uppercase tracking-[0.18em] text-ink-muted">
                  {t('llmSettings.eyebrow')}
                </p>
                <h2
                  id="llm-settings-title"
                  className="font-display text-title text-ink-primary"
                >
                  {t('llmSettings.title')}
                </h2>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">
                  {t('llmSettings.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('llmSettings.closeAria')}
                className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-muted transition-colors hover:bg-bg-base hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              {/* 2. 隐私警示横幅 */}
              <div
                role="note"
                aria-label={t('llmSettings.privacyTitle')}
                className="flex items-start gap-2 rounded-lg border border-accent-warn/40 bg-accent-warn/10 p-3 text-caption text-ink-secondary"
                data-testid="llm-privacy-banner"
              >
                <ShieldAlert
                  className="h-4 w-4 shrink-0 text-accent-warn"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-accent-warn">
                    {t('llmSettings.privacyTitle')}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                    {t('llmSettings.privacyBody')}
                  </p>
                </div>
              </div>

              {/* 3. provider 选择 */}
              <section aria-labelledby="llm-provider-label" className="space-y-2">
                <p
                  id="llm-provider-label"
                  className="text-caption font-medium text-ink-secondary"
                >
                  {t('llmSettings.providerSectionTitle')}
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="llm-provider-label"
                  className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                >
                  {PROVIDER_OPTIONS.map((p) => {
                    const labelKey =
                      p === 'local'
                        ? 'llmSettings.providerLocal'
                        : p === 'openai'
                          ? 'llmSettings.providerOpenAI'
                          : p === 'anthropic'
                            ? 'llmSettings.providerAnthropic'
                            : 'llmSettings.providerGemini';
                    const active = provider === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleProviderChange(p)}
                        data-testid={`llm-provider-chip-${p}`}
                        className={
                          'inline-flex h-10 items-center justify-center rounded-lg border px-2 text-caption font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ' +
                          (active
                            ? 'border-accent-primary/60 bg-accent-primary/15 text-accent-primary'
                            : 'border-line-subtle bg-bg-base text-ink-secondary hover:border-line-strong hover:text-ink-primary')
                        }
                      >
                        {t(labelKey as Parameters<typeof t>[0])}
                      </button>
                    );
                  })}
                </div>
                {provider === 'local' && (
                  <p className="text-[11px] leading-relaxed text-ink-muted">
                    {t('assistant.providerLocalLabel')}
                  </p>
                )}
              </section>

              {/* 4. API key + 测试连接（仅 LLM provider） */}
              {providerNonLocal && (
                <section className="space-y-2">
                  <label
                    htmlFor="llm-api-key-input"
                    className="block text-caption font-medium text-ink-secondary"
                  >
                    {t('llmSettings.apiKeyLabel')}
                  </label>
                  <div className="flex items-stretch gap-1">
                    <div className="relative flex-1">
                      <KeyRound
                        className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                        aria-hidden="true"
                      />
                      <input
                        id="llm-api-key-input"
                        type={revealKey ? 'text' : 'password'}
                        value={draftKey}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setDraftKey(e.target.value)}
                        onBlur={handleKeyCommit}
                        placeholder={placeholderKeyFor(providerNonLocal, t)}
                        aria-label={t('llmSettings.apiKeyLabel')}
                        className="w-full rounded-lg border border-line-subtle bg-bg-base py-1.5 pl-7 pr-2 text-body text-ink-primary placeholder:text-ink-muted/60 focus:border-accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                        data-testid="llm-key-input"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRevealKey((v) => !v)}
                      aria-label={revealKey ? t('llmSettings.apiKeyHide') : t('llmSettings.apiKeyShow')}
                      aria-pressed={revealKey}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-subtle bg-bg-base text-ink-muted transition-colors hover:bg-bg-surface hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                    >
                      {revealKey ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleTest()}
                      disabled={test.kind === 'testing' || !draftKey.trim()}
                      data-testid="llm-test-btn"
                    >
                      {test.kind === 'testing' ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      <span>{test.kind === 'testing' ? t('llmSettings.testing') : t('llmSettings.testBtn')}</span>
                    </Button>
                    {/* 绑定状态：颜色 + 形状 + sr-only 文本三通道 */}
                    {test.kind === 'ok' && (
                      <span
                        role="status"
                        className="inline-flex items-center gap-1 text-caption text-accent-measure"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">{t('llmSettings.testOk')}：</span>
                        {t('llmSettings.testOk')}
                      </span>
                    )}
                    {test.kind === 'fail' && (
                      <span
                        role="alert"
                        className="inline-flex items-center gap-1 text-caption text-accent-fault"
                      >
                        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        {t(test.messageKey as Parameters<typeof t>[0])}
                      </span>
                    )}
                    {test.kind === 'idle' && apiKeys[providerNonLocal] && (
                      <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
                        <Check className="h-3.5 w-3.5 text-accent-measure" aria-hidden="true" />
                        {t('llmSettings.apiKeySaved')}
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* 5. 模型 + maxTokens（仅 LLM provider） */}
              {providerNonLocal && (
                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="llm-model-select"
                      className="block text-caption font-medium text-ink-secondary"
                    >
                      {t('llmSettings.modelLabel')}
                    </label>
                    <select
                      id="llm-model-select"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      aria-label={t('llmSettings.modelLabel')}
                      data-testid="llm-model-select"
                      className="mt-1 w-full rounded-lg border border-line-subtle bg-bg-base px-2 py-1.5 text-body text-ink-primary focus:border-accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                    >
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}（in ${m.inputPerMillionUsd}/1M · out ${m.outputPerMillionUsd}/1M）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="llm-max-tokens-input"
                      className="block text-caption font-medium text-ink-secondary"
                    >
                      {t('llmSettings.maxTokensLabel')}
                    </label>
                    <input
                      id="llm-max-tokens-input"
                      type="range"
                      min={256}
                      max={4096}
                      step={64}
                      value={Math.min(4096, Math.max(256, maxTokens))}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                      aria-label={t('llmSettings.maxTokensLabel')}
                      aria-valuemin={256}
                      aria-valuemax={4096}
                      aria-valuenow={Math.min(4096, Math.max(256, maxTokens))}
                      aria-valuetext={`${maxTokens} tokens`}
                      className="mt-1 w-full accent-accent-primary"
                    />
                    <p className="mt-0.5 text-right text-caption text-ink-muted">
                      {maxTokens} tokens
                    </p>
                  </div>
                </section>
              )}

              {/* 6. RAG 模式 segmented control */}
              <section className="space-y-2">
                <p
                  id="llm-rag-mode-label"
                  className="text-caption font-medium text-ink-secondary"
                >
                  {t('llmSettings.ragModeLabel')}
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="llm-rag-mode-label"
                  className="grid grid-cols-3 gap-2"
                >
                  {(['always', 'when_relevant', 'never'] as const).map((m) => {
                    const active = ragMode === m;
                    const labelKey =
                      m === 'always'
                        ? 'llmSettings.ragModeAlways'
                        : m === 'when_relevant'
                          ? 'llmSettings.ragModeWhenRelevant'
                          : 'llmSettings.ragModeNever';
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setRagMode(m)}
                        data-testid={`llm-rag-mode-${m}`}
                        className={
                          'inline-flex min-h-[44px] items-center justify-center rounded-lg border px-2 py-1.5 text-center text-[11px] leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ' +
                          (active
                            ? 'border-accent-primary/60 bg-accent-primary/15 text-accent-primary'
                            : 'border-line-subtle bg-bg-base text-ink-secondary hover:border-line-strong hover:text-ink-primary')
                        }
                      >
                        {t(labelKey)}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 月度预算（与用量段联动） */}
              {providerNonLocal && (
                <section className="space-y-1">
                  <label
                    htmlFor="llm-budget-input"
                    className="block text-caption font-medium text-ink-secondary"
                  >
                    {t('llmSettings.monthlyBudgetLabel')}
                  </label>
                  <input
                    id="llm-budget-input"
                    type="number"
                    min={0}
                    step={0.5}
                    value={monthlyBudgetUsd}
                    onChange={(e) => setMonthlyBudgetUsd(Number(e.target.value))}
                    aria-label={t('llmSettings.monthlyBudgetLabel')}
                    className="w-full rounded-lg border border-line-subtle bg-bg-base px-2 py-1.5 text-body text-ink-primary focus:border-accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                  />
                </section>
              )}

              {/* 7. 用量统计 */}
              <section
                aria-labelledby="llm-usage-label"
                className="space-y-2 rounded-lg border border-line-subtle bg-bg-base p-3"
              >
                <div className="flex items-center justify-between">
                  <p
                    id="llm-usage-label"
                    className="text-caption font-medium text-ink-secondary"
                  >
                    {t('llmSettings.usageSectionTitle')}
                  </p>
                  <button
                    type="button"
                    onClick={resetSpend}
                    className="text-[11px] text-accent-primary underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                  >
                    {t('llmSettings.usageResetBtn')}
                  </button>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-caption">
                  <div>
                    <dt className="text-ink-muted">{t('llmSettings.usageSpent')}</dt>
                    <dd className="font-mono text-ink-primary">
                      ${spentUsd.toFixed(4)} USD
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">{t('llmSettings.usageTokens')}</dt>
                    <dd className="font-mono text-ink-primary">{spentTokens}</dd>
                  </div>
                </dl>
                {isOverBudget && (
                  <p
                    role="alert"
                    className="rounded border border-accent-fault/40 bg-accent-fault/10 px-2 py-1 text-[11px] text-accent-fault"
                  >
                    {t('llmSettings.overBudgetWarn')}
                  </p>
                )}
                <p className="text-[10px] leading-relaxed text-ink-muted">
                  {t('llmSettings.pricingSources')}
                </p>
              </section>
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-2 border-t border-line-subtle px-5 py-3">
              <Button
                type="button"
                variant="danger"
                onClick={handleClearAll}
                aria-label={t('llmSettings.clearAllConfirmAria')}
              >
                {t('llmSettings.clearAllBtn')}
              </Button>
              <Button type="button" variant="primary" onClick={onClose}>
                {t('common.close')}
              </Button>
            </footer>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export default LLMSettingsModal;
