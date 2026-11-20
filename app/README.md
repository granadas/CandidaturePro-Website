# Candidature Pro Web

L’espace candidat est servi sur https://candidaturepro.ch/app/. Le domaine `www` est redirigé vers cette adresse. La page publique présente le service ; les outils et le téléchargement Windows apparaissent après connexion.

## Parcours disponibles

- Inscription web gratuite par e-mail et mot de passe, confirmation PKCE et renvoi du message. Aucun compte n’est considéré connecté avant confirmation lorsque celle-ci est requise. Un lien ouvert dans un autre navigateur invite à se connecter avec ses identifiants. Aucun mot de passe n’est enregistré dans le stockage local.
- Connexion Supabase, profil candidat et formule avec quota partagé. L’identité (prénom, nom, e-mail) est verrouillée lors de sa première confirmation ; téléphone, ville, métiers, compétences et langues restent modifiables. Une correction d’identité passe par une demande et une décision administrateur journalisée.
- Entreprises suisses, offres d’emploi, création et préparation des candidatures.
- CV avec trois modèles, photo facultative JPG/PNG redimensionnée localement, variantes enregistrées et adaptation des compétences à une offre. Les variantes sont chargées individuellement pour éviter de télécharger toutes les photos à l’ouverture du menu. Export Word DOCX modifiable local, avec photo intégrée et styles correspondant au modèle choisi ; le modèle classique reste accessible sans Premium. L’export n’enregistre pas automatiquement la variante.
- Analyse indicative des CV du formulaire et historique privé des 30 derniers scores affichés ; Premium requis pour créer une analyse. Le calcul local ne consomme pas de crédit IA.
- Bibliothèque PDF privée : CV, lettres, certificats, attestations, diplômes et autres justificatifs. Aperçu, téléchargement et suppression. Retrait individuel des PDF sélectionnés depuis la bibliothèque avant le contrôle final.
- Génération de lettres, contrôle final et envoi Gmail ou Outlook individuel ou groupé. Au maximum huit PDF et 10 Mo cumulés par message ; validation identique dans le navigateur et sur le serveur.
- Connexion Outlook web avec autorisation Microsoft minimale pour lire et envoyer les messages ; envoi individuel et suivi automatique des réponses dans la même vue que Gmail. Les identifiants de renouvellement sont stockés dans une table privée accessible uniquement au service serveur. La configuration du client Microsoft et du retour OAuth web est requise avant activation.
- Synchronisation des réponses, lecture des fils Gmail avec expéditeur/objet/date, rédaction et proposition IA de réponses. Les brouillons de réponse restent dans le même onglet après fermeture du message ; les demandes d’envoi interrompues gardent leur identifiant et leur texte. La déconnexion efface ces brouillons.
- Suivi des statuts, notes, réponses non lues et dates de relance.
- Préparation d’entretien générée à la demande pour les candidatures au statut « Entretien », avec le poste, la ville, le profil et la dernière variante de CV enregistrée. Les informations complémentaires de l’utilisateur sont facultatives ; la préparation s’affiche dans la page.
- Relances sélectionnées avec proposition IA à insérer après relecture ; brouillons et identifiants d’envoi conservés dans l’onglet jusqu’à l’envoi ou la déconnexion.
- Préparation d’un nouvel envoi depuis le suivi : copie en brouillon, conservation de l’ancien envoi et réutilisation d’un renvoi déjà en attente.
- Support et administration des contacts, vérifications, adresses invalides, liste noire, utilisateurs, crédits et actualisation des offres. Statistiques d’usage communes à Windows, crédits filtrés par mois UTC ou tout l’historique, recherche des comptes par e-mail. Présence estimée parmi les 100 comptes les plus récents : activité de moins de deux minutes, affichage actualisé toutes les 30 secondes. Un onglet web visible signale son activité au maximum une fois par minute entre les onglets d’un même navigateur ; aucun signalement lorsque l’onglet est masqué.
- Pages « Mon compte », « Mises à jour » et « À propos ». La page Mon compte montre le statut Premium et le quota mensuel ; les mises à jour indiquent la dernière version Windows publiée. Les administrateurs peuvent enregistrer les métadonnées d’une version via `admin_save_app_release` après avoir publié l’installateur. L’authentification web utilise les RPC partagés de session active Windows ; une autre connexion remplace cette session, avec vérification périodique côté navigateur.
- Les paramètres web incluent un diagnostic du navigateur, la sauvegarde ZIP et la restauration additive des dossiers, CV et PDF.

