use std::process::{Child, Command as StdCommand};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

struct AppState {
    server: Mutex<Option<Child>>,
    tray_handle: Mutex<Option<tauri::tray::TrayIcon>>,
}

#[tauri::command]
fn update_tray_tooltip(state: tauri::State<AppState>, text: String) {
    if let Some(ref tray) = *state.tray_handle.lock().unwrap() {
        let _ = tray.set_tooltip(Some(text));
    }
}

fn start_server(app: &tauri::AppHandle) {
    let resource = app.path().resource_dir().unwrap();
    // Tauri 把 resources 中 ../ 翻译成 _up_/ 子目录。开发模式下无此前缀
    let dist = if cfg!(debug_assertions) {
        resource.join("dist-server")
    } else {
        resource.join("_up_").join("dist-server")
    };

    // 用户数据放在系统标准路径 (macOS: ~/Library/Application Support/)
    let data_dir = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&data_dir).ok();

    // ponytail: 开发模式用系统 node，生产模式用 bundle 内 node
    let node = if cfg!(debug_assertions) {
        "node".to_string()
    } else {
        // externalBin 与主可执行文件同目录，Tauri 去掉架构后缀
        app.path()
            .resource_dir()
            .unwrap()
            .parent()
            .unwrap()
            .join("MacOS")
            .join("node")
            .to_string_lossy()
            .to_string()
    };

    let mut cmd = StdCommand::new(&node);
    cmd.args(["server.js"])
        .current_dir(&dist)
        .env("PORT", "4137")
        .env("LLM_CONTEXT_VIZ_DATA_DIR", data_dir.to_string_lossy().to_string())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());
    #[cfg(unix)] { cmd.process_group(0); }
    match cmd.spawn()
    {
        Ok(c) => {
            println!("[tauri] 后端已启动 (PID: {}) node={node}", c.id());
            *app.state::<AppState>().server.lock().unwrap() = Some(c);
        }
        Err(e) => eprintln!("[tauri] 后端启动失败: {e}"),
    }
}

fn kill_server(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<AppState>().server.lock().unwrap().take() {
        #[cfg(unix)] {
            // SIGKILL 整个进程组，确保残留子进程也被清掉
            let pid = child.id() as i32;
            unsafe { libc::kill(-pid, libc::SIGKILL); }
        }
        let _ = child.kill();
    }
}

fn kill_server_on_exit(app: &tauri::AppHandle) {
    kill_server(app);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            server: Mutex::new(None),
            tray_handle: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // 启动 Express 后端
            start_server(&handle);

            // 系统托盘
            let show = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            let handle2 = handle.clone();
            let tray = TrayIconBuilder::new()
                .tooltip("LLM Context Viz — 等待会话…")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => kill_server_on_exit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            *app.state::<AppState>().tray_handle.lock().unwrap() = Some(tray);

            // macOS: close → hide to tray
            if let Some(w) = app.get_webview_window("main") {
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        if let Some(win) = handle2.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![update_tray_tooltip])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                kill_server(_app);
            }
        });
}
