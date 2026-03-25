-- Normalize courses.grade_levels from Chinese labels to grade keys
-- Students use keys (P1-P6, J1-J3, S1-S3); courses should match.

UPDATE courses
SET grade_levels = ARRAY(
  SELECT CASE elem
    WHEN '小一' THEN 'P1'
    WHEN '小二' THEN 'P2'
    WHEN '小三' THEN 'P3'
    WHEN '小四' THEN 'P4'
    WHEN '小五' THEN 'P5'
    WHEN '小六' THEN 'P6'
    WHEN '國一' THEN 'J1'
    WHEN '國二' THEN 'J2'
    WHEN '國三' THEN 'J3'
    WHEN '高一' THEN 'S1'
    WHEN '高二' THEN 'S2'
    WHEN '高三' THEN 'S3'
    ELSE elem
  END
  FROM UNNEST(grade_levels) AS elem
)
WHERE grade_levels IS NOT NULL
  AND grade_levels <> '{}';
