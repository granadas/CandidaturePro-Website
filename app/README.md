# Candidature Pro Web — fondation

Première étape de la version web, isolée de la page commerciale.

## Contenu

- interface responsive desktop/mobile ;
- navigation principale alignée avec l'application Windows ;
- tableau de bord initial ;
- formulaire de connexion compatible avec Supabase Auth par e-mail/mot de passe ;
- configuration publique séparée dans `config.js`.

## Activation de la connexion

Le projet Supabase doit être actif. Renseigner uniquement une clé **publishable** dans `config.js`.

Ne jamais placer une clé `service_role`, un secret OAuth Gmail ou une clé privée dans ce dépôt public.

## Étapes suivantes

1. connecter les données du profil ;
2. inventorier les tables/RPC existantes et leurs politiques RLS ;
3. connecter Entreprises et Candidatures en lecture ;
4. ajouter les opérations d'écriture après contrôle RLS ;
5. intégrer Gmail via une fonction serveur dédiée.
