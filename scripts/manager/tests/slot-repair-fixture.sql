create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.role() returns text language sql as $$select 'service_role'::text$$;
create table tour_manager_events(event_key text primary key);
create table tour_manager_event_players(event_key text, player_key text, name_zh text, name_en text,
 draw_position int, profile_id text, photo_url text, is_qualifier_placeholder boolean, price int, source jsonb default '{}');
create table tour_manager_lineups(id uuid primary key,user_id uuid,season int,station_key text,status text,
 village_hope_player_key text,village_hope_player_name text);
create table tour_manager_lineup_players(id uuid primary key,lineup_id uuid,event_key text,player_key text,
 name_zh text,name_en text,price int,earned_points int,reached_round text,metadata jsonb);
create table tour_manager_wallets(user_id uuid,season int,balance int check(balance>=0),updated_at timestamptz);
create table tour_manager_settlements(id uuid primary key,contract_id uuid,player_key text,points_delta int,is_final boolean,source jsonb);
create table tour_manager_wallet_ledger(id uuid default gen_random_uuid(),user_id uuid,season int,station_key text,
 lineup_id uuid,type text,amount int,balance_after int,description text,metadata jsonb);
insert into tour_manager_events values ('wta-2026-w42-wuhan');
insert into tour_manager_event_players(event_key,player_key,name_zh,name_en,draw_position,profile_id,photo_url,is_qualifier_placeholder,price) values
 ('wta-2026-w42-wuhan','WTA|iva-jovic','约维奇','Iva JOVIC',17,'332285','jovic.jpg',false,345),
 ('wta-2026-w42-wuhan','WTA|anna-bondar','邦达尔','Anna BONDAR',25,'322942','bondar.jpg',false,275);
insert into tour_manager_lineups values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',2026,'2026-w42-wuhan','settling','WTA|mirra-andreeva','米拉');
insert into tour_manager_lineup_players values
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','wta-2026-w42-wuhan','WTA|anna-bondar','邦达尔','Anna BONDAR',345,10,'R64','{"player_key":"WTA|mirra-andreeva","draw_position":17,"is_village_hope":true}'),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','wta-2026-w42-wuhan','WTA|anna-bondar','邦达尔','Anna BONDAR',275,10,'R64','{"player_key":"WTA|iva-jovic","draw_position":25}');
insert into tour_manager_wallets values ('00000000-0000-0000-0000-000000000002',2026,320,now());
insert into tour_manager_settlements values
 ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','WTA|anna-bondar',10,true,'{"match_key":"wta-2026-w42-wuhan:LS044"}');
insert into tour_manager_wallet_ledger(lineup_id,type,amount,metadata) values
 ('00000000-0000-0000-0000-000000000001','lineup_wallet_spend',-100,'{"players":[{"player_key":"WTA|mirra-andreeva","price":345}]}');
