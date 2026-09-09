import { m } from 'framer-motion';
import type { ReactNode } from 'react';
import { moduleEntry } from '../../utils/motion';

interface Props {
  primary: ReactNode;
  probe?: ReactNode;
  concept?: ReactNode;
}

/**
 * 教学模块统一外壳：
 * - primary：主交互区（3D / 矢量平面 / 限制图 / 流程图）
 * - probe ：实时探针卡片，xl 屏左右排列，否则纵向
 * - concept：概念解释 / 公式 / 调试建议（可折叠 ConceptNotes）
 *
 * 各模块只负责给三个槽提供内容，不再写自己的入场动画 / Asset / 公式面板。
 */
export function ModuleLayout({ primary, probe, concept }: Props) {
  return (
    <m.div variants={moduleEntry} initial="hidden" animate="visible" className="space-y-4">
      <div className={probe ? 'grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]' : ''}>
        <div className="min-w-0">{primary}</div>
        {probe && <div className="min-w-0 space-y-4">{probe}</div>}
      </div>
      {concept && <div>{concept}</div>}
    </m.div>
  );
}
