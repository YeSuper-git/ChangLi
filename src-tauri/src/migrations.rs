use anyhow::{Context, Result};
use sqlx::{sqlite::SqlitePool, Row};

pub async fn run(pool: &SqlitePool) -> Result<()> {
    create_base_tables(pool).await?;
    migrate_existing_tables(pool).await?;
    // actor_periods table and period_id columns must exist before cascade rebuild,
    // because rebuild copies data using SELECT period_id FROM old tables.
    create_actor_periods_table(pool).await?;
    add_column_if_not_exists(
        pool,
        "actor_periods",
        "sort_order",
        "INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    migrate_period_id_columns(pool).await?;
    migrate_cascade_foreign_keys(pool).await?;
    create_video_and_series_relation_tables(pool).await?;
    migrate_legacy_video_relations(pool).await?;
    backfill_required_values(pool).await?;
    seed_default_actors_if_empty(pool).await?;
    create_actor_photos_table(pool).await?;
    create_indexes(pool).await?;
    add_column_if_not_exists(pool, "categories", "scan_path", "TEXT")
        .await?;
    // 回填历史空 display_type：动漫类（scan_path 含 '动漫' 或 key='anime' 的分类下）
    execute(
        pool,
        "UPDATE video_series SET display_type = 'anime' WHERE display_type = '' OR display_type IS NULL",
        "backfill empty display_type to anime",
    ).await?;
    seed_default_actor_fields(pool).await?;
    seed_tutorial_data(pool).await?;
    // Remove stale 'name' field from actor_fields (task #1)
    execute(pool, "DELETE FROM actor_fields WHERE field_key = 'name'", "delete name from actor_fields").await?;
    // 回填历史分类 features 中缺失的 status 字段
    {
        let rows = sqlx::query_scalar::<_, String>("SELECT features FROM categories")
            .fetch_all(pool).await.unwrap_or_default();
        for features_str in rows {
            if let Ok(mut features) = serde_json::from_str::<serde_json::Value>(&features_str) {
                if features.get("status").is_none() {
                    features["status"] = serde_json::Value::Bool(true);
                    let new_features = serde_json::to_string(&features).unwrap_or(features_str.clone());
                    sqlx::query("UPDATE categories SET features = ? WHERE features = ?")
                        .bind(&new_features).bind(&features_str)
                        .execute(pool).await?;
                }
            }
        }
    }
    add_column_if_not_exists(pool, "actor_fields", "options", "TEXT")
        .await?;
    add_column_if_not_exists(pool, "actor_fields", "format", "TEXT")
        .await?;
    create_preset_templates_table(pool).await?;
    seed_preset_templates(pool).await?;
    add_column_if_not_exists(pool, "actors", "view_count", "INTEGER NOT NULL DEFAULT 0").await?;
    Ok(())
}

async fn create_base_tables(pool: &SqlitePool) -> Result<()> {
    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            parser_type TEXT NOT NULL DEFAULT 'css',
            config TEXT NOT NULL,
            enabled BOOLEAN DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create sites table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            url TEXT,
            magnet TEXT,
            info TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create resources table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
            aria2_gid TEXT UNIQUE,
            status TEXT DEFAULT 'waiting',
            progress REAL DEFAULT 0,
            download_speed INTEGER DEFAULT 0,
            file_path TEXT,
            file_name TEXT,
            file_size INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create downloads table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS video_series (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            poster TEXT,
            folder_path TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create video_series table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            series_id INTEGER REFERENCES video_series(id) ON DELETE CASCADE,
            episode_number INTEGER,
            file_size INTEGER,
            duration REAL,
            width INTEGER,
            height INTEGER,
            resolution TEXT,
            source_site TEXT,
            metadata TEXT,
            thumbnail TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create videos table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS actors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            photo TEXT,
            bio TEXT,
            birthday TEXT,
            height TEXT,
            measurements TEXT,
            japanese_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create actors table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create tags table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS resource_tags (
            resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (resource_id, tag_id)
        )
        "#,
        "create resource_tags table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS resource_actors (
            resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
            actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
            role TEXT,
            PRIMARY KEY (resource_id, actor_id)
        )
        "#,
        "create resource_actors table",
    )
    .await?;

    create_video_and_series_relation_tables(pool).await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
            last_position REAL DEFAULT 0,
            total_duration REAL,
            play_count INTEGER DEFAULT 1,
            last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create play_history table",
    )
    .await?;

    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS watch_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
            episode INTEGER NOT NULL,
            position REAL DEFAULT 0,
            duration REAL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(resource_id, episode)
        )
        "#,
        "create watch_progress table",
    )
    .await?;

    // 大类配置表
    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            card_layout TEXT NOT NULL DEFAULT 'auto',
            features TEXT NOT NULL DEFAULT '{}',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create categories table",
    )
    .await?;

    // 演员字段配置表（全局独立，不关联大类）
    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS actor_fields (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_key TEXT NOT NULL UNIQUE,
            field_label TEXT NOT NULL,
            field_type TEXT NOT NULL DEFAULT 'text',
            sort_order INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create actor_fields table",
    )
    .await?;

    Ok(())
}

