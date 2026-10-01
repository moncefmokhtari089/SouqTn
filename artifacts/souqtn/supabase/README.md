# Configuration Supabase — SouqTN

1. Dans le tableau de bord Supabase, ouvrez **SQL Editor**, collez puis exécutez `migrations/20261001000000_souqtn_profiles.sql`.
2. Configurez l’URL du site dans **Authentication → URL Configuration**. Ajoutez l’URL de l’application et sa route `reset-password` aux URL de redirection autorisées (par exemple `https://votre-domaine/reset-password`, avec le préfixe de base de l’application si nécessaire). Activez la confirmation d’e-mail si souhaité.
3. Configurez uniquement `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans l’application. Aucune clé `service_role` n’est nécessaire côté client.

Les images d’avatar sont servies publiquement depuis le bucket `souqtn-avatars`. La table `profiles`, notamment les numéros de téléphone et les autres informations de profil, reste réservée à son propriétaire grâce aux politiques RLS.