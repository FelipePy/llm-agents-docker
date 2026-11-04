// Jarvis: janela do llm-agent (Windows e Linux). Ao abrir, executa `llm-agent ui`
// (no WSL, no Windows; direto, no Linux), le a URL impressa e carrega a
// interface; fica na bandeja ao fechar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, PhysicalPosition, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// URL da interface (com o token), depois que o servidor sobe (a bolinha usa).
struct ServerUrl(Mutex<Option<String>>);
/// Item "Iniciar com o sistema" da bandeja (para ficar igual a opcao da interface).
struct AutostartItem(CheckMenuItem<Wry>);

/// WebView2: audio sem clique, microfone liberado. Vale para TODAS as janelas: com
/// argumentos diferentes na mesma pasta de dados, o WebView2 nao cria a janela
/// (a bolinha sem eles derrubava o app ao abrir).
#[cfg(windows)]
const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream";

/// Aberto pelo sistema (inicio automatico): comeca escondido, com a bolinha.
fn start_minimized() -> bool {
    std::env::args().any(|a| a == "--minimized")
}

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

/// Executa `llm-agent ui` (com `--stop` antes, ao reiniciar) e devolve a URL.
fn start_server(restart: bool) -> Result<String, String> {
    let stop = if restart { "llm-agent ui --stop >/dev/null 2>&1; " } else { "" };
    let script = format!(
        "export PATH=\"$HOME/.local/bin:$PATH\"; \
         command -v llm-agent >/dev/null || {{ echo 'llm-agent não encontrado no WSL: rode ./install.sh no repositório.' >&2; exit 127; }}; \
         {stop}llm-agent ui"
    );
    #[cfg(windows)]
    let mut cmd = {
        let mut cmd = Command::new("wsl.exe");
        // JARVIS_WSL_DISTRO escolhe a distribuicao (padrao: a do WSL).
        if let Ok(distro) = std::env::var("JARVIS_WSL_DISTRO") {
            if !distro.trim().is_empty() {
                cmd.args(["-d", distro.trim()]);
            }
        }
        cmd.args(["-e", "bash", "-lc", &script]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new("bash");
        cmd.args(["-lc", &script]);
        cmd
    };

    let out = cmd.output().map_err(|e| {
        if cfg!(windows) { format!("Não consegui executar o wsl.exe ({e}). O WSL está instalado?") } else { format!("Não consegui executar o bash ({e}).") }
    })?;
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

/// Erro que nao impede o app de abrir: vai para jarvis.log, na pasta de logs do app
/// (no Windows, %LOCALAPPDATA%\dev.llmagent.jarvis\logs).
fn log_error(app: &AppHandle, what: &str, err: impl std::fmt::Display) {
    use std::io::Write;
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("jarvis.log")) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "[{secs}] {what}: {err}");
    }
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
                if let Ok(mut current) = app.state::<ServerUrl>().0.lock() {
                    *current = Some(url.clone());
                }
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

/// Para a bolinha: URL do servidor (ou None enquanto ele sobe).
#[tauri::command]
fn server_url(state: tauri::State<ServerUrl>) -> Option<String> {
    state.0.lock().ok().and_then(|url| url.clone())
}

/// Clique na bolinha: volta para a janela principal.
#[tauri::command]
fn show_main(app: AppHandle) {
    show(&app);
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    hide_orb(app);
}

fn show_orb(app: &AppHandle) {
    if let Some(orb) = app.get_webview_window("orb") {
        let _ = orb.show();
    }
}

fn hide_orb(app: &AppHandle) {
    if let Some(orb) = app.get_webview_window("orb") {
        let _ = orb.hide();
    }
}

fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Conta para a interface (pagina remota, sem acesso ao app) o que so o app sabe.
fn inject_desktop_info(app: &AppHandle) {
    eval(
        app,
        &format!(
            "window.__JARVIS_DESKTOP__ = {{ autostart: {} }}; window.dispatchEvent(new Event('jarvis-desktop'));",
            autostart_enabled(app)
        ),
    );
}