async fn migrate_existing_tables(pool: &SqlitePool) -> Result<()> {
    for column in [
        Column::new("sites", "name", "TEXT NOT NULL DEFAULT ''"),
        Column::new("sites", "url", "TEXT NOT NULL DEFAULT ''"),
        Column::new("sites", "parser_type", "TEXT NOT NULL DEFAULT 'css'"),
        Column::new("sites", "config", "TEXT NOT NULL DEFAULT '{}'"),
        Column::new("sites", "enabled", "BOOLEAN DEFAULT 1"),
        Column::new("sites", "created_at", "TEXT"),
        Column::new("sites", "updated_at", "TEXT"),
        Column::new("resources", "site_id", "INTEGER"),
        Column::new("resources", "title", "TEXT NOT NULL DEFAULT ''"),
        Column::new("resources", "url", "TEXT"),
        Column::new("resources", "magnet", "TEXT"),
        Column::new("resources", "info", "TEXT"),
        Column::new("resources", "created_at", "TEXT"),
        Column::new("downloads", "resource_id", "INTEGER"),
        Column::new("downloads", "aria2_gid", "TEXT"),
        Column::new("downloads", "status", "TEXT DEFAULT 'waiting'"),
        Column::new("downloads", "progress", "REAL DEFAULT 0"),
        Column::new("downloads", "download_speed", "INTEGER DEFAULT 0"),
        Column::new("downloads", "file_path", "TEXT"),
        Column::new("downloads", "file_name", "TEXT"),
        Column::new("downloads", "file_size", "INTEGER"),
        Column::new("downloads", "created_at", "TEXT"),
        Column::new("downloads", "updated_at", "TEXT"),
        Column::new("videos", "file_path", "TEXT NOT NULL DEFAULT ''"),
        Column::new("videos", "file_name", "TEXT NOT NULL DEFAULT ''"),
        Column::new("videos", "series_id", "INTEGER"),
        Column::new("videos", "episode_number", "INTEGER"),
        Column::new("videos", "file_size", "INTEGER"),
        Column::new("videos", "duration", "REAL"),
        Column::new("videos", "width", "INTEGER"),
        Column::new("videos", "height", "INTEGER"),
        Column::new("videos", "resolution", "TEXT"),
        Column::new("videos", "source_site", "TEXT"),
        Column::new("videos", "season", "INTEGER DEFAULT 0"),
        Column::new("videos", "metadata", "TEXT"),
        Column::new("videos", "thumbnail", "TEXT"),
        Column::new("videos", "thumbnail_base64", "TEXT"),
        Column::new("videos", "description", "TEXT"),
        Column::new("videos", "poster_orientation", "TEXT"),
        Column::new("videos", "created_at", "TEXT"),
        Column::new("videos", "updated_at", "TEXT"),
        Column::new("video_series", "title", "TEXT NOT NULL DEFAULT ''"),
        Column::new("video_series", "description", "TEXT"),
        Column::new("video_series", "poster", "TEXT"),
        Column::new("video_series", "folder_path", "TEXT"),
        Column::new(
            "video_series",
            "poster_orientation",
            "TEXT DEFAULT 'landscape'",
        ),
        Column::new("video_series", "status", "TEXT DEFAULT 'ongoing'"),
        Column::new("video_series", "created_at", "TEXT"),
        Column::new("video_series", "updated_at", "TEXT"),
        Column::new("video_series", "poster_base64", "TEXT"),
        Column::new("videos", "is_favorite", "INTEGER DEFAULT 0"),
        Column::new("videos", "subtitle", "TEXT"),
        Column::new("video_series", "is_favorite", "INTEGER DEFAULT 0"),
        Column::new("video_series", "is_watched", "INTEGER DEFAULT 0"),
        Column::new("video_series", "code", "TEXT"),
        Column::new("video_series", "has_chinese_sub", "INTEGER DEFAULT 0"),
        Column::new("video_series", "display_type", "TEXT DEFAULT ''"),
        Column::new("actors", "name", "TEXT NOT NULL DEFAULT ''"),
        Column::new("actors", "photo", "TEXT"),
        Column::new("actors", "avatar_base64", "TEXT"),
        Column::new("actors", "bio", "TEXT"),
        Column::new("actors", "birthday", "TEXT"),
        Column::new("actors", "height", "TEXT"),
        Column::new("actors", "measurements", "TEXT"),
        Column::new("actors", "japanese_name", "TEXT"),
        Column::new("actors", "cup_size", "TEXT"),
        Column::new("actors", "alias", "TEXT"),
        Column::new("actors", "weight", "TEXT"),
        Column::new("actors", "created_at", "TEXT"),
        Column::new("actors", "updated_at", "TEXT"),
        Column::new("tags", "name", "TEXT NOT NULL DEFAULT ''"),
        Column::new("tags", "created_at", "TEXT"),
        Column::new("resource_actors", "role", "TEXT"),
        Column::new("play_history", "video_id", "INTEGER"),
        Column::new("play_history", "last_position", "REAL DEFAULT 0"),
        Column::new("play_history", "total_duration", "REAL"),
        Column::new("play_history", "play_count", "INTEGER DEFAULT 1"),
        Column::new("play_history", "last_played", "TEXT"),
        Column::new("watch_progress", "resource_id", "INTEGER"),
        Column::new("watch_progress", "episode", "INTEGER NOT NULL DEFAULT 1"),
        Column::new("watch_progress", "position", "REAL DEFAULT 0"),
        Column::new("watch_progress", "duration", "REAL DEFAULT 0"),
        Column::new("watch_progress", "updated_at", "TEXT"),
    ] {
        add_column_if_not_exists(pool, column.table, column.name, column.definition).await?;
    }

    Ok(())
}

