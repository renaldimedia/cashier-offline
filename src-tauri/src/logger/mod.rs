// src/logger/mod.rs
// File-based logger with monthly rotation
// Logs to: {data_dir}/logs/app_YYYY-MM.log

use std::path::Path;

use anyhow::Result;
use tracing::Level;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{
    fmt::{self, time::ChronoLocal},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Call once at startup. Returns a `WorkerGuard` that must be kept alive
/// for the duration of the process (dropping it flushes remaining logs).
pub fn init_logger(data_dir: &Path) -> Result<WorkerGuard> {
    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&log_dir)?;

    // Rotate by day but use a monthly filename prefix
    let file_appender = tracing_appender::rolling::daily(
        &log_dir,
        "app",  // produces: app.YYYY-MM-DD
    );

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // Log level: read from env, default to INFO
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,pos_app_lib=debug"));

    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_timer(ChronoLocal::new("%Y-%m-%d %H:%M:%S%.3f".into()))
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .json();  // structured JSON logs for easy parsing

    let stdout_layer = fmt::layer()
        .with_writer(std::io::stdout)
        .with_timer(ChronoLocal::new("%H:%M:%S".into()))
        .with_target(false)
        .pretty();

    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(stdout_layer)
        .init();

    tracing::info!("Logger initialized. Log directory: {:?}", log_dir);

    Ok(guard)
}