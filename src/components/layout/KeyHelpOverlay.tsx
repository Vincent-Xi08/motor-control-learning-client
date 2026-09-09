import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { Shortcut } from '../../utils/useKeyboardShortcuts';
import { useI18n } from '../../i18n/useI18n';
import type { TKey } from '../../i18n/useI18n';
import { useFocusTrap } from '../../utils/useFocusTrap';

interface KeyHelpOverlayProps {
  open: boolean;
  shortcuts: Shortcut[];
  onClose: () => void;
}

const CATEGORY_ORDER: Shortcut['category'][] = ['运行控制', '导航', '布局', '模式', '帮助'];

// 类别中文 literal → translations.ts 的 shell.keyHelpCat* key
const CATEGORY_I18N: Record<Shortcut['category'], TKey> = {
  '运行控制': 'shell.keyHelpCatRun',
  '导航': 'shell.keyHelpCatNav',
  '布局': 'shell.keyHelpCatLayout',
  '模式': 'shell.keyHelpCatMode',
  '帮助': 'shell.keyHelpCatHelp',
};

/** 把按键描述渲染成键帽样式的小标签。 */
function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-line-subtle bg-bg-raised px-1.5 py-0.5 font-mono text-caption text-ink-primary">
      {children}
    </kbd>
  );
}

/** 把 Shortcut 转成可视化的键帽序列：含修饰键时拼接为 ctrl + shift + key。 */
function renderKeys(s: Shortcut, spaceLabel: string) {
  const parts: string[] = [];
  if (s.meta?.includes('ctrl')) parts.push('Ctrl');
  if (s.meta?.includes('shift')) parts.push('Shift');
  if (s.meta?.includes('alt')) parts.push('Alt');
  // 替换 Space 显示，按 locale 取不同标签；箭头键给个直观符号
  let display = s.key;
  if (display === 'Space') display = spaceLabel;
  else if (display === 'ArrowLeft') display = '←';
  else if (display === 'ArrowRight') display = '→';
  else if (display === 'ArrowUp') display = '↑';
  else if (display === 'ArrowDown') display = '↓';
  else if (display.length === 1) display = display.toUpperCase();
  parts.push(display);
  return parts;
}

export function KeyHelpOverlay({ open, shortcuts, onClose }: KeyHelpOverlayProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Esc 关闭：直接绑 keydown，避免依赖 hook 同时拦截 Esc——这里一旦 open 就接管。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap：open 期间锁住 Tab，关闭时还焦点给打开 modal 的元素（WCAG 2.4.3 / Section 508 §1194.22(o)）
  // Esc 由上面的 useEffect 负责，这里不再重复绑。
  useFocusTrap(open, dialogRef);

  // 按 category 分组，保持声明顺序
  const grouped: Record<string, Shortcut[]> = {};
  for (const s of shortcuts) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  return (
    <AnimatePresence>
      {open && (
        <m.div
          key="key-help-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t('shell.keyHelpTitle')}
          className="fixed inset-0 z-[100] grid place-items-center bg-bg-base/70 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <m.div
            ref={dialogRef}
            className="scrollbar-thin max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line-subtle bg-bg-surface p-5 shadow-xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-4 flex items-baseline justify-between gap-3">
              <div>
                <p className="text-caption uppercase tracking-[0.22em] text-ink-muted">{t('shell.keyHelpEyebrow')}</p>
                <h2 className="mt-0.5 font-display text-display text-ink-primary">{t('shell.keyHelpTitle')}</h2>
              </div>
              <p className="text-caption text-ink-muted">{t('shell.keyHelpHint')}</p>
            </header>
            <div className="space-y-4">
              {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
                <section key={cat}>
                  <h3 className="mb-2 text-caption uppercase tracking-[0.18em] text-ink-muted">{t(CATEGORY_I18N[cat])}</h3>
                  <ul className="space-y-1.5">
                    {grouped[cat].map((s, idx) => (
                      <li
                        key={`${cat}-${s.key}-${idx}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-line-subtle/50 bg-bg-raised/40 px-3 py-1.5"
                      >
                        <span className="text-body text-ink-secondary">{s.description}</span>
                        <span className="flex items-center gap-1">
                          {renderKeys(s, t('shell.keyHelpKeySpace')).map((part, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <span className="text-caption text-ink-muted">+</span>}
                              <KeyCap>{part}</KeyCap>
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
