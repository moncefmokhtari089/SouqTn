import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export const AVATAR_BUCKET = 'souqtn-avatars';

export type SupabaseProfile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  created_at: string;
};

export type ProfileInput = {
  username: string;
  full_name: string;
  avatar_url?: string | null;
  phone?: string | null;
  location?: string | null;
  bio?: string | null;
};

function jwtRole(key: string): string | undefined {
  try {
    const payload = key.split('.')[1];
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized);
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed === 'object' && parsed !== null && 'role' in parsed) {
      const role = (parsed as { role?: unknown }).role;
      return typeof role === 'string' ? role : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const env = import.meta.env;
const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const hasServiceRoleKey =
  jwtRole(supabaseAnonKey) === 'service_role' ||
  /service[_ -]?role/i.test(supabaseAnonKey);
const validSupabaseUrl = /^https?:\/\/\S+$/i.test(supabaseUrl);

export const supabaseConfigured =
  Boolean(supabaseUrl && supabaseAnonKey) &&
  validSupabaseUrl &&
  !hasServiceRoleKey;

export const supabaseConfigError = hasServiceRoleKey
  ? 'La configuration Supabase contient une clé réservée au serveur. Remplacez-la par la clé publique anon.'
  : !supabaseUrl || !supabaseAnonKey
    ? 'Supabase n’est pas configuré. Ajoutez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.'
    : !validSupabaseUrl
      ? 'L’URL Supabase est invalide. Vérifiez VITE_SUPABASE_URL.'
      : null;

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;