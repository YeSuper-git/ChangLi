use anyhow::{Context, Result};
use sqlx::sqlite::SqlitePool;

pub async fn run(pool: &SqlitePool) -> Result<()> {
    create_base_tables(pool).await?;
    migrate_existing_tables(pool).await?;
    backfill_required_values(pool).await?;
    seed_default_actors_if_empty(pool).await?;
    create_indexes(pool).await?;
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
            series_id INTEGER REFERENCES video_series(id) ON DELETE SET NULL,
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
        Column::new("videos", "metadata", "TEXT"),
        Column::new("videos", "thumbnail", "TEXT"),
        Column::new("videos", "description", "TEXT"),
        Column::new("videos", "created_at", "TEXT"),
        Column::new("videos", "updated_at", "TEXT"),
        Column::new("video_series", "title", "TEXT NOT NULL DEFAULT ''"),
        Column::new("video_series", "description", "TEXT"),
        Column::new("video_series", "poster", "TEXT"),
        Column::new("video_series", "folder_path", "TEXT"),
        Column::new("video_series", "created_at", "TEXT"),
        Column::new("video_series", "updated_at", "TEXT"),
        Column::new("actors", "name", "TEXT NOT NULL DEFAULT ''"),
        Column::new("actors", "photo", "TEXT"),
        Column::new("actors", "bio", "TEXT"),
        Column::new("actors", "birthday", "TEXT"),
        Column::new("actors", "height", "TEXT"),
        Column::new("actors", "measurements", "TEXT"),
        Column::new("actors", "japanese_name", "TEXT"),
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

async fn create_indexes(pool: &SqlitePool) -> Result<()> {
    for sql in [
        "CREATE INDEX IF NOT EXISTS idx_resources_site_id ON resources(site_id)",
        "CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status)",
        "CREATE INDEX IF NOT EXISTS idx_videos_source_site ON videos(source_site)",
        "CREATE INDEX IF NOT EXISTS idx_play_history_video_id ON play_history(video_id)",
        "CREATE INDEX IF NOT EXISTS idx_watch_progress_resource_id ON watch_progress(resource_id)",
    ] {
        execute(pool, sql, "create index").await?;
    }

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

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("changli-migration-{}.db", Uuid::new_v4()))
    }
}