async fn create_video_and_series_relation_tables(pool: &SqlitePool) -> Result<()> {
    for (sql, action) in [
        (
            r#"
            CREATE TABLE IF NOT EXISTS video_tags (
                video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (video_id, tag_id)
            )
            "#,
            "create video_tags table",
        ),
        (
            r#"
            CREATE TABLE IF NOT EXISTS video_actors (
                video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
                actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
                role TEXT,
                PRIMARY KEY (video_id, actor_id)
            )
            "#,
            "create video_actors table",
        ),
        (
            r#"
            CREATE TABLE IF NOT EXISTS series_tags (
                series_id INTEGER REFERENCES video_series(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (series_id, tag_id)
            )
            "#,
            "create series_tags table",
        ),
        (
            r#"
            CREATE TABLE IF NOT EXISTS series_actors (
                series_id INTEGER REFERENCES video_series(id) ON DELETE CASCADE,
                actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
                role TEXT,
                PRIMARY KEY (series_id, actor_id)
            )
            "#,
            "create series_actors table",
        ),
    ] {
        execute(pool, sql, action).await?;
    }
    Ok(())
}

async fn migrate_legacy_video_relations(pool: &SqlitePool) -> Result<()> {
    execute(
        pool,
        r#"
        INSERT OR IGNORE INTO video_tags (video_id, tag_id)
        SELECT rt.resource_id, rt.tag_id
        FROM resource_tags rt
        JOIN videos v ON v.id = rt.resource_id
        JOIN tags t ON t.id = rt.tag_id
        "#,
        "migrate legacy resource_tags to video_tags",
    )
    .await?;

    execute(
        pool,
        r#"
        INSERT OR IGNORE INTO video_actors (video_id, actor_id, role)
        SELECT ra.resource_id, ra.actor_id, ra.role
        FROM resource_actors ra
        JOIN videos v ON v.id = ra.resource_id
        JOIN actors a ON a.id = ra.actor_id
        "#,
        "migrate legacy resource_actors to video_actors",
    )
    .await?;

    Ok(())
}

async fn migrate_cascade_foreign_keys(pool: &SqlitePool) -> Result<()> {
    rebuild_videos_table_if_needed(pool).await?;

    rebuild_pair_table_if_missing_cascade(
        pool,
        "resource_tags",
        r#"
        CREATE TABLE resource_tags_new (
            resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (resource_id, tag_id)
        )
        "#,
        "INSERT OR IGNORE INTO resource_tags_new (resource_id, tag_id)
         SELECT resource_id, tag_id FROM resource_tags
         WHERE EXISTS (SELECT 1 FROM resources r WHERE r.id = resource_tags.resource_id)
           AND EXISTS (SELECT 1 FROM tags t WHERE t.id = resource_tags.tag_id)",
    )
    .await?;

    rebuild_pair_table_if_missing_cascade(
        pool,
        "resource_actors",
        r#"
        CREATE TABLE resource_actors_new (
            resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
            actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
            role TEXT,
            PRIMARY KEY (resource_id, actor_id)
        )
        "#,
        "INSERT OR IGNORE INTO resource_actors_new (resource_id, actor_id, role)
         SELECT resource_id, actor_id, role FROM resource_actors
         WHERE EXISTS (SELECT 1 FROM resources r WHERE r.id = resource_actors.resource_id)
           AND EXISTS (SELECT 1 FROM actors a WHERE a.id = resource_actors.actor_id)",
    )
    .await?;

    rebuild_pair_table_if_missing_cascade(
        pool,
        "video_tags",
        r#"
        CREATE TABLE video_tags_new (
            video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (video_id, tag_id)
        )
        "#,
        "INSERT OR IGNORE INTO video_tags_new (video_id, tag_id)
         SELECT video_id, tag_id FROM video_tags
         WHERE EXISTS (SELECT 1 FROM videos v WHERE v.id = video_tags.video_id)
           AND EXISTS (SELECT 1 FROM tags t WHERE t.id = video_tags.tag_id)",
    )
    .await?;

    rebuild_pair_table_if_missing_cascade(
        pool,
        "video_actors",
        r#"
        CREATE TABLE video_actors_new (
            video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
            actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
            role TEXT,
            period_id INTEGER REFERENCES actor_periods(id) ON DELETE SET NULL,
            PRIMARY KEY (video_id, actor_id)
        )
        "#,
        "INSERT OR IGNORE INTO video_actors_new (video_id, actor_id, role, period_id)
         SELECT video_id, actor_id, role, period_id FROM video_actors
         WHERE EXISTS (SELECT 1 FROM videos v WHERE v.id = video_actors.video_id)
           AND EXISTS (SELECT 1 FROM actors a WHERE a.id = video_actors.actor_id)",
    )
    .await?;

    rebuild_pair_table_if_missing_cascade(
        pool,
        "series_tags",
        r#"
        CREATE TABLE series_tags_new (
            series_id INTEGER REFERENCES video_series(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (series_id, tag_id)
        )
        "#,
        "INSERT OR IGNORE INTO series_tags_new (series_id, tag_id)
         SELECT series_id, tag_id FROM series_tags
         WHERE EXISTS (SELECT 1 FROM video_series s WHERE s.id = series_tags.series_id)
           AND EXISTS (SELECT 1 FROM tags t WHERE t.id = series_tags.tag_id)",
    )
    .await?;

    rebuild_pair_table_if_missing_cascade(
        pool,
        "series_actors",
        r#"
        CREATE TABLE series_actors_new (
            series_id INTEGER REFERENCES video_series(id) ON DELETE CASCADE,
            actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
            role TEXT,
            period_id INTEGER REFERENCES actor_periods(id) ON DELETE SET NULL,
            PRIMARY KEY (series_id, actor_id)
        )
        "#,
        "INSERT OR IGNORE INTO series_actors_new (series_id, actor_id, role, period_id)
         SELECT series_id, actor_id, role, period_id FROM series_actors
         WHERE EXISTS (SELECT 1 FROM video_series s WHERE s.id = series_actors.series_id)
           AND EXISTS (SELECT 1 FROM actors a WHERE a.id = series_actors.actor_id)",
    )
    .await?;

    Ok(())
}

async fn rebuild_videos_table_if_needed(pool: &SqlitePool) -> Result<()> {
    let video_sql: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'videos'",
    )
    .fetch_optional(pool)
    .await
    .context("read videos table schema")?;

    let needs_rebuild = video_sql
        .as_deref()
        .map(|sql| {
            !sql.to_ascii_lowercase()
                .contains("references video_series(id) on delete cascade")
        })
        .unwrap_or(false);

    if !needs_rebuild {
        return Ok(());
    }

    let mut conn = pool
        .acquire()
        .await
        .context("acquire sqlite connection for videos rebuild")?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .context("disable foreign keys for videos rebuild")?;
    sqlx::query("DROP TABLE IF EXISTS videos_new")
        .execute(&mut *conn)
        .await
        .context("drop stale videos_new")?;
    sqlx::query(
        r#"
        CREATE TABLE videos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            series_id INTEGER REFERENCES video_series(id) ON DELETE CASCADE,
            episode_number INTEGER,
            file_size INTEGER,
            duration REAL,
            width INTEGER,
            height INTEGER,
            resolution TEXT,
            source_site TEXT,
            metadata TEXT,
            thumbnail TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&mut *conn)
    .await
    .context("create videos_new with cascade series fk")?;
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO videos_new (
            id, file_path, file_name, series_id, episode_number, file_size, duration,
            width, height, resolution, source_site, metadata, thumbnail, description,
            created_at, updated_at
        )
        SELECT
            id, file_path, file_name,
            CASE WHEN series_id IS NULL OR EXISTS (SELECT 1 FROM video_series s WHERE s.id = videos.series_id) THEN series_id ELSE NULL END,
            episode_number, file_size, duration, width, height, resolution, source_site,
            metadata, thumbnail, description, created_at, updated_at
        FROM videos
        "#,
    )
    .execute(&mut *conn)
    .await
    .context("copy videos into cascade table")?;
    sqlx::query("DROP TABLE videos")
        .execute(&mut *conn)
        .await
        .context("drop old videos table")?;
    sqlx::query("ALTER TABLE videos_new RENAME TO videos")
        .execute(&mut *conn)
        .await
        .context("rename videos_new")?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .context("reenable foreign keys after videos rebuild")?;
    Ok(())
}

