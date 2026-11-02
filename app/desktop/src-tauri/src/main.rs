// Jarvis (Windows): janela do llm-agent. Ao abrir, executa `llm-agent ui` no
// WSL, le a URL impressa e carrega a interface; fica na bandeja ao fechar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Url, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Nao abrir uma janela de console para o wsl.exe.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Tela de abertura (arquivos do app) no WebView2 do Windows.
const SPLASH: &str = if cfg!(windows) { "http://tauri.localhost/index.html" } else { "tauri://localhost/index.html" };

fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// Executa `llm-agent ui` (com `--stop` antes, ao reiniciar) no WSL e devolve a URL.
fn start_server(restart: bool) -> Result<String, String> {
    let stop = if restart { "llm-agent ui --stop >/dev/null 2>&1; " } else { "" };
    let script = format!(
        "export PATH=\"$HOME/.local/bin:$PATH\"; \
         command -v llm-agent >/dev/null || {{ echo 'llm-agent não encontrado no WSL: rode ./install.sh no repositório.' >&2; exit 127; }}; \
         {stop}llm-agent ui"
    );
    let mut cmd = Command::new("wsl.exe");
    // JARVIS_WSL_DISTRO escolhe a distribuicao (padrao: a do WSL).
    if let Ok(distro) = std::env::var("JARVIS_WSL_DISTRO") {
        if !distro.trim().is_empty() {
            cmd.args(["-d", distro.trim()]);
        }
    }
    cmd.args(["-e", "bash", "-lc", &script]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| format!("Não consegui executar o wsl.exe ({e}). O WSL está instalado?"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| l.starts_with("http://127.0.0.1:") && l.contains("#token="))
        .map(str::to_string)
        .ok_or_else(|| {
            let detail = tail(&format!("{stderr}\n{stdout}"), 20);
            if detail.is_empty() { format!("O llm-agent ui terminou sem imprimir a URL (código {:?}).", out.status.code()) } else { detail }
        })
}

fn eval(app: &AppHandle, js: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(js);
    }
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(w) = app.get_webview_window("main") {
        // Volta para a tela de abertura (pode estar na interface) e mostra o erro.
        if !w.url().map(|u| u.as_str().starts_with(SPLASH)).unwrap_or(false) {
            if let Ok(splash) = SPLASH.parse::<Url>() {
                let _ = w.navigate(splash);
                thread::sleep(Duration::from_millis(600));
            }
        }
    }
    let text = serde_json::to_string(message).unwrap_or_else(|_| "\"erro\"".into());
    eval(app, &format!("window.showError && window.showError({text})"));
}

/// Sobe (ou reinicia) o servidor numa thread e carrega a interface.
fn boot(app: AppHandle, restart: bool) {
    eval(&app, "window.setStatus && window.setStatus('Iniciando o servidor no WSL… (na primeira vez ele instala o que falta e demora mais)')");
    thread::spawn(move || match start_server(restart) {
        Ok(url) => match url.parse::<Url>() {
            Ok(u) => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.navigate(u);
                }
            }
            Err(e) => show_error(&app, &format!("URL inválida do llm-agent ui: {url} ({e})")),
        },
        Err(message) => show_error(&app, &message),
    });
}

#[tauri::command]
fn retry(app: AppHandle) {
    boot(app, false);
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if visible && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show(app);
        }
    }
}

fn main() {
    tauri::Builder::default()
        // Abrir de novo so traz a janela para a frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyJ) {
                        toggle(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![retry])
        .setup(|app| {
            let handle = app.handle().clone();

            let show_item = MenuItem::with_id(app, "show", "Mostrar o Jarvis (Ctrl+Alt+J)", true, None::<&str>)?;
            let restart_item = MenuItem::with_id(app, "restart", "Reiniciar o servidor", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &restart_item, &quit_item])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Jarvis")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "restart" => boot(app.clone(), true),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            app.global_shortcut()
                .register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyJ))?;

            boot(handle, false);
            Ok(())
        })
        // Fechar a janela so a esconde: o Jarvis continua ouvindo na bandeja.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Jarvis");
}
