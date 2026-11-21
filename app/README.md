# Candidature Pro Web

L’espace candidat est servi sur https://candidaturepro.ch/app/. Le domaine `www` est redirigé vers cette adresse. La page publique présente le service ; les outils et le téléchargement Windows apparaissent après connexion.

## Parcours disponibles

- Inscription web gratuite par e-mail et mot de passe, confirmation PKCE et renvoi du message. Aucun compte n’est considéré connecté avant confirmation lorsque celle-ci est requise. Un lien ouvert dans un autre navigateur invite à se connecter avec ses identifiants. Aucun mot de passe n’est enregistré dans le stockage local.
- Connexion Supabase, profil candidat et formule avec quota partagé. L’identité (prénom, nom, e-mail) est verrouillée lors de sa première confirmation ; téléphone, ville, métiers, compétences et langues restent modifiables. Une correction d’identité passe par une demande et une décision administrateur journalisée.
- Entreprises suisses, offres d’emploi, création et préparation des candidatures.
- CV avec trois modèles, photo facultative JPG/PNG redimensionnée localement, variantes enregistrées et adaptation des compétences à une offre. Les variantes sont chargées individuellement pour éviter de télécharger toutes les photos à l’ouverture du menu. Export Word DOCX modifiable local, avec photo intégrée et styles correspondant au modèle choisi ; le modèle classique reste accessible sans Premium. L’export n’enregistre pas automatiquement la variante.
- Analyse indicative des CV du formulaire et historique privé des 30 derniers scores affichés ; Premium requis pour créer une analyse. Le calcul local ne consomme pas de crédit IA.
- Bibliothèque PDF privée : CV, lettres, certificats, attestations, diplômes et autres justificatifs. Aperçu, téléchargement et suppression. Retrait individuel des PDF sélectionnés depuis la bibliothèque avant le contrôle final.
- Génération de lettres, contrôle final et envoi Gmail individuel ou groupé. Au maximum huit PDF et 10 Mo cumulés par message ; validation identique dans le navigateur et sur le serveur.
- Connexion et déconnexion Outlook depuis les paramètres avec retour OAuth PKCE. L'envoi des candidatures depuis le navigateur utilise encore Gmail ; Outlook n'est pas proposé comme expéditeur dans ce parcours.
- Synchronisation des réponses, lecture des fils Gmail avec expéditeur/objet/date, rédaction et proposition IA de réponses. Les brouillons de réponse restent dans le même onglet après fermeture du message ; les demandes d’envoi interrompues gardent leur identifiant et leur texte. La déconnexion efface ces brouillons.
- Suivi des statuts, notes, réponses non lues et dates de relance.
- Relances sélectionnées avec proposition IA à insérer après relecture ; brouillons et identifiants d’envoi conservés dans l’onglet jusqu’à l’envoi ou la déconnexion.
- Préparation d’un nouvel envoi depuis le suivi : copie en brouillon, conservation de l’ancien envoi et réutilisation d’un renvoi déjà en attente.
- Support et administration des contacts, vérifications, adresses invalides, liste noire, utilisateurs, crédits et actualisation des offres. Statistiques d’usage communes à Windows, crédits filtrés par mois UTC ou tout l’historique, recherche des comptes par e-mail. Présence estimée parmi les 100 comptes les plus récents : activité de moins de deux minutes, affichage actualisé toutes les 30 secondes. Un onglet web visible signale son activité au maximum une fois par minute entre les onglets d’un même navigateur ; aucun signalement lorsque l’onglet est masqué.

- Mot de passe oublié par lien e-mail PKCE dans le même navigateur, disponible aussi depuis les paramètres sans déconnexion ; modification depuis Mon compte avec confirmation du nouveau mot de passe. Aucun changement automatique des identifiants.
- Sauvegarde ZIP des dossiers, variantes de CV et PDF privés (100 Mo maximum), contrôle d’intégrité CRC et appartenance au compte. Restauration des éléments manquants seulement, sans écraser les éléments existants, modifier l’identité ou les droits, ni importer de jetons Gmail. Les liens de fils Gmail des dossiers supprimés ne sont pas recréés.

## Configuration

Configuration Auth vérifiée le 18 novembre 2026 : URL principale `https://candidaturepro.ch/app/` et quatre retours exacts (production et préversion, avec et sans `?recuperation=1`). Pour une nouvelle installation, autoriser `https://candidaturepro.ch/app/?recuperation=1` (et l’URL équivalente de préversion) pour le retour des liens de récupération. La livraison réelle du lien et le changement du mot de passe nécessitent une validation par le titulaire du compte.

`config.js` contient uniquement l’URL Supabase et une clé publique. Les clés privées, la clé de service et les secrets OAuth restent côté serveur.

Le client OAuth Google est de type Application Web avec Gmail API activée. Autoriser exactement `https://candidaturepro.ch/app/` et l’URI de préversion configurée. Les secrets serveur sont `GMAIL_WEB_CLIENT_ID`, `GMAIL_WEB_CLIENT_SECRET` et `GMAIL_WEB_REDIRECT_URI`.

La fonction `gmail-web` vérifie l’utilisateur, l’origine et l’appartenance des dossiers avant les opérations Gmail. Les envois initiaux et les réponses/relances disposent de réservations pour éviter de renvoyer automatiquement un message dont le résultat est incertain. Vérifier Gmail lorsqu’un envoi reste incertain.

Pour Outlook, enregistrer une application Microsoft avec comptes personnels et professionnels, autoriser `https://candidaturepro.ch/app/` comme URI de redirection **Web**, et déléguer `Mail.Read`, `Mail.Send` et `offline_access`. La fonction `outlook-web` lit `OUTLOOK_WEB_CLIENT_ID`, `OUTLOOK_WEB_CLIENT_SECRET` et `OUTLOOK_WEB_REDIRECT_URI` (ou les deux variantes `MAIL_PROVIDER_B_CLIENT_ID` et `MAIL_PROVIDER_B_CLIENT_SECRET` pour les identifiants). Le statut des paramètres reste « en attente de configuration » tant que ces valeurs manquent. La connexion réelle exige ensuite le consentement du titulaire du compte Microsoft.

## Limites de validation

Les vérifications automatisées locales couvrent les calculs, validations, sélections et interruptions simulées. Elles ne remplacent pas une validation finale dans un navigateur connecté, avec de vrais PDF et le compte Gmail du candidat. L’analyse CV porte sur les champs du formulaire. L’import PDF extrait le texte localement avec PDF.js 6.5.438 (licence Apache 2.0 incluse), puis permet de relire et ajouter les passages aux rubriques. Aucun OCR des scans ; limites de 10 Mo, 20 pages, 30 000 caractères et 30 secondes. Les mises en page à colonnes peuvent nécessiter des corrections. Aucun CV importé pour lecture n’est automatiquement téléversé ou enregistré. Les fichiers DOCX et TXT UTF-8/UTF-16 sont également lus localement (DOCX : texte principal, XML de 2 Mo maximum, intégrité ZIP vérifiée ; aucun accès aux liens externes ni exécution des macros). Une détection des rubriques françaises, anglaises et portugaises propose les paragraphes à relire et à ajouter au formulaire sans écraser les champs existants. La répartition est indicative, le nom et les coordonnées ne sont pas déduits automatiquement. Les anciens formats DOC et les scans OCR ne sont pas pris en charge.
