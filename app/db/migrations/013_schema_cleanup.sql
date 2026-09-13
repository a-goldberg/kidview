-- Preserve clarification-era audit data inside the current audit payload before
-- removing the inactive first-version columns.
UPDATE search_events
SET audit_summary_json = json_set(
  CASE WHEN json_valid(audit_summary_json) THEN audit_summary_json ELSE '{}' END,
  '$.legacy_clarification',
  json_object(
    'clarified_query', clarified_query,
    'query_intent', query_intent,
    'clarification_options_json', clarification_options_json,
    'selected_clarification', selected_clarification
  )
)
WHERE (clarified_query IS NOT NULL AND clarified_query != query)
   OR (query_intent IS NOT NULL AND
       (source_mode IS NULL OR query_intent != source_mode || '_discovery'))
   OR clarification_options_json != '[]'
   OR selected_clarification IS NOT NULL;

ALTER TABLE policy_profiles DROP COLUMN allow_shorts;
ALTER TABLE policy_profiles DROP COLUMN allow_livestreams;

ALTER TABLE search_events DROP COLUMN clarified_query;
ALTER TABLE search_events DROP COLUMN query_intent;
ALTER TABLE search_events DROP COLUMN clarification_options_json;
ALTER TABLE search_events DROP COLUMN selected_clarification;
