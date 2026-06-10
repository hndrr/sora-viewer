import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

// CSS Grid の row-span 方式マゾンリー。
// DOM 順 = データ順を保つため、無限スクロール（sentinel 方式）とそのまま共存できる。
const ROW_UNIT = 4;
const GAP = 14;
const MIN_COL = 260;
const PADDING = 18;

// 行スパンの推定とカード側の描画がズレないよう、高さ比（h/w）はここで一元化する。
// width/height が manifest に無い(0)場合は 16:9 にフォールバック。
export function clampedHeightRatio(w: number, h: number): number {
  if (!w || !h) return 9 / 16;
  return Math.min(Math.max(h / w, 0.5), 1.9);
}

export function MasonryGrid<T>({
  items,
  keyOf,
  heightRatio,
  renderItem,
}: {
  items: T[];
  keyOf: (item: T) => string;
  heightRatio: (item: T) => number;
  renderItem: (item: T) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ cols: number; colW: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth - PADDING * 2;
      const cols = Math.max(1, Math.floor((width + GAP) / (MIN_COL + GAP)));
      const colW = (width - GAP * (cols - 1)) / cols;
      setLayout((prev) =>
        prev && prev.cols === cols && prev.colW === colW ? prev : { cols, colW },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'grid',
        gridTemplateColumns: layout ? `repeat(${layout.cols}, 1fr)` : undefined,
        gridAutoRows: ROW_UNIT,
        gap: GAP,
        padding: PADDING,
      }}
    >
      {layout &&
        items.map((item) => {
          // セル高 = span*ROW_UNIT + (span-1)*GAP ≧ 推定高。カード側は height:100% で埋める。
          const est = layout.colW * heightRatio(item);
          const span = Math.max(1, Math.ceil((est + GAP) / (ROW_UNIT + GAP)));
          return (
            <div key={keyOf(item)} style={{ gridRowEnd: `span ${span}` }}>
              {renderItem(item)}
            </div>
          );
        })}
    </div>
  );
}
