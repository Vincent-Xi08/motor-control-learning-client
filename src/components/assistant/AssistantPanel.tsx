import { AnimatePresence, m } from 'framer-motion';
import { Send, Settings, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssistantStore, type AssistantCitation, type AssistantMessage } from '../../store/assistantStore';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { translate, useI18n } from '../../i18n/useI18n';
import {
  buildLLMSystemPrompt,
  buildRagIndex,
  buildRagIndexAsync,
  citationToTarget,
  composeAnswer,
  search,
  ANSWER_SCORE_THRESHOLD,
  type RagIndex,
  type SearchResult,
} from '../../utils/ragIndex';
import { CitationLink } from './CitationLink';
import { LLMSettingsModal } from './LLMSettingsModal';
import { useLLMStore, type RagMode } from '../../store/llmStore';
import {
  estimateInputTokens,
  estimateTokens,
  LLMError,
  lookupModel,
  makeProvider,
  type ChatMessage,
  type LLMProviderName,
} from '../../utils/llmProviders';

/**
 * 浮动聊天面板 —— 教学助手主 UI。
 *
 * 对话流（按 llmStore.provider 路由）：
 *   1. 用户输入 → pushUser
 *   2. provider === 'local' → 走 ragIndex.search + composeAnswer 启发式（保留轮 7 路径）
 *   3. provider !== 'local' → 走 makeProvider(name, key).chat() 流式：
 *        a. ragIndex.search(query, 5) 拿 top-5 chunks
 *        b. buildLLMSystemPrompt 拼 system message
 *        c. 组装 [system, ...历史 user/assistant, user] messages 数组
 *        d. for await delta → setState 拼到 streaming buffer → 完成后 pushAssistant
 *   4. 失败降级：catch 异常 → toast 提示 + 自动 setProvider('local') + 再跑一次启发式
 *
 * 状态指示：assistant message bubble 顶部 chip 显示"由 X 回答" / "本地启发式回答"。
 *
 * a11y：role="dialog" + aria-label + Esc 关闭 + settings gear 也能聚焦
 */
