"use client";

import { PERCH_STRONG_LOGIT, PERCH_AGREE_LOGIT } from "../lib/editAnalysis";

// 🔥 編集した録音の解析結果：鳥ごとの一覧。各鳥にチェック（初期は空欄）→ 公開と同時に「確定」になる。
//    BirdNET と Perch の両方が挙げた鳥は、緑で強調する。
//    speciesList：summarizeSpecies の結果／perchOn：Perch も解析したか／perchOnly：findPerchOnly の結果
//    checked：チェックした鳥（学名）の Set／onToggle(学名)／disabled：処理中
export default function EditAnalysisList({ speciesList, perchOn, perchOnly, checked, onToggle, disabled }) {
  const bothCount = speciesList.filter((s) => s.both).length;
  return (
    <>
      <p className="mt-1 text-[10px] leading-relaxed text-inkMuted">
        {perchOn ? `BirdNET と Perch の両方が挙げた鳥（Perch の点数 ${PERCH_AGREE_LOGIT} 以上）は、緑で強調します（${bothCount}種）。` : ""}
        チェック（初期は空欄）を付けた鳥は、公開と同時に「確定」になります。
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {speciesList.map((s) => (
          <li key={s.sci}>
            <label
              className={`flex cursor-pointer items-start gap-2 rounded-xl border-2 px-2.5 py-2 text-[11px] leading-relaxed ${
                s.both ? "border-[#3E9B5F] bg-[#DDF3E4] text-[#1F5E3A]" : "border-transparent bg-page text-inkMuted"
              }`}
            >
              <input type="checkbox" checked={checked.has(s.sci)} onChange={() => onToggle(s.sci)} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className={`text-xs font-bold ${s.both ? "" : "text-ink"}`}>
                  {s.both && "✓ "}
                  {s.name}
                </span>
                {s.both && <span className="ml-1 font-bold">（両方が一致）</span>}
                <br />
                BirdNET：{s.count}件（一番高い信頼度 {Math.round(s.best * 100)}%）
                {perchOn && (
                  <>
                    <br />
                    {s.perch
                      ? `Perch：上位${s.perch.rank}位・点数 ${Number(s.perch.logit).toFixed(1)}${s.perch.logit >= PERCH_STRONG_LOGIT ? "（強い）" : s.both ? "" : "（点数が低いので、一致には数えません）"}`
                      : "Perch：上位には、いません"}
                  </>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {perchOnly.length > 0 && (
        <p className="mt-2 text-[10px] leading-relaxed text-inkMuted">
          Perch だけが強く言う鳥（BirdNET の記録には、ありません）：{perchOnly.slice(0, 5).map(([n, v]) => `${n}（${v.toFixed(1)}）`).join("、")}
        </p>
      )}
    </>
  );
}
