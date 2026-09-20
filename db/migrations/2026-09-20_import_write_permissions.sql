-- 新しい「データ登録」画面（/import）から書き込めるようにする（管理者だけ）
--
-- 今まで：記録（detections）・鳥の写真（bird_master）・音声と写真の保管場所への書き込みは、
--   Streamlit の管理者用の鍵だけができた。新しいアプリは、ログイン中の人の権限で書くため、
--   「管理者名簿にいる人だけ」に、書き込みを許す設定を足す。
-- 変わらないもの：読み取りの権限、Streamlit の書き込み（service_role の権限は別）、ログインなしの人が見られる範囲。
-- 消す権限（DELETE）は、どこにも足さない（画面からは、記録も音声も写真も消せない）。
--
-- 管理者の登録（メールアドレスなどをリポジトリに書かないため、この手順書には含めない）：
--   insert into public.app_admins (user_id) values ('<管理者のユーザーID>');
--
-- 元に戻す：ファイルの末尾の「ロールバック」を参照

-- ---------- 管理者名簿 ----------
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- 自分の行だけ読める（「自分が管理者か」の判定に使う）。名簿を書き換える権限は、誰にも渡さない
create policy app_admins_read_own on public.app_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.app_admins from anon, authenticated;
grant select on table public.app_admins to authenticated;

-- ---------- 記録（detections）：管理者だけが、登録・上書きできる ----------
-- 書ける列は、データ登録に必要なものだけ（id・登録日時は自動で入る）
grant insert (wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, location_name, latitude, longitude)
  on public.detections to authenticated;
grant update (wav_filename, start_sec, end_sec, scientific_name, common_name, confidence, location_name, latitude, longitude)
  on public.detections to authenticated;

create policy detections_admin_insert on public.detections
  for insert to authenticated
  with check (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

create policy detections_admin_update on public.detections
  for update to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

-- ---------- 鳥の写真の登録（bird_master）：管理者だけ ----------
grant insert (common_name, image_url) on public.bird_master to authenticated;
grant update (common_name, image_url) on public.bird_master to authenticated;

create policy bird_master_admin_insert on public.bird_master
  for insert to authenticated
  with check (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

create policy bird_master_admin_update on public.bird_master
  for update to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.app_admins a where a.user_id = (select auth.uid())));

-- ---------- 音声（bird-wav）と写真（bird-images）の保管場所：管理者だけがアップロードできる ----------
-- 上書き保存（同じ名前のファイルを置き換える）には、読む・書く・更新の3つの権限が必要
create policy storage_admin_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('bird-wav', 'bird-images')
    and exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
  );

create policy storage_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('bird-wav', 'bird-images')
    and exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
  );

create policy storage_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('bird-wav', 'bird-images')
    and exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
  )
  with check (
    bucket_id in ('bird-wav', 'bird-images')
    and exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
  );

-- ---------- ロールバック（元に戻す場合に、この順で実行） ----------
-- drop policy storage_admin_update on storage.objects;
-- drop policy storage_admin_insert on storage.objects;
-- drop policy storage_admin_select on storage.objects;
-- drop policy bird_master_admin_update on public.bird_master;
-- drop policy bird_master_admin_insert on public.bird_master;
-- revoke insert, update on public.bird_master from authenticated;
-- drop policy detections_admin_update on public.detections;
-- drop policy detections_admin_insert on public.detections;
-- revoke insert, update on public.detections from authenticated;
-- drop table public.app_admins;
