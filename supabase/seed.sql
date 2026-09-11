-- DEVELOPMENT ONLY. Never import DEMO invitations in a production project.
begin;
insert into public.invitation_groups(id,name,slug,code,is_demo,active) values
('10000000-0000-4000-8000-000000000001','DEMO — Família Silva','demo-familia-silva-d7c82f4a916b30e58a62','D7C82F4A916B30E58A62',true,true),
('10000000-0000-4000-8000-000000000002','DEMO — Casal Oliveira','demo-casal-oliveira-a93e7062c84f15b9d620','A93E7062C84F15B9D620',true,true),
('10000000-0000-4000-8000-000000000003','DEMO — Convite inativo','demo-inativo-b41f893a620d75e9c038','B41F893A620D75E9C038',true,false)
on conflict(id) do nothing;
insert into public.guests(id,invitation_group_id,name,type) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','João Silva','adult'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Maria Silva','adult'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Pedro Silva','child'),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','Ana Oliveira','adult'),
('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','Carlos Oliveira','adult')
on conflict(id) do nothing;
-- The real private address must be configured separately. Do not fabricate one.
commit;

