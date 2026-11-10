-- =====================================================================
-- TableTap — 0002 Supabase-specific wiring
-- Run this on Supabase only (it is skipped gracefully elsewhere).
--  * points staff_profiles.user_id at auth.users
--  * auto-creates the staff profile row when an auth user is created
--  * storage bucket + policies for menu images
-- =====================================================================

do $do$
begin
  -- 1. staff_profiles.user_id -> auth.users(id)
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    begin
      alter table staff_profiles
        add constraint staff_profiles_user_fk
        foreign key (user_id) references auth.users(id) on delete cascade;
    exception when duplicate_object then null;
    end;

    -- The staff profile carries the role; Supabase auth.users holds the credential.
    -- Read it into the JWT so RLS can use auth_restaurant_id() without a query.
    begin
      create or replace function public.custom_access_token_hook(event jsonb)
      returns jsonb language plpgsql stable as $fn$
      declare
        claims jsonb;
        prof   record;
      begin
        select restaurant_id, role, full_name, is_active
          into prof from public.staff_profiles
         where user_id = (event->>'user_id')::uuid;

        claims := coalesce(event->'claims', '{}'::jsonb);
        if prof.restaurant_id is not null then
          claims := jsonb_set(claims, '{restaurant_id}', to_jsonb(prof.restaurant_id));
          claims := jsonb_set(claims, '{staff_role}', to_jsonb(prof.role));
        end if;
        return jsonb_set(event, '{claims}', claims);
      end $fn$;
    exception when others then null;
    end;
  end if;
end $do$;

-- 2. Storage bucket for menu images (compressed WebP, <= 200 KB enforced in app)
do $do$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('menu-images', 'menu-images', true, 204800,
            array['image/webp','image/jpeg','image/png'])
    on conflict (id) do update
      set public = true,
          file_size_limit = 204800,
          allowed_mime_types = array['image/webp','image/jpeg','image/png'];

    begin
      create policy "menu images are public to read"
        on storage.objects for select to anon, authenticated
        using (bucket_id = 'menu-images');
    exception when duplicate_object then null;
    end;

    begin
      create policy "staff upload menu images"
        on storage.objects for insert to authenticated
        with check (bucket_id = 'menu-images' and public.auth_restaurant_id() is not null);
    exception when duplicate_object then null;
    end;
  end if;
end $do$;
