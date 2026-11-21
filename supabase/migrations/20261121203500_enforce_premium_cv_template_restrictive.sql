-- Restrictive policies are ANDed with the existing owner policy.
-- Permissive INSERT/UPDATE policies would be ORed and cannot enforce Premium.
DROP POLICY IF EXISTS "CV template requires active Premium on insert" ON public.web_cv_variants;
DROP POLICY IF EXISTS "CV template requires active Premium on update" ON public.web_cv_variants;

CREATE POLICY "CV template requires active Premium on insert"
ON public.web_cv_variants AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    fields->>'template' = 'classic'
    OR (
      fields->>'template' IN ('modern', 'compact')
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND lower(p.plan) = 'premium'
          AND (p.premium_until IS NULL OR p.premium_until > now())
      )
    )
  )
);

CREATE POLICY "CV template requires active Premium on update"
ON public.web_cv_variants AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    fields->>'template' = 'classic'
    OR (
      fields->>'template' IN ('modern', 'compact')
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND lower(p.plan) = 'premium'
          AND (p.premium_until IS NULL OR p.premium_until > now())
      )
    )
  )
);
