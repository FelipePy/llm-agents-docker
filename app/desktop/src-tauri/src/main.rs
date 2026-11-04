// Jarvis: janela do llm-agent (Windows e Linux). Ao abrir, instala ou atualiza o
// llm-agents-docker que vem no instalador e sobe o servidor da interface (no WSL,
// no Windows; direto, no Linux), le a URL impressa e carrega a interface; fica na
// bandeja ao fechar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, PhysicalPosition, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde_json::Value;

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

/// Pacote do llm-agents-docker embutido no instalador (scripts/build-payload.sh):
/// (setup.sh, llm-agents-docker.tar.gz). None num build sem ele (tauri dev).
fn payload(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let dir = app.path().resource_dir().ok()?.join("payload");
    let (setup, archive) = (dir.join("setup.sh"), dir.join("llm-agents-docker.tar.gz"));
    (setup.is_file() && archive.is_file()).then_some((setup, archive))
}

/// Caminho para o bash (no Windows, sem o prefixo \\?\ que o wslpath nao entende).
fn shell_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

/// Clone do repositorio para desenvolvimento (JARVIS_REPO; no Windows, caminho do WSL).
fn dev_repo() -> Option<String> {
    std::env::var("JARVIS_REPO").ok().map(|r| r.trim().to_string()).filter(|r| !r.is_empty())
}

/// bash de login (no Windows, dentro do WSL; `root`: como root, sem senha) rodando
/// `script` com os argumentos. No WSL, argumentos que sao caminhos do Windows sao
/// convertidos pelo setup.sh.
fn bash_command(script: &str, args: &[String], root: bool) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("wsl.exe");
        // JARVIS_WSL_DISTRO escolhe a distribuicao (padrao: a do WSL).
        if let Some(distro) = env_distro() {
            cmd.args(["-d", &distro]);
        }
        if root {
            cmd.args(["-u", "root"]);
        }
        cmd.args(["-e", "bash", "-lc", script, "jarvis"]).args(args);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        let mut cmd = Command::new("bash");
        cmd.args(["-lc", script, "jarvis"]).args(args);
        cmd
    }
}

/// Distribuicao do WSL escolhida em JARVIS_WSL_DISTRO.
#[cfg_attr(not(windows), allow(dead_code))]
fn env_distro() -> Option<String> {
    std::env::var("JARVIS_WSL_DISTRO").ok().map(|d| d.trim().to_string()).filter(|d| !d.is_empty())
}

/// Cada linha do stdout (false) e do stderr (true), assim que sai.
type LineFn = Arc<dyn Fn(&str, bool) + Send + Sync>;

/// Le as linhas de um pipe (texto invalido em UTF-8 nao interrompe a leitura).
fn read_lines(pipe: impl Read, is_err: bool, on_line: &LineFn) -> String {
    let mut text = String::new();
    for chunk in BufReader::new(pipe).split(b'\n').map_while(Result::ok) {
        let line = String::from_utf8_lossy(&chunk).replace(['\0', '\r'], "");
        on_line(&line, is_err);
        text.push_str(&line);
        text.push('\n');
    }
    text
}

/// Roda o comando passando cada linha para `on_line` e devolve (codigo, stdout, stderr).
fn run_lines(mut cmd: Command, on_line: LineFn) -> Result<(Option<i32>, String, String), String> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| {
        if cfg!(windows) { format!("Não consegui executar o wsl.exe ({e}). O WSL está instalado?") } else { format!("Não consegui executar o bash ({e}).") }
    })?;
    let stderr = child.stderr.take().map(|err| {
        let on_line = on_line.clone();
        thread::spawn(move || read_lines(err, true, &on_line))
    });
    let stdout = child.stdout.take().map(|out| read_lines(out, false, &on_line)).unwrap_or_default();
    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
    Ok((status.code(), stdout, stderr))
}

