const ID = '001-org-direct-properties';

function up(db) {
  const columns = db.prepare('PRAGMA table_info(orgs)').all();
  if (!columns.length) return;

  const addColumn = (name, definition) => {
    if (!columns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE orgs ADD COLUMN ${name} ${definition}`);
    }
  };

  addColumn('is_active', 'INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))');
  addColumn('slug', 'TEXT');
  addColumn('name', 'TEXT');
  addColumn('description', 'TEXT');
  addColumn('created_by', 'TEXT');
  addColumn('timezone', "TEXT NOT NULL DEFAULT 'UTC'");
  addColumn('auto_move_past_assignments', 'INTEGER NOT NULL DEFAULT 1 CHECK (auto_move_past_assignments IN (0, 1))');
  addColumn('theme', 'TEXT');
  addColumn('visibility', 'TEXT');
  addColumn('share_code', 'TEXT');
  addColumn('share_uses', 'INTEGER');
  addColumn('share_permission', 'TEXT');
  addColumn('allow_cross_group_task_copy', 'INTEGER NOT NULL DEFAULT 0 CHECK (allow_cross_group_task_copy IN (0, 1))');
  addColumn('suspended_at', "TEXT NOT NULL DEFAULT ''");

  const update = db.prepare(`UPDATE orgs SET
    slug = json_extract(payload, '$.slug'),
    name = json_extract(payload, '$.name'),
    description = json_extract(payload, '$.description'),
    created_by = json_extract(payload, '$.createdBy'),
    timezone = COALESCE(json_extract(payload, '$.timezone'), 'UTC'),
    auto_move_past_assignments = CASE WHEN json_type(payload, '$.autoMovePastAssignments') = 'false' THEN 0 ELSE 1 END,
    theme = json_extract(payload, '$.theme'),
    visibility = json_extract(payload, '$.visibility'),
    share_code = json_extract(payload, '$.shareCode'),
    share_uses = json_extract(payload, '$.shareUses'),
    share_permission = json_extract(payload, '$.sharePermission'),
    allow_cross_group_task_copy = CASE WHEN json_type(payload, '$.allowCrossGroupTaskCopy') = 'true' THEN 1 ELSE 0 END,
    suspended_at = COALESCE(json_extract(payload, '$.suspendedAt'), '')`);
  update.run();
}

module.exports = { ID, up };