fn set_autostart(app: &AppHandle, on: bool) {
    let launcher = app.autolaunch();
    let _ = if on { launcher.enable() } else { launcher.disable() };
    let enabled = autostart_enabled(app);
    if let Some(item) = app.try_state::<AutostartItem>() {
        let _ = item.0.set_checked(enabled);
    }
    inject_desktop_info(app);
}

/// Pedidos da interface: navegacao para jarvis://... (o app atende e cancela).
fn handle_bridge(app: &AppHandle, url: &Url) {
    if url.host_str() == Some("autostart") {
        set_autostart(app, url.path() == "/on");
    }
}

fn create_main(app: &AppHandle) -> tauri::Result<()> {
    let bridge = app.clone();
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Jarvis")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .visible(!start_minimized())
        .on_navigation(move |url| {
            if url.scheme() == "jarvis" {
                handle_bridge(&bridge, url);
                return false;
            }
            true
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                inject_desktop_info(window.app_handle());
            }
        });
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(BROWSER_ARGS);
    }
    builder.build()?;
    Ok(())
}

/// Bolinha do Jarvis na lateral da tela, sempre por cima, quando o app nao esta em uso.
fn create_orb(app: &AppHandle) -> tauri::Result<()> {
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, "orb", WebviewUrl::App("orb.html".into()))
        .title("Jarvis")
        .inner_size(84.0, 84.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false);
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(BROWSER_ARGS);
    }
    let orb = builder.build()?;
    if let Ok(Some(monitor)) = orb.primary_monitor() {
        let (size, origin, scale) = (monitor.size(), monitor.position(), monitor.scale_factor());
        let side = (84.0 * scale) as i32;
        let x = origin.x + size.width as i32 - side - (12.0 * scale) as i32;
        let y = origin.y + size.height as i32 / 2 - side / 2;
        let _ = orb.set_position(PhysicalPosition::new(x, y));
    }
    Ok(())
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

/// No Linux (WebKitGTK), microfone e audio sem clique vem desligados: liga os dois
/// e aceita os pedidos de permissao da pagina (microfone, localizacao).
fn configure_webview(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.with_webview(|webview| {
            use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
            let view = webview.inner();
            if let Some(settings) = WebViewExt::settings(&view) {
                settings.set_enable_media_stream(true);
                settings.set_enable_webaudio(true);
                settings.set_media_playback_requires_user_gesture(false);
            }
            view.connect_permission_request(|_, request| {
                request.allow();
                true
            });
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
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
        // Inicio com o sistema: abre escondido (--minimized), so com a bolinha.
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .manage(ServerUrl(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![retry, server_url, show_main])
        .setup(|app| {
            let handle = app.handle().clone();
            create_main(&handle)?;
            // Sem a bolinha (ou o atalho) o app ainda funciona: registra e segue.
            if let Err(e) = create_orb(&handle) {
                log_error(&handle, "bolinha", e);
            }
            if start_minimized() {
                show_orb(&handle);
            }

            let show_item = MenuItem::with_id(app, "show", "Mostrar o Jarvis (Ctrl+Alt+J)", true, None::<&str>)?;
            let autostart_item =
                CheckMenuItem::with_id(app, "autostart", "Iniciar com o sistema", true, autostart_enabled(&handle), None::<&str>)?;
            let restart_item = MenuItem::with_id(app, "restart", "Reiniciar o servidor", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &autostart_item, &restart_item, &quit_item])?;
            app.manage(AutostartItem(autostart_item));
            let mut tray = TrayIconBuilder::new()
                .tooltip("Jarvis")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "autostart" => set_autostart(app, !autostart_enabled(app)),
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

            // Outro programa pode ja usar o Ctrl+Alt+J.
            if let Err(e) = app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyJ)) {
                log_error(&handle, "atalho Ctrl+Alt+J", e);
            }

            configure_webview(&handle);
            boot(handle, false);
            Ok(())
        })
        // Fechar a janela so a esconde (o Jarvis continua ouvindo). Saindo do app
        // (outro programa em foco, minimizado ou escondido), aparece a bolinha.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    show_orb(window.app_handle());
                }
                WindowEvent::Focused(false) => show_orb(window.app_handle()),
                WindowEvent::Focused(true) => hide_orb(window.app_handle()),
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Jarvis");
}
