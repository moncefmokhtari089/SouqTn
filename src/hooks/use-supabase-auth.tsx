import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  AVATAR_BUCKET,
  supabase,
  supabaseConfigured,
  supabaseConfigError,
} from '@/lib/supabase';
import { resolveStorageUrls } from '@/lib/supabase';
import type { SupabaseProfile } from '@/lib/supabase';

async function hydrateProfile(row: SupabaseProfile): Promise<SupabaseProfile> {
  if (!row.avatar_url) return row;
  const urls = await resolveStorageUrls(AVATAR_BUCKET, [row.avatar_url]);
  return { ...row, avatar_url: urls[row.avatar_url] ?? null };
}

type SignUpInput = {
  email: string;
  password: string;
  username: string;
  full_name: string;
  phone: string;
  location: string;
};

type ProfilePatch = Partial<
  Pick<SupabaseProfile, 'username' | 'full_name' | 'avatar_url' | 'phone' | 'location' | 'bio'>
>;

type SupabaseAuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: SupabaseProfile | null;
  loading: boolean;
  profileError: string | null;
  configured: boolean;
  configError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<boolean>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateProfile: (partial: ProfilePatch) => Promise<SupabaseProfile>;
  uploadAvatar: (file: File) => Promise<string>;
  refreshProfile: () => Promise<SupabaseProfile | null>;
};

const AuthContext = createContext<SupabaseAuthContextValue | null>(null);

function friendlyError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.toLowerCase();
  if (/invalid login credentials|invalid credentials|email or password/.test(message)) {
    return new Error('Adresse e-mail ou mot de passe incorrect.');
  }
  if (/invalid email|email address is invalid|unable to validate email/.test(message)) {
    return new Error('Veuillez saisir une adresse e-mail valide.');
  }
  if (/profiles_username_key|username.*already|duplicate key.*username/.test(message)) {
    return new Error('Ce nom d’utilisateur est déjà pris.');
  }
  if (/already registered|user already exists|email.*already|duplicate key/.test(message)) {
    return new Error('Un compte existe déjà avec cette adresse e-mail.');
  }
  if (/known to be weak|easy to guess|pwned/.test(message)) {
    return new Error('Ce mot de passe est trop courant. Choisissez-en un plus original.');
  }
  if (/weak password|password.*(at least|too short)|should be at least/.test(message)) {
    return new Error('Choisissez un mot de passe plus sûr (au moins 6 caractères).');
  }
  if (/profiles.*(does not exist|schema cache)|relation .*profiles.*does not exist|could not find the .*profiles/.test(message)) {
    return new Error('La table des profils est introuvable. Appliquez la migration Supabase indiquée dans supabase/README.md.');
  }
  if (/fetch failed|failed to fetch|network|load failed|connection/.test(message)) {
    return new Error('Connexion impossible. Vérifiez votre réseau et réessayez.');
  }
  return new Error(raw || 'Une erreur est survenue. Veuillez réessayer.');
}

