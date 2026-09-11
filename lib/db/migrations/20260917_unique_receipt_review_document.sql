WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY document_id
           ORDER BY
             CASE
               WHEN status = 'confirmed' AND retain_original THEN 0
               WHEN status = 'pending' AND expires_at > now() THEN 1
               ELSE 2
             END,
             confirmed_at DESC NULLS LAST,
             expires_at DESC,
             created_at DESC,
             id DESC
         ) AS position
  FROM receipt_reviews
  WHERE document_id IS NOT NULL
)
UPDATE receipt_reviews r
SET document_id = NULL
FROM ranked
WHERE r.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS receipt_reviews_document_unique_idx
  ON receipt_reviews (document_id)
  WHERE document_id IS NOT NULL;