async fn rebuild_pair_table_if_missing_cascade(
    pool: &SqlitePool,
    table: &str,
    create_new_sql: &str,
    copy_sql: &str,
) -> Result<()> {
    if !table_exists(pool, table).await? || table_has_delete_cascade(pool, table).await? {
        return Ok(());
    }

    let backup_table = format!("{table}_old_migration");
    let final_create_sql = create_new_sql.replace(&format!("{table}_new"), table);
    execute(
        pool,
        &format!("DROP TABLE IF EXISTS {backup_table}"),
        "drop stale relation backup table",
    )
    .await?;
    execute(
        pool,
        &format!("ALTER TABLE {table} RENAME TO {backup_table}"),
        "rename old relation table to backup",
    )
    .await?;
    execute(pool, &final_create_sql, "create rebuilt relation table").await?;
    let copy_sql = copy_sql
        .replace(&format!("{table}_new"), "__CHangLi_TARGET_TABLE__")
        .replace(table, &backup_table)
        .replace("__CHangLi_TARGET_TABLE__", table);
    execute(pool, &copy_sql, "copy relation table data").await?;
    execute(
        pool,
        &format!("DROP TABLE {backup_table}"),
        "drop relation backup table",
    )
    .await?;
    Ok(())
}

async fn table_exists(pool: &SqlitePool, table: &str) -> Result<bool> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?")
            .bind(table)
            .fetch_one(pool)
            .await
            .with_context(|| format!("check table {table} exists"))?;
    Ok(count > 0)
}