function requireClient() {
  if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase est indisponible.');
  return supabase;
}

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<SupabaseProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const profileRequests = useRef(new Map<string, Promise<SupabaseProfile>>());

  const fetchProfile = useCallback(async (user: User): Promise<SupabaseProfile> => {
    const pending = profileRequests.current.get(user.id);
    if (pending) return pending;

    const request = (async () => {
      const client = requireClient();
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw friendlyError(error);
      let row = data as SupabaseProfile | null;
      if (!row) {
        // First sign-in: create the profile from the sign-up metadata.
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
        const base =
          String(meta['username'] || user.email?.split('@')[0] || 'membre')
            .trim()
            .slice(0, 40) || 'membre';
        const fullName = String(meta['full_name'] || base).trim() || base;
        for (let attempt = 0; attempt < 4 && !row; attempt++) {
          const username = attempt === 0 ? base : `${base}${Math.floor(Math.random() * 9000 + 1000)}`;
          const { data: created, error: insertError } = await client
            .from('profiles')
            .insert({
              id: user.id,
              username,
              full_name: fullName,
              phone: (meta['phone'] as string) || null,
              location: (meta['location'] as string) || null,
            })
            .select('*')
            .single();
          if (!insertError) row = created as SupabaseProfile;
          else if (!/duplicate|unique/i.test(insertError.message)) throw friendlyError(insertError);
        }
        if (!row) throw new Error('Impossible de créer votre profil. Veuillez réessayer.');
      }
      return hydrateProfile(row);
    })();
    profileRequests.current.set(user.id, request);
    try {
      return await request;
    } finally {
      if (profileRequests.current.get(user.id) === request) {
        profileRequests.current.delete(user.id);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) {
      setProfile(null);
      return null;
    }
    try {
      const nextProfile = await fetchProfile(session.user);
      setProfile(nextProfile);
      setProfileError(null);
      return nextProfile;
    } catch (error) {
      const friendly = friendlyError(error);
      setProfileError(friendly.message);
      throw friendly;
    }
  }, [fetchProfile, session]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    const syncSession = async (nextSession: Session | null) => {
      if (!active) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (!nextSession?.user) {
        setProfile(null);
        setProfileError(null);
        setLoading(false);
        return;
      }
      try {
        const nextProfile = await fetchProfile(nextSession.user);
        if (active) {
          setProfile(nextProfile);
          setProfileError(null);
        }
      } catch (error) {
        if (active) setProfileError(friendlyError(error).message);
      } finally {
        if (active) setLoading(false);
      }
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession);
    });
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return syncSession(data.session);
      })
      .catch((error: unknown) => {
        if (active) {
          setProfileError(friendlyError(error).message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await requireClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) {
      throw friendlyError(error);
    }
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    try {
      const { data, error } = await requireClient().auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            username: input.username,
            full_name: input.full_name,
            phone: input.phone,
            location: input.location,
          },
        },
      });
      if (error) throw error;
      return Boolean(data.session);
    } catch (error) {
      throw friendlyError(error);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { error } = await requireClient().auth.signOut();
      if (error) throw error;
    } catch (error) {
      throw friendlyError(error);
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const resetUrl = `${window.location.origin}/reset-password`;
    try {
      const { error } = await requireClient().auth.resetPasswordForEmail(email, {
        redirectTo: resetUrl,
      });
      if (error) throw error;
    } catch (error) {
      throw friendlyError(error);
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    try {
      const { error } = await requireClient().auth.updateUser({ password });
      if (error) throw error;
    } catch (error) {
      throw friendlyError(error);
    }
  }, []);

  const updateProfile = useCallback(
    async (partial: ProfilePatch) => {
      const currentSession = sessionRef.current;
      if (!currentSession?.user) throw new Error('Connectez-vous pour modifier votre profil.');
      try {
        const client = requireClient();
        await fetchProfile(currentSession.user);
        const { data, error } = await client
          .from('profiles')
          .update(partial as never)
          .eq('id', currentSession.user.id)
          .select('*')
          .single();
        if (error) throw error;
        const updated = await hydrateProfile(data as SupabaseProfile);
        setProfile(updated);
        setProfileError(null);
        return updated;
      } catch (error) {
        throw friendlyError(error);
      }
    },
    [fetchProfile],
  );

  const uploadAvatar = useCallback(
    async (file: File) => {
      const currentSession = sessionRef.current;
      if (!currentSession?.user) throw new Error('Connectez-vous pour ajouter une photo de profil.');
      const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      if (!(file.type in AVATAR_TYPES)) {
        throw new Error('Utilisez une photo JPEG, PNG ou WebP.');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('La photo ne doit pas dépasser 5 Mo.');
      }
      const extension = AVATAR_TYPES[file.type];
      const path = `${currentSession.user.id}/${crypto.randomUUID()}.${extension}`;
      try {
        const client = requireClient();
        const { error } = await client.storage.from(AVATAR_BUCKET).upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (error) throw error;
        return path;
      } catch (error) {
        throw friendlyError(error);
      }
    },
    [],
  );

  const value = useMemo<SupabaseAuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      profileError,
      configured: supabaseConfigured,
      configError: supabaseConfigError,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      updatePassword,
      updateProfile,
      uploadAvatar,
      refreshProfile,
    }),
    [
      session,
      profile,
      loading,
      profileError,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      updatePassword,
      updateProfile,
      uploadAvatar,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSupabaseAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useSupabaseAuth doit être utilisé dans SupabaseAuthProvider.');
  }
  return context;
}