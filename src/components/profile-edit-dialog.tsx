import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSupabaseAuth } from '@/hooks/use-supabase-auth';

type ProfileEditDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function ProfileEditDialog({ open, onClose }: ProfileEditDialogProps) {
  const { profile, updateProfile, uploadAvatar } = useSupabaseAuth();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!open) return;
    setUsername(profile?.username ?? '');
    setFullName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
    setLocation(profile?.location ?? '');
    setBio(profile?.bio ?? '');
    setPhoto(null);
    setError('');
    setSuccess('');
  }, [open, profile]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!username.trim() || !fullName.trim()) {
      setError('Le nom d’utilisateur et le nom complet sont obligatoires.');
      return;
    }
    setBusy(true);
    try {
      const fields = {
        username: username.trim(),
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        location: location.trim() || null,
        bio: bio.trim() || null,
      };
      if (photo) {
        const avatarUrl = await uploadAvatar(photo);
        await updateProfile({ ...fields, avatar_url: avatarUrl });
      } else {
        await updateProfile(fields);
      }
      setSuccess('Votre profil a bien été mis à jour.');
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La mise à jour a échoué. Veuillez réessayer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Votre espace ELmarchii</p>
            <h2 className="display text-2xl font-extrabold text-[#203b37]" id="profile-edit-title">Modifier le profil</h2>
          </div>
          <button className="icon-btn" type="button" aria-label="Fermer" onClick={onClose} disabled={busy} data-testid="button-close-profile-dialog">×</button>
        </div>

        {error && <p className="mb-4 rounded-xl bg-[#fbebe8] p-3 text-sm text-[#9b4438]" role="alert" data-testid="status-profile-error">{error}</p>}
        {success && <p className="mb-4 rounded-xl bg-[#e9f0e9] p-3 text-sm text-[#2c6658]" role="status" data-testid="status-profile-success">{success}</p>}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]">
            Nom d’utilisateur
            <input className="field" value={username} onChange={(event) => setUsername(event.target.value)} required data-testid="input-profile-username" />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]">
            Nom complet
            <input className="field" value={fullName} onChange={(event) => setFullName(event.target.value)} required data-testid="input-profile-full-name" />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]">
            Téléphone
            <input className="field" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} data-testid="input-profile-phone" />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]">
            Ville / région
            <input className="field" value={location} onChange={(event) => setLocation(event.target.value)} data-testid="input-profile-location" />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]">
            À propos
            <textarea className="field h-24 resize-y py-2" value={bio} onChange={(event) => setBio(event.target.value)} data-testid="input-profile-bio" />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold text-[#36534c]">
            Photo de profil
            <input className="block w-full rounded-xl border border-[#e2ddcf] bg-[#fbf9f3] p-2 text-sm" type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} data-testid="input-profile-avatar" />
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-quiet" type="button" onClick={onClose} disabled={busy} data-testid="button-cancel-profile">Annuler</button>
            <button className="btn-primary disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={busy} data-testid="button-save-profile">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}