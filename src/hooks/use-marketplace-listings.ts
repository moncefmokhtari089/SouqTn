import { useCallback, useEffect, useRef, useState } from 'react';
import { AVATAR_BUCKET, LISTING_IMAGES_BUCKET, resolveStorageUrls, supabase, supabaseConfigError } from '@/lib/supabase';

export { LISTING_IMAGES_BUCKET };
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type ListingRow = {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price: number | string;
  category: string;
  condition: string;
  location: string;
  images: string[];
  status: 'active' | 'sold' | 'archived';
  created_at: string;
  updated_at: string;
};

type PublicSellerRow = {
  id: string;
  username: string;
  full_name?: string | null;
  avatar_url: string | null;
  location?: string | null;
};

export type MarketplaceListing = ListingRow & {
  price: number;
  imageUrls: string[];
  sellerUsername: string;
  sellerAvatarUrl: string | null;
  sellerFullName: string | null;
  sellerLocation: string | null;
};

export type ListingPatch = Pick<NewListingInput, 'title' | 'description' | 'price' | 'category' | 'condition' | 'location'>;

export type NewListingInput = {
  title: string;
  description: string;
  price: number;
  category: string;
  condition: string;
  location: string;
  files: File[];
};

type SellerIdentity = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

function messageFor(error: unknown): string {
  const issue = error as { code?: string; status?: number; message?: string } | null;
  if (issue?.code === 'PGRST205') {
    return 'Le catalogue n’est pas encore configuré. Exécutez la migration marketplace dans Supabase.';
  }
  if (issue?.code === '42501' || issue?.status === 401 || issue?.status === 403) {
    return 'Accès refusé par Supabase. Vérifiez les règles RLS de la migration marketplace.';
  }
  if (issue?.status === 404 || /bucket not found/i.test(issue?.message ?? '')) {
    return 'Le stockage des photos n’est pas configuré. Exécutez la migration marketplace dans Supabase.';
  }
  return issue?.message || 'Une erreur est survenue lors de la communication avec Supabase.';
}

function validateListing(input: NewListingInput) {
  if (input.title.trim().length < 3 || input.title.trim().length > 120) {
    throw new Error('Le titre doit contenir entre 3 et 120 caractères.');
  }
  if (input.description.trim().length < 10 || input.description.trim().length > 5000) {
    throw new Error('La description doit contenir entre 10 et 5 000 caractères.');
  }
  if (!Number.isFinite(input.price) || input.price <= 0 || input.price > 999999999.999) {
    throw new Error('Saisissez un prix valide, supérieur à 0 TND.');
  }
  if (!input.category.trim() || !input.condition.trim() || !input.location.trim()) {
    throw new Error('Choisissez une catégorie, un état et une ville.');
  }
  if (input.files.length < 1 || input.files.length > MAX_IMAGES) {
    throw new Error(`Ajoutez entre 1 et ${MAX_IMAGES} photos.`);
  }
  for (const file of input.files) {
    if (!(file.type in ALLOWED_IMAGE_TYPES)) {
      throw new Error('Utilisez des photos JPEG, PNG ou WebP.');
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      throw new Error('Chaque photo doit faire moins de 5 Mo.');
    }
  }
}

function toListing(
  row: ListingRow,
  seller: PublicSellerRow | SellerIdentity | null,
  urls: Record<string, string>,
): MarketplaceListing {
  const imageUrls = row.images.map((path) => urls[path]).filter((u): u is string => Boolean(u));
  return {
    ...row,
    price: Number(row.price),
    imageUrls,
    sellerUsername: seller?.username || 'Vendeur',
    sellerAvatarUrl: seller
      ? 'avatar_url' in seller
        ? seller.avatar_url
        : seller.avatarUrl
      : null,
    sellerFullName: seller && 'full_name' in seller ? seller.full_name ?? null : null,
    sellerLocation: seller && 'location' in seller ? seller.location ?? null : null,
  };
}

