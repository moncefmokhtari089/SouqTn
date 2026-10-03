-- =========================================================
-- 0004 ELmarchii rebrand
-- Additive text-only rebrand; compatibility identifiers remain unchanged.
-- =========================================================

update public.payment_providers
set label = 'ELmarchii Wallet'
where code = 'wallet';

create or replace function public.notify_wallet_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  v_label := case new.type when 'deposit' then 'Dépôt' when 'purchase' then 'Achat' when 'sale_proceeds' then 'Produit de vente'
    when 'refund' then 'Remboursement' when 'withdrawal' then 'Retrait' else 'Ajustement' end;
  insert into public.notifications (user_id, title, message)
    values (new.user_id, 'ELmarchii Wallet', v_label || ' de ' || abs(new.amount) || ' TND : ' ||
      case new.status when 'pending' then 'en attente' when 'completed' then 'disponible' when 'failed' then 'échoué'
        when 'cancelled' then 'annulé' else new.status end || '.');
  return new;
end; $$;

revoke all on function public.notify_wallet_events() from public, anon, authenticated;