async fn table_has_delete_cascade(pool: &SqlitePool, table: &str) -> Result<bool> {
    let sql = format!("PRAGMA foreign_key_list({table})");
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .with_context(|| format!("read foreign keys for {table}"))?;
    Ok(!rows.is_empty()
        && rows.iter().all(|row| {
            row.get::<String, _>("on_delete")
                .eq_ignore_ascii_case("CASCADE")
        }))
}

pub async fn add_column_if_not_exists(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
    match sqlx::query(&sql).execute(pool).await {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(err)) if is_duplicate_column_error(&*err) => Ok(()),
        Err(err) => Err(err).with_context(|| format!("add column {table}.{column}")),
    }
}

fn is_duplicate_column_error(err: &dyn sqlx::error::DatabaseError) -> bool {
    err.message()
        .to_ascii_lowercase()
        .contains("duplicate column")
}

async fn backfill_required_values(pool: &SqlitePool) -> Result<()> {
    for sql in [
        "UPDATE sites SET name = '' WHERE name IS NULL",
        "UPDATE sites SET url = '' WHERE url IS NULL",
        "UPDATE sites SET parser_type = 'css' WHERE parser_type IS NULL",
        "UPDATE sites SET config = '{}' WHERE config IS NULL",
        "UPDATE sites SET enabled = 1 WHERE enabled IS NULL",
        "UPDATE sites SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
        "UPDATE sites SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
        "UPDATE resources SET title = '' WHERE title IS NULL",
        "UPDATE resources SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
        "UPDATE downloads SET status = 'waiting' WHERE status IS NULL",
        "UPDATE downloads SET progress = 0 WHERE progress IS NULL",
        "UPDATE downloads SET download_speed = 0 WHERE download_speed IS NULL",
        "UPDATE downloads SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
        "UPDATE downloads SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
        "UPDATE videos SET file_path = '' WHERE file_path IS NULL",
        "UPDATE videos SET file_name = '' WHERE file_name IS NULL",
        "UPDATE videos SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
        "UPDATE videos SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
        "UPDATE video_series SET title = '' WHERE title IS NULL",
        "UPDATE video_series SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
        "UPDATE video_series SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
        "UPDATE actors SET name = '' WHERE name IS NULL",
        "UPDATE actors SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
        "UPDATE actors SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
        "UPDATE tags SET name = '' WHERE name IS NULL",
        "UPDATE tags SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
        "UPDATE play_history SET last_position = 0 WHERE last_position IS NULL",
        "UPDATE play_history SET play_count = 1 WHERE play_count IS NULL",
        "UPDATE play_history SET last_played = CURRENT_TIMESTAMP WHERE last_played IS NULL",
        "UPDATE watch_progress SET episode = 1 WHERE episode IS NULL",
        "UPDATE watch_progress SET position = 0 WHERE position IS NULL",
        "UPDATE watch_progress SET duration = 0 WHERE duration IS NULL",
        "UPDATE watch_progress SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL",
    ] {
        execute(pool, sql, "backfill migrated values").await?;
    }

    Ok(())
}

async fn seed_default_actors_if_empty(pool: &SqlitePool) -> Result<()> {
    // ChangLi 当前没有内置默认演员。保留这个受保护入口，防止未来新增默认数据时
    // 写成无条件 INSERT/REPLACE 导致用户删除的数据在启动后又被恢复。
    const DEFAULT_ACTORS: &[&str] = &[];
    if DEFAULT_ACTORS.is_empty() {
        return Ok(());
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actors")
        .fetch_one(pool)
        .await
        .context("count actors before seeding defaults")?;

    if count > 0 {
        return Ok(());
    }

    for name in DEFAULT_ACTORS {
        sqlx::query("INSERT INTO actors (name) VALUES (?)")
            .bind(name)
            .execute(pool)
            .await
            .with_context(|| format!("seed default actor {name}"))?;
    }

    Ok(())
}

async fn create_actor_periods_table(pool: &SqlitePool) -> Result<()> {
    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS actor_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE
        )
        "#,
        "create actor_periods table",
    )
    .await?;
    Ok(())
}

