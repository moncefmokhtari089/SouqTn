import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useSupabaseAuth } from '@/hooks/use-supabase-auth';

export type AuthPageMode = 'login' | 'register' | 'forgot-password' | 'reset-password';

type AuthPageProps = { mode: AuthPageMode };

function Field({
  label,
  name,
  type = 'text',
  required = false,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]" htmlFor={name}>
      {label}
      <input
        className="field"
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        autoComplete={autoComplete}
        data-testid={`input-${name}`}
      />
    </label>
  );
}

export function AuthPage({ mode }: AuthPageProps) {
  const auth = useSupabaseAuth();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot-password';
  const isReset = mode === 'reset-password';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!email.trim() && !isReset) {
      setError('Veuillez saisir votre adresse e-mail.');
      return;
    }
    if ((mode === 'login' || isRegister) && password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (isReset && newPassword.length < 6) {
      setError('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (isRegister && (!username.trim() || !fullName.trim())) {
      setError('Veuillez renseigner votre nom complet et votre nom d’utilisateur.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await auth.signIn(email.trim(), password);
        const requested = sessionStorage.getItem('souqtn-auth-return');
        const destination =
          requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/profile';
        sessionStorage.removeItem('souqtn-auth-return');
        navigate(destination);
      } else if (isRegister) {
        const hasSession = await auth.signUp({
          email: email.trim(),
          password,
          username: username.trim(),
          full_name: fullName.trim(),
          phone: phone.trim(),
          location: location.trim(),
        });
        if (hasSession && photo) {
          const avatarUrl = await auth.uploadAvatar(photo);
          await auth.updateProfile({ avatar_url: avatarUrl });
        }
        setSuccess(
          hasSession
            ? 'Votre compte est créé. Bienvenue sur SouqTN !'
            : 'Votre compte est prêt. Confirmez votre adresse e-mail pour terminer l’inscription. Vous pourrez ajouter votre photo depuis votre profil.',
        );
        if (hasSession) navigate('/profile');
      } else if (isForgot) {
        await auth.sendPasswordReset(email.trim());
        setSuccess('Si un compte correspond à cette adresse, un lien de réinitialisation vous sera envoyé.');
      } else {
        await auth.updatePassword(newPassword);
        setSuccess('Votre mot de passe a été mis à jour.');
        setTimeout(() => navigate('/login'), 900);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setBusy(false);
    }
  }

  const title = isRegister
    ? 'Rejoignez SouqTN'
    : isForgot
      ? 'Mot de passe oublié'
      : isReset
        ? 'Nouveau mot de passe'
        : 'Ravi de vous revoir';

  return (
    <main className="page-wrap">
      <section className="panel mx-auto w-full max-w-xl p-6 sm:p-9">
        <p className="eyebrow mb-3">{isRegister ? 'Créer un compte' : 'Espace membre'}</p>
        <h1 className="display mb-2 text-3xl font-extrabold text-[#203b37]">{title}</h1>
        <p className="mb-7 text-sm leading-6 text-[#657873]">
          {isRegister
            ? 'Créez votre compte pour découvrir le meilleur du marché tunisien.'
            : isForgot
              ? 'Saisissez votre adresse e-mail pour recevoir un lien sécurisé.'
              : isReset
                ? 'Choisissez un nouveau mot de passe pour votre compte.'
                : 'Connectez-vous pour retrouver votre espace et vos annonces.'}
        </p>

        {!auth.configured && (
          <p className="mb-5 rounded-xl bg-[#f8eee5] p-3 text-sm text-[#805335]" role="alert" data-testid="status-supabase-config">
            {auth.configError}
          </p>
        )}
        {error && <p className="mb-5 rounded-xl bg-[#fbebe8] p-3 text-sm text-[#9b4438]" role="alert" data-testid="status-auth-error">{error}</p>}
        {success && <p className="mb-5 rounded-xl bg-[#e9f0e9] p-3 text-sm text-[#2c6658]" role="status" data-testid="status-auth-success">{success}</p>}

        <form className="space-y-4" onSubmit={handleSubmit}>
          {isRegister && (
            <>
              <Field label="Nom d’utilisateur" name="username" value={username} onChange={setUsername} required autoComplete="username" />
              <Field label="Nom complet" name="full-name" value={fullName} onChange={setFullName} required autoComplete="name" />
              <Field label="Téléphone" name="phone" type="tel" value={phone} onChange={setPhone} autoComplete="tel" />
              <Field label="Ville / région" name="location" value={location} onChange={setLocation} autoComplete="address-level2" />
            </>
          )}
          {!isReset && (
            <Field label="Adresse e-mail" name="email" type="email" value={email} onChange={setEmail} required autoComplete="email" />
          )}
          {(mode === 'login' || isRegister) && (
            <Field label="Mot de passe" name="password" type="password" value={password} onChange={setPassword} required autoComplete={isRegister ? 'new-password' : 'current-password'} />
          )}
          {isReset && (
            <Field label="Nouveau mot de passe" name="new-password" type="password" value={newPassword} onChange={setNewPassword} required autoComplete="new-password" />
          )}
          {isRegister && (
            <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]" htmlFor="avatar-file">
              Photo de profil <span className="font-normal text-[#82918c]">(facultative)</span>
              <input
                className="block w-full rounded-xl border border-[#e2ddcf] bg-[#fbf9f3] p-2 text-sm"
                id="avatar-file"
                type="file"
                accept="image/*"
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                data-testid="input-avatar-file"
              />
            </label>
          )}

          <button className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={busy || !auth.configured} data-testid="button-auth-submit">
            {busy ? 'Veuillez patienter…' : isRegister ? 'Créer mon compte' : isForgot ? 'Envoyer le lien' : isReset ? 'Mettre à jour' : 'Se connecter'}
          </button>
        </form>

        <nav className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#eee8dd] pt-5 text-sm">
          {mode === 'login' && (
            <>
              <Link href="/register" className="font-bold text-[#205e52]" data-testid="link-register">Créer un compte</Link>
              <Link href="/forgot-password" className="text-[#657873] hover:text-[#205e52]" data-testid="link-forgot-password">Mot de passe oublié ?</Link>
            </>
          )}
          {isRegister && <Link href="/login" className="font-bold text-[#205e52]" data-testid="link-login">Déjà membre ? Se connecter</Link>}
          {(isForgot || isReset) && <Link href="/login" className="font-bold text-[#205e52]" data-testid="link-login">Retour à la connexion</Link>}
        </nav>
      </section>
    </main>
  );
}