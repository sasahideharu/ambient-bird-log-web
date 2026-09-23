"use client";

import { Suspense, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { canGoBackInApp, hasNavigatedInApp } from "../lib/backNav";
import { useSwipeNav } from "../lib/useSwipeNav";
import { useStickyBgHeight } from "../lib/useStickyBgHeight";
import { fetchDetections, fetchBirdImages, getRemoteAudioUrl } from "../lib/queries";
import { forgetSpectrogram } from "../lib/spectrogram3dData";
import { useLoginState } from "../lib/useLoginState";
import { signOut } from "../lib/auth";
import LoginPanel from "./LoginPanel";
import { useSystemBars } from "../lib/useSystemBars";
import { buildSpeciesList } from "../lib/aggregate";
import {
  getSessionOrderMap,
  setSessionOrderMap,
  sortWithFixedTail,
} from "../lib/speciesOrder";
import MinimalBirdModal from "./MinimalBirdModal";
import OfflineSavePanel from "./OfflineSavePanel";
import { isNativeApp, onUsingSavedChange, refreshEditedAudio } from "../lib/offline";

const CONFIDENCE_DEFAULT = 60;

// 🔥 写真グリッドの1枚分。読み込みに失敗したら、写真なしの縁取りだけのマスに切り替える（admin版と同じ考え方）
function MinimalThumb({ species: s, onSelect }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = s.imageUrl && !imgFailed;

  return (
    <button
      onClick={() => onSelect(s.name)}
      className="rounded-xl overflow-hidden border border-white/50 hover:border-white relative block transition-colors bg-white/5"
    >
      <div className="aspect-square">
        {showImage ? (
          <img
            src={s.imageUrl}
            alt={s.name}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : null}
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 backdrop-blur-[1px] text-white text-[10px] font-medium tracking-wide text-center py-1.5">
        {s.name}
      </div>
    </button>
  );
}

// promptLogin: 管理画面（?admin=true）にログイン無しで来たときに、最初からログイン画面を開く
function MinimalHomeInner({ promptLogin = false }) {
  useSystemBars("dark"); // 暗い背景：バーの文字は白
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const login = useLoginState();
  const [loginOpen, setLoginOpen] = useState(promptLogin);
  const [rawDetections, setRawDetections] = useState([]);
  const [birdImages, setBirdImages] = useState([]);
  const [keyword, setKeyword] = useState("");

  // 🔥 背景の写真を、透明から浮かび上がらせる演出は、アプリを開いた最初の1回だけ。
  //    2回目以降（録音画面からスワイプで戻ってきたときなど）は、最初から見えている状態にする
  //    （毎回、写真が透明→浮かび上がる、をやり直すと、その一瞬、下地の黒が見えてしまうため）
  const [bgRevealed, setBgRevealed] = useState(() => hasNavigatedInApp());
  const [contentRevealed, setContentRevealed] = useState(false);
  // 🔥 鳥の窓は、画面の住所（?bird=鳥の名前）と連動させる。開くと履歴が1つ増え、「×」で1つ戻る。
  //    こうすると、窓から別の画面（3D の全画面・音声の編集）へ行って戻ったとき、鳥の窓が開いた状態に戻る（トップまで戻らない）
  const selectedSpecies = params.get("bird");
  const openBird = useCallback(
    (name) => router.push(`${pathname}?bird=${encodeURIComponent(name)}`, { scroll: false }),
    [router, pathname]
  );
  const closeBird = useCallback(() => {
    if (canGoBackInApp()) router.back();
    // この住所を、直接開いたときだけ（戻る先が無い）：住所から ?bird= を外す（router.replace は、同じ画面への移動のため、住所が変わらなかった。住所を直接書き換えると、Next.js のルーターと同期される）
    else window.history.replaceState(null, "", pathname);
  }, [router, pathname]);
  const [orderMap, setOrderMap] = useState(() => ({ ...getSessionOrderMap() }));

  // 🔥 アプリ（iPhone/Android）のときだけ「オフライン保存」を出す。
  //    電波が無くて保存データを表示している間は、その旨を小さく表示する
  const [isApp, setIsApp] = useState(false);
  const [usingSaved, setUsingSaved] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  useEffect(() => {
    setIsApp(isNativeApp());
    return onUsingSavedChange(setUsingSaved);
  }, []);

  // 🔥 左から右へスワイプすると、録音画面へ戻る（ログイン中のアプリだけ。録音画面から、右から左へスワイプして来た、その逆）
  const { dragPercent: swipePercent, dragging: swiping, handlers: swipeHandlers } = useSwipeNav({
    direction: "right",
    enabled: isApp && login.loggedIn,
    onCommit: () => router.push("/record"),
  });
  const swipeStyle = {
    transform: swipePercent > 0 ? `translateX(${swipePercent * 100}%)` : undefined,
    transition: swiping ? "none" : "transform 320ms ease-out",
  };

  // 🔥 アプリを開いたとき：編集して公開した録音を、編集し直したものがあれば、保存済みのコピーを新しいものに入れ替える
  //    （そのままだと、編集前の音が出続ける）。電波が無いときは、何もしない
  useEffect(() => {
    if (!isNativeApp()) return;
    refreshEditedAudio({ getRemoteAudioUrl })
      .then((names) => names.forEach(forgetSpectrogram))
      .catch((err) => console.warn(err));
  }, []);

  // 🔥 「タイトルを、画面の縦センターから15%上（＝上から35%）の位置に最優先で固定する」を、
  //    タイトル自身の高さだけを測って実現する。中身全体ではなくタイトルだけを測ることで、
  //    下に続くサブタイトル・検索窓・一覧がどれだけ長くなっても、タイトルの位置は一切変わらない
  const titleRef = useRef(null);
  const [paddingTop, setPaddingTop] = useState(24);

  const recomputePadding = useCallback(() => {
    if (typeof window === "undefined" || !titleRef.current) return;
    const titleHeight = titleRef.current.offsetHeight;
    const vh = window.innerHeight;
    const desired = vh * 0.35 - titleHeight / 2;
    setPaddingTop(Math.max(0, desired));
  }, []);

  useLayoutEffect(() => {
    recomputePadding();
    const ro = new ResizeObserver(() => recomputePadding());
    if (titleRef.current) ro.observe(titleRef.current);
    window.addEventListener("resize", recomputePadding);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recomputePadding);
    };
  }, [recomputePadding]);

  // 🔥 オフライン保存・削除のあとにも呼んで、写真などの参照先（ネット／端末内）を最新にする
  const loadData = useCallback(async () => {
    try {
      const [detections, images] = await Promise.all([
        fetchDetections(),
        fetchBirdImages(),
      ]);
      setRawDetections(detections);
      setBirdImages(images);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 🔥 データが読み込まれたら、まだ順番が決まっていない鳥にだけ新しくランダムな順位を割り当てて保存する
  //    （AdminHomeと同じsessionOrderMapを参照するので、両画面で同じ並びになる）
  useEffect(() => {
    if (rawDetections.length === 0) return;
    const allSpecies = buildSpeciesList(rawDetections, birdImages);
    setOrderMap((prev) => {
      const next = { ...getSessionOrderMap(), ...prev };
      let changed = false;
      for (const s of allSpecies) {
        if (!(s.name in next)) {
          next[s.name] = Math.random();
          changed = true;
        }
      }
      if (changed) setSessionOrderMap(next);
      return changed ? next : prev;
    });
  }, [rawDetections, birdImages]);

  useEffect(() => {
    // 文字・検索窓・一覧の、ゆっくりの登場効果は、毎回（2回目以降も）そのまま再生する
    const t2 = setTimeout(() => setContentRevealed(true), 650);
    // 背景の写真の登場効果（透明→浮かび上がる）だけは、最初の1回に限る（上のuseStateを参照）
    if (hasNavigatedInApp()) return () => clearTimeout(t2);
    const t1 = setTimeout(() => setBgRevealed(true), 80);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const visible = useMemo(() => {
    const filteredDetections = rawDetections.filter(
      (d) => Math.round(d.confidence * 100) >= CONFIDENCE_DEFAULT
    );
    const speciesList = buildSpeciesList(filteredDetections, birdImages);
    const keywordFiltered = speciesList.filter(
      (s) => keyword.trim() === "" || s.name.includes(keyword.trim())
    );
    return sortWithFixedTail(keywordFiltered, orderMap);
  }, [rawDetections, birdImages, keyword, orderMap]);

  // 🔥 一覧の件数が変わったとき（データが読み込めた・検索で絞り込んだ、など）だけ、
  //    背景の高さが足りているかを測り直す（内容が画面より長く伸びても、背景が途中で剥がれないように）
  const bgHeight = useStickyBgHeight(visible.length);

  return (
    <div className="relative w-full bg-black overflow-x-hidden" style={{ touchAction: "pan-y" }} {...swipeHandlers}>
      {/* 背景：sticky + 負のマージンで「固定に見える」ようにする。
          position: fixed だとAndroidのChromeでアドレスバーの伸縮時に位置がズレることがあるため、
          スクロールの動きに素直に追従するstickyの方が両OSで安定する */}
      <div
        className={`sticky top-0 w-full z-0 ${
          bgRevealed ? "opacity-100 brightness-100 saturate-100" : "opacity-0 brightness-[0.35] saturate-[0.55]"
        }`}
        style={{
          transition: "opacity 2600ms ease-out, filter 2600ms ease-out",
          height: bgHeight ? `${bgHeight}px` : "100vh",
          marginBottom: bgHeight ? `-${bgHeight}px` : "-100vh",
        }}
      >
        <Image
          src="/forest-bg.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/25" />
      </div>

      {/* コンテンツ：タイトル〜一覧のまとまりの中心が、画面の縦センターから15%上に来るよう、
          実際の高さを測ってpaddingTopで調整する（absolute配置だと中身が伸びたときに
          画面の外へはみ出す問題があったため、この方式に変更） */}
      <div className="relative z-10 min-h-screen w-full flex flex-col items-center px-6 pb-10" style={swipeStyle}>
        <div className="w-full max-w-sm flex flex-col items-center">
        <div style={{ paddingTop }}>
          <h1
            ref={titleRef}
            className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} font-hero font-light text-white text-3xl tracking-wide text-center`}
            style={{ transitionDelay: "300ms" }}
          >
            Ambient Bird Log
          </h1>
        </div>
        <p
          className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} font-hero text-[#F4F2EC] text-center mt-2`}
          style={{ transitionDelay: "900ms" }}
        >
          <span className="block text-[10px] tracking-[2px]">by Hideharu Sasa</span>
          <span className="block text-[7px] tracking-[1.5px] mt-1 opacity-80">from Angle Matters</span>
        </p>

        <div
          className={`abl-fade-blur ${contentRevealed ? "abl-fade-in" : ""} w-full mt-10`}
          style={{ transitionDelay: "2400ms", transitionDuration: "2000ms" }}
        >
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="What bird sings now?"
            className="w-full bg-white/10 rounded-xl px-5 py-3 text-white text-sm text-center placeholder:text-white/50 outline-none focus:bg-white/15 transition-colors"
          />
        </div>

        <div
          className={`abl-fade ${contentRevealed ? "abl-fade-in" : ""} w-full mt-6 grid grid-cols-3 gap-2`}
          style={{ transitionDelay: "5200ms", transitionDuration: "2000ms" }}
        >
          {visible.map((s) => (
            <MinimalThumb key={s.name} species={s} onSelect={openBird} />
          ))}
          {visible.length === 0 && (
            <p className="col-span-3 text-center text-white/50 text-xs py-4">
              該当する野鳥が見つかりませんでした
            </p>
          )}
        </div>
        </div>
      </div>

      {/* フッター：白い帯にInstagramアイコンと著作権表記 */}
      <div
        className="relative z-10 w-full bg-white pt-6 flex flex-col items-center justify-center gap-3"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))", ...swipeStyle }}
      >
        {/* ログインの有無で、使えるものを分ける（ログイン中だけ、緯度経度・地図・管理画面・オフライン保存） */}
        {login.ready && (
          <div className="w-full px-4 flex flex-col items-center gap-2 text-[11px] text-[#8A8A8A]">
            {login.loggedIn ? (
              <>
                {/* 1行目：ログイン中に使える機能。項目の途中で折り返さない（whitespace-nowrap）。
                    幅が足りなければ、項目ごとに次の行へ回る */}
                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
                  <Link
                    href="/admin"
                    className="whitespace-nowrap hover:text-[#555] underline underline-offset-2 transition-colors"
                  >
                    観測地点・観測日・地図
                  </Link>
                  {isApp && (
                    <button
                      onClick={() => setOfflineOpen(true)}
                      className="whitespace-nowrap hover:text-[#555] underline underline-offset-2 transition-colors"
                    >
                      オフライン保存
                    </button>
                  )}
                  {isApp && (
                    <Link
                      href="/record"
                      className="whitespace-nowrap hover:text-[#555] underline underline-offset-2 transition-colors"
                    >
                      録音
                    </Link>
                  )}
                  {isApp && (
                    <Link
                      href="/recordings"
                      className="whitespace-nowrap hover:text-[#555] underline underline-offset-2 transition-colors"
                    >
                      録音の一覧
                    </Link>
                  )}
                  {isApp && (
                    // 開発中：録音の下見（診断）。録音機能ができたら、録音の入口に置き換える
                    <Link
                      href="/diag"
                      className="whitespace-nowrap hover:text-[#555] underline underline-offset-2 transition-colors"
                    >
                      録音の下見
                    </Link>
                  )}
                </div>
                {/* 2行目：ログインの状態 */}
                <div className="flex items-center justify-center gap-3">
                  <span className="whitespace-nowrap">ログイン中</span>
                  <span aria-hidden="true">・</span>
                  <button
                    onClick={async () => {
                      setOfflineOpen(false);
                      await signOut();
                    }}
                    className="whitespace-nowrap hover:text-[#555] underline underline-offset-2 transition-colors"
                  >
                    ログアウト
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="whitespace-nowrap hover:text-[#555] underline underline-offset-2 transition-colors"
              >
                ログイン
              </button>
            )}
          </div>
        )}
        <a
          href="https://www.instagram.com/hideharu.sasa?igsh=Y2Z6c2h5Nmd2Zm5u&utm_source=qr"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Instagram"
          className="text-[#8A8A8A] hover:text-[#555] transition-colors"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
          </svg>
        </a>
        <p className="text-[10px] text-[#A0A0A0] tracking-wide">
          © 2026 Hideharu Sasa. All rights reserved.
        </p>
      </div>

      {usingSaved && (
        <div
          style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
          className="fixed left-1/2 -translate-x-1/2 z-40 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-[10px] text-white/80 tracking-wide">
          オフライン：保存データを表示中
        </div>
      )}

      <MinimalBirdModal
        speciesName={selectedSpecies}
        onClose={closeBird}
        onChanged={loadData}
      />

      {isApp && login.loggedIn && (
        <OfflineSavePanel
          open={offlineOpen}
          onClose={() => setOfflineOpen(false)}
          onChanged={loadData}
        />
      )}

      <LoginPanel
        open={loginOpen && !login.loggedIn}
        onClose={() => setLoginOpen(false)}
        notice={promptLogin ? "観測地点・観測日・地図の画面は、ログインが必要です。" : null}
      />
    </div>
  );
}

export default function MinimalHome(props) {
  return (
    <Suspense fallback={null}>
      <MinimalHomeInner {...props} />
    </Suspense>
  );
}