async fn migrate_period_id_columns(pool: &SqlitePool) -> Result<()> {
    // Add period_id to video_actors (legacy name: resource_actors)
    add_column_if_not_exists(
        pool,
        "video_actors",
        "period_id",
        "INTEGER REFERENCES actor_periods(id) ON DELETE SET NULL",
    )
    .await?;
    add_column_if_not_exists(
        pool,
        "series_actors",
        "period_id",
        "INTEGER REFERENCES actor_periods(id) ON DELETE SET NULL",
    )
    .await?;
    add_column_if_not_exists(
        pool,
        "resource_actors",
        "period_id",
        "INTEGER REFERENCES actor_periods(id) ON DELETE SET NULL",
    )
    .await?;
    Ok(())
}

async fn create_actor_photos_table(pool: &SqlitePool) -> Result<()> {
    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS actor_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
            photo TEXT,
            photo_base64 TEXT,
            is_primary INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create actor_photos table",
    )
    .await?;
    Ok(())
}

async fn create_indexes(pool: &SqlitePool) -> Result<()> {
    for sql in [
        "CREATE INDEX IF NOT EXISTS idx_resources_site_id ON resources(site_id)",
        "CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status)",
        "CREATE INDEX IF NOT EXISTS idx_videos_source_site ON videos(source_site)",
        "CREATE INDEX IF NOT EXISTS idx_play_history_video_id ON play_history(video_id)",
        "CREATE INDEX IF NOT EXISTS idx_watch_progress_resource_id ON watch_progress(resource_id)",
        "CREATE INDEX IF NOT EXISTS idx_videos_series_id ON videos(series_id)",
        "CREATE INDEX IF NOT EXISTS idx_video_tags_tag_id ON video_tags(tag_id)",
        "CREATE INDEX IF NOT EXISTS idx_video_actors_actor_id ON video_actors(actor_id)",
        "CREATE INDEX IF NOT EXISTS idx_series_tags_tag_id ON series_tags(tag_id)",
        "CREATE INDEX IF NOT EXISTS idx_series_actors_actor_id ON series_actors(actor_id)",
    ] {
        execute(pool, sql, "create index").await?;
    }

    Ok(())
}

