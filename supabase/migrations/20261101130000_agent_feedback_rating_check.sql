-- Fix agent_feedback's rating check: a NULL rating made `rating IN (-1, 1)` and
-- `rating BETWEEN 1 AND 5` evaluate to NULL, which a CHECK treats as passing,
-- so a reply or an undismissed survey with no rating was accepted.
ALTER TABLE public.agent_feedback DROP CONSTRAINT agent_feedback_check;

ALTER TABLE public.agent_feedback ADD CONSTRAINT agent_feedback_rating_check CHECK (
  (kind = 'reply' AND NOT dismissed AND rating IS NOT NULL AND rating IN (-1, 1)) OR
  (kind = 'survey' AND (
    (dismissed AND rating IS NULL) OR
    (NOT dismissed AND rating IS NOT NULL AND rating BETWEEN 1 AND 5)
  ))
);