/// Linhas "@status ..." vao para a tela de abertura.
fn status_lines(app: &AppHandle) -> LineFn {
    let app = app.clone();
    Arc::new(move |line, _| {
        if let Some(text) = line.strip_prefix("@status ") {
            let text = serde_json::to_string(text).unwrap_or_default();
            eval(&app, &format!("window.setStatus && window.setStatus({text})"));
        }
    })
}

/// Roda o setup.sh do pacote com o bash (no Windows, no WSL).
const RUN_SETUP: &str = if cfg!(windows) { "f=\"$(wslpath -u \"$1\")\"; shift; exec bash \"$f\" \"$@\"" } else { "exec bash \"$@\"" };

/// Sobe o servidor e devolve a URL. Com o pacote embutido, o setup.sh instala ou
/// atualiza o codigo dele antes (no Windows, dentro do WSL); com JARVIS_REPO, usa
/// o clone; sem nenhum dos dois, o `llm-agent` instalado pelo install.sh.
fn start_server(app: &AppHandle, restart: bool) -> Result<String, String> {
    const LEGACY: &str = "export PATH=\"$HOME/.local/bin:$PATH\"; command -v llm-agent >/dev/null || { echo 'llm-agent não encontrado: rode ./install.sh no repositório.' >&2; exit 127; }; ";
    let (script, args): (String, Vec<String>) = match (dev_repo(), payload(app)) {
        (Some(repo), _) => {
            let stop = if restart { "\"$1/llm-agent\" ui --stop >/dev/null 2>&1; " } else { "" };
            (format!("[ -x \"$1/llm-agent\" ] || {{ echo \"JARVIS_REPO sem llm-agent: $1\" >&2; exit 127; }}; {stop}exec \"$1/llm-agent\" ui"), vec![repo])
        }
        (None, Some((setup, archive))) => {
            let mut args = vec![shell_path(&setup), "start".into(), "--payload".into(), shell_path(&archive)];
            if restart {
                args.push("--restart".into());
            }
            (RUN_SETUP.to_string(), args)
        }
        (None, None) => (format!("{LEGACY}{}llm-agent ui", if restart { "llm-agent ui --stop >/dev/null 2>&1; " } else { "" }), vec![]),
    };
    let (code, stdout, stderr) = run_lines(bash_command(&script, &args, false), status_lines(app))?;
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| l.starts_with("http://127.0.0.1:") && l.contains("#token="))
        .map(str::to_string)
        .ok_or_else(|| {
            let detail = tail(&format!("{stderr}\n{}", stdout.lines().filter(|l| !l.starts_with("@status ")).collect::<Vec<_>>().join("\n")), 20);
            if detail.is_empty() { format!("O servidor terminou sem imprimir a URL (código {code:?}).") } else { detail }
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
    to_splash(app);
    let text = serde_json::to_string(message).unwrap_or_else(|_| "\"erro\"".into());
    eval(app, &format!("window.showError && window.showError({text})"));
}

/// Volta para a tela de abertura (a janela pode estar na interface).
fn to_splash(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if !w.url().map(|u| u.as_str().starts_with(SPLASH)).unwrap_or(false) {
            if let Ok(splash) = SPLASH.parse::<Url>() {
                let _ = w.navigate(splash);
                thread::sleep(Duration::from_millis(600));
            }
        }
    }
}

/// Sobe (ou reinicia) o servidor e carrega a interface (bloqueia: chame numa thread).
fn start(app: &AppHandle, restart: bool) {
    eval(app, "window.setStatus && window.setStatus('Iniciando o servidor…')");
    match start_server(app, restart) {
        Ok(url) => match url.parse::<Url>() {
            Ok(u) => {
                if let Ok(mut current) = app.state::<ServerUrl>().0.lock() {
                    *current = Some(url.clone());
                }
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.navigate(u);
                }
            }
            Err(e) => show_error(app, &format!("URL inválida do llm-agent ui: {url} ({e})")),
        },
        Err(message) => show_error(app, &message),
    }
}

