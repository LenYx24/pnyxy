-- Robustly link a library folder to the course (space) and section it
-- mirrors, so the library can show a course folder's not-yet-copied files
-- as "available" placeholders. Previously the folder<->course link was
-- name-matching only (fragile: a rename broke it). These columns make it
-- explicit. Both are set on the member's own folders by ensureCourseFolders
-- / ensureSectionFolder when they join or open a course.

alter table folders
  add column if not exists source_space_id uuid
    references spaces(id) on delete set null,
  add column if not exists source_section_id uuid
    references space_sections(id) on delete set null;

-- Look up "which of my folders mirrors this course" without a full scan.
create index if not exists folders_source_space_id_idx
  on folders(source_space_id)
  where source_space_id is not null;

comment on column folders.source_space_id is
  'Course (space) this folder mirrors; set on the member''s course folder. Null for normal folders.';
comment on column folders.source_section_id is
  'Course section this subfolder mirrors; null for the course root folder (General items) and normal folders.';