async fn seed_default_categories(pool: &SqlitePool) -> Result<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Ok(());
    }

    // 动漫：竖版卡片，支持标签/追番/中字/集数，不支持演员
    sqlx::query(
        "INSERT INTO categories (key, name, card_layout, features, sort_order) VALUES (?, ?, ?, ?, ?)"
    )
    .bind("anime")
    .bind("动漫")
    .bind("portrait")
    .bind(r#"{"tags":true,"actors":false,"tracking":true,"chinese_sub":true,"episode":true}"#)
    .bind(1)
    .execute(pool)
    .await?;

    // 影视：横版卡片，支持演员/中字，不支持标签/追番/集数
    sqlx::query(
        "INSERT INTO categories (key, name, card_layout, features, sort_order) VALUES (?, ?, ?, ?, ?)"
    )
    .bind("adult")
    .bind("影视")
    .bind("landscape")
    .bind(r#"{"tags":false,"actors":true,"tracking":false,"status":true,"chinese_sub":true,"episode":false}"#)
    .bind(2)
    .execute(pool)
    .await?;

    Ok(())
}

async fn seed_default_actor_fields(pool: &SqlitePool) -> Result<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actor_fields")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Ok(());
    }

    let default_fields = [
        ("birthday", "生日", "date", 1, 1),
        ("height", "身高", "text", 2, 1),
        ("weight", "体重", "text", 3, 1),
    ];

    for (key, label, ftype, order, enabled) in &default_fields {
        sqlx::query(
            "INSERT INTO actor_fields (field_key, field_label, field_type, sort_order, enabled) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(key)
        .bind(label)
        .bind(ftype)
        .bind(order)
        .bind(enabled)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn create_preset_templates_table(pool: &SqlitePool) -> Result<()> {
    execute(
        pool,
        r#"
        CREATE TABLE IF NOT EXISTS preset_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            field_type TEXT NOT NULL DEFAULT 'text',
            sub_fields TEXT NOT NULL DEFAULT '[]',
            rules TEXT NOT NULL DEFAULT '{}',
            is_extension INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        "create preset_templates table",
    )
    .await?;
    Ok(())
}

async fn seed_preset_templates(pool: &SqlitePool) -> Result<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM preset_templates")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Ok(());
    }

    let presets: Vec<(&str, &str, &str, &str, &str, i32, i32)> = vec![
        ("height", "身高", "number", "[]", r#"{"unit":"cm"}"#, 0, 1),
        ("weight", "体重", "number", "[]", r#"{"unit":"kg"}"#, 0, 2),
        ("birthday", "生日", "date", "[]", "{}", 0, 3),
        (
            "measurements",
            "三围",
            "compound",
            r#"[{"label":"B","maxLen":2},{"label":"W","maxLen":2},{"label":"H","maxLen":2}]"#,
            "{}",
            1,
            4,
        ),
        ("cup_size", "罩杯", "text", "[]", r#"{"maxLength":1,"uppercase":true}"#, 1, 5),
    ];

    for (key, name, field_type, sub_fields, rules, is_ext, order) in &presets {
        sqlx::query(
            "INSERT INTO preset_templates (key, name, field_type, sub_fields, rules, is_extension, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(key)
        .bind(name)
        .bind(field_type)
        .bind(sub_fields)
        .bind(rules)
        .bind(is_ext)
        .bind(order)
        .execute(pool)
        .await?;
    }

    Ok(())
}


/// 首次安装时预置教程示例数据：一个分类、一个演员、两个标签、一个视频集
async fn seed_tutorial_data(pool: &SqlitePool) -> Result<()> {
    // 只在数据库完全为空时执行
    let cat_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
        .fetch_one(pool)
        .await?;
    let actor_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actors")
        .fetch_one(pool)
        .await?;
    let tag_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tags")
        .fetch_one(pool)
        .await?;

    if cat_count > 0 || actor_count > 0 || tag_count > 0 {
        return Ok(());
    }

    // 创建示例分类
    let features = r#"{"tags":true,"actors":true,"tracking":true,"watched":true,"status":true,"chinese_sub":true,"episode":"话"}"#;
    sqlx::query(
        "INSERT INTO categories (key, name, card_layout, features, sort_order) VALUES (?, ?, ?, ?, ?)"
    )
    .bind("example")
    .bind("示例分类")
    .bind("auto")
    .bind(features)
    .bind(1)
    .execute(pool)
    .await
    .context("seed tutorial category")?;

    // 创建示例演员
    sqlx::query("INSERT INTO actors (name, bio, birthday, height, weight) VALUES (?, ?, ?, ?, ?)")
        .bind("示例演员")
        .bind("这是一位示例演员，你可以编辑个人信息、添加海报、关联作品。")
        .bind("1990-01-01")
        .bind("165cm")
        .bind("50kg")
        .execute(pool)
        .await
        .context("seed tutorial actor")?;

    // 获取演员 ID
    let actor_id: i64 = sqlx::query_scalar("SELECT id FROM actors WHERE name = '示例演员'")
        .fetch_one(pool)
        .await?;

    // 创建示例标签
    for tag_name in &["动作", "科幻"] {
        sqlx::query("INSERT INTO tags (name) VALUES (?)")
            .bind(tag_name)
            .execute(pool)
            .await
            .with_context(|| format!("seed tutorial tag {tag_name}"))?;
    }

    // 获取标签 ID
    let tag1_id: i64 = sqlx::query_scalar("SELECT id FROM tags WHERE name = '动作'")
        .fetch_one(pool)
        .await?;
    let tag2_id: i64 = sqlx::query_scalar("SELECT id FROM tags WHERE name = '科幻'")
        .fetch_one(pool)
        .await?;

    // 创建示例视频集
    sqlx::query(
        "INSERT INTO video_series (title, display_type, created_at) VALUES (?, ?, datetime('now'))"
    )
    .bind("示例视频集")
    .bind("example")
    .execute(pool)
    .await
    .context("seed tutorial video series")?;

    // 获取视频集 ID
    let series_id: i64 = sqlx::query_scalar("SELECT id FROM video_series WHERE title = '示例视频集'")
        .fetch_one(pool)
        .await?;

    // 关联演员
    sqlx::query("INSERT INTO series_actors (series_id, actor_id) VALUES (?, ?)")
        .bind(series_id)
        .bind(actor_id)
        .execute(pool)
        .await
        .context("seed tutorial series-actor relation")?;

    // 关联标签
    for tag_id in &[tag1_id, tag2_id] {
        sqlx::query("INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)")
            .bind(series_id)
            .bind(tag_id)
            .execute(pool)
            .await
            .context("seed tutorial series-tag relation")?;
    }

    // 关联分类
    sqlx::query("UPDATE video_series SET display_type = 'example' WHERE id = ?")
        .bind(series_id)
        .execute(pool)
        .await
        .context("seed tutorial series-category relation")?;

    Ok(())
}

async fn execute(pool: &SqlitePool, sql: &str, action: &str) -> Result<()> {
    sqlx::query(sql)
        .execute(pool)
        .await
        .with_context(|| action.to_string())?;
    Ok(())
}

struct Column {
    table: &'static str,
    name: &'static str,
    definition: &'static str,
}

impl Column {
    const fn new(table: &'static str, name: &'static str, definition: &'static str) -> Self {
        Self {
            table,
            name,
            definition,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;
    use std::path::PathBuf;
    use uuid::Uuid;

    #[tokio::test]
    async fn migrates_old_actor_table_without_resetting_data() -> Result<()> {
        let db_path = temp_db_path();
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let pool = SqlitePool::connect(&db_url).await?;

        sqlx::query(
            r#"
            CREATE TABLE actors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                photo TEXT,
                bio TEXT
            )
            "#,
        )
        .execute(&pool)
        .await?;
        sqlx::query("INSERT INTO actors (name, bio) VALUES ('旧库演员', '保留')")
            .execute(&pool)
            .await?;

        run(&pool).await?;
        run(&pool).await?;

        let columns: Vec<String> = sqlx::query("PRAGMA table_info(actors)")
            .fetch_all(&pool)
            .await?
            .into_iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();

        for expected in [
            "id",
            "name",
            "photo",
            "bio",
            "birthday",
            "height",
            "measurements",
            "japanese_name",
            "cup_size",
            "created_at",
            "updated_at",
        ] {
            assert!(
                columns.iter().any(|column| column == expected),
                "missing actors.{expected}; columns={columns:?}"
            );
        }

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actors")
            .fetch_one(&pool)
            .await?;
        assert_eq!(count, 1);

        let row = sqlx::query(
            "UPDATE actors SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING name, bio, created_at, updated_at",
        )
        .bind("新名字")
        .bind(1_i64)
        .fetch_one(&pool)
        .await?;

        assert_eq!(row.get::<String, _>("name"), "新名字");
        assert_eq!(row.get::<String, _>("bio"), "保留");
        assert!(!row.get::<String, _>("created_at").is_empty());
        assert!(!row.get::<String, _>("updated_at").is_empty());

        pool.close().await;
        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    #[tokio::test]
    async fn migrates_cascade_foreign_keys_and_deletes_series_children() -> Result<()> {
        let db_path = temp_db_path();
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let pool = SqlitePool::connect(&db_url).await?;

        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE video_series (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, poster TEXT, folder_path TEXT UNIQUE, created_at TEXT, updated_at TEXT)")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, series_id INTEGER REFERENCES video_series(id), episode_number INTEGER, file_size INTEGER, duration REAL, width INTEGER, height INTEGER, resolution TEXT, source_site TEXT, metadata TEXT, thumbnail TEXT, description TEXT, created_at TEXT, updated_at TEXT)")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE actors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, photo TEXT, bio TEXT, birthday TEXT, height TEXT, measurements TEXT, japanese_name TEXT, created_at TEXT, updated_at TEXT)")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT)")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE video_actors (video_id INTEGER REFERENCES videos(id), actor_id INTEGER REFERENCES actors(id), role TEXT, PRIMARY KEY (video_id, actor_id))")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE video_tags (video_id INTEGER REFERENCES videos(id), tag_id INTEGER REFERENCES tags(id), PRIMARY KEY (video_id, tag_id))")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE series_actors (series_id INTEGER REFERENCES video_series(id), actor_id INTEGER REFERENCES actors(id), role TEXT, PRIMARY KEY (series_id, actor_id))")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE TABLE series_tags (series_id INTEGER REFERENCES video_series(id), tag_id INTEGER REFERENCES tags(id), PRIMARY KEY (series_id, tag_id))")
            .execute(&pool)
            .await?;

        sqlx::query("INSERT INTO video_series (id, title) VALUES (1, '剧集')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO videos (id, file_path, file_name, series_id) VALUES (1, '/tmp/a.mp4', 'a.mp4', 1)").execute(&pool).await?;
        sqlx::query("INSERT INTO actors (id, name) VALUES (1, '演员')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO tags (id, name) VALUES (1, '标签')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO video_actors (video_id, actor_id) VALUES (1, 1)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO video_tags (video_id, tag_id) VALUES (1, 1)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO series_actors (series_id, actor_id) VALUES (1, 1)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO series_tags (series_id, tag_id) VALUES (1, 1)")
            .execute(&pool)
            .await?;

        run(&pool).await?;
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await?;

        sqlx::query("DELETE FROM actors WHERE id = 1")
            .execute(&pool)
            .await?;
        let video_actor_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM video_actors")
            .fetch_one(&pool)
            .await?;
        let series_actor_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM series_actors")
            .fetch_one(&pool)
            .await?;
        assert_eq!(video_actor_count, 0);
        assert_eq!(series_actor_count, 0);

        sqlx::query("DELETE FROM tags WHERE id = 1")
            .execute(&pool)
            .await?;
        let video_tag_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM video_tags")
            .fetch_one(&pool)
            .await?;
        let series_tag_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM series_tags")
            .fetch_one(&pool)
            .await?;
        assert_eq!(video_tag_count, 0);
        assert_eq!(series_tag_count, 0);

        sqlx::query("DELETE FROM video_series WHERE id = 1")
            .execute(&pool)
            .await?;
        let video_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM videos")
            .fetch_one(&pool)
            .await?;
        assert_eq!(video_count, 0);

        pool.close().await;
        let _ = std::fs::remove_file(db_path);
        Ok(())
    }

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("changli-migration-{}.db", Uuid::new_v4()))
    }
}