/// Ao abrir: confere as dependencias (com o pacote embutido) e, se faltar algo,
/// mostra a lista para o usuario aprovar; senao, sobe o servidor. Reiniciar o
/// servidor (bandeja) nao confere de novo.
fn boot(app: AppHandle, restart: bool) {
    thread::spawn(move || {
        if !restart && payload(&app).is_some() {
            eval(&app, "window.setStatus && window.setStatus('Conferindo o que o Jarvis precisa…')");
            match check(&app) {
                Ok(items) if needs_attention(&items) => return show_setup(&app, &items, false),
                Ok(_) => {}
                Err(e) => return show_error(&app, &e),
            }
        }
        start(&app, restart);
    });
}

// --- Dependencias (setup.sh check / install / install-root) -------------------

/// Ultima verificacao: os itens e o usuario/distribuicao do Linux (linha @env).
#[derive(Default)]
struct SetupInfo {
    items: Vec<Value>,
    user: String,
    distro: String,
}
struct SetupState(Mutex<SetupInfo>);

/// Argumentos do pacote (e do clone, em desenvolvimento) para o setup.sh.
fn payload_args(app: &AppHandle) -> Result<(String, Vec<String>), String> {
    let (setup, archive) = payload(app).ok_or("Este build do Jarvis não traz o pacote de instalação.")?;
    let mut args = vec!["--payload".to_string(), shell_path(&archive)];
    if let Some(repo) = dev_repo() {
        args.extend(["--repo".to_string(), repo]);
    }
    Ok((shell_path(&setup), args))
}

/// setup.sh com os argumentos. Como root: no Windows, `wsl -u root` (sem senha);
/// no Linux, pkexec (pede a senha numa janela do sistema).
fn setup_command(app: &AppHandle, args: Vec<String>, root: bool) -> Result<Command, String> {
    let (setup, _) = payload_args(app)?;
    if root && !cfg!(windows) {
        // O AppImage fica montado so para o usuario: o root le uma copia.
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let copy = dir.join("setup.sh");
        std::fs::copy(&setup, &copy).map_err(|e| format!("Não consegui copiar o setup.sh ({e})."))?;
        let copy = shell_path(&copy);
        if Command::new("pkexec").arg("--version").output().is_err() {
            return Err(format!("Sem o pkexec para pedir a senha de administrador. Rode no terminal:\nsudo bash {copy} {}", args.join(" ")));
        }
        let mut cmd = Command::new("pkexec");
        cmd.arg("bash").arg(copy).args(args);
        return Ok(cmd);
    }
    let mut full = vec![setup];
    full.extend(args);
    Ok(bash_command(RUN_SETUP, &full, root))
}

/// Confere as dependencias e guarda o resultado. No Windows sem WSL (ou sem a
/// distribuicao), so o item do WSL: o resto e conferido dentro dele, depois.
fn check(app: &AppHandle) -> Result<Vec<Value>, String> {
    #[cfg(windows)]
    if let Some(items) = wsl_missing() {
        if let Ok(mut info) = app.state::<SetupState>().0.lock() {
            info.items = items.clone();
        }
        return Ok(items);
    }
    let (_, payload) = payload_args(app)?;
    let mut args = vec!["check".to_string()];
    args.extend(payload);
    let (code, stdout, stderr) = run_lines(setup_command(app, args, false)?, Arc::new(|_, _| {}))?;
    if code != Some(0) {
        return Err(format!("Não consegui conferir a instalação.\n{}", tail(&format!("{stderr}\n{stdout}"), 15)));
    }
    let mut info = SetupInfo::default();
    for line in stdout.lines() {
        if let Some(item) = line.strip_prefix("@item ").and_then(|j| serde_json::from_str::<Value>(j).ok()) {
            info.items.push(item);
        } else if let Some(env) = line.strip_prefix("@env ").and_then(|j| serde_json::from_str::<Value>(j).ok()) {
            info.user = env["user"].as_str().unwrap_or_default().to_string();
            info.distro = env["distro"].as_str().unwrap_or_default().to_string();
        }
    }
    let items = info.items.clone();
    if let Ok(mut state) = app.state::<SetupState>().0.lock() {
        *state = info;
    }
    Ok(items)
}

