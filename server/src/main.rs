mod game;
mod service;

use service::{AppState, app, maintenance};
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let address: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:3000".into())
        .parse()?;
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "client/dist".into());
    let state = AppState::default();
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, %static_dir, "花札館 server ready");
    tokio::spawn(maintenance(state.clone()));
    let shutdown_state = state.clone();
    axum::serve(
        listener,
        app(state, &static_dir).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_signal().await;
        shutdown_state.close_connections();
    })
    .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
