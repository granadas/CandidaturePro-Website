import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") ?? "";

    if (!auth.startsWith("Bearer ")) {
      return Response.json(
        { message: "Session utilisateur requise." },
        { status: 401 },
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");

    if (!apiKey) {
      return Response.json(
        { message: "GEMINI_API_KEY non configurée." },
        { status: 500 },
      );
    }

    const data = await req.json();
    const prompt = `
Tu es un coach d'entretien professionnel.

${data.instruction ?? ""}

ENTREPRISE:
${data.company ?? ""}

POSTE:
${data.jobTitle ?? ""}

VILLE:
${data.city ?? ""}

OFFRE D'EMPLOI:
${data.jobOffer ?? ""}

MESSAGE DE CANDIDATURE:
${data.originalApplicationMessage ?? ""}

OBJET DU MESSAGE DU RECRUTEUR:
${data.recruiterReplySubject ?? ""}

MESSAGE DU RECRUTEUR:
${data.recruiterReplyBody ?? ""}

PROFIL CV:
Titre: ${data.cv?.professionalTitle ?? ""}
Résumé: ${data.cv?.summary ?? ""}
Expériences: ${data.cv?.experiences ?? ""}
Formation: ${data.cv?.education ?? ""}
Compétences: ${data.cv?.skills ?? ""}
Langues: ${data.cv?.languages ?? ""}
Certifications: ${data.cv?.certifications ?? ""}
`.trim();

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 1800,
          },
        }),
      },
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error(responseText);
      return Response.json(
        { message: "Gemini n'a pas pu préparer l'entretien." },
        { status: 502 },
      );
    }

    const json = JSON.parse(responseText);
    const preparation = json?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part?.text ?? "")
      .join("")
      .trim() ?? "";

    if (!preparation || preparation.length < 400) {
      return Response.json(
        { message: "Préparation IA vide ou incomplète." },
        { status: 502 },
      );
    }

    return Response.json({ preparation });
  } catch (error) {
    console.error(error);
    return Response.json(
      { message: "Erreur du service IA." },
      { status: 500 },
    );
  }
});
