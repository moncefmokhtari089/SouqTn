import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, resolveStorageUrls, AVATAR_BUCKET } from '@/lib/supabase';
import type { Database } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
export type OrderRow = Tables['orders']['Row'] & { order_items: Tables['order_items']['Row'][] };
export type WalletTx = Tables['wallet_transactions']['Row'];
export type PaymentTx = Tables['transactions']['Row'];
export type MessageRow = Tables['messages']['Row'];
export type PaymentProvider = Tables['payment_providers']['Row'];
export type PublicPerson = { id: string; username: string; full_name: string; avatar_url: string | null; location: string | null };
export type ConversationView = Tables['conversations']['Row'] & { other: PublicPerson | null; unread: number };

function friendly(error: { message?: string } | null | undefined, fallback: string) {
  const msg = error?.message ?? '';
  // Our database functions raise French, user-facing messages.
  if (msg && /[éèàçù]|Connexion|Commande|Annonce|Solde|Montant|Vous|Profil|Moyen|Paiement|Accès|Requête|Changement|Expédiez|Transaction|disponible/.test(msg)) return msg;
  return fallback;
}

export async function fetchPublicPeople(ids: string[]): Promise<Record<string, PublicPerson>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabase.rpc('get_public_profiles', { profile_ids: unique });
  const rows = (data ?? []) as PublicPerson[];
  const urls = await resolveStorageUrls(AVATAR_BUCKET, rows.map((r) => r.avatar_url ?? '').filter(Boolean));
  return Object.fromEntries(rows.map((r) => [r.id, { ...r, avatar_url: r.avatar_url ? urls[r.avatar_url] ?? null : null }]));
}

/* ----------------------------- Messaging ----------------------------- */

export function useConversations(userId: string | null | undefined) {
  const [items, setItems] = useState<ConversationView[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const [{ data: convs }, { data: unread }] = await Promise.all([
      supabase.from('conversations').select('*').order('last_message_at', { ascending: false }).limit(100),
      supabase.from('messages').select('conversation_id').is('read_at', null).neq('sender_id', userId).limit(1000),
    ]);
    const rows = convs ?? [];
    const people = await fetchPublicPeople(rows.map((c) => (c.buyer_id === userId ? c.seller_id : c.buyer_id)));
    const counts: Record<string, number> = {};
    for (const m of unread ?? []) counts[m.conversation_id] = (counts[m.conversation_id] ?? 0) + 1;
    setItems(
      rows.map((c) => ({
        ...c,
        other: people[c.buyer_id === userId ? c.seller_id : c.buyer_id] ?? null,
        unread: counts[c.id] ?? 0,
      })),
    );
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const channel = supabase
      .channel(`inbox-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const start = useCallback(async (listingId: string) => {
    const { data, error } = await supabase.rpc('start_conversation', { p_listing_id: listingId });
    if (error || !data) throw new Error(friendly(error, 'Impossible d’ouvrir la conversation.'));
    await refresh();
    return data as string;
  }, [refresh]);

  return { items, loading, refresh, start, unread: items.reduce((n, c) => n + c.unread, 0) };
}

export function useThread(conversationId: string | null, userId: string | null | undefined, onRead?: () => void) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
    onReadRef.current?.();
  }, [conversationId]);

  useEffect(() => {
    setMessages([]);
    if (!conversationId || !userId) return;
    let active = true;
    void supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        setMessages(data ?? []);
        void markRead();
      });
    const channel = supabase
      .channel(`thread-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as MessageRow;
          setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]));
          if (row.sender_id !== userId) void markRead();
        },
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, userId, markRead]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!conversationId || !userId || !text) return;
      if (text.length > 2000) throw new Error('Message trop long (2000 caractères max).');
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: conversationId, sender_id: userId, body: text })
        .select('*')
        .single();
      if (error) throw new Error('Impossible d’envoyer le message.');
      setMessages((cur) => (cur.some((m) => m.id === data.id) ? cur : [...cur, data]));
    },
    [conversationId, userId],
  );

  return { messages, send };
}

/* ------------------------------ Orders ------------------------------- */

export function useOrders(userId: string | null | undefined) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [providers, setProviders] = useState<PaymentProvider[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setOrders([]);
      return;
    }
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false })
      .limit(100);
    setOrders((data ?? []) as OrderRow[]);
  }, [userId]);

  useEffect(() => {
    void supabase.from('payment_providers').select('*').then(({ data }) => setProviders(data ?? []));
  }, []);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const channel = supabase
      .channel(`orders-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const createOrder = useCallback(
    async (input: {
      listingId: string;
      method: string;
      name: string;
      phone: string;
      address: string;
      city: string;
      notes: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await supabase.rpc('create_order', {
        p_listing_id: input.listingId,
        p_payment_method: input.method,
        p_shipping_name: input.name,
        p_shipping_phone: input.phone,
        p_shipping_address: input.address,
        p_shipping_city: input.city,
        p_notes: input.notes,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error || !data) throw new Error(friendly(error, 'Impossible de créer la commande.'));
      await refresh();
      return data as string;
    },
    [refresh],
  );

  const setStatus = useCallback(
    async (orderId: string, status: string) => {
      const { error } = await supabase.rpc('update_order_status', { p_order_id: orderId, p_status: status });
      if (error) throw new Error(friendly(error, 'Impossible de mettre à jour la commande.'));
      await refresh();
    },
    [refresh],
  );

  const confirmCod = useCallback(
    async (orderId: string) => {
      const { error } = await supabase.rpc('confirm_cod_payment', { p_order_id: orderId });
      if (error) throw new Error(friendly(error, 'Impossible de confirmer l’encaissement.'));
      await refresh();
    },
    [refresh],
  );

  return { orders, providers, refresh, createOrder, setStatus, confirmCod };
}

/* --------------------------- Wallet / payments ----------------------- */

export function useWallet(userId: string | null | undefined) {
  const [summary, setSummary] = useState<{ available: number; pending: number }>({ available: 0, pending: 0 });
  const [ledger, setLedger] = useState<WalletTx[]>([]);
  const [payments, setPayments] = useState<PaymentTx[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setLedger([]);
      setPayments([]);
      setSummary({ available: 0, pending: 0 });
      return;
    }
    const [s, l, p] = await Promise.all([
      supabase.rpc('get_wallet_summary'),
      supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    const row = (s.data as { available: number; pending: number }[] | null)?.[0];
    setSummary({ available: Number(row?.available ?? 0), pending: Number(row?.pending ?? 0) });
    setLedger(l.data ?? []);
    setPayments(p.data ?? []);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withdraw = useCallback(
    async (amount: number) => {
      const { error } = await supabase.rpc('request_withdrawal', { p_amount: amount });
      if (error) throw new Error(friendly(error, 'Impossible de demander ce retrait.'));
      await refresh();
    },
    [refresh],
  );

  return { ...summary, ledger, payments, refresh, withdraw };
}
