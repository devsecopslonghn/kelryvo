//! Real TLS and LDAP BER exchange on a private ephemeral loopback port. The
//! application entry point remains fixed to operator-allowlisted LDAPS/636.
use super::*;
use openssl::{
    asn1::Asn1Time,
    bn::BigNum,
    hash::MessageDigest,
    pkey::PKey,
    rsa::Rsa,
    ssl::{SslAcceptor, SslMethod},
    x509::{
        X509, X509NameBuilder,
        extension::{BasicConstraints, SubjectAlternativeName},
    },
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};

const SERVICE_DN: &str = "cn=reader,dc=kelryvo,dc=test";
const USER_DN: &str = "uid=person,ou=people,dc=kelryvo,dc=test";
const BASE_DN: &str = "ou=people,dc=kelryvo,dc=test";

#[derive(Debug)]
enum Event {
    Bind {
        connection: usize,
        dn: String,
        password: String,
    },
    Search {
        connection: usize,
        base: String,
        scope: u8,
        filter: Vec<u8>,
    },
}
struct Fixture {
    port: u16,
    ca: String,
    events: Arc<Mutex<Vec<Event>>>,
    stop: Arc<AtomicBool>,
    task: Option<thread::JoinHandle<()>>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.task.take().unwrap().join().unwrap();
    }
}

fn tlv(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    if value.len() < 128 {
        out.push(value.len() as u8);
    } else {
        assert!(value.len() <= u16::MAX as usize);
        out.extend_from_slice(&[0x82, (value.len() >> 8) as u8, value.len() as u8]);
    }
    out.extend_from_slice(value);
    out
}
fn fields(tag: u8, values: &[Vec<u8>]) -> Vec<u8> {
    tlv(tag, &values.concat())
}
fn string(value: &str) -> Vec<u8> {
    tlv(4, value.as_bytes())
}
fn take<'a>(input: &mut &'a [u8]) -> (u8, &'a [u8]) {
    assert!(input.len() >= 2);
    let tag = input[0];
    let first = input[1];
    *input = &input[2..];
    let count = usize::from(first & 0x7f);
    let length = if first & 0x80 == 0 {
        count
    } else {
        assert!((1..=2).contains(&count));
        assert!(input.len() >= count);
        let n = input[..count]
            .iter()
            .fold(0, |n, b| (n << 8) | usize::from(*b));
        *input = &input[count..];
        n
    };
    assert!(input.len() >= length);
    let (value, rest) = input.split_at(length);
    *input = rest;
    (tag, value)
}
fn text_field(input: &mut &[u8], tag: u8) -> String {
    let (actual, value) = take(input);
    assert_eq!(actual, tag);
    String::from_utf8(value.to_vec()).unwrap()
}
fn packet(stream: &mut impl Read) -> std::io::Result<Vec<u8>> {
    let mut header = [0; 2];
    stream.read_exact(&mut header)?;
    assert_eq!(header[0], 0x30);
    let mut length = usize::from(header[1] & 0x7f);
    if header[1] & 0x80 != 0 {
        assert!((1..=2).contains(&length));
        let mut bytes = vec![0; length];
        stream.read_exact(&mut bytes)?;
        length = bytes.into_iter().fold(0, |n, b| (n << 8) | usize::from(b));
    }
    assert!(length <= 16384);
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes)?;
    Ok(bytes)
}
fn send(stream: &mut impl Write, id: &[u8], operation: Vec<u8>) {
    stream
        .write_all(&fields(0x30, &[tlv(2, id), operation]))
        .unwrap();
    stream.flush().unwrap();
}
fn result(tag: u8, code: u8) -> Vec<u8> {
    fields(tag, &[tlv(0x0a, &[code]), string(""), string("")])
}
fn entry(subject: Option<&[u8]>, display: Option<&str>) -> Vec<u8> {
    let mut attributes = vec![];
    if let Some(subject) = subject {
        attributes.push(fields(
            0x30,
            &[string("ENTRYuuid"), tlv(0x31, &tlv(4, subject))],
        ));
    }
    if let Some(display) = display {
        attributes.push(fields(
            0x30,
            &[string("DISPLAYname"), tlv(0x31, &string(display))],
        ));
    }
    fields(0x64, &[string(USER_DN), fields(0x30, &attributes)])
}

