import { supabase as client } from "@/integrations/supabase/client";

export const supabase = client;
export const supabaseConfigured = true;
export const supabaseConfigError: string | null = null;

export const AVATAR_BUCKET = "souqtn-avatars";
export const LISTING_IMAGES_BUCKET = "souqtn-listings";

const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

export type SupabaseProfile = {
  id: string;
  username: string;
  full_name: string;
  /** Storage path (or legacy absolute URL) of the avatar. */
  avatar_url: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  created_at: string;
};

const urlCache = new Map<string, { url: string; expires: number }>();

/**
 * Photos live in private buckets readable by everyone through a storage policy.
 * Resolve stored paths into signed URLs (batched, cached).
 */
export async function resolveStorageUrls(bucket: string, paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const now = Date.now();
  const missing: string[] = [];
  for (const path of new Set(paths)) {
    if (!path) continue;
    if (/^https?:\/\//i.test(path)) {
      result[path] = path;
      continue;
    }
    const cached = urlCache.get(`${bucket}/${path}`);
    if (cached && cached.expires > now) result[path] = cached.url;
    else missing.push(path);
  }
  if (missing.length) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, SIGNED_URL_TTL);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        result[item.path] = item.signedUrl;
        urlCache.set(`${bucket}/${item.path}`, { url: item.signedUrl, expires: now + (SIGNED_URL_TTL - 3600) * 1000 });
      }
    }
  }
  return result;
}
