"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAudioUrl } from "../../lib/queries";
import AudioEditor from "../../components/AudioEditor";
import { useSystemBars } from "../../lib/useSystemBars";
import { useLoginState } from "../../lib/useLoginState";

// 🔥 音声の編集（ログイン中の人だけ）。アプリ化（静的書き出し）に対応するため、URLは
//    /edit?name=260712_043_Tr1.mp3&start=3&end=12 の形にしている。
//    name が無いときは、端末のファイルを選んで編集できる（データ登録の前に、試したいときなど）
function EditInner() {
  useSystemBars("light"); // 明るい背景：バーの文字は黒
  const router = useRouter();
  const params = useSearchParams();
  const login = useLoginState();
  const name = params.get("name");
  const start = Number(params.get("start"));
  const end = Number(params.get("end"));
  const [localFile, setLocalFile] = useState(null);

  const src = useMemo(() => (name ? getAudioUrl(name) : null), [name]);
  const initialRange = useMemo(
    () => (name && Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null),
    [name, start, end]
  );

  return (
    <div className="abl-page-safe min-h-screen w-full flex justify-center bg-page px-6">
      <div className="w-full max-w-sm bg-page rounded-[28px] border-[6px] border-white shadow-xl overflow-hidden pb-6">
        <button onClick={() => router.back()} className="block px-4 pt-4 text-xs font-bold text-[#3F6C74]">
          ‹ 戻る
        </button>

        <div className="mx-4 mt-2.5 mb-3 bg-white border-[3px] border-cardBorder rounded-2xl p-4">
          <div className="font-display text-xl">音声を編集</div>
          <div className="text-[11px] text-inkMuted font-bold mt-0.5 break-all">
            {name ?? localFile?.name ?? "ファイルを選んでください"}
          </div>
        </div>

        {!login.ready && <p className="text-center text-xs text-inkMuted py-10">確認中...</p>}
        {login.ready && !login.loggedIn && (
          <p className="text-center text-xs text-inkMuted py-10 px-6">この画面は、ログイン中の人だけが使えます。</p>
        )}

        {login.loggedIn && (
          <div className="px-4 flex flex-col gap-3">
            {!name && (
              <div className="bg-white border-[3px] border-cardBorder rounded-2xl p-4">
                <label className="inline-block cursor-pointer text-[11px] font-bold rounded-full border-2 border-cardBorder bg-page px-3.5 py-1.5 text-[#3F6C74] hover:border-accent">
                  音声ファイルを選ぶ
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav"
                    className="hidden"
                    onChange={(e) => setLocalFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <p className="mt-2 text-[10px] text-inkMuted leading-relaxed">
                  選んだファイルは、この端末の中だけで開きます（どこにも送られません）。
                </p>
              </div>
            )}
            {(name || localFile) && <AudioEditor src={src} file={name ? null : localFile} initialRange={initialRange} sourceName={name} />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EditPage() {
  return (
    <Suspense fallback={null}>
      <EditInner />
    </Suspense>
  );
}