fn certificate() -> (SslAcceptor, String) {
    let key = PKey::from_rsa(Rsa::generate(2048).unwrap()).unwrap();
    let mut name = X509NameBuilder::new().unwrap();
    name.append_entry_by_text("CN", "directory.kelryvo.test")
        .unwrap();
    let name = name.build();
    let mut cert = X509::builder().unwrap();
    cert.set_version(2).unwrap();
    cert.set_serial_number(&BigNum::from_u32(1).unwrap().to_asn1_integer().unwrap())
        .unwrap();
    cert.set_subject_name(&name).unwrap();
    cert.set_issuer_name(&name).unwrap();
    cert.set_pubkey(&key).unwrap();
    cert.set_not_before(&Asn1Time::days_from_now(0).unwrap())
        .unwrap();
    cert.set_not_after(&Asn1Time::days_from_now(1).unwrap())
        .unwrap();
    cert.append_extension(BasicConstraints::new().critical().ca().build().unwrap())
        .unwrap();
    let alt = SubjectAlternativeName::new()
        .dns("directory.kelryvo.test")
        .build(&cert.x509v3_context(None, None))
        .unwrap();
    cert.append_extension(alt).unwrap();
    cert.sign(&key, MessageDigest::sha256()).unwrap();
    let cert = cert.build();
    let ca = String::from_utf8(cert.to_pem().unwrap()).unwrap();
    let mut acceptor = SslAcceptor::mozilla_intermediate(SslMethod::tls_server()).unwrap();
    acceptor.set_certificate(&cert).unwrap();
    acceptor.set_private_key(&key).unwrap();
    (acceptor.build(), ca)
}
impl Fixture {
    fn new() -> Self {
        let (acceptor, ca) = certificate();
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(vec![]));
        let (thread_stop, thread_events) = (stop.clone(), events.clone());
        let task = thread::spawn(move || {
            let mut clients = vec![];
            while !thread_stop.load(Ordering::SeqCst) {
                let (stream, _) = match listener.accept() {
                    Ok(stream) => stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(e) => panic!("private LDAP listener: {e}"),
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let events = thread_events.clone();
                let acceptor = acceptor.clone();
                let connection = clients.len();
                clients.push(thread::spawn(move || {
                    let Ok(mut stream) = acceptor.accept(stream) else {
                        return;
                    };
                    while let Ok(bytes) = packet(&mut stream) {
                        let mut bytes = bytes.as_slice();
                        let (tag, id) = take(&mut bytes);
                        assert_eq!(tag, 2);
                        let (tag, mut operation) = take(&mut bytes);
                        assert!(bytes.is_empty());
                        match tag {
                            0x60 => {
                                assert_eq!(take(&mut operation), (2, &[3][..]));
                                let dn = text_field(&mut operation, 4);
                                let password = text_field(&mut operation, 0x80);
                                let valid = (dn == SERVICE_DN
                                    && password == "service-fixture-secret")
                                    || (dn == USER_DN && password == "user-fixture-secret");
                                events.lock().unwrap().push(Event::Bind {
                                    connection,
                                    dn,
                                    password,
                                });
                                send(&mut stream, id, result(0x61, if valid { 0 } else { 49 }));
                            }
                            0x63 => {
                                let base = text_field(&mut operation, 4);
                                let (tag, scope) = take(&mut operation);
                                assert_eq!(tag, 0x0a);
                                let scope = scope[0];
                                for tag in [0x0a, 2, 2, 1] {
                                    assert_eq!(take(&mut operation).0, tag);
                                }
                                let (filter_tag, filter) = take(&mut operation);
                                let filter = tlv(filter_tag, filter);
                                events.lock().unwrap().push(Event::Search {
                                    connection,
                                    base,
                                    scope,
                                    filter: filter.clone(),
                                });
                                if scope == 0 {
                                    send(&mut stream, id, entry(None, None));
                                } else {
                                    let mut filter_parts = &filter[2..];
                                    assert_eq!(text_field(&mut filter_parts, 4), "uid");
                                    let username = text_field(&mut filter_parts, 4);
                                    if username != "absent" {
                                        let subject = if username == "missing-subject" {
                                            None
                                        } else if username == "binary" {
                                            Some(&b"\xff\0\x80"[..])
                                        } else {
                                            Some(&b"immutable-subject"[..])
                                        };
                                        let display =
                                            (username != "no-display").then_some("Native person");
                                        send(&mut stream, id, entry(subject, display));
                                        if username == "duplicate" {
                                            send(&mut stream, id, entry(subject, display));
                                        }
                                    }
                                }
                                send(&mut stream, id, result(0x65, 0));
                            }
                            0x42 => break,
                            _ => panic!("unexpected LDAP request tag {tag}"),
                        }
                    }
                }));
            }
            for client in clients {
                client.join().unwrap();
            }
        });
        Self {
            port,
            ca,
            events,
            stop,
            task: Some(task),
        }
    }
    fn runtime(&self, host: &str, ca: &str) -> Arc<Runtime> {
        Arc::new(Runtime::parse(&serde_json::to_vec(&json!({
            "format":1,"publicOrigin":"https://app.kelryvo.test","key":"1".repeat(64),
            "routes":[{"id":"directory","kind":"LDAP","host":host,"transport":"LDAPS","port":636,
                "pinnedIPs":["127.0.0.1"],"baseDNs":[BASE_DN],"bindDNs":[SERVICE_DN],
                "secretRefs":["ldap-secret"],"ca":ca}],
            "secrets":{"ldap-secret":"service-fixture-secret"}
        })).unwrap()).unwrap())
    }
}
fn provider() -> Value {
    json!({"routeId":"directory","baseDN":BASE_DN,"bindDN":SERVICE_DN,
        "bindSecretRef":"ldap-secret","loginAttribute":"uid","subjectAttribute":"entryUUID"})
}

