import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type MemberNotification = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
};

/** Favorites of the signed-in member, stored in the database. */
export function useFavorites(userId: string | null | undefined) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!userId) {
      setIds([]);
      return;
    }
    let active = true;
    void supabase
      .from('favorites')
      .select('listing_id')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (active) setIds((data ?? []).map((row) => row.listing_id));
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const toggle = useCallback(
    async (listingId: string) => {
      if (!userId) throw new Error('Connectez-vous pour gérer vos favoris.');
      const isFav = ids.includes(listingId);
      setIds((cur) => (isFav ? cur.filter((x) => x !== listingId) : [...cur, listingId]));
      const { error } = isFav
        ? await supabase.from('favorites').delete().eq('user_id', userId).eq('listing_id', listingId)
        : await supabase.from('favorites').insert({ user_id: userId, listing_id: listingId });
      if (error && !/duplicate/i.test(error.message)) {
        setIds((cur) => (isFav ? [...cur, listingId] : cur.filter((x) => x !== listingId)));
        throw new Error('Impossible de mettre à jour vos favoris.');
      }
      return !isFav;
    },
    [ids, userId],
  );

  return { ids, toggle };
}

/** Notifications of the signed-in member, stored in the database. */
export function useNotifications(userId: string | null | undefined) {
  const [items, setItems] = useState<MemberNotification[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    const { data } = await supabase
      .from('notifications')
      .select('id,title,message,read,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    setItems((data ?? []) as MemberNotification[]);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
  }, [userId]);

  return { items, unread: items.filter((n) => !n.read).length, refresh, markAllRead };
}