/// Algo a instalar ou resolver. A atualizacao do proprio codigo nao entra: ela
/// vem com o app novo (o setup.sh start atualiza, com reinicio verificado).
fn needs_attention(items: &[Value]) -> bool {
    items.iter().any(|i| {
        let state = i["state"].as_str().unwrap_or("ok");
        state != "ok" && !(i["id"] == "app" && state == "outdated")
    })
}

fn show_setup(app: &AppHandle, items: &[Value], repair: bool) {
    to_splash(app);
    let items = serde_json::to_string(items).unwrap_or_else(|_| "[]".into());
    eval(app, &format!("window.showSetup && window.showSetup({items}, {repair})"));
}

/// Nome do usuario do Linux a criar no WSL: o do Windows, no formato do Linux.
fn linux_user_name() -> String {
    let raw = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default().to_lowercase();
    let name: String = raw.chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_' || *c == '-').take(32).collect();
    if name.starts_with(|c: char| c.is_ascii_lowercase()) && name != "root" { name } else { "jarvis".into() }
}

/// Repassa a saida do setup.sh para a tela: @step (progresso de cada item),
/// @restart (guardado em `restarts`) e o resto como registro.
fn setup_lines(app: &AppHandle, restarts: Arc<Mutex<Vec<String>>>) -> LineFn {
    let app = app.clone();
    Arc::new(move |line, _| {
        if let Some(step) = line.strip_prefix("@step ").and_then(|j| serde_json::from_str::<Value>(j).ok()) {
            eval(&app, &format!("window.setupStep && window.setupStep({step})"));
        } else if let Some(kind) = line.strip_prefix("@restart ") {
            if let Ok(mut r) = restarts.lock() {
                r.push(kind.trim().to_string());
            }
        } else {
            let text = line.strip_prefix("@status ").unwrap_or(line).trim();
            if !text.is_empty() && !text.starts_with('@') {
                let text = serde_json::to_string(text).unwrap_or_default();
                eval(&app, &format!("window.setupLog && window.setupLog({text})"));
            }
        }
    })
}

fn setup_step(app: &AppHandle, id: &str, state: &str, message: &str) {
    let step = serde_json::json!({ "id": id, "state": state, "message": message });
    eval(app, &format!("window.setupStep && window.setupStep({step})"));
}

fn setup_done(app: &AppHandle, restart: Option<&str>, error: Option<&str>) {
    let done = serde_json::json!({ "restart": restart, "error": error });
    eval(app, &format!("window.setupDone && window.setupDone({done})"));
}

