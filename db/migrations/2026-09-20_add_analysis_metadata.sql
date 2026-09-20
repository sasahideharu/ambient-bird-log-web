-- 記録（detections）に、「どのモデルが・いつ・どんな設定で解析したか」を残す列を足す（サーバー解析用）
--
-- 目的：解析エンジン（BirdNET・将来の Perch など）を差し替えても、各記録が「どの結果か」を後から見分けられるようにする。
--   ライセンス（BirdNET のモデルは非営利のみ）の切り分けにも使う。
-- 既存の記録：これらの列は空（NULL）のまま。＝「BirdNET の画面（Mac）で解析して、CSV で取り込んだもの」
-- 変わらないもの：既存の列・既存の記録・読み取りの権限（ログインなしの人は、新しい列を読めない）。
--   Streamlit の書き込み（service_role）は、そのまま動く。
-- 書き込み：先に作った「管理者だけが書ける」行の制限（detections_admin_insert／update）がそのまま効く。
--   列ごとの権限だけ、新しい列の分を足す。
--
-- 元に戻す：ファイルの末尾の「ロールバック」を参照

alter table public.detections
  add column model_name text,          -- 例：BirdNET
  add column model_version text,       -- 例：2.4
  add column analyzed_at timestamptz,  -- 解析した日時
  add column analysis_params jsonb;    -- 解析の設定（信頼度の下限・場所／時期の絞り込みなど）

-- ログイン中の管理者が、記録を登録・上書きするときに、これらの列も書けるようにする
grant insert (model_name, model_version, analyzed_at, analysis_params) on public.detections to authenticated;
grant update (model_name, model_version, analyzed_at, analysis_params) on public.detections to authenticated;

-- ---------- ロールバック（元に戻す場合） ----------
-- revoke insert (model_name, model_version, analyzed_at, analysis_params) on public.detections from authenticated;
-- revoke update (model_name, model_version, analyzed_at, analysis_params) on public.detections from authenticated;
-- alter table public.detections drop column model_name, drop column model_version, drop column analyzed_at, drop column analysis_params;