export function AssistantPanel() {
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const messages = useAssistantStore((s) => s.messages);
  const pushUser = useAssistantStore((s) => s.pushUser);
  const pushAssistant = useAssistantStore((s) => s.pushAssistant);
  const clearMessages = useAssistantStore((s) => s.clearMessages);
  const pendingDraft = useAssistantStore((s) => s.pendingDraft);
  const consumePendingDraft = useAssistantStore((s) => s.consumePendingDraft);

  const llmProvider = useLLMStore((s) => s.provider);
  const llmApiKeys = useLLMStore((s) => s.apiKeys);
  const llmModel = useLLMStore((s) => s.model);
  const llmMaxTokens = useLLMStore((s) => s.maxTokens);
  const llmRagMode = useLLMStore((s) => s.ragMode);
  const llmSetProvider = useLLMStore((s) => s.setProvider);
  const llmRecordSpend = useLLMStore((s) => s.recordSpend);
  const llmSetFallback = useLLMStore((s) => s.setFallbackReason);
  const fallbackReason = useLLMStore((s) => s.fallbackReason);

  const { t, locale } = useI18n();
  const [draft, setDraft] = useState('');
  const [index, setIndex] = useState<RagIndex | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [streamingProvider, setStreamingProvider] = useState<LLMProviderName | null>(null);
  const [streamingCitations, setStreamingCitations] = useState<AssistantCitation[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'info' | 'fault' } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Focus trap：浮窗打开期间 Tab 在面板内循环，关闭把焦点还给 FAB
  // autoFocusFirst=false，让上面已有的 inputRef.focus() 拿到首次焦点。
  // settingsOpen 时把 trap 让给 LLMSettingsModal，避免双重 trap 抢焦点。
  useFocusTrap(open && !settingsOpen, dialogRef, { autoFocusFirst: false });

  // 打开时构建索引（首次同步基础 + 异步补 walkthrough）
  useEffect(() => {
    if (!open) return;
    const base = buildRagIndex();
    setIndex(base);
    void buildRagIndexAsync()
      .then((idx) => setIndex({ ...idx }))
      .catch(() => {
        /* walkthrough 加载失败不影响基础检索；保持已 set 的 base 即可 */
      });
  }, [open]);

  // 打开 + pendingDraft 时：把题目灌入输入框、聚焦
  useEffect(() => {
    if (!open) return;
    const draftFromOutside = consumePendingDraft();
    if (draftFromOutside) setDraft(draftFromOutside);
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open, consumePendingDraft]);

  // Esc 关闭（仅当 settings 也没开时）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !settingsOpen) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen, settingsOpen]);

  // 新消息或流式 delta 后滚到底部
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, streamingText]);

  // 切走面板时 abort 进行中的流
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingText('');
    setStreamingProvider(null);
    setStreamingCitations([]);
  }, [open]);

  // toast 3 秒自动消失
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  /** 本地启发式（轮 7 路径，保留为兜底） */
  const runLocalAnswer = useCallback(
    (text: string, idx: RagIndex) => {
      const results: SearchResult[] = search(text, 8, idx);
      const composed = composeAnswer(text, results, locale);
      const citations: AssistantCitation[] = composed.citations.map((ri) => {
        const r = results[ri];
        const tgt = citationToTarget(r.chunk);
        return {
          chunkId: r.chunk.id,
          title: r.chunk.title,
          preview: r.chunk.text.slice(0, 140),
          moduleId: tgt.moduleId,
          walkthroughStepId: tgt.walkthroughStepId,
        };
      });
      pushAssistant(`${t('assistant.localAnswerMarker')}\n${composed.answer}`, citations);
    },
    [locale, pushAssistant, t],
  );

  /** 真 LLM 路径：流式 delta 拼到 streamingText buffer */
  const runLLMAnswer = useCallback(
    async (text: string, idx: RagIndex) => {
      const providerName = llmProvider as LLMProviderName;
      const apiKey = llmApiKeys[providerName];
      if (!apiKey) {
        throw new LLMError('unauthorized', t('assistant.missingApiKeyError'));
      }
      // 1) 检索 top-5 chunks（RAG 注入策略决定是否真喂给 system）
      const results = search(text, 5, idx);
      const topScore = results[0]?.score ?? 0;
      const shouldInject = shouldInjectRag(llmRagMode, topScore);
      const systemPrompt = shouldInject ? buildLLMSystemPrompt(results, locale) : '';
      const citations: AssistantCitation[] = shouldInject
        ? results.map((r) => {
            const tgt = citationToTarget(r.chunk);
            return {
              chunkId: r.chunk.id,
              title: r.chunk.title,
              preview: r.chunk.text.slice(0, 140),
              moduleId: tgt.moduleId,
              walkthroughStepId: tgt.walkthroughStepId,
            };
          })
        : [];

      // 2) 组装 messages：system + 历史对话（取去掉最新 user，因为已 push 进 store）+ 当前 user
      const history = messagesToChatTurns(messages);
      const chatMessages: ChatMessage[] = [];
      if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
      chatMessages.push(...history, { role: 'user', content: text });

      // 3) 启动流式
      const provider = makeProvider(providerName, apiKey);
      const ctrl = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ctrl;
      setStreamingProvider(providerName);
      setStreamingCitations(citations);
      setStreamingText('');

      let assembled = '';
      try {
        for await (const chunk of provider.chat(chatMessages, {
          model: llmModel,
          maxTokens: llmMaxTokens,
          signal: ctrl.signal,
        })) {
          if (ctrl.signal.aborted) break;
          assembled += chunk.delta;
          setStreamingText(assembled);
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }

      if (ctrl.signal.aborted) {
        // 被取消（关闭面板 / 用户中止）：把已生成的内容入库以免完全丢失
        if (assembled.trim()) {
          pushAssistant(
            `${t('assistant.llmAnswerLead')}${prettyProviderName(providerName)}${t('assistant.llmAbortedTail')}\n${assembled}`,
            citations,
          );
        }
      } else {
        // 4) 落库：把流式结果作为完整 assistant 消息
        const finalText = `${t('assistant.llmAnswerLead')}${prettyProviderName(providerName)} · ${prettyModelName(llmModel)}${t('assistant.llmAnswerTail')}\n${assembled}`;
        pushAssistant(finalText, citations);
        // 5) 记录用量（粗估 input + 实际 assembled tokens）
        const model = lookupModel(providerName, llmModel);
        if (model) {
          const inTok = estimateInputTokens(chatMessages);
          const outTok = estimateTokens(assembled);
          const usd =
            (inTok / 1_000_000) * model.inputPerMillionUsd +
            (outTok / 1_000_000) * model.outputPerMillionUsd;
          llmRecordSpend(usd, inTok + outTok);
        }
      }
      setStreamingText('');
      setStreamingProvider(null);
      setStreamingCitations([]);
    },
    [
      llmProvider,
      llmApiKeys,
      llmModel,
      llmMaxTokens,
      llmRagMode,
      locale,
      messages,
      pushAssistant,
      llmRecordSpend,
      t,
    ],
  );

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    pushUser(text);
    setDraft('');
    const idx = index ?? buildRagIndex();

    if (llmProvider === 'local') {
      runLocalAnswer(text, idx);
      return;
    }

    try {
      await runLLMAnswer(text, idx);
    } catch (err) {
      // 失败降级：toast 提示 + setProvider('local') + 再跑一次本地启发式
      // 注意：setProvider 内部会清空 fallbackReason，因此 setFallback 必须放在 setProvider 之后
      const reason = err instanceof LLMError ? `${err.code}: ${err.message}` : (err as Error).message;
      llmSetProvider('local');
      llmSetFallback(reason);
      setToast({ text: `${t('assistant.fallbackNotice')} · ${reason.slice(0, 80)}`, kind: 'fault' });
      setStreamingText('');
      setStreamingProvider(null);
      setStreamingCitations([]);
      try {
        runLocalAnswer(text, idx);
      } catch {
        /* 启发式也炸了：保留 toast，不再二次 fallback */
      }
    }
  }, [
    draft,
    index,
    llmProvider,
    pushUser,
    runLocalAnswer,
    runLLMAnswer,
    llmSetFallback,
    llmSetProvider,
    t,
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const pendingHint = useMemo(() => pendingDraft && draft === pendingDraft, [pendingDraft, draft]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <m.div
            ref={dialogRef}
            id="assistant-panel"
            role="dialog"
            aria-modal="false"
            aria-label={t('assistant.panelTitle')}
            className="fixed bottom-20 right-5 z-40 flex h-[min(640px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-line-subtle bg-bg-surface shadow-2xl"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-line-subtle px-4 py-3">
              <div>
                <p className="text-caption uppercase tracking-[0.18em] text-ink-muted">
                  {t('assistant.panelEyebrow')}
                </p>
                <h2 className="font-display text-title text-ink-primary">{t('assistant.panelTitle')}</h2>
                <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{t('assistant.panelSubtitle')}</p>
                <ProviderChip provider={llmProvider} model={llmModel} t={t} />
              </div>
              <div className="flex items-center gap-1">
                <button
                  ref={settingsBtnRef}
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={t('assistant.settingsAria')}
                  aria-haspopup="dialog"
                  aria-expanded={settingsOpen}
                  data-testid="assistant-settings-btn"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-bg-base hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={clearMessages}
                  aria-label={t('assistant.clearButton')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-bg-base hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                  disabled={messages.length === 0}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('assistant.closeAria')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-bg-base hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            {fallbackReason && (
              <div
                role="status"
                className="border-b border-accent-warn/30 bg-accent-warn/10 px-3 py-1 text-[11px] text-accent-warn"
              >
                {t('assistant.fallbackNotice')}：{fallbackReason.slice(0, 120)}
              </div>
            )}

            <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && (
                <div className="rounded-lg border border-dashed border-line-subtle p-4 text-center text-caption text-ink-muted">
                  {t('assistant.emptyHint')}
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[88%] rounded-2xl rounded-br-sm border border-accent-primary/30 bg-accent-primary/10 px-3 py-2 text-body text-ink-primary'
                        : 'max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm border border-line-subtle bg-bg-base px-3 py-2 text-body text-ink-secondary'
                    }
                  >
                    {m.role === 'assistant' && (
                      <AssistantOriginChip message={m} t={t} />
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                          {t('assistant.citationsTitle')}
                        </p>
                        <ul className="space-y-1.5">
                          {m.citations.map((c, i) => (
                            <CitationLink key={i} index={i + 1} citation={c} />
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* 正在流式：单独渲染一个 assistant bubble */}
              {streamingText && (
                <div className="flex justify-start" data-testid="assistant-streaming">
                  <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm border border-accent-primary/30 bg-bg-base px-3 py-2 text-body text-ink-secondary">
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-primary/15 px-2 py-0.5 text-[10px] font-medium text-accent-primary">
                      {streamingProvider
                        ? `${t('assistant.streamingByLead')}${prettyProviderName(streamingProvider)} · ${prettyModelName(llmModel)}${t('assistant.streamingByTail')}`
                        : t('assistant.generating')}
                    </span>
                    <p className="whitespace-pre-wrap leading-relaxed">{streamingText}</p>
                    {streamingCitations.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                          {t('assistant.citationsTitle')}
                        </p>
                        <ul className="space-y-1.5">
                          {streamingCitations.map((c, i) => (
                            <CitationLink key={i} index={i + 1} citation={c} />
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-line-subtle px-3 py-2">
              {pendingHint && (
                <p className="mb-1 text-[11px] text-accent-measure">{t('assistant.pendingDraftHint')}</p>
              )}
              {toast && (
                <p
                  role="alert"
                  className={
                    'mb-1 rounded border px-2 py-1 text-[11px] ' +
                    (toast.kind === 'fault'
                      ? 'border-accent-fault/40 bg-accent-fault/10 text-accent-fault'
                      : 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary')
                  }
                >
                  {toast.text}
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={2}
                  placeholder={t('assistant.inputPlaceholder')}
                  aria-label={t('assistant.panelTitle')}
                  className="scrollbar-thin flex-1 resize-none rounded-lg border border-line-subtle bg-bg-base px-2.5 py-1.5 text-body text-ink-primary placeholder:text-ink-muted/60 focus:border-accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!draft.trim() || !!streamingText}
                  aria-label={t('assistant.sendAria')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent-primary/50 bg-accent-primary/10 text-accent-primary transition-colors hover:bg-accent-primary/20 disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-bg-base disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <LLMSettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          // 把焦点还给 settings gear（focus trap 也做这件事，但 modal 在 panel 内部需要明示）
          window.setTimeout(() => settingsBtnRef.current?.focus(), 30);
        }}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 子组件 & 工具函数
// ────────────────────────────────────────────────────────────────────────────

/**
 * 消息首行来源标记的双 locale 形态。
 * 生成侧按当前 locale 写入（runLocalAnswer / runLLMAnswer），解析侧需同时识别两种形态：
 * 兼容 localStorage 里的历史消息与语言切换后残留的旧标记。
 */
const MARKER_LOCALES = ['zh-CN', 'en-US'] as const;
const LOCAL_ANSWER_MARKERS = MARKER_LOCALES.map((loc) => translate(loc, 'assistant.localAnswerMarker'));
const LLM_ANSWER_LEADS = MARKER_LOCALES.map((loc) => translate(loc, 'assistant.llmAnswerLead').trimEnd());

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 首行是否为来源标记行（要求整行以 "]" 收尾，与旧版整行正则语义一致） */
function isOriginMarkerLine(line: string): boolean {
  return (
    line.endsWith(']') &&
    (LOCAL_ANSWER_MARKERS.some((m) => line.startsWith(m)) || LLM_ANSWER_LEADS.some((p) => line.startsWith(p)))
  );
}

/** 顶部小 chip：本地 / 云端 + 模型名 */
function ProviderChip({
  provider,
  model,
  t,
}: {
  provider: ReturnType<typeof useLLMStore.getState>['provider'];
  model: string;
  t: ReturnType<typeof useI18n>['t'];
}) {
  if (provider === 'local') {
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-line-subtle bg-bg-base px-1.5 py-0.5 text-[10px] text-ink-muted">
        {t('assistant.providerLocalBadge')}
      </span>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-accent-primary/40 bg-accent-primary/10 px-1.5 py-0.5 text-[10px] text-accent-primary">
      {t('assistant.providerLLMBadge')} · {prettyProviderName(provider as LLMProviderName)} · {prettyModelName(model)}
    </span>
  );
}

/** 单条 assistant message 顶部"由 X 回答"chip */
function AssistantOriginChip({
  message,
  t,
}: {
  message: AssistantMessage;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const text = message.content;
  // 通过文本前缀提取来源；这套约定与 runLocalAnswer / runLLMAnswer 写入格式一致（两种 locale 形态都识别）
  const localMatch = LOCAL_ANSWER_MARKERS.some((m) => text.startsWith(m));
  const llmMatch = text.match(new RegExp(`^(${LLM_ANSWER_LEADS.map(escapeRegExp).join('|')})\\s+([^\\s·\\]]+)`));
  if (localMatch) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line-subtle bg-bg-surface px-1.5 py-0.5 text-[10px] text-ink-muted">
        {t('assistant.providerLocalBadge')}
      </span>
    );
  }
  if (llmMatch) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-primary/40 bg-accent-primary/10 px-1.5 py-0.5 text-[10px] text-accent-primary">
        {t('assistant.providerLLMBadge')} · {llmMatch[1]}
      </span>
    );
  }
  return null;
}

/** 把历史 messages 转成 ChatMessage（去掉首位行的"由 X 回答"meta 标记） */
export function messagesToChatTurns(messages: AssistantMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const content = stripOriginPrefix(m.content);
    if (!content) continue;
    out.push({ role: m.role, content });
  }
  return out;
}

function stripOriginPrefix(text: string): string {
  // 把首行的来源标记（"[本地启发式回答]" / "[由 X · Y 回答]" 及其英文形态）去掉，只送真正问答内容
  const lines = text.split('\n');
  if (lines.length === 0) return text;
  const first = lines[0]?.trim() ?? '';
  if (isOriginMarkerLine(first)) {
    return lines.slice(1).join('\n').trim();
  }
  return text;
}

/** 按 RAG 模式 + 当前 top score 决定是否真的注入 system 上下文 */
export function shouldInjectRag(mode: RagMode, topScore: number): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return topScore >= ANSWER_SCORE_THRESHOLD;
}

export function prettyProviderName(name: LLMProviderName): string {
  if (name === 'openai') return 'OpenAI';
  if (name === 'anthropic') return 'Anthropic';
  return 'Gemini';
}

export function prettyModelName(model: string): string {
  // 把 'gpt-4o-mini' / 'claude-haiku-4-5-20251001' 缩成易读 label
  if (model.startsWith('gpt-')) return model.toUpperCase();
  if (model.startsWith('claude-')) return model.split('-').slice(0, 3).join('-');
  if (model.startsWith('gemini-')) return model;
  return model;
}
