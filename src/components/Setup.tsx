import {
  Check,
  Clapperboard,
  FileArchive,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import type { ViewerDataSource, ZipLoadResult } from '../dataSources/types';
import { FolderBrowser } from './FolderBrowser';

declare global {
  interface Window {
    soraNative?: {
      isElectron: boolean;
      pickDir: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>;
    };
  }
}

interface Props {
  dataSource: ViewerDataSource;
  onDone: () => void;
}

const S = {
  page: {
    minHeight: '100vh',
    background: '#161616',
    color: '#ddd',
    fontFamily: 'inherit',
    display: 'flex',
    justifyContent: 'center',
  },
  wrap: { width: 'min(680px, 92vw)', padding: '48px 24px 32px' },
  h1: { fontSize: 20, margin: '0 0 6px', color: '#fff' },
  lead: { fontSize: 13, color: '#888', lineHeight: 1.7, margin: '0 0 28px' },
  card: {
    background: '#1d1d1d',
    border: '1px solid #2c2c2c',
    borderRadius: 12,
    padding: '18px 18px 16px',
    marginBottom: 16,
  },
  h2: { fontSize: 14, margin: '0 0 4px', color: '#fff' },
  desc: { fontSize: 12, color: '#888', lineHeight: 1.7, margin: '0 0 14px' },
  code: { background: '#2a2a2a', borderRadius: 4, padding: '1px 5px', fontSize: 11, color: '#cdd' },
  row: { display: 'flex', gap: 10, alignItems: 'center' },
  path: {
    flex: 1,
    minWidth: 0,
    background: '#131313',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '9px 12px',
    fontSize: 12,
    color: '#cfd6cf',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'rtl' as const,
    textAlign: 'left' as const,
  },
  pathEmpty: { color: '#666', direction: 'ltr' as const },
  btn: {
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: 8,
    border: '1px solid #3a3a3a',
    background: '#2a2a2a',
    color: '#ddd',
    padding: '9px 16px',
    fontSize: 13,
    whiteSpace: 'nowrap' as const,
  },
  stat: { fontSize: 11, marginTop: 8, minHeight: 15 },
  statOk: { color: '#7ab87a' },
  statWarn: { color: '#d99' },
  footer: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 24 },
  launch: {
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: 8,
    border: '1px solid #4a7a4a',
    background: '#2d4a2d',
    color: '#cfe9cf',
    padding: '11px 26px',
    fontSize: 13,
    fontWeight: 700,
  },
  launchOff: { background: '#232323', borderColor: '#2f2f2f', color: '#666', cursor: 'default' },
  err: { fontSize: 12, color: '#e08a8a' },

  // ── browser-zip 専用（ヒーロー + ドロップゾーン）────────────────────────
  zipPage: {
    minHeight: '100vh',
    background: 'radial-gradient(1200px 600px at 50% -10%, #1d2330 0%, #101014 55%, #0d0d0d 100%)',
    color: '#ddd',
    display: 'flex',
    justifyContent: 'center',
  },
  zipWrap: {
    width: 'min(640px, 92vw)',
    padding: '64px 24px 48px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  heroTitle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    fontSize: 34,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#fff',
    margin: '0 0 10px',
    textAlign: 'center' as const,
  },
  heroLead: {
    fontSize: 14,
    color: '#9aa3b2',
    lineHeight: 1.8,
    margin: '0 0 18px',
    textAlign: 'center' as const,
  },
  privacyBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(122, 184, 122, 0.35)',
    borderRadius: 999,
    background: 'rgba(45, 74, 45, 0.35)',
    color: '#a8d8a8',
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 32,
  },
  dropzone: {
    font: 'inherit',
    color: 'inherit',
    width: '100%',
    border: '2px dashed #3a4150',
    borderRadius: 18,
    background: 'rgba(255, 255, 255, 0.025)',
    padding: '44px 28px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
    cursor: 'pointer',
    transition: 'border-color .15s, background .15s',
    textAlign: 'center' as const,
    outline: 'none',
  },
  dropzoneHover: { borderColor: '#5f8ee8', background: 'rgba(95, 142, 232, 0.06)' },
  dropzoneBusy: { cursor: 'progress' },
  dropTitle: { fontSize: 16, fontWeight: 700, color: '#f0f0f0' },
  dropHint: { fontSize: 12, color: '#8a93a3', lineHeight: 1.7 },
  zipStat: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    minHeight: 20,
    marginTop: 18,
  },
  guide: {
    width: '100%',
    marginTop: 28,
    border: '1px solid #262b36',
    borderRadius: 12,
    background: 'rgba(255, 255, 255, 0.02)',
    padding: '4px 18px',
  },
  guideSummary: {
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    color: '#aab3c2',
    padding: '12px 0',
    userSelect: 'none' as const,
    listStyle: 'none' as const,
  },
  guideSteps: {
    margin: 0,
    padding: '2px 0 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  guideStep: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  guideNum: {
    flex: '0 0 auto',
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: '#2a3242',
    color: '#9db5e8',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  guideText: { fontSize: 12, color: '#9aa3b2', lineHeight: 1.7 },
  dropOverlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 1000,
    background: 'rgba(13, 16, 24, 0.88)',
    backdropFilter: 'blur(6px)',
    border: '3px dashed #5f8ee8',
    borderRadius: 16,
    margin: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    color: '#c9dcff',
    fontSize: 18,
    fontWeight: 700,
    pointerEvents: 'none' as const,
  },
  skipBtn: {
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: '#e8e8e8',
    padding: '8px 22px',
    fontSize: 12,
    fontWeight: 600,
    marginTop: 12,
  },
};

