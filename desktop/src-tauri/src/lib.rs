//! Jobhunt's desktop shell.
//! - Launch: the Node server as a child (`node` beside this executable, the built app in Resources/app) on a free
//!   loopback port, with the data folder in Application Support. The window opens once the server answers.
//! - Quit: the child is stopped. The child also watches its stdin, so it exits if this process dies without quitting.

use std::fs;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const READY_TIMEOUT: Duration = Duration::from_secs(30);

struct Shell {
    child: Mutex<Option<Child>>,
}

/// The browser extension looks for the app on these ports, in this order; any free port is the last resort.
const PORTS: [u16; 4] = [47600, 47601, 47602, 47603];

fn free_port() -> Result<u16, String> {
    for port in PORTS {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

fn spawn_server(app: &AppHandle, home: &PathBuf, port: u16) -> Result<Child, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let node = exe.parent().ok_or("the executable has no folder")?.join("node");
    let server = app.path().resource_dir().map_err(|e| e.to_string())?.join("app");
    if !node.exists() {
        return Err(format!("the node runtime is missing at {}", node.display()));
    }
    let main = server.join("launch.cjs");
    if !main.exists() {
        return Err(format!("the app is missing at {}", main.display()));
    }
    fs::create_dir_all(home.join("logs")).map_err(|e| e.to_string())?;
    let log = fs::OpenOptions::new().create(true).append(true).open(home.join("logs/server.log")).map_err(|e| e.to_string())?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    Command::new(&node)
        .arg(&main)
        .env("JOBHUNT_DATA_DIR", home)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .current_dir(&server)
        // Kept open for as long as this process lives: the server exits when it closes.
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log2))
        .spawn()
        .map_err(|e| format!("could not start node: {e}"))
}

fn wait_ready(port: u16, child: &mut Child) -> Result<(), String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let start = Instant::now();
    while start.elapsed() < READY_TIMEOUT {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("the local service stopped at once ({status}); see logs/server.log"));
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(120));
    }
    Err("the local service did not answer within 30 seconds; see logs/server.log".into())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn error_window(app: &AppHandle, reason: &str) {
    eprintln!("jobhunt: {reason}");
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Jobhunt")
        .inner_size(640.0, 360.0)
        .build();
}

fn stop_server(shell: &Shell) {
    if let Some(mut child) = shell.child.lock().unwrap().take() {
        // Closing stdin asks the server to exit; kill is the fallback.
        drop(child.stdin.take());
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn run() {
    tauri::Builder::default()
        // Links with target=_blank and window.open go to the default browser (the plugin's JS shim patches both).
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .manage(Shell { child: Mutex::new(None) })
        .setup(|app| {
            let handle = app.handle().clone();
            let home = match handle.path().app_data_dir() {
                Ok(p) => p,
                Err(e) => {
                    error_window(&handle, &e.to_string());
                    return Ok(());
                }
            };
            let started = free_port().and_then(|port| spawn_server(&handle, &home, port).map(|child| (port, child)));
            let (port, mut child) = match started {
                Ok(v) => v,
                Err(e) => {
                    error_window(&handle, &e);
                    return Ok(());
                }
            };
            if let Err(e) = wait_ready(port, &mut child) {
                let _ = child.kill();
                error_window(&handle, &e);
                return Ok(());
            }
            *handle.state::<Shell>().child.lock().unwrap() = Some(child);
            let url = format!("http://127.0.0.1:{port}/").parse().expect("url");
            WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                .title("Jobhunt")
                .inner_size(1320.0, 860.0)
                .min_inner_size(420.0, 560.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Jobhunt could not start")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(app),
            RunEvent::Exit => stop_server(&app.state::<Shell>()),
            _ => {}
        });
}