/// Instala os itens aprovados, na ordem da lista: WSL (Windows), passos de root
/// (uma unica permissao de administrador) e passos do usuario. Para no primeiro
/// erro; no fim confere de novo e, com tudo pronto, sobe o servidor.
fn install(app: &AppHandle, ids: &[String]) {
    let (items, user, distro) = match app.state::<SetupState>().0.lock() {
        Ok(info) => (info.items.clone(), info.user.clone(), info.distro.clone()),
        Err(_) => return,
    };
    let is_root = |id: &str| items.iter().any(|i| i["id"] == id && i["root"] == true);
    let restarts = Arc::new(Mutex::new(Vec::<String>::new()));

    #[cfg(windows)]
    if ids.iter().any(|id| id == "wsl") {
        setup_step(app, "wsl", "start", "");
        match install_wsl(setup_lines(app, restarts.clone())) {
            Ok(restart) => {
                setup_step(app, "wsl", "ok", "");
                if restart {
                    return setup_done(app, Some("windows"), None);
                }
            }
            Err(e) => {
                setup_step(app, "wsl", "fail", &e);
                return setup_done(app, None, Some(&e));
            }
        }
    }

    let root_ids: Vec<String> = ids.iter().filter(|id| id.as_str() != "wsl" && is_root(id)).cloned().collect();
    let user_ids: Vec<String> = ids.iter().filter(|id| id.as_str() != "wsl" && !is_root(id)).cloned().collect();
    if !root_ids.is_empty() {
        let name = if root_ids.iter().any(|id| id == "wsl-user") { linux_user_name() } else { user.clone() };
        let mut args = vec!["install-root".to_string(), "--user".into(), name];
        args.extend(root_ids);
        if let Err(e) = setup_command(app, args, true).and_then(|cmd| run_step(cmd, setup_lines(app, restarts.clone()))) {
            return setup_done(app, None, Some(&e));
        }
    }
    // Distribuicao do WSL reiniciada: vale o usuario padrao, o systemd e o grupo docker.
    #[cfg(windows)]
    if restarts.lock().map(|r| r.iter().any(|k| k == "wsl")).unwrap_or(false) {
        let mut cmd = Command::new("wsl.exe");
        if distro.is_empty() { cmd.arg("--shutdown") } else { cmd.args(["--terminate", &distro]) };
        let _ = cmd.creation_flags(CREATE_NO_WINDOW).output();
    }
    #[cfg(not(windows))]
    let _ = distro;
    if !user_ids.is_empty() {
        let (_, payload) = match payload_args(app) {
            Ok(p) => p,
            Err(e) => return setup_done(app, None, Some(&e)),
        };
        let mut args = vec!["install".to_string()];
        args.extend(payload);
        args.extend(user_ids);
        if let Err(e) = setup_command(app, args, false).and_then(|cmd| run_step(cmd, setup_lines(app, restarts.clone()))) {
            return setup_done(app, None, Some(&e));
        }
    }

    if restarts.lock().map(|r| r.iter().any(|k| k == "logout")).unwrap_or(false) {
        return setup_done(app, Some("logout"), None);
    }
    match check(app) {
        Ok(items) if needs_attention(&items) => show_setup(app, &items, false),
        Ok(_) => {
            setup_done(app, None, None);
            start(app, false);
        }
        Err(e) => setup_done(app, None, Some(&e)),
    }
}

/// Um setup.sh install / install-root: erro com o fim da saida se falhar.
fn run_step(cmd: Command, on_line: LineFn) -> Result<(), String> {
    let (code, stdout, stderr) = run_lines(cmd, on_line)?;
    if code == Some(0) {
        return Ok(());
    }
    let failed = stdout
        .lines()
        .filter_map(|l| l.strip_prefix("@step ").and_then(|j| serde_json::from_str::<Value>(j).ok()))
        .find(|s| s["state"] == "fail")
        .and_then(|s| s["message"].as_str().map(str::to_string));
    Err(failed.filter(|m| !m.trim().is_empty()).unwrap_or_else(|| tail(&stderr, 6)))
}