export function useMarketplaceListings(sellerIdentity: SellerIdentity | null) {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const request = useRef<Promise<void> | null>(null);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setError(supabaseConfigError || 'Supabase n’est pas configuré.');
      setLoading(false);
      loaded.current = true;
      return;
    }
    if (request.current) return request.current;

    const pending = (async () => {
      if (!loaded.current) setLoading(true);
      const startingRevision = revision.current;
      const { data, error: listingError } = await supabase
        .from('listings')
        .select('id,seller_id,title,description,price,category,condition,location,images,status,created_at,updated_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (listingError) throw listingError;

      const rows = (data ?? []) as ListingRow[];
      const sellerIds = [...new Set(rows.map((row) => row.seller_id))];
      let sellers: PublicSellerRow[] = [];
      if (sellerIds.length) {
        const { data: sellerData, error: sellerError } = await supabase.rpc('get_public_profiles', {
          profile_ids: sellerIds,
        });
        if (sellerError) throw sellerError;
        sellers = (sellerData ?? []) as PublicSellerRow[];
        const avatarPaths = sellers.map((s) => s.avatar_url).filter((p): p is string => Boolean(p));
        if (avatarPaths.length) {
          const avatarUrls = await resolveStorageUrls(AVATAR_BUCKET, avatarPaths);
          sellers = sellers.map((s) => ({ ...s, avatar_url: s.avatar_url ? avatarUrls[s.avatar_url] ?? null : null }));
        }
      }
      const urls = await resolveStorageUrls(LISTING_IMAGES_BUCKET, rows.flatMap((row) => row.images));

      const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));
      if (startingRevision === revision.current) {
        setListings(rows.map((row) => toListing(row, sellerById.get(row.seller_id) ?? null, urls)));
      }
      setError(null);
    })();
    request.current = pending;
    try {
      await pending;
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      loaded.current = true;
      setLoading(false);
      request.current = null;
    }
  }, []);

  const createListing = useCallback(
    async (input: NewListingInput) => {
      validateListing(input);
      if (!supabase) throw new Error(supabaseConfigError || 'Supabase n’est pas configuré.');
      if (!sellerIdentity?.id) throw new Error('Connectez-vous pour publier une annonce.');

      const title = input.title.trim();
      const description = input.description.trim();
      const uploadedPaths: string[] = [];
      const listingId = crypto.randomUUID();
      try {
        for (const file of input.files) {
          const extension = ALLOWED_IMAGE_TYPES[file.type];
          const path = `${sellerIdentity.id}/${listingId}/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from(LISTING_IMAGES_BUCKET)
            .upload(path, file, {
              cacheControl: '3600',
              contentType: file.type,
              upsert: false,
            });
          if (uploadError) throw uploadError;
          uploadedPaths.push(path);
        }

        const { data, error: insertError } = await supabase
          .from('listings')
          .insert({
            id: listingId,
            seller_id: sellerIdentity.id,
            title,
            description,
            price: input.price,
            category: input.category,
            condition: input.condition,
            location: input.location,
            images: uploadedPaths,
            status: 'active',
          })
          .select('id,seller_id,title,description,price,category,condition,location,images,status,created_at,updated_at')
          .single();
        if (insertError) throw insertError;

        const created = data as ListingRow;
        const urls = await resolveStorageUrls(LISTING_IMAGES_BUCKET, created.images);
        const listing = toListing(created, sellerIdentity, urls);
        revision.current += 1;
        setListings((current) =>
          [listing, ...current.filter((item) => item.id !== listing.id)].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          ),
        );
        setError(null);
        return listing;
      } catch (createError) {
        if (uploadedPaths.length) {
          const { error: cleanupError } = await supabase.storage
            .from(LISTING_IMAGES_BUCKET)
            .remove(uploadedPaths);
          if (cleanupError) {
            throw new Error(`${messageFor(createError)} Les photos temporaires n’ont pas pu être supprimées.`);
          }
        }
        throw new Error(messageFor(createError));
      }
    },
    [sellerIdentity?.id, sellerIdentity?.username, sellerIdentity?.avatarUrl],
  );

  const updateListing = useCallback(
    async (id: string, patch: ListingPatch) => {
      validateListing({ ...patch, files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] });
      if (!sellerIdentity?.id) throw new Error('Connectez-vous pour modifier une annonce.');
      const { data, error: updateError } = await supabase
        .from('listings')
        .update({ ...patch, title: patch.title.trim(), description: patch.description.trim() })
        .eq('id', id)
        .eq('seller_id', sellerIdentity.id)
        .select('id,seller_id,title,description,price,category,condition,location,images,status,created_at,updated_at')
        .single();
      if (updateError) throw new Error(messageFor(updateError));
      const row = data as ListingRow;
      revision.current += 1;
      setListings((current) =>
        current.map((item) =>
          item.id === id ? { ...item, ...row, price: Number(row.price), imageUrls: item.imageUrls } : item,
        ),
      );
    },
    [sellerIdentity?.id],
  );

  const deleteListing = useCallback(
    async (id: string) => {
      if (!sellerIdentity?.id) throw new Error('Connectez-vous pour supprimer une annonce.');
      const existing = listings.find((item) => item.id === id);
      const { error: deleteError } = await supabase
        .from('listings')
        .delete()
        .eq('id', id)
        .eq('seller_id', sellerIdentity.id);
      if (deleteError) throw new Error(messageFor(deleteError));
      revision.current += 1;
      setListings((current) => current.filter((item) => item.id !== id));
      if (existing?.images.length) {
        await supabase.storage.from(LISTING_IMAGES_BUCKET).remove(existing.images);
      }
    },
    [listings, sellerIdentity?.id],
  );

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  return { listings, loading, error, refresh, createListing, updateListing, deleteListing };
}