- Mot de passe oublié par lien e-mail PKCE dans le même navigateur, disponible aussi depuis les paramètres sans déconnexion ; modification depuis Mon compte avec confirmation du nouveau mot de passe. Aucun changement automatique des identifiants.
- Sauvegarde ZIP des dossiers, variantes de CV et PDF privés (100 Mo maximum), contrôle d’intégrité CRC et appartenance au compte. Restauration des éléments manquants seulement, sans écraser les éléments existants, modifier l’identité ou les droits, ni importer de jetons Gmail. Les liens de fils Gmail des dossiers supprimés ne sont pas recréés.

## Configuration

Configuration Auth vérifiée le 18 novembre 2026 : URL principale `https://candidaturepro.ch/app/` et quatre retours exacts (production et préversion, avec et sans `?recuperation=1`). Pour une nouvelle installation, autoriser `https://candidaturepro.ch/app/?recuperation=1` (et l’URL équivalente de préversion) pour le retour des liens de récupération. La livraison réelle du lien et le changement du mot de passe nécessitent une validation par le titulaire du compte.

`config.js` contient uniquement l’URL Supabase et une clé publique. Les clés privées, la clé de service et les secrets OAuth restent côté serveur.

Le client OAuth Google est de type Application Web avec Gmail API activée. Autoriser exactement `https://candidaturepro.ch/app/` et l’URI de préversion configurée. Les secrets serveur sont `GMAIL_WEB_CLIENT_ID`, `GMAIL_WEB_CLIENT_SECRET` et `GMAIL_WEB_REDIRECT_URI`.

Pour Outlook web, l’Edge Function réutilise le client public Microsoft déjà fourni par `MAIL_PROVIDER_B_CLIENT_ID` ou `mail-oauth-config`. L’application Entra doit autoriser `https://candidaturepro.ch/app/` comme URI SPA avec PKCE. `OUTLOOK_WEB_REDIRECT_URI` est utile seulement pour une préversion. Les permissions déléguées demandées sont `Mail.Read`, `Mail.Send` et `offline_access` ; aucun secret client n’est conservé dans le code.

La fonction `gmail-web` vérifie l’utilisateur, l’origine et l’appartenance des dossiers avant les opérations Gmail. Les envois initiaux et les réponses/relances disposent de réservations pour éviter de renvoyer automatiquement un message dont le résultat est incertain. Vérifier Gmail lorsqu’un envoi reste incertain.

La fonction `generate-interview-prep` est déployée avec la vérification JWT activée et utilise le secret serveur `GEMINI_API_KEY`. Son code source est conservé dans `supabase/functions/generate-interview-prep/`.

## Limites de validation

Les vérifications automatisées locales couvrent les calculs, validations, sélections et interruptions simulées. Elles ne remplacent pas une validation finale dans un navigateur connecté, avec de vrais PDF et le compte Gmail du candidat. L’analyse CV porte sur les champs du formulaire. L’import PDF extrait le texte localement avec PDF.js 6.5.438 (licence Apache 2.0 incluse), puis permet de relire et ajouter les passages aux rubriques. Aucun OCR des scans ; limites de 10 Mo, 20 pages, 30 000 caractères et 30 secondes. Les mises en page à colonnes peuvent nécessiter des corrections. Aucun CV importé pour lecture n’est automatiquement téléversé ou enregistré. Les fichiers DOCX et TXT UTF-8/UTF-16 sont également lus localement (DOCX : texte principal, XML de 2 Mo maximum, intégrité ZIP vérifiée ; aucun accès aux liens externes ni exécution des macros). Une détection des rubriques françaises, anglaises et portugaises propose les paragraphes à relire et à ajouter au formulaire sans écraser les champs existants. La répartition est indicative, le nom et les coordonnées ne sont pas déduits automatiquement. Les anciens formats DOC et les scans OCR ne sont pas pris en charge.
