-- 解析用の WAV を、解析のあとで、アプリから消せるようにする（WAV の直接アップロード）
--
-- 目的：画面（ブラウザ）で 48kHz・16bit に変換した WAV を、保管場所（bird-wav）に一時的に保存して、
--       サーバー（BirdNET）に解析してもらい、解析が終わったら、その WAV を消す。
-- 制限（この権限で消せるもの）：
--   ・bird-wav の中の、名前が「英数字と . _ - ＋ .wav（小文字）」のファイルだけ
--       → 公開している MP3 と、鳥の写真（bird-images）は、消せない
--   ・管理者名簿にいる人だけ（ほかの保管場所の権限と同じ）
-- 変わらないもの：読む・保存する・上書きの権限、detections・audio_edits などの表、Streamlit
--
-- 元に戻す：ファイルの末尾の「ロールバック」を参照

create policy storage_admin_delete_wav on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bird-wav'
    and name ~ '^[A-Za-z0-9._-]+\.wav$'
    and exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
  );

-- ---------- ロールバック（元に戻す場合） ----------
-- drop policy storage_admin_delete_wav on storage.objects;
