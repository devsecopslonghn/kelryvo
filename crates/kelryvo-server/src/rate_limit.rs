//! Fixed-window quotas match the retained HTTP boundary, before authentication.
//! Only actual socket peers supply client identity; forwarded headers are ignored.
use crate::{ApiError, AppState};
use axum::{
    extract::{ConnectInfo, MatchedPath, Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{
    collections::{BTreeMap, HashMap},
    net::{IpAddr, Ipv6Addr, SocketAddr},
    time::{Duration, Instant},
};

pub(crate) const HEADERS: [&str; 4] = [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "retry-after",
];
const WINDOW: Duration = Duration::from_secs(60);
const CAPACITY: usize = 5000;

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
pub(crate) enum Scope {
    Api,
    Readiness,
    Setup,
    PasswordChange,
    ProviderTest,
    ProviderLookup,
    Ldap,
    OidcStart,
    OidcCallback,
    Session,
}
type Client = (IpAddr, bool);
pub(crate) type Quotas = HashMap<Scope, Cache>;
struct Counter {
    start: Instant,
    count: u64,
    access: u64,
}
#[derive(Default)]
pub(crate) struct Cache {
    clients: HashMap<Client, Counter>,
    accesses: BTreeMap<u64, Client>,
    sequence: u64,
}
pub(crate) struct Budget {
    maximum: u32,
    remaining: u32,
    reset: u64,
    exceeded: bool,
}
impl Cache {
    fn consume(
        &mut self,
        client: Client,
        maximum: u32,
        now: Instant,
        capacity: usize,
    ) -> Option<Budget> {
        // Preserve bounded LRU behavior independently for each configured route
        // store. Touching another client cannot extend an existing fixed window.
        self.sequence = self.sequence.checked_add(1)?;
        if !self.clients.contains_key(&client) && self.clients.len() >= capacity {
            let (_, oldest) = self.accesses.pop_first()?;
            self.clients.remove(&oldest);
        }
        let counter = self.clients.entry(client).or_insert(Counter {
            start: now,
            count: 0,
            access: self.sequence,
        });
        self.accesses.remove(&counter.access);
        if now.duration_since(counter.start) >= WINDOW {
            counter.start = now;
            counter.count = 0;
        }
        counter.count = counter.count.saturating_add(1);
        counter.access = self.sequence;
        self.accesses.insert(counter.access, client);
        let ttl = WINDOW.saturating_sub(now.duration_since(counter.start));
        Some(Budget {
            maximum,
            remaining: if counter.count >= u64::from(maximum) {
                0
            } else {
                maximum - counter.count as u32
            },
            reset: ttl.as_secs() + u64::from(ttl.subsec_nanos() != 0),
            exceeded: counter.count > u64::from(maximum),
        })
    }
}
pub(crate) fn normalized(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(ip) => ip.to_ipv4_mapped().map(IpAddr::V4).unwrap_or_else(|| {
            let mut octets = ip.octets();
            octets[8..].fill(0);
            IpAddr::V6(Ipv6Addr::from(octets))
        }),
        ip => ip,
    }
}
pub(crate) fn peer(request: &Request) -> IpAddr {
    normalized(
        request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|v| v.0.ip())
            .unwrap_or(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
    )
}
pub(crate) fn consume(
    state: &AppState,
    ip: IpAddr,
    scope: Scope,
    password: bool,
    maximum: u32,
) -> Result<Budget, ApiError> {
    state
        .quota
        .lock()
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "UNAVAILABLE"))?
        .entry(scope)
        .or_default()
        .consume(
            (normalized(ip), password),
            maximum,
            Instant::now(),
            CAPACITY,
        )
        .ok_or(ApiError(StatusCode::SERVICE_UNAVAILABLE, "UNAVAILABLE"))
}
impl Budget {
    pub(crate) fn blocked(&self) -> Option<Response> {
        self.exceeded.then(|| {
            self.apply(ApiError(StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED").into_response())
        })
    }
    pub(crate) fn apply(&self, mut response: Response) -> Response {
        let headers = response.headers_mut();
        for (name, value) in [
            (HEADERS[0], u64::from(self.maximum)),
            (HEADERS[1], u64::from(self.remaining)),
            (HEADERS[2], self.reset),
        ] {
            headers.insert(
                name,
                HeaderValue::from_str(&value.to_string()).expect("numeric quota header"),
            );
        }
        if self.exceeded {
            headers.insert(
                HEADERS[3],
                HeaderValue::from_str(&self.reset.to_string()).expect("numeric retry header"),
            );
        }
        response
    }
}
pub(crate) async fn limit(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str);
    let method = request.method();
    let Some(route) = route.filter(|route| route.starts_with("/api/")) else {
        return next.run(request).await;
    };
    if route == "/api/livez" || route == "/api/session" && method == Method::POST {
        // Session POST has the retained preHandler quota: JSON syntax must be
        // accepted before password/token budgets are selected in auth::login.
        return next.run(request).await;
    }
    let (scope, maximum) = match route {
        "/api/readyz" => (Scope::Readiness, 120),
        "/api/auth/setup" if method == Method::POST => (Scope::Setup, 10),
        "/api/account/password" if method == Method::POST => (Scope::PasswordChange, 5),
        "/api/identity/providers/{provider}/test" if method == Method::POST => {
            (Scope::ProviderTest, 10)
        }
        "/api/identity/providers/{provider}/lookup" if method == Method::POST => {
            (Scope::ProviderLookup, 10)
        }
        "/api/auth/ldap/{provider}/session" if method == Method::POST => (Scope::Ldap, 20),
        "/api/auth/oidc/{provider}/start" if method == Method::POST => (Scope::OidcStart, 20),
        "/api/auth/oidc/callback" => (Scope::OidcCallback, 20),
        _ => (Scope::Api, 600),
    };
    let budget = match consume(&state, peer(&request), scope, false, maximum) {
        Ok(budget) => budget,
        Err(error) => return error.into_response(),
    };
    if let Some(response) = budget.blocked() {
        response
    } else {
        budget.apply(next.run(request).await)
    }
}

#[cfg(test)]
mod tests;
