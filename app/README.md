# Candidature Pro Web

L’espace candidat est servi sur https://candidaturepro.ch/app/. Le domaine `www` est redirigé vers cette adresse. La page publique présente le service ; les outils et le téléchargement Windows apparaissent après connexion.

## Parcours disponibles

- Connexion Supabase, profil candidat et formule avec quota partagé. L’identité (prénom, nom, e-mail) est verrouillée lors de sa première confirmation ; téléphone, ville, métiers, compétences et langues restent modifiables. Une correction d’identité passe par une demande et une décision administrateur journalisée.
- Entreprises suisses, offres d’emploi, création et préparation des candidatures.
- CV avec trois modèles, photo facultative JPG/PNG redimensionnée localement, variantes enregistrées et adaptation des compétences à une offre. Les variantes sont chargées individuellement pour éviter de télécharger toutes les photos à l’ouverture du menu.
- Analyse indicative des CV du formulaire et historique privé des 30 derniers scores affichés ; Premium requis pour créer une analyse. Le calcul local ne consomme pas de crédit IA.
- Bibliothèque PDF privée : CV, lettres, certificats, attestations, diplômes et autres justificatifs. Aperçu, téléchargement et suppression. Retrait individuel des PDF sélectionnés depuis la bibliothèque avant le contrôle final.
- Génération de lettres, contrôle final et envoi Gmail individuel ou groupé. Au maximum huit PDF et 10 Mo cumulés par message ; validation identique dans le navigateur et sur le serveur.
- Synchronisation des réponses, lecture des fils Gmail avec expéditeur/objet/date, rédaction et proposition IA de réponses. Les brouillons de réponse restent dans le même onglet après fermeture du message ; les demandes d’envoi interrompues gardent leur identifiant et leur texte. La déconnexion efface ces brouillons.
- Suivi des statuts, notes, réponses non lues et dates de relance.
- Relances sélectionnées avec proposition IA à insérer après relecture ; brouillons et identifiants d’envoi conservés dans l’onglet jusqu’à l’envoi ou la déconnexion.
- Préparation d’un nouvel envoi depuis le suivi : copie en brouillon, conservation de l’ancien envoi et réutilisation d’un renvoi déjà en attente.
- Support et administration des contacts, vérifications, adresses invalides, liste noire, utilisateurs, crédits et actualisation des offres.

- Mot de passe oublié par lien e-mail PKCE dans le même navigateur ; modification depuis Mon compte avec confirmation du nouveau mot de passe. Aucun changement automatique des identifiants.
- Sauvegarde ZIP des dossiers, variantes de CV et PDF privés (100 Mo maximum), contrôle d’intégrité CRC et appartenance au compte. Restauration des éléments manquants seulement, sans écraser les éléments existants, modifier l’identité ou les droits, ni importer de jetons Gmail. Les liens de fils Gmail des dossiers supprimés ne sont pas recréés.

## Configuration

Dans la configuration Auth Supabase, autoriser `https://candidaturepro.ch/app/?recuperation=1` (et l’URL équivalente de préversion) pour le retour des liens de récupération. La livraison réelle du lien et le changement du mot de passe nécessitent une validation par le titulaire du compte.

`config.js` contient uniquement l’URL Supabase et une clé publique. Les clés privées, la clé de service et les secrets OAuth restent côté serveur.

Le client OAuth Google est de type Application Web avec Gmail API activée. Autoriser exactement `https://candidaturepro.ch/app/` et l’URI de préversion configurée. Les secrets serveur sont `GMAIL_WEB_CLIENT_ID`, `GMAIL_WEB_CLIENT_SECRET` et `GMAIL_WEB_REDIRECT_URI`.

La fonction `gmail-web` vérifie l’utilisateur, l’origine et l’appartenance des dossiers avant les opérations Gmail. Les envois initiaux et les réponses/relances disposent de réservations pour éviter de renvoyer automatiquement un message dont le résultat est incertain. Vérifier Gmail lorsqu’un envoi reste incertain.

## Limites de validation

Les vérifications automatisées locales couvrent les calculs, validations, sélections et interruptions simulées. Elles ne remplacent pas une validation finale dans un navigateur connecté, avec de vrais PDF et le compte Gmail du candidat. L’analyse CV porte sur les champs du formulaire, sans extraction automatique du contenu des PDF importés.