/// Distribuicoes do WSL instaladas (None: o WSL nao responde).
#[cfg(windows)]
fn wsl_distros() -> Option<Vec<String>> {
    let out = Command::new("wsl.exe").args(["-l", "-q"]).creation_flags(CREATE_NO_WINDOW).output().ok()?;
    if !out.status.success() {
        return None;
    }
    // O wsl.exe escreve em UTF-16.
    let units: Vec<u16> = out.stdout.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    let text = String::from_utf16_lossy(&units);
    Some(text.lines().map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0').to_string()).filter(|l| !l.is_empty()).collect())
}

/// Item do WSL, se faltar o WSL ou a distribuicao (JARVIS_WSL_DISTRO ou qualquer uma).
#[cfg(windows)]
fn wsl_missing() -> Option<Vec<Value>> {
    let wanted = env_distro();
    let ready = match wsl_distros() {
        Some(list) => match &wanted {
            Some(d) => list.iter().any(|x| x.eq_ignore_ascii_case(d)),
            None => !list.is_empty(),
        },
        None => false,
    };
    if ready {
        return None;
    }
    let distro = wanted.unwrap_or_else(|| "Ubuntu".into());
    Some(vec![serde_json::json!({
        "id": "wsl", "state": "missing", "root": false, "found": "",
        "title": format!("WSL2 e {distro}"),
        "why": "No Windows, os agentes, os containers e o servidor do Jarvis rodam num Linux dentro do WSL. Depois dele, o Jarvis confere o resto (Docker, Node, Python e a voz).",
        "action": format!("Instala o WSL2 e o {distro} (wsl --install -d {distro}). O Windows pede permissão de administrador e pode pedir para reiniciar o computador."),
        "size": "~1 GB",
    })])
}

/// wsl --install da distribuicao. Ok(true): falta reiniciar o Windows.
#[cfg(windows)]
fn install_wsl(on_line: LineFn) -> Result<bool, String> {
    let distro = env_distro().unwrap_or_else(|| "Ubuntu".into());
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--install", "-d", &distro, "--no-launch"]).env("WSL_UTF8", "1").creation_flags(CREATE_NO_WINDOW);
    let (code, stdout, stderr) = run_lines(cmd, on_line)?;
    if wsl_missing().is_none() {
        return Ok(false);
    }
    // Instalada pela Store sem abrir: registra pelo lancador da distribuicao (ubuntu.exe, ubuntu2404.exe...).
    let launcher = format!("{}.exe", distro.to_lowercase().replace(['-', '.'], ""));
    let _ = Command::new(&launcher).args(["install", "--root"]).creation_flags(CREATE_NO_WINDOW).output();
    if wsl_missing().is_none() {
        return Ok(false);
    }
    if code == Some(0) {
        // O WSL acabou de ser ligado: a distribuicao so aparece depois de reiniciar.
        return Ok(true);
    }
    Err(format!("O wsl --install falhou.\n{}", tail(&format!("{stderr}\n{stdout}"), 10)))
}

#[tauri::command]
fn retry(app: AppHandle) {
    boot(app, false);
}

/// Instala os itens aprovados na tela de abertura.
#[tauri::command]
fn setup_install(app: AppHandle, ids: Vec<String>) {
    thread::spawn(move || install(&app, &ids));
}

/// "Agora não": sobe o servidor sem instalar nada.
#[tauri::command]
fn setup_skip(app: AppHandle) {
    thread::spawn(move || start(&app, false));
}

/// Bandeja: mostra a lista (tambem o que ja esta ok), para reparar ou reinstalar.
fn review_setup(app: &AppHandle) {
    show(app);
    let app = app.clone();
    thread::spawn(move || {
        if payload(&app).is_none() {
            return show_error(&app, "Este build do Jarvis não traz o pacote de instalação (use o instalador do release).");
        }
        to_splash(&app);
        eval(&app, "window.setStatus && window.setStatus('Conferindo o que o Jarvis precisa…')");
        match check(&app) {
            Ok(items) => show_setup(&app, &items, true),
            Err(e) => show_error(&app, &e),
        }
    });
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
        .manage(SetupState(Mutex::new(SetupInfo::default())))
        .invoke_handler(tauri::generate_handler![retry, server_url, show_main, setup_install, setup_skip])
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
            let setup_item = MenuItem::with_id(app, "setup", "Verificar a instalação", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &autostart_item, &restart_item, &setup_item, &quit_item])?;
            app.manage(AutostartItem(autostart_item));
            let mut tray = TrayIconBuilder::new()
                .tooltip("Jarvis")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "autostart" => set_autostart(app, !autostart_enabled(app)),
                    "restart" => boot(app.clone(), true),
                    "setup" => review_setup(app),
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