export function Setup({ dataSource, onDone }: Props) {
  const [cfg, setCfg] = useState<Awaited<ReturnType<ViewerDataSource['getConfig']>> | null>(null);
  const [error, setError] = useState('');
  const [browserFor, setBrowserFor] = useState<'json' | 'mov' | null>(null);
  const [zipResult, setZipResult] = useState<ZipLoadResult | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoLaunchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneFiredRef = useRef(false);

  useEffect(() => {
    dataSource
      .getConfig()
      .then(setCfg)
      .catch(() =>
        setCfg({
          jsonDir: null,
          movDir: null,
          jsonCount: 0,
          movCount: 0,
          configured: false,
        }),
      );
  }, [dataSource]);

  useEffect(
    () => () => {
      if (autoLaunchTimerRef.current) clearTimeout(autoLaunchTimerRef.current);
    },
    [],
  );

  async function applyDir(which: 'json' | 'mov', dir: string) {
    setError('');
    if (!dataSource.applyDir) return;
    try {
      setCfg(await dataSource.applyDir(which, dir));
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定に失敗しました');
      return;
    }
  }

  async function pick(which: 'json' | 'mov') {
    setError('');
    const current = which === 'json' ? cfg?.jsonDir : cfg?.movDir;
    if (window.soraNative?.pickDir) {
      const dir = await window.soraNative.pickDir({
        title: which === 'json' ? 'JSON フォルダを選択' : 'mov フォルダを選択',
        defaultPath: current ?? undefined,
      });
      if (dir) await applyDir(which, dir);
    } else {
      setBrowserFor(which);
    }
  }

  const launch = () => {
    if (doneFiredRef.current) return;
    doneFiredRef.current = true;
    if (autoLaunchTimerRef.current) clearTimeout(autoLaunchTimerRef.current);
    onDone();
  };

  async function loadZip(file: File | undefined) {
    if (!file || !dataSource.loadZipFile || zipLoading) return;
    setError('');
    setZipLoading(true);
    try {
      const result = await dataSource.loadZipFile(file);
      setZipResult(result);
      const nextCfg = await dataSource.getConfig();
      setCfg(nextCfg);
      // 読み込み成功 → 統計を一瞬見せてから自動でフィードへ
      if (nextCfg.configured) {
        autoLaunchTimerRef.current = setTimeout(launch, 1200);
      }
    } catch (e) {
      setZipResult(null);
      setError(e instanceof Error ? e.message : 'ZIP の読み込みに失敗しました');
    } finally {
      setZipLoading(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files];
    const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
    if (!zip) {
      setError('ZIP ファイルをドロップしてください');
      return;
    }
    void loadZip(zip);
  }

  const ready = !!cfg && cfg.jsonCount > 0 && cfg.movCount > 0;

  const renderPath = (dir: string | null) =>
    dir ? (
      <div style={S.path} title={dir}>
        {dir}
      </div>
    ) : (
      <div style={{ ...S.path, ...S.pathEmpty }}>未選択</div>
    );

  const renderStat = (dir: string | null, count: number, label: string) => {
    if (!dir) return <div style={S.stat} />;
    const statRow = { display: 'flex', alignItems: 'center', gap: 5 };
    if (count > 0)
      return (
        <div style={{ ...S.stat, ...S.statOk, ...statRow }}>
          <Check size={13} aria-hidden />
          {count} {label} を検出
        </div>
      );
    return (
      <div style={{ ...S.stat, ...S.statWarn, ...statRow }}>
        <TriangleAlert size={13} aria-hidden />
        {label} が見つかりません。フォルダを確認してください
      </div>
    );
  };

  if (dataSource.mode === 'browser-zip') {
    const zipReady = !!cfg?.configured;

    return (
      <div
        style={S.zipPage}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div style={S.zipWrap}>
          <h1 style={S.heroTitle}>
            <Clapperboard size={30} aria-hidden />
            Sora Viewer
          </h1>
          <p style={S.heroLead}>
            Sora2 でエクスポートした作品を、ブラウザだけで
            <br />
            フィードのように眺める・探す・再生する。
          </p>
          <span style={S.privacyBadge}>
            <ShieldCheck size={15} aria-hidden />
            ファイルは端末外に送信されません — すべてブラウザ内で処理
          </span>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            style={{ display: 'none' }}
            disabled={zipLoading}
            onChange={(e) => {
              void loadZip(e.currentTarget.files?.[0]);
              e.currentTarget.value = '';
            }}
          />

          <button
            type="button"
            aria-label="Sora エクスポート ZIP を選択またはドロップ"
            style={{
              ...S.dropzone,
              ...(dropHover ? S.dropzoneHover : {}),
              ...(zipLoading ? S.dropzoneBusy : {}),
            }}
            disabled={zipLoading}
            onMouseEnter={() => setDropHover(true)}
            onMouseLeave={() => setDropHover(false)}
            onClick={() => fileInputRef.current?.click()}
          >
            {zipLoading ? (
              <Loader2 size={36} color="#5f8ee8" aria-hidden className="setup-spin" />
            ) : zipReady ? (
              <Check size={36} color="#7ab87a" aria-hidden />
            ) : (
              <Upload size={36} color="#5f8ee8" aria-hidden />
            )}
            <div style={S.dropTitle}>
              {zipLoading
                ? 'ZIP を読み込んでいます…'
                : zipReady
                  ? '読み込み完了！まもなく起動します'
                  : 'ZIP をここにドロップ'}
            </div>
            {!zipReady && !zipLoading && (
              <div style={S.dropHint}>
                またはクリックしてファイルを選択
                <br />
                <code style={S.code}>sora-data-files-export-*.zip</code> をそのまま使えます
              </div>
            )}
            <div style={S.zipStat}>
              {zipResult && (
                <span style={{ ...S.statOk, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Check size={13} aria-hidden />
                  {zipResult.generationCount} 件 / 再生可能 {zipResult.playableCount} 件（JSON{' '}
                  {zipResult.jsonCount}、MP4 {zipResult.movCount}）
                </span>
              )}
              {error && <span style={S.err}>{error}</span>}
            </div>
          </button>

          {zipReady && !zipLoading && (
            <button type="button" style={S.skipBtn} onClick={launch}>
              すぐに開く
            </button>
          )}

          <details style={S.guide}>
            <summary style={S.guideSummary}>
              <FileArchive size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 7 }} />
              エクスポート ZIP の入手方法
            </summary>
            <ol style={S.guideSteps}>
              {[
                <>
                  <a
                    href="https://sora.chatgpt.com"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#9db5e8' }}
                  >
                    sora.chatgpt.com
                  </a>{' '}
                  にログインします
                </>,
                <>設定（Settings）から「データエクスポート」をリクエストします</>,
                <>準備完了メールが届いたら、リンクから ZIP をダウンロードします</>,
                <>ダウンロードした ZIP をこの画面にドロップすれば完了です</>,
              ].map((text, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 固定の静的リスト
                <li key={i} style={S.guideStep}>
                  <span style={S.guideNum}>{i + 1}</span>
                  <span style={S.guideText}>{text}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>

        {dragging && (
          <div style={S.dropOverlay}>
            <FileArchive size={44} aria-hidden />
            ここに ZIP をドロップ
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <h1 style={{ ...S.h1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clapperboard size={18} aria-hidden />
          データ設定
        </h1>
        <p style={S.lead}>
          閲覧するデータの場所を指定してください。
          <br />
          JSON と動画(mov)は別々の場所にあっても構いません。指定したフォルダ
          <strong>そのものの中身</strong>を読み込みます。
        </p>

        <div style={S.card}>
          <h2 style={S.h2}>JSON フォルダ</h2>
          <p style={S.desc}>
            Sora エクスポートの JSON があるフォルダ。フォルダ直下に{' '}
            <code style={S.code}>*-generations.json</code>、 または{' '}
            <code style={S.code}>sora-data-files-export-1/</code> のようなサブフォルダ（中に{' '}
            <code style={S.code}>generations.json</code>）がある場所を選びます。
          </p>
          <div style={S.row}>
            {renderPath(cfg?.jsonDir ?? null)}
            <button style={S.btn} onClick={() => pick('json')}>
              フォルダを選択…
            </button>
          </div>
          {renderStat(cfg?.jsonDir ?? null, cfg?.jsonCount ?? 0, 'JSON')}
        </div>

        <div style={S.card}>
          <h2 style={S.h2}>mov フォルダ</h2>
          <p style={S.desc}>
            動画ファイル <code style={S.code}>{'{generation_id}.mp4'}</code> が入っているフォルダ。
          </p>
          <div style={S.row}>
            {renderPath(cfg?.movDir ?? null)}
            <button style={S.btn} onClick={() => pick('mov')}>
              フォルダを選択…
            </button>
          </div>
          {renderStat(cfg?.movDir ?? null, cfg?.movCount ?? 0, 'mp4')}
        </div>

        <div style={S.footer}>
          <button
            style={{ ...S.launch, ...(ready ? {} : S.launchOff) }}
            disabled={!ready}
            onClick={onDone}
          >
            起動
          </button>
          {error && <span style={S.err}>{error}</span>}
        </div>
      </div>

      {browserFor && (
        <FolderBrowser
          title={browserFor === 'json' ? 'JSON フォルダを選択' : 'mov フォルダを選択'}
          initialPath={browserFor === 'json' ? cfg?.jsonDir : cfg?.movDir}
          browseDir={(path) =>
            dataSource.browseDir
              ? dataSource.browseDir(path)
              : Promise.reject(new Error('フォルダブラウザはこのモードでは使えません'))
          }
          onSelect={async (dir) => {
            const w = browserFor;
            setBrowserFor(null);
            if (w) await applyDir(w, dir);
          }}
          onClose={() => setBrowserFor(null)}
        />
      )}
    </div>
  );
}
