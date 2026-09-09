import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';

/**
 * 模块内卡片锚点导航（scroll-spy 芯片条）。
 *
 * 模式来源：Tailwind Plus Protocol 模板的 SectionProvider —— rAF 节流的
 * scroll 监听 + getBoundingClientRect 区间判定（无 IntersectionObserver）。
 * 适配本项目：滚动容器是 SimulationPanel 的 section（overflow-auto）而非
 * window；锚点目标为带 data-card-anchor 的 Card；UI 形态从右侧竖排 TOC
 * 改为水平芯片条（契合 1.4fr/1fr 双列卡片网格）。
 *
 * 行为：点击芯片平滑滚动到卡片（scroll-mt 预留粘性头高度）；滚动时高亮
 * 当前视口内最后一张进入的卡片；芯片条自身横向滚动跟随活动芯片。
 */
interface Anchor {
  id: string;
  title: string;
}

export function ModuleSectionNav({
  scrollContainerRef,
  moduleId,
}: {
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  /** 当前模块 id：变化时（Suspense resolve 后）重扫锚点 */
  moduleId: string;
}) {
  const { t } = useI18n();
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 扫描锚点：模块懒加载（Suspense）完成后卡片才挂载——用 MutationObserver
  // 监听容器子树，卡片就位即建表；重复标题追加序号保证 id 唯一。
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;

    const scan = () => {
      const els = Array.from(root.querySelectorAll<HTMLElement>('[data-card-anchor]'));
      const seen = new Map<string, number>();
      const list: Anchor[] = els.map((el, i) => {
        const rawTitle = el.getAttribute('data-card-title') ?? `#${i + 1}`;
        const dup = seen.get(rawTitle) ?? 0;
        seen.set(rawTitle, dup + 1);
        const title = dup > 0 ? `${rawTitle} ${dup + 1}` : rawTitle;
        const id = `card-anchor-${i}`;
        el.id = id;
        return { id, title };
      });
      const signature = list.map((a) => a.title).join('\u0000');
      setAnchors((prev) => {
        const prevSig = prev.map((a) => a.title).join('\u0000');
        if (prevSig === signature) return prev;
        return list;
      });
    };

    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [scrollContainerRef, moduleId]);

  // 锚点列表变化（换模块）时重置高亮到第一张卡
  useEffect(() => {
    setActiveId(anchors[0]?.id ?? null);
  }, [anchors]);

  // scroll-spy（Protocol 模式的容器内适配版）
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || anchors.length === 0) return;

    const STICKY_OFFSET = 84; // 粘性头 + 芯片条高度余量
    const spy = () => {
      const rects = anchors.map((a) => {
        const el = root.querySelector<HTMLElement>(`#${CSS.escape(a.id)}`);
        if (!el) return null;
        const top = el.getBoundingClientRect().top;
        return { id: a.id, top };
      });
      // 活动卡片 = 视口顶线之下最靠近的那张；全在下方时取第一张
      let active: string | null = rects[0]?.id ?? null;
      for (const r of rects) {
        if (r && r.top <= STICKY_OFFSET) active = r.id;
      }
      setActiveId((prev) => (prev === active ? prev : active));
    };

    const raf = requestAnimationFrame(spy);
    // 双源监听：桌面端模块 section 自身滚动；移动端（<xl 布局高度未约束）
    // section 撑开到内容高度、由 window 滚动——只听 section 会漏，spy 冻结
    root.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', spy);
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('scroll', spy);
      window.removeEventListener('scroll', spy);
      window.removeEventListener('resize', spy);
    };
  }, [anchors, scrollContainerRef]);

  // 活动芯片滚入芯片条可视区（只动条自身，不触发页面滚动）
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !activeId) return;
    const chip = bar.querySelector<HTMLButtonElement>(`[data-chip-id="${activeId}"]`);
    if (!chip) return;
    const chipLeft = chip.offsetLeft;
    const chipRight = chipLeft + chip.offsetWidth;
    if (chipLeft < bar.scrollLeft + 8 || chipRight > bar.scrollLeft + bar.clientWidth - 8) {
      bar.scrollTo({ left: chipLeft - bar.clientWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' });
    }
  }, [activeId]);

  if (anchors.length < 2) return null; // 单卡片模块不需要导航

  const jump = (id: string) => {
    const root = scrollContainerRef.current;
    const el = root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      ref={barRef}
      role="tablist"
      aria-label={t('shell.sectionNavAria')}
      className="scrollbar-none flex items-center gap-1 overflow-x-auto pb-0.5"
    >
      {anchors.map((a) => {
        const isActive = a.id === activeId;
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-chip-id={a.id}
            onClick={() => jump(a.id)}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] leading-tight transition-colors ${
              isActive
                ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
                : 'border-line-subtle bg-bg-base text-ink-muted hover:text-ink-primary'
            }`}
          >
            {a.title}
          </button>
        );
      })}
    </div>
  );
}
