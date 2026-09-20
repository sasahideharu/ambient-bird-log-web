-- 公開した編集を、取り下げる命令 unpublish_audio_edit を作る（編集機能：公開後の「編集し直す」「公開をやめる」）
--
-- 目的：編集して公開した録音（<元の名前>_e<連番>.mp3）を、あとから直せるようにする。
--   ・「公開を取り下げて、編集し直す」＝取り下げ → 直す → もう一度、書き出して公開する
--   ・「公開をやめる」＝取り下げて、そのままにする（設定は下書きに戻る。不要なら、編集画面の「この範囲を消す」で消せる）
--   どちらも、この命令（取り下げ）を使う。
-- 命令がすること（1回の処理でまとめて行う。途中で止まっても、半端な状態にならない）：
--   1. 管理者本人が、自分の、公開済みの編集だけを、取り下げられる（それ以外は、エラー）
--   2. その編集の書き出した録音（例 260711_011_Tr1_e1.mp3）の、記録（detections）を消す
--   3. 同じ録音の、Perch の意見（model_opinions）を消す（音が変わるので、古い意見は使えない）
--   4. audio_edits の公開日時（published_at）を空にする → 直す・消すことが、できる状態に戻る
-- 消さないもの：元の録音の記録・他の編集の記録・確認（verifications：確定・修正）・保管場所の録音ファイル
--   （確認は残す。同じ範囲・同じ鳥の記録が、再公開で出れば、その確認が引き継がれる）
-- なぜ命令か：記録（detections）は、アプリ（ログイン中の管理者）からは、消せない設計（削除の権限が無い）。
--   この命令だけが、「名前が _e連番.mp3 の記録」を、本人の取り下げのときだけ、消せる。
--
-- 元に戻す：ファイルの末尾の「ロールバック」を参照

create or replace function public.unpublish_audio_edit(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_detections integer;
  v_opinions integer;
begin
  if v_uid is null or not exists (select 1 from public.app_admins a where a.user_id = v_uid) then
    raise exception '管理者だけが、公開を取り下げられます' using errcode = '42501';
  end if;

  -- 自分の、公開済みの編集だけ（同時に、2回押されても、順番に処理する）
  select e.exported_wav_filename into v_name
    from public.audio_edits e
   where e.id = p_id and e.created_by = v_uid and e.published_at is not null
   for update;
  if not found then
    raise exception '公開済みの、自分の編集が見つかりません' using errcode = 'P0002';
  end if;
  -- 消すのは、編集で書き出した録音（名前が _e連番.mp3）の記録だけ
  if v_name is null or v_name !~ '^[A-Za-z0-9._-]+_e[0-9]+\.mp3$' then
    raise exception '書き出した録音の名前が正しくないため、取り下げできません' using errcode = '22023';
  end if;

  delete from public.detections where wav_filename = v_name;
  get diagnostics v_detections = row_count;

  delete from public.model_opinions where wav_filename = v_name;
  get diagnostics v_opinions = row_count;

  update public.audio_edits set published_at = null, updated_at = now() where id = p_id;

  return jsonb_build_object('name', v_name, 'detections_deleted', v_detections, 'opinions_deleted', v_opinions);
end;
$$;

-- 呼べるのは、ログイン中の人だけ（中で、管理者・本人かを、確かめる）
revoke all on function public.unpublish_audio_edit(bigint) from public, anon, authenticated;
grant execute on function public.unpublish_audio_edit(bigint) to authenticated;

-- ---------- ロールバック（元に戻す場合） ----------
-- drop function public.unpublish_audio_edit(bigint);
