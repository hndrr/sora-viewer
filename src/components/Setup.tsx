import { useEffect, useState } from 'react';
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
  fileInput: {
    width: '100%',
    background: '#131313',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#ddd',
    fontSize: 13,
  },
};

export function Setup({ dataSource, onDone }: Props) {
  const [cfg, setCfg] = useState<Awaited<ReturnType<ViewerDataSource['getConfig']>> | null>(null);
  const [error, setError] = useState('');
  const [browserFor, setBrowserFor] = useState<'json' | 'mov' | null>(null);
  const [zipResult, setZipResult] = useState<ZipLoadResult | null>(null);
  const [zipLoading, setZipLoading] = useState(false);

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

  async function loadZip(file: File | undefined) {
    if (!file || !dataSource.loadZipFile) return;
    setError('');
    setZipLoading(true);
    try {
      const result = await dataSource.loadZipFile(file);
      setZipResult(result);
      setCfg(await dataSource.getConfig());
    } catch (e) {
      setZipResult(null);
      setError(e instanceof Error ? e.message : 'ZIP の読み込みに失敗しました');
    } finally {
      setZipLoading(false);
    }
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
    if (count > 0)
      return (
        <div style={{ ...S.stat, ...S.statOk }}>
          ✓ {count} {label} を検出
        </div>
      );
    return (
      <div style={{ ...S.stat, ...S.statWarn }}>
        ⚠ {label} が見つかりません。フォルダを確認してください
      </div>
    );
  };

  if (dataSource.mode === 'browser-zip') {
    const zipReady = !!cfg?.configured;

    return (
      <div style={S.page}>
        <div style={S.wrap}>
          <h1 style={S.h1}>🎬 ZIP を選択</h1>
          <p style={S.lead}>
            Sora2 のエクスポート ZIP を選択してください。
            <br />
            ファイルはアップロードされず、このブラウザ内だけで読み込まれます。
          </p>

          <div style={S.card}>
            <h2 style={S.h2}>Sora export ZIP</h2>
            <p style={S.desc}>
              <code style={S.code}>sora-data-files-export-*.zip</code> 内の{' '}
              <code style={S.code}>generations.json</code> /{' '}
              <code style={S.code}>*-generations.json</code> と{' '}
              <code style={S.code}>{'{generation_id}.mp4'}</code> を検出します。
            </p>
            <input
              style={S.fileInput}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              disabled={zipLoading}
              onChange={(e) => loadZip(e.currentTarget.files?.[0])}
            />
            {zipLoading && <div style={S.stat}>ZIP を読み込み中…</div>}
            {zipResult && (
              <div style={{ ...S.stat, ...S.statOk }}>
                ✓ {zipResult.generationCount} 件 / 再生可能 {zipResult.playableCount} 件 （JSON{' '}
                {zipResult.jsonCount}、MP4 {zipResult.movCount}）
              </div>
            )}
          </div>

          <div style={S.footer}>
            <button
              style={{ ...S.launch, ...(zipReady ? {} : S.launchOff) }}
              disabled={!zipReady}
              onClick={onDone}
            >
              起動
            </button>
            {error && <span style={S.err}>{error}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>🎬 データ設定</h1>
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
