//! Native Chrome DevTools driver. Test orchestration, locators and assertions
//! are Rust; fixed DOM interop shims only access browser APIs, like WASM glue.
use crate::{Result, root};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tungstenite::{Message, WebSocket};

#[derive(Clone, Debug)]
pub enum Text {
    Exact(String),
    Contains(String),
    Regex(regex::Regex),
}
impl Text {
    pub fn exact(text: impl Into<String>) -> Self {
        Self::Exact(text.into())
    }
    pub fn contains(text: impl Into<String>) -> Self {
        Self::Contains(text.into())
    }
    pub fn regex(text: &str) -> Self {
        Self::Regex(regex::Regex::new(text).expect("authored browser pattern"))
    }
    fn matches(&self, text: &str) -> bool {
        let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
        match self {
            Self::Exact(wanted) => &normalized == wanted,
            Self::Contains(wanted) => normalized.contains(wanted),
            Self::Regex(pattern) => pattern.is_match(&normalized),
        }
    }
}
#[derive(Clone, Debug)]
enum Kind {
    Css(String),
    Role(String, Option<Text>),
    Text(Text),
    Label(String),
}
#[derive(Clone, Debug)]
pub struct Locator {
    kind: Kind,
    scope: Option<Box<Locator>>,
    has: Option<Box<Locator>>,
    text: Option<Text>,
    index: Option<usize>,
}
impl Locator {
    fn new(kind: Kind) -> Self {
        Self {
            kind,
            scope: None,
            has: None,
            text: None,
            index: None,
        }
    }
    pub fn css(selector: impl Into<String>) -> Self {
        Self::new(Kind::Css(selector.into()))
    }
    pub fn role(role: impl Into<String>, name: Option<Text>) -> Self {
        Self::new(Kind::Role(role.into(), name))
    }
    pub fn text(text: Text) -> Self {
        Self::new(Kind::Text(text))
    }
    pub fn label(label: impl Into<String>) -> Self {
        Self::new(Kind::Label(label.into()))
    }
    pub fn within(mut self, scope: &Locator) -> Self {
        self.scope = Some(Box::new(scope.clone()));
        self
    }
    pub fn having(mut self, descendant: &Locator) -> Self {
        self.has = Some(Box::new(descendant.clone()));
        self
    }
    pub fn containing(mut self, text: Text) -> Self {
        self.text = Some(text);
        self
    }
    pub fn nth(mut self, index: usize) -> Self {
        self.index = Some(index);
        self
    }
    pub fn first(self) -> Self {
        self.nth(0)
    }
}
#[derive(Clone)]
pub struct Page {
    pub target: String,
    pub session: String,
    pub context: Option<String>,
}
pub struct Browser {
    socket: WebSocket<TcpStream>,
    sequence: u64,
    child: Child,
    directory: tempfile::TempDir,
    events: VecDeque<Value>,
    pub exceptions: Vec<Value>,
    routes: BTreeMap<(String, String), (u16, Value)>,
    interceptors: BTreeMap<String, Interceptor>,
}
pub struct MockResponse {
    pub status: u16,
    pub content_type: String,
    pub bytes: Vec<u8>,
}
impl MockResponse {
    pub fn json(status: u16, value: &Value) -> Result<Self> {
        Ok(Self {
            status,
            content_type: "application/json".into(),
            bytes: serde_json::to_vec(value)?,
        })
    }
}
type Interceptor = Box<dyn FnMut(&Value) -> Result<MockResponse> + Send>;
#[derive(Debug)]
struct DetachedDom;
impl std::fmt::Display for DetachedDom {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Native browser DOM changed during locator lookup")
    }
}
impl std::error::Error for DetachedDom {}
fn protocol_error(method: &str, error: &Value) -> Box<dyn std::error::Error + Send + Sync> {
    let lookup = matches!(
        method,
        "DOM.describeNode"
            | "DOM.resolveNode"
            | "DOM.querySelectorAll"
            | "DOM.pushNodesByBackendIdsToFrontend"
            | "Runtime.callFunctionOn"
    );
    let missing = error["code"] == -32000
        && error["message"].as_str().is_some_and(|message| {
            [
                "Could not find node with given",
                "No node with given id",
                "Could not find object with given id",
                "Cannot find context with specified id",
                "Execution context was destroyed",
            ]
            .iter()
            .any(|prefix| message.starts_with(prefix))
        });
    if lookup && missing {
        Box::new(DetachedDom)
    } else {
        // CDP error payloads can contain page data; retain only our fixed method.
        format!("Chrome protocol command failed: {method}").into()
    }
}
struct PendingChild(Option<Child>);
impl Drop for PendingChild {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(child.id() as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Browser {
    fn drop(&mut self) {
        let _ = self.socket.send(Message::Text(
            json!({"id":self.sequence+1,"method":"Browser.close","params":{}})
                .to_string()
                .into(),
        ));
        for _ in 0..80 {
            // Inspect without reaping: keep the child PID reserved until the
            // owned process group has been terminated, then wait exactly once.
            if fs::read_to_string(format!("/proc/{}/stat", self.child.id()))
                .ok()
                .is_some_and(|value| {
                    value
                        .rsplit_once(')')
                        .is_some_and(|(_, tail)| tail.trim_start().starts_with('Z'))
                })
            {
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let _ = nix::sys::signal::killpg(
            nix::unistd::Pid::from_raw(self.child.id() as i32),
            nix::sys::signal::Signal::SIGKILL,
        );
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn manifest() -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(
        root().join("docs/dependencies/test-browser.json"),
    )?)?)
}
fn executable() -> Result<PathBuf> {
    let manifest = manifest()?;
    let candidates = if let Some(path) = std::env::var_os("KELRYVO_TEST_BROWSER") {
        vec![PathBuf::from(path)]
    } else {
        vec![
            root().join(".cache/native-browser").join(
                manifest["executable"]
                    .as_str()
                    .ok_or("Browser executable pin")?,
            ),
            PathBuf::from(std::env::var_os("HOME").ok_or("Home directory unavailable")?)
                .join(".cache/ms-playwright/chromium-1248/chrome-linux64/chrome"),
        ]
    };
    for candidate in candidates {
        if candidate.is_file() {
            let meta = fs::symlink_metadata(&candidate)?;
            if meta.is_symlink() {
                return Err("Pinned browser executable cannot be a symlink".into());
            }
            if meta.len()
                != manifest["executableBytes"]
                    .as_u64()
                    .ok_or("Browser size pin")?
                || kelryvo_core::sha256(fs::read(&candidate)?) != manifest["executableSha256"]
            {
                return Err("Browser executable differs from the reviewed test pin".into());
            }
            return Ok(candidate);
        }
    }
    Err("Pinned native test browser unavailable; run kelryvo-test --install-browser".into())
}
impl Browser {
    pub fn launch() -> Result<Self> {
        use std::os::unix::{fs::DirBuilderExt, process::CommandExt};
        if std::env::consts::OS != "linux" || std::env::consts::ARCH != "x86_64" {
            return Err(
                "Pinned browser scope is Linux amd64; native ARM server checks are separate".into(),
            );
        }
        let directory =
            crate::process::private_directory("rust-browser-cdp-", &root().join(".cache"))?;
        let profile = directory.path().join("profile");
        std::fs::DirBuilder::new().mode(0o700).create(&profile)?;
        let mut child = PendingChild(Some(
            Command::new(executable()?)
                .process_group(0)
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .env("LANG", "C.UTF-8")
                .env("TZ", "UTC")
                .args([
                    "--headless=new",
                    "--hide-scrollbars",
                    "--no-sandbox",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--disable-background-networking",
                    "--disable-extensions",
                    "--remote-debugging-address=127.0.0.1",
                    "--remote-debugging-port=0",
                ])
                .arg(format!("--user-data-dir={}", profile.display()))
                .arg("about:blank")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(fs::File::create(directory.path().join("chrome.log"))?)
                .spawn()?,
        ));
        let port_file = profile.join("DevToolsActivePort");
        let start = Instant::now();
        let endpoint = loop {
            if child.0.as_mut().unwrap().try_wait()?.is_some() {
                return Err("Pinned Chrome exited before protocol readiness".into());
            }
            if let Ok(port) = fs::read_to_string(&port_file) {
                let mut lines = port.lines();
                if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                    break format!("ws://127.0.0.1:{port}{path}");
                }
            }
            if start.elapsed() > Duration::from_secs(15) {
                return Err("Pinned Chrome protocol readiness timed out".into());
            }
            thread::sleep(Duration::from_millis(25));
        };
        let url = url::Url::parse(&endpoint)?;
        let address = ("127.0.0.1", url.port().ok_or("Chrome protocol port")?)
            .to_socket_addrs()?
            .next()
            .ok_or("Chrome loopback address")?;
        let stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))?;
        stream.set_read_timeout(Some(Duration::from_secs(15)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let config = tungstenite::protocol::WebSocketConfig::default()
            .max_message_size(Some(16 * 1024 * 1024))
            .max_frame_size(Some(16 * 1024 * 1024));
        let (socket, _) =
            tungstenite::client::client_with_config(endpoint.as_str(), stream, Some(config))
                .map_err(|_| "Native Chrome WebSocket handshake failed")?;
        Ok(Self {
            socket,
            sequence: 0,
            child: child.0.take().unwrap(),
            directory,
            events: VecDeque::new(),
            exceptions: Vec::new(),
            routes: BTreeMap::new(),
            interceptors: BTreeMap::new(),
        })
    }
    pub fn call(&mut self, page: Option<&Page>, method: &str, params: Value) -> Result<Value> {
        self.sequence += 1;
        let id = self.sequence;
        let mut request = json!({"id":id,"method":method,"params":params});
        if let Some(page) = page {
            request["sessionId"] = page.session.clone().into();
        }
        self.socket
            .send(Message::Text(request.to_string().into()))?;
        loop {
            let message = self.socket.read()?;
            let Message::Text(text) = message else {
                continue;
            };
            let value: Value = serde_json::from_str(&text)?;
            if value["method"] == "Fetch.requestPaused" {
                use base64::Engine;
                let session = value["sessionId"]
                    .as_str()
                    .ok_or("Intercepted browser session")?;
                let url = value["params"]["request"]["url"]
                    .as_str()
                    .ok_or("Intercepted browser URL")?;
                let route = self
                    .routes
                    .get(&(session.to_owned(), url.to_owned()))
                    .or_else(|| {
                        self.routes.iter().find_map(|((s, pattern), route)| {
                            (s == session
                                && pattern
                                    .strip_suffix('*')
                                    .is_some_and(|prefix| url.starts_with(prefix)))
                            .then_some(route)
                        })
                    });
                let response = if let Some((status, body)) = route {
                    Some(MockResponse::json(*status, body)?)
                } else if let Some(handler) = self.interceptors.get_mut(session) {
                    Some(handler(&value["params"]["request"])?)
                } else {
                    None
                };
                self.sequence += 1;
                let request = if let Some(response) = response {
                    if !(100..=599).contains(&response.status)
                        || response.bytes.len() > 16 * 1024 * 1024
                    {
                        return Err("Invalid or unbounded native browser fixture response".into());
                    }
                    json!({"id":self.sequence,"sessionId":session,"method":"Fetch.fulfillRequest","params":{"requestId":value["params"]["requestId"],"responseCode":response.status,"responseHeaders":[{"name":"content-type","value":response.content_type}],"body":base64::engine::general_purpose::STANDARD.encode(&response.bytes)}})
                } else {
                    json!({"id":self.sequence,"sessionId":session,"method":"Fetch.continueRequest","params":{"requestId":value["params"]["requestId"]}})
                };
                self.socket
                    .send(Message::Text(request.to_string().into()))?;
                continue;
            }
            if value["id"] == id {
                if value.get("error").is_some() {
                    return Err(protocol_error(method, &value["error"]));
                }
                return Ok(value["result"].clone());
            }
            if value["method"] == "Runtime.exceptionThrown" {
                self.exceptions.push(value.clone());
            }
            if matches!(
                value["method"].as_str(),
                Some(
                    "Network.responseReceived"
                        | "Network.responseReceivedExtraInfo"
                        | "Network.requestWillBeSent"
                        | "Network.loadingFailed"
                        | "Fetch.requestPaused"
                        | "Page.javascriptDialogOpening"
                        | "Browser.downloadWillBegin"
                        | "Browser.downloadProgress"
                        | "Runtime.exceptionThrown"
                )
            ) {
                if self.events.len() >= 16384 {
                    return Err("Native browser event retention bound exceeded".into());
                }
                self.events.push_back(value);
            }
        }
    }
    pub fn page(&mut self, independent: bool) -> Result<Page> {
        let context = if independent {
            Some(
                self.call(
                    None,
                    "Target.createBrowserContext",
                    json!({"disposeOnDetach":true}),
                )?["browserContextId"]
                    .as_str()
                    .ok_or("Browser context")?
                    .to_owned(),
            )
        } else {
            None
        };
        let mut params = json!({"url":"about:blank"});
        if let Some(context) = &context {
            params["browserContextId"] = context.clone().into();
        }
        let target = self.call(None, "Target.createTarget", params)?["targetId"]
            .as_str()
            .ok_or("Browser target")?
            .to_owned();
        let session = self.call(
            None,
            "Target.attachToTarget",
            json!({"targetId":target,"flatten":true}),
        )?["sessionId"]
            .as_str()
            .ok_or("Browser session")?
            .to_owned();
        let page = Page {
            target,
            session,
            context,
        };
        for domain in [
            "Page.enable",
            "DOM.enable",
            "Runtime.enable",
            "Accessibility.enable",
            "Network.enable",
        ] {
            self.call(Some(&page), domain, json!({}))?;
        }
        self.call(
            Some(&page),
            "Security.setIgnoreCertificateErrors",
            json!({"ignore":true}),
        )?;
        self.viewport(&page, 1280, 720)?;
        Ok(page)
    }
    pub fn route_json(&mut self, page: &Page, url: &str, body: Option<Value>) -> Result<()> {
        self.route_response(page, url, body.map(|body| (200, body)))
    }
    /// An exact fixture URL or one trailing `*` for a selected query prefix.
    /// Routing stays scoped to this browser session; unrelated requests pass.
    pub fn route_response(
        &mut self,
        page: &Page,
        url: &str,
        response: Option<(u16, Value)>,
    ) -> Result<()> {
        if response
            .as_ref()
            .is_some_and(|(status, _)| !(100..=599).contains(status))
        {
            return Err("Invalid browser fixture response status".into());
        }
        let key = (page.session.clone(), url.to_owned());
        if let Some(response) = response {
            self.routes.insert(key, response);
        } else {
            self.routes.remove(&key);
        }
        self.refresh_routes(page)
    }
    /// A session-scoped Rust response fixture. No JavaScript test handler or
    /// HTTP server is needed to exercise the compiled WASM client.
    pub fn intercept(
        &mut self,
        page: &Page,
        handler: impl FnMut(&Value) -> Result<MockResponse> + Send + 'static,
    ) -> Result<()> {
        self.interceptors
            .insert(page.session.clone(), Box::new(handler));
        self.refresh_routes(page)
    }
    fn refresh_routes(&mut self, page: &Page) -> Result<()> {
        let mut patterns: Vec<_> = self
            .routes
            .keys()
            .filter(|(session, _)| session == &page.session)
            .map(|(_, url)| json!({"urlPattern":url,"requestStage":"Request"}))
            .collect();
        if self.interceptors.contains_key(&page.session) {
            patterns.push(json!({"urlPattern":"*","requestStage":"Request"}));
        }
        if patterns.is_empty() {
            self.call(Some(page), "Fetch.disable", json!({}))?;
        } else {
            self.call(Some(page), "Fetch.enable", json!({"patterns":patterns}))?;
        }
        Ok(())
    }
    pub fn close_page(&mut self, page: &Page) -> Result<()> {
        self.interceptors.remove(&page.session);
        self.routes
            .retain(|(session, _), _| session != &page.session);
        if let Some(context) = &page.context {
            self.call(
                None,
                "Target.disposeBrowserContext",
                json!({"browserContextId":context}),
            )?;
        } else {
            self.call(None, "Target.closeTarget", json!({"targetId":page.target}))?;
        }
        Ok(())
    }
    pub fn goto(&mut self, page: &Page, url: &str) -> Result<()> {
        let result = self.call(Some(page), "Page.navigate", json!({"url":url}))?;
        if result["errorText"].as_str().is_some_and(|s| !s.is_empty()) {
            return Err("Native browser navigation failed".into());
        }
        let expected = url::Url::parse(url)?.to_string();
        let start = Instant::now();
        while self.url(page).ok().as_deref() != Some(expected.as_str()) {
            if start.elapsed() > Duration::from_secs(15) {
                return Err("Native browser navigation did not commit".into());
            }
            thread::sleep(Duration::from_millis(25));
        }
        self.wait(page, &Locator::css("body"), true)?;
        Ok(())
    }
    pub fn reload(&mut self, page: &Page) -> Result<()> {
        self.call(Some(page), "Page.reload", json!({"ignoreCache":true}))?;
        self.wait(page, &Locator::css("body"), true)
    }
    pub fn evaluate(&mut self, page: &Page, expression: &str) -> Result<Value> {
        let result = self.call(
            Some(page),
            "Runtime.evaluate",
            json!({"expression":expression,"returnByValue":true,"awaitPromise":true}),
        )?;
        if result.get("exceptionDetails").is_some() {
            return Err("Native browser DOM interop failed".into());
        }
        Ok(result["result"]["value"].clone())
    }
    fn object(&mut self, page: &Page, backend: u64) -> Result<String> {
        Ok(self.call(
            Some(page),
            "DOM.resolveNode",
            json!({"backendNodeId":backend}),
        )?["object"]["objectId"]
            .as_str()
            .ok_or("Browser DOM object")?
            .to_owned())
    }
    fn dom(
        &mut self,
        page: &Page,
        backend: u64,
        function: &str,
        arguments: Vec<Value>,
    ) -> Result<Value> {
        let object = self.object(page, backend)?;
        let result=self.call(Some(page),"Runtime.callFunctionOn",json!({"objectId":object,"functionDeclaration":function,"arguments":arguments,"returnByValue":true,"awaitPromise":true}))?;
        if result.get("exceptionDetails").is_some() {
            return Err("Native browser DOM operation failed".into());
        }
        Ok(result["result"]["value"].clone())
    }
    fn contains(&mut self, page: &Page, root: u64, child: u64) -> Result<bool> {
        let object = self.object(page, child)?;
        Ok(self.dom(
            page,
            root,
            "function(child){return this.contains(child)}",
            vec![json!({"objectId":object})],
        )? == true)
    }
    fn nodes(&mut self, page: &Page, locator: &Locator, root: Option<u64>) -> Result<Vec<u64>> {
        let started = Instant::now();
        loop {
            match self.nodes_once(page, locator, root) {
                Err(error)
                    if root.is_none()
                        && error.is::<DetachedDom>()
                        && started.elapsed() < Duration::from_secs(15) =>
                {
                    // Only restart a read-only lookup from its document/scope.
                    // Mouse, keyboard and submitted mutations are never replayed.
                    thread::sleep(Duration::from_millis(25));
                }
                result => return result,
            }
        }
    }
    fn nodes_once(
        &mut self,
        page: &Page,
        locator: &Locator,
        root: Option<u64>,
    ) -> Result<Vec<u64>> {
        if let Some(scope) = &locator.scope {
            let parents = self.nodes(page, scope, root)?;
            let mut child = locator.clone();
            child.scope = None;
            let index = child.index.take();
            let mut nodes = Vec::new();
            for parent in parents {
                for node in self.nodes(page, &child, Some(parent))? {
                    if !nodes.contains(&node) {
                        nodes.push(node);
                    }
                }
            }
            return Ok(if let Some(index) = index {
                nodes.into_iter().nth(index).into_iter().collect()
            } else {
                nodes
            });
        }
        let scope = root;
        let mut nodes = match &locator.kind {
            Kind::Css(selector) => {
                let document =
                    self.call(Some(page), "DOM.getDocument", json!({"depth":0}))?["root"]["nodeId"]
                        .as_u64()
                        .ok_or("Browser document")?;
                let node = if let Some(scope) = scope {
                    self.call(
                        Some(page),
                        "DOM.pushNodesByBackendIdsToFrontend",
                        json!({"backendNodeIds":[scope]}),
                    )?["nodeIds"][0]
                        .as_u64()
                        .ok_or("Browser scope node")?
                } else {
                    document
                };
                let found = self.call(
                    Some(page),
                    "DOM.querySelectorAll",
                    json!({"nodeId":node,"selector":selector}),
                )?;
                let mut nodes = Vec::new();
                for id in found["nodeIds"]
                    .as_array()
                    .ok_or("Browser selector result")?
                {
                    nodes.push(self.call(Some(page),"DOM.describeNode",json!({"nodeId":id}))?["node"]["backendNodeId"].as_u64().ok_or("Browser backend node")?);
                }
                nodes
            }
            Kind::Role(role, name) => {
                let tree = self.call(Some(page), "Accessibility.getFullAXTree", json!({}))?;
                tree["nodes"]
                    .as_array()
                    .ok_or("Browser accessibility tree")?
                    .iter()
                    .filter(|node| {
                        node["ignored"] != true
                            && node["role"]["value"] == role.as_str()
                            && name.as_ref().is_none_or(|wanted| {
                                wanted.matches(node["name"]["value"].as_str().unwrap_or(""))
                            })
                    })
                    .filter_map(|node| node["backendDOMNodeId"].as_u64())
                    .collect()
            }
            Kind::Text(text) => {
                let tree = self.call(Some(page), "Accessibility.getFullAXTree", json!({}))?;
                let text_nodes: Vec<_> = tree["nodes"]
                    .as_array()
                    .ok_or("Browser accessibility tree")?
                    .iter()
                    .filter(|node| {
                        node["ignored"] != true
                            && node["role"]["value"] == "StaticText"
                            && text.matches(node["name"]["value"].as_str().unwrap_or(""))
                    })
                    .filter_map(|node| node["backendDOMNodeId"].as_u64())
                    .collect();
                let mut elements = Vec::new();
                for node in text_nodes {
                    let object = self.object(page, node)?;
                    let parent=self.call(Some(page),"Runtime.callFunctionOn",json!({"objectId":object,"functionDeclaration":"function(){return this.nodeType===3?this.parentElement:this}","returnByValue":false}))?;
                    if parent["result"]["subtype"] == "null"
                        || parent["result"]["type"] == "undefined"
                    {
                        return Err(Box::new(DetachedDom));
                    }
                    let object = parent["result"]["objectId"]
                        .as_str()
                        .ok_or("Browser text parent")?;
                    let node = self.call(
                        Some(page),
                        "DOM.describeNode",
                        json!({"objectId":object}),
                    )?["node"]["backendNodeId"]
                        .as_u64()
                        .ok_or("Browser text element")?;
                    if !elements.contains(&node) {
                        elements.push(node);
                    }
                }
                elements
            }
            Kind::Label(label) => {
                let tree = self.call(Some(page), "Accessibility.getFullAXTree", json!({}))?;
                let controls: Vec<_> = tree["nodes"]
                    .as_array()
                    .ok_or("Browser accessibility tree")?
                    .iter()
                    .filter(|node| {
                        node["ignored"] != true
                            && matches!(
                                node["role"]["value"].as_str(),
                                Some(
                                    "textbox"
                                        | "combobox"
                                        | "checkbox"
                                        | "radio"
                                        | "spinbutton"
                                        | "searchbox"
                                )
                            )
                            && Text::exact(label)
                                .matches(node["name"]["value"].as_str().unwrap_or(""))
                    })
                    .filter_map(|node| node["backendDOMNodeId"].as_u64())
                    .collect();
                if !controls.is_empty() {
                    controls
                } else {
                    // Resolve label association through the DOM API; the authored
                    // test remains Rust and supplied text is a JSON data argument.
                    let labels = self.nodes(page, &Locator::css("label"), scope)?;
                    let mut found = Vec::new();
                    for node in labels {
                        if Text::exact(label).matches(
                            self.dom(page, node, "function(){return this.textContent}", vec![])?
                                .as_str()
                                .unwrap_or(""),
                        ) {
                            let object = self.object(page, node)?;
                            let result=self.call(Some(page),"Runtime.callFunctionOn",json!({"objectId":object,"functionDeclaration":"function(){return this.control}","returnByValue":false}))?;
                            if let Some(object) = result["result"]["objectId"].as_str() {
                                let described = self.call(
                                    Some(page),
                                    "DOM.describeNode",
                                    json!({"objectId":object}),
                                )?;
                                if let Some(id) = described["node"]["backendNodeId"].as_u64() {
                                    found.push(id);
                                }
                            }
                        }
                    }
                    found
                }
            }
        };
        let mut filtered = Vec::new();
        for node in nodes.drain(..) {
            if let Some(scope) = scope
                && !self.contains(page, scope, node)?
            {
                continue;
            }
            if let Some(text) = &locator.text
                && !text.matches(&self.inner_text_at(page, node)?)
            {
                continue;
            }
            if let Some(has) = &locator.has
                && self.nodes(page, has, Some(node))?.is_empty()
            {
                continue;
            }
            filtered.push(node);
        }
        Ok(if let Some(index) = locator.index {
            filtered.get(index).copied().into_iter().collect()
        } else {
            filtered
        })
    }
    pub fn count(&mut self, page: &Page, locator: &Locator) -> Result<usize> {
        Ok(self.nodes(page, locator, None)?.len())
    }
    pub fn wait(&mut self, page: &Page, locator: &Locator, visible: bool) -> Result<()> {
        let start = Instant::now();
        loop {
            let found = self.nodes(page, locator, None).unwrap_or_default();
            let mut any = false;
            for node in found {
                if self.dom(page,node,"function(){const element=this.nodeType===3?this.parentElement:this;return element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}) && element.getClientRects().length>0}",vec![]).is_ok_and(|visible|visible==true)
                {
                    any = true;
                    break;
                }
            }
            if any == visible {
                return Ok(());
            }
            if start.elapsed() > Duration::from_secs(15) {
                return Err(
                    format!("Native browser locator wait timed out: {:?}", locator.kind).into(),
                );
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
    fn one(&mut self, page: &Page, locator: &Locator) -> Result<u64> {
        self.wait(page, locator, true)?;
        self.attached_one(page, locator)
    }
    fn attached_one(&mut self, page: &Page, locator: &Locator) -> Result<u64> {
        let start = Instant::now();
        loop {
            let nodes = self.nodes(page, locator, None)?;
            match nodes.as_slice() {
                [node] => return Ok(*node),
                [] if start.elapsed() < Duration::from_secs(15) => {
                    thread::sleep(Duration::from_millis(25))
                }
                _ => {
                    return Err(format!(
                        "Native browser attached locator is not unique ({} matches): {locator:?}",
                        nodes.len()
                    )
                    .into());
                }
            }
        }
    }
    pub fn click(&mut self, page: &Page, locator: &Locator) -> Result<()> {
        self.click_position(page, locator, None)
    }
    pub fn click_position(
        &mut self,
        page: &Page,
        locator: &Locator,
        position: Option<(f64, f64)>,
    ) -> Result<()> {
        // Scrolling, responsive layout and a completed API render may move a
        // control. Resolve and hit-test again before sending any mouse input;
        // a submitted click is never retried.
        let start = Instant::now();
        let (x, y) = loop {
            let node = self.one(page, locator)?;
            if self
                .call(
                    Some(page),
                    "DOM.scrollIntoViewIfNeeded",
                    json!({"backendNodeId":node}),
                )
                .is_err()
            {
                if start.elapsed() > Duration::from_secs(15) {
                    return Err("Browser click target detached before scrolling".into());
                }
                thread::sleep(Duration::from_millis(25));
                continue;
            }
            let hit=self.dom(page,node,"async function(x,y){this.scrollIntoView({block:'center',inline:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=this.getBoundingClientRect();x=r.x+(x??r.width/2);y=r.y+(y??r.height/2);const hit=document.elementFromPoint(x,y);return {inside:hit!==null&&(hit===this||this.contains(hit)),enabled:!this.matches(':disabled')&&!this.closest('[aria-disabled=\"true\"]'),x,y,tag:hit?.tagName,target:this.tagName,rect:{left:r.left,top:r.top,width:r.width,height:r.height},width:innerWidth,height:innerHeight}}",vec![json!({"value":position.map(|p|p.0)}),json!({"value":position.map(|p|p.1)})])?;
            if hit["inside"] == true && hit["enabled"] == true {
                break (
                    hit["x"].as_f64().ok_or("Browser viewport x")?,
                    hit["y"].as_f64().ok_or("Browser viewport y")?,
                );
            }
            if start.elapsed() > Duration::from_secs(15) {
                return Err(format!(
                    "Browser click target never received its viewport hit test: {:?} {hit}",
                    locator.kind
                )
                .into());
            }
            thread::sleep(Duration::from_millis(25));
        };
        for kind in ["mousePressed", "mouseReleased"] {
            self.call(
                Some(page),
                "Input.dispatchMouseEvent",
                json!({"type":kind,"x":x,"y":y,"button":"left","clickCount":1}),
            )?;
        }
        Ok(())
    }
    pub fn fill(&mut self, page: &Page, locator: &Locator, text: &str) -> Result<()> {
        // Rendering can replace a form between discovery and focus. Resolve
        // again before any input is sent; never replay a submitted mutation.
        let start = Instant::now();
        loop {
            let node = self.one(page, locator)?;
            if self
                .call(Some(page), "DOM.focus", json!({"backendNodeId":node}))
                .is_ok()
            {
                break;
            }
            if start.elapsed() > Duration::from_secs(15) {
                return Err(
                    format!("Browser input did not become focusable: {:?}", locator.kind).into(),
                );
            }
            thread::sleep(Duration::from_millis(25));
        }
        for kind in ["keyDown", "keyUp"] {
            self.call(Some(page),"Input.dispatchKeyEvent",json!({"type":kind,"key":"a","code":"KeyA","windowsVirtualKeyCode":65,"modifiers":2}))?;
        }
        for kind in ["keyDown", "keyUp"] {
            self.call(
                Some(page),
                "Input.dispatchKeyEvent",
                json!({"type":kind,"key":"Backspace","code":"Backspace","windowsVirtualKeyCode":8}),
            )?;
        }
        if !text.is_empty() {
            self.call(Some(page), "Input.insertText", json!({"text":text}))?;
        }
        Ok(())
    }
    pub fn visible(&mut self, page: &Page, locator: &Locator) -> Result<bool> {
        for node in self.nodes(page, locator, None)? {
            if self.dom(page,node,"function(){return this.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}) && this.getClientRects().length>0}",vec![])?==true{return Ok(true);}
        }
        Ok(false)
    }
    pub fn element(
        &mut self,
        page: &Page,
        locator: &Locator,
        function: &str,
        arguments: Vec<Value>,
    ) -> Result<Value> {
        let node = self.one(page, locator)?;
        self.dom(page, node, function, arguments)
    }
    pub fn viewport(&mut self, page: &Page, width: u32, height: u32) -> Result<()> {
        self.call(
            Some(page),
            "Emulation.setDeviceMetricsOverride",
            json!({"width":width,"height":height,"deviceScaleFactor":1,"mobile":false}),
        )?;
        self.evaluate(
            page,
            "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        )?;
        Ok(())
    }
    pub fn key(&mut self, page: &Page, key: &str) -> Result<()> {
        let (code, virtual_code) = match key {
            "Escape" => ("Escape", 27),
            "Enter" => ("Enter", 13),
            _ => return Err("Unsupported native browser test key".into()),
        };
        for kind in ["keyDown", "keyUp"] {
            self.call(
                Some(page),
                "Input.dispatchKeyEvent",
                json!({"type":kind,"key":key,"code":code,"windowsVirtualKeyCode":virtual_code}),
            )?;
        }
        self.evaluate(page, "new Promise(resolve=>requestAnimationFrame(resolve))")?;
        Ok(())
    }
    pub fn api_requests(&mut self, page: &Page) -> Result<usize> {
        self.evaluate(page, "0")?;
        Ok(self
            .events
            .iter()
            .filter(|event| {
                event["sessionId"] == page.session
                    && event["method"] == "Network.requestWillBeSent"
                    && event["params"]["request"]["url"]
                        .as_str()
                        .and_then(|u| url::Url::parse(u).ok())
                        .is_some_and(|u| u.path().starts_with("/api/"))
            })
            .count())
    }
    pub fn requests_ending(&mut self, page: &Page, suffix: &str) -> Result<usize> {
        self.evaluate(page, "0")?;
        Ok(self
            .events
            .iter()
            .filter(|event| {
                event["sessionId"] == page.session
                    && event["method"] == "Network.requestWillBeSent"
                    && event["params"]["request"]["url"]
                        .as_str()
                        .is_some_and(|u| u.ends_with(suffix))
            })
            .count())
    }
    pub fn failed_responses(&mut self, page: &Page) -> Result<Value> {
        self.evaluate(page, "0")?;
        Ok(Value::Array(
            self.events
                .iter()
                .filter_map(|event| {
                    let response = &event["params"]["response"];
                    if event["sessionId"] != page.session
                        || event["method"] != "Network.responseReceived"
                        || response["status"].as_u64()? < 400
                    {
                        return None;
                    }
                    let url = url::Url::parse(response["url"].as_str()?).ok()?;
                    Some(json!([url.path(), response["status"]]))
                })
                .collect(),
        ))
    }
    /// Read the actual browser response; do not replay a mutation to inspect it.
    pub fn response_json(&mut self, page: &Page, url: &str) -> Result<Value> {
        use base64::Engine;
        self.evaluate(page, "0")?;
        let request = self
            .events
            .iter()
            .rev()
            .find(|event| {
                event["sessionId"] == page.session
                    && event["method"] == "Network.responseReceived"
                    && event["params"]["response"]["url"] == url
            })
            .ok_or("Browser response not retained")?["params"]["requestId"]
            .clone();
        let response = self.call(
            Some(page),
            "Network.getResponseBody",
            json!({"requestId":request}),
        )?;
        let body = response["body"].as_str().ok_or("Browser response body")?;
        let bytes = if response["base64Encoded"] == true {
            base64::engine::general_purpose::STANDARD.decode(body)?
        } else {
            body.as_bytes().to_vec()
        };
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("Browser JSON response exceeded its bound".into());
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
    pub fn download(&mut self, page: &Page, button: &Locator, filename: &str) -> Result<Vec<u8>> {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let directory = self.directory.path().join("downloads");
        if !directory.exists() {
            fs::create_dir(&directory)?;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        }
        let mut params =
            json!({"behavior":"allowAndName","downloadPath":directory,"eventsEnabled":true});
        if let Some(context) = &page.context {
            params["browserContextId"] = context.clone().into();
        }
        self.call(None, "Browser.setDownloadBehavior", params)?;
        self.events.retain(|event| {
            !matches!(
                event["method"].as_str(),
                Some("Browser.downloadWillBegin" | "Browser.downloadProgress")
            )
        });
        self.click(page, button)?;
        let started = Instant::now();
        loop {
            self.evaluate(page, "0")?;
            if let Some(event) = self.events.iter().find(|event| {
                event["method"] == "Browser.downloadWillBegin"
                    && event["params"]["suggestedFilename"] == filename
            }) {
                let guid = event["params"]["guid"]
                    .as_str()
                    .ok_or("Browser download id")?;
                if guid.len() != 36 || !guid.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
                    return Err("Invalid browser download id".into());
                }
                if self.events.iter().any(|event| {
                    event["method"] == "Browser.downloadProgress"
                        && event["params"]["guid"] == guid
                        && event["params"]["state"] == "canceled"
                }) {
                    return Err("Browser artifact download was canceled".into());
                }
                if self.events.iter().any(|event| {
                    event["method"] == "Browser.downloadProgress"
                        && event["params"]["guid"] == guid
                        && event["params"]["state"] == "completed"
                }) {
                    let path = directory.join(guid);
                    let metadata = fs::symlink_metadata(&path)?;
                    if !metadata.is_file()
                        || metadata.nlink() != 1
                        || metadata.len() > 16 * 1024 * 1024
                    {
                        return Err("Invalid or unbounded browser artifact download".into());
                    }
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
                    return Ok(fs::read(path)?);
                }
            }
            if started.elapsed() > Duration::from_secs(15) {
                return Err(format!(
                    "Browser download did not complete with expected filename: {filename}"
                )
                .into());
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
    pub fn select(
        &mut self,
        page: &Page,
        locator: &Locator,
        value: Option<&str>,
        index: Option<usize>,
    ) -> Result<()> {
        let node = self.one(page, locator)?;
        let result=self.dom(page,node,"function(value,index){const option=value!==null?Array.from(this.options).find(o=>o.value===value):this.options[index];if(!option)return false;this.value=option.value;this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return true}",vec![json!({"value":value}),json!({"value":index})])?;
        if result != true {
            return Err("Native browser select option unavailable".into());
        }
        Ok(())
    }
    fn inner_text_at(&mut self, page: &Page, node: u64) -> Result<String> {
        Ok(self
            .dom(
                page,
                node,
                "function(){return this.innerText??this.textContent??''}",
                vec![],
            )?
            .as_str()
            .ok_or("Browser text value")?
            .to_owned())
    }
    pub fn text(&mut self, page: &Page, locator: &Locator) -> Result<String> {
        let node = self.one(page, locator)?;
        self.inner_text_at(page, node)
    }
    pub fn value(&mut self, page: &Page, locator: &Locator) -> Result<String> {
        let node = self.one(page, locator)?;
        Ok(self
            .dom(page, node, "function(){return this.value}", vec![])?
            .as_str()
            .ok_or("Browser input value")?
            .to_owned())
    }
    pub fn attribute(
        &mut self,
        page: &Page,
        locator: &Locator,
        name: &str,
    ) -> Result<Option<String>> {
        let node = self.attached_one(page, locator)?;
        Ok(self
            .dom(
                page,
                node,
                "function(name){return this.getAttribute(name)}",
                vec![json!({"value":name})],
            )?
            .as_str()
            .map(str::to_owned))
    }
    pub fn enabled(&mut self, page: &Page, locator: &Locator) -> Result<bool> {
        let node = self.one(page, locator)?;
        Ok(self.dom(page, node, "function(){return !this.matches(':disabled') && !this.closest('[aria-disabled=\"true\"]')}", vec![])? == true)
    }
    pub fn url(&mut self, page: &Page) -> Result<String> {
        Ok(self
            .evaluate(page, "window.location.href")?
            .as_str()
            .ok_or("Browser location")?
            .to_owned())
    }
    pub fn screenshot(&mut self, page: &Page, path: &Path) -> Result<()> {
        use base64::Engine;
        let data = self.call(
            Some(page),
            "Page.captureScreenshot",
            json!({"format":"png"}),
        )?["data"]
            .as_str()
            .ok_or("Browser screenshot")?
            .to_owned();
        fs::write(
            path,
            base64::engine::general_purpose::STANDARD.decode(data)?,
        )?;
        Ok(())
    }
    pub fn drain_events(&mut self) -> Vec<Value> {
        self.events.drain(..).collect()
    }
    pub fn profile_path(&self) -> &Path {
        self.directory.path()
    }
}

fn hash_file(path: &Path, expected: u64) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::File::open(path)?;
    if file.metadata()?.len() != expected {
        return Err("Pinned browser artifact size mismatch".into());
    }
    let mut hash = Sha256::new();
    let mut bytes = [0; 65536];
    let mut total = 0;
    loop {
        let size = file.read(&mut bytes)?;
        if size == 0 {
            break;
        }
        total += size as u64;
        if total > expected {
            return Err("Browser artifact grew while reading".into());
        }
        hash.update(&bytes[..size]);
    }
    if total != expected {
        return Err("Incomplete browser artifact".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub async fn install() -> Result<PathBuf> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    if std::env::consts::OS != "linux" || std::env::consts::ARCH != "x86_64" {
        return Err("Pinned browser installer supports Linux amd64 only".into());
    }
    let manifest = manifest()?;
    let root = root();
    let cache = root.join(".cache/native-browser");
    fs::create_dir_all(&cache)?;
    if cache.canonicalize()? != cache {
        return Err("Browser cache must be a canonical regular directory".into());
    }
    let target = cache.join(
        manifest["executable"]
            .as_str()
            .ok_or("Pinned executable path")?,
    );
    if target.exists() {
        if hash_file(
            &target,
            manifest["executableBytes"]
                .as_u64()
                .ok_or("Pinned executable size")?,
        )? != manifest["executableSha256"]
        {
            return Err("Existing browser differs from the reviewed pin".into());
        }
        return Ok(target);
    }
    let archive = cache.join(format!(
        "chrome-linux64-{}.zip",
        manifest["version"]
            .as_str()
            .ok_or("Pinned browser version")?
    ));
    let bytes = manifest["bytes"]
        .as_u64()
        .ok_or("Pinned browser archive size")?;
    if !archive.exists() {
        let url = manifest["url"].as_str().ok_or("Pinned browser URL")?;
        let parsed = url::Url::parse(url)?;
        if parsed.scheme() != "https" || parsed.host_str() != Some("storage.googleapis.com") {
            return Err("Unexpected browser distribution origin".into());
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let mut response = client.get(url).send().await?.error_for_status()?;
        let mut temporary = tempfile::NamedTempFile::new_in(&cache)?;
        let mut count = 0;
        let mut hash = Sha256::new();
        while let Some(chunk) = response.chunk().await? {
            count += chunk.len() as u64;
            if count > bytes {
                return Err("Browser archive exceeded its reviewed size".into());
            }
            temporary.write_all(&chunk)?;
            hash.update(&chunk);
        }
        if count != bytes || format!("{:x}", hash.finalize()) != manifest["sha256"] {
            return Err("Browser download does not match its reviewed checksum".into());
        }
        temporary.as_file().sync_all()?;
        temporary.persist_noclobber(&archive)?;
    }
    if hash_file(&archive, bytes)? != manifest["sha256"] {
        return Err("Browser archive differs from its reviewed checksum".into());
    }
    let environment = crate::process::local_environment();
    let listing = crate::process::capture(
        "/usr/bin/unzip",
        &["-Z1".into(), archive.as_os_str().to_owned()],
        &root,
        &environment,
        None,
        Duration::from_secs(30),
    )
    .await?;
    if !listing.success {
        return Err("Pinned browser archive cannot be inspected".into());
    }
    for name in std::str::from_utf8(&listing.stdout)?.lines() {
        if !name.starts_with("chrome-linux64/")
            || name.split('/').any(|part| part == ".." || part == ".")
            || name.contains('\\')
        {
            return Err("Unsafe browser archive member".into());
        }
    }
    let temporary = crate::process::private_directory("unpack-", &cache)?;
    let output = crate::process::capture(
        "/usr/bin/unzip",
        &[
            "-q".into(),
            archive.as_os_str().to_owned(),
            "-d".into(),
            temporary.path().as_os_str().to_owned(),
        ],
        &root,
        &environment,
        None,
        Duration::from_secs(120),
    )
    .await?;
    if !output.success
        || hash_file(
            &temporary.path().join("chrome-linux64/chrome"),
            manifest["executableBytes"].as_u64().unwrap(),
        )? != manifest["executableSha256"]
    {
        return Err("Extracted test browser does not match the reviewed pin".into());
    }
    if cache.join("chrome-linux64").exists() {
        return Err(
            "Browser destination already exists; retained files were not overwritten".into(),
        );
    }
    fs::rename(
        temporary.path().join("chrome-linux64"),
        cache.join("chrome-linux64"),
    )?;
    Ok(target)
}
pub fn protocol_smoke() -> Result<()> {
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    let html = "<html><body><article><h1>Native browser</h1><label for='value'>Value</label><input id='value'><select id='select' aria-label='Selection'><option value='one'>One</option><option value='two'>Two</option></select><details id='detail'><summary>Open detail</summary><p>Detail</p></details><fieldset disabled><button id='disabled'>Disabled action</button></fieldset><div aria-disabled='true'><button id='aria-disabled'>ARIA disabled action</button></div><section class='scope'><span class='child'>One</span></section><section class='scope'><span class='child'>Two</span></section><a download='fixture.json' href='data:application/json,%7B%22native%22%3Atrue%7D'>Export fixture</a></article></body></html>";
    let url = format!(
        "data:text/html,{}",
        url::form_urlencoded::byte_serialize(html.as_bytes())
            .collect::<String>()
            .replace('+', "%20")
    );
    browser
        .goto(&page, &url)
        .map_err(|error| format!("Browser protocol navigation: {error}"))?;
    let heading = Locator::role("heading", Some(Text::exact("Native browser")));
    browser
        .wait(&page, &heading, true)
        .map_err(|error| format!("Browser protocol heading: {error}"))?;
    browser
        .fill(&page, &Locator::label("Value"), "Việt 😀")
        .map_err(|error| format!("Browser protocol label/fill: {error}"))?;
    if browser.value(&page, &Locator::css("#value"))? != "Việt 😀" {
        return Err("Native browser input operation failed".into());
    }
    browser
        .select(&page, &Locator::label("Selection"), Some("two"), None)
        .map_err(|error| format!("Browser protocol selection: {error}"))?;
    if browser.value(&page, &Locator::css("#select"))? != "two" {
        return Err("Native browser selection operation failed".into());
    }
    if browser.count(&page, &Locator::role("article", None).having(&heading))? != 1 {
        return Err("Native browser locator scope failed".into());
    }
    browser
        .click(&page, &Locator::css("summary"))
        .map_err(|error| format!("Browser protocol click: {error}"))?;
    if browser
        .attribute(&page, &Locator::css("#detail"), "open")?
        .is_none()
    {
        return Err("Native browser trusted click did not open its disclosure".into());
    }
    if browser.enabled(&page, &Locator::css("#disabled"))?
        || browser.enabled(&page, &Locator::css("#aria-disabled"))?
        || !browser.enabled(&page, &Locator::css("#value"))?
    {
        return Err("Native browser disabled fieldset/ARIA semantics differ".into());
    }
    // Schedule a DOM-only readiness transition. The driver must wait before
    // sending its single trusted click, just as it does for a busy app button.
    browser.evaluate(
        &page,
        "setTimeout(()=>document.querySelector('fieldset').disabled=false,250);0",
    )?;
    browser.click(&page, &Locator::css("#disabled"))?;
    if browser.evaluate(&page, "document.activeElement.id")? != "disabled" {
        return Err("Native browser clicked before its fieldset became enabled".into());
    }
    let children = Locator::css(".child").within(&Locator::css(".scope"));
    if browser.count(&page, &children)? != 2
        || browser.text(&page, &children.nth(1))? != "Two"
        || browser.count(
            &page,
            &Locator::css(".child").within(&Locator::css(".absent")),
        )? != 0
    {
        return Err("Native browser multi-parent/absent scope semantics differ".into());
    }
    let artifact: Value = serde_json::from_slice(&browser.download(
        &page,
        &Locator::role("link", Some(Text::exact("Export fixture"))),
        "fixture.json",
    )?)?;
    if artifact != json!({"native":true}) {
        return Err("Native browser download differs from the selected artifact".into());
    }
    let response_url = "https://protocol.invalid/api/probe";
    browser.route_json(&page, response_url, Some(json!({"native":true})))?;
    browser.goto(&page, response_url)?;
    if browser.response_json(&page, response_url)? != json!({"native":true})
        || browser.requests_ending(&page, "/api/probe")? != 1
    {
        return Err("Native browser response inspection must not replay requests".into());
    }
    browser.goto(&page, "about:blank#done")?;
    if !browser.url(&page)?.ends_with("#done") || !browser.exceptions.is_empty() {
        return Err("Native browser navigation or exception contract failed".into());
    }
    println!(
        "PASS: pinned browser, native DevTools transport, accessibility/label/CSS locators, Unicode input, selection, scoped descendants and trusted navigation"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detached_lookup_errors_are_distinct_from_input_and_invalid_selector_failures() {
        let detached = json!({"code":-32000,"message":"Could not find node with given id"});
        assert!(protocol_error("DOM.describeNode", &detached).is::<DetachedDom>());
        assert!(!protocol_error("Input.dispatchMouseEvent", &detached).is::<DetachedDom>());
        assert!(!protocol_error("Input.dispatchKeyEvent", &detached).is::<DetachedDom>());
        assert!(
            !protocol_error(
                "DOM.querySelectorAll",
                &json!({"code":-32000,"message":"DOM Error while querying"})
            )
            .is::<DetachedDom>()
        );
        assert!(
            !protocol_error(
                "DOM.describeNode",
                &json!({"code":-32602,"message":"Invalid parameters"})
            )
            .is::<DetachedDom>()
        );
    }
    #[test]
    fn locator_text_normalizes_layout_whitespace_without_changing_names() {
        assert!(Text::exact("Tiếng Việt 😀").matches(" Tiếng\n Việt 😀 "));
        assert!(!Text::exact("APP").matches("APP2"));
        assert!(Text::regex("^APP[0-9]+$").matches("APP12"));
    }
}