#[tokio::test]
async fn ldaps_wire_keeps_service_and_user_credentials_on_separate_verified_connections() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime("directory.kelryvo.test", &fixture.ca);
    let c = provider();
    let username = "x*)(uid=*)";
    let result = ldap_exchange(
        runtime.clone(),
        &c,
        Some(username),
        Some("user-fixture-secret"),
        fixture.port,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        result,
        json!({"subject":"immutable-subject","displayName":"Native person"})
    );
    {
        let events = fixture.events.lock().unwrap();
        assert_eq!(
            events.len(),
            3,
            "one service bind/search and one independent user bind"
        );
        let Event::Bind {
            connection: service,
            dn,
            password,
        } = &events[0]
        else {
            panic!("service bind")
        };
        assert_eq!(dn, SERVICE_DN);
        assert_eq!(password, "service-fixture-secret");
        let Event::Search {
            connection,
            base,
            scope,
            filter,
        } = &events[1]
        else {
            panic!("service search")
        };
        assert_eq!(connection, service);
        assert_eq!(base, BASE_DN);
        assert_eq!(*scope, 2);
        assert_eq!(
            *filter,
            fields(0xa3, &[string("uid"), string(username)]),
            "username remains one literal equality assertion"
        );
        let Event::Bind {
            connection,
            dn,
            password,
        } = &events[2]
        else {
            panic!("user bind")
        };
        assert_ne!(connection, service);
        assert_eq!(dn, USER_DN);
        assert_eq!(password, "user-fixture-secret");
    }
    assert!(
        ldap_exchange(
            runtime.clone(),
            &c,
            Some("person"),
            Some("incorrect"),
            fixture.port
        )
        .await
        .unwrap()
        .is_none()
    );
    for username in ["absent", "duplicate", "missing-subject"] {
        let before = fixture.events.lock().unwrap().len();
        assert!(
            ldap_exchange(
                runtime.clone(),
                &c,
                Some(username),
                Some("user-fixture-secret"),
                fixture.port
            )
            .await
            .unwrap()
            .is_none()
        );
        assert_eq!(
            fixture.events.lock().unwrap().len(),
            before + 2,
            "unresolved identity never binds a user"
        );
    }
    let missing_display =
        ldap_exchange(runtime.clone(), &c, Some("no-display"), None, fixture.port)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(
        missing_display,
        json!({"subject":"immutable-subject","displayName":null})
    );
    assert_eq!(
        super::super::lookup_projection(missing_display),
        json!({"subject":"immutable-subject","displayName":""}),
        "public lookup preserves the retained API projection of an absent display name"
    );
    assert_eq!(
        ldap_exchange(runtime.clone(), &c, Some("binary"), None, fixture.port)
            .await
            .unwrap()
            .unwrap()["subject"],
        "_wCA"
    );
    assert!(
        ldap_exchange(runtime, &c, None, None, fixture.port)
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn ldaps_wire_rejects_untrusted_certificates_names_and_provider_authority() {
    let fixture = Fixture::new();
    let c = provider();
    let wrong_host = fixture.runtime("wrong.kelryvo.test", &fixture.ca);
    assert!(
        ldap_exchange(wrong_host, &c, Some("person"), None, fixture.port)
            .await
            .is_err()
    );
    let (_, wrong_ca) = certificate();
    let wrong_ca = fixture.runtime("directory.kelryvo.test", &wrong_ca);
    assert!(
        ldap_exchange(wrong_ca, &c, Some("person"), None, fixture.port)
            .await
            .is_err()
    );
    assert!(
        fixture.events.lock().unwrap().is_empty(),
        "unverified TLS never sends credentials"
    );
    let runtime = fixture.runtime("directory.kelryvo.test", &fixture.ca);
    for field in [
        "routeId",
        "baseDN",
        "bindDN",
        "bindSecretRef",
        "subjectAttribute",
    ] {
        let mut denied = c.clone();
        denied[field] = json!("outside-operator-allowlist");
        assert!(
            ldap_exchange(runtime.clone(), &denied, Some("person"), None, fixture.port)
                .await
                .is_err()
        );
    }
    assert!(
        fixture.events.lock().unwrap().is_empty(),
        "provider metadata cannot expand operator authority"
    );
}
