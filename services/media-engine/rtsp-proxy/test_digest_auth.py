"""Unit tests for the RTSP proxy upstream Digest auth helpers."""

import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from proxy import (  # noqa: E402
    build_digest_authorization,
    extract_digest_challenge,
    inject_authorization,
    parse_digest_challenge,
)


def _md5(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def test_parse_digest_challenge():
    challenge = parse_digest_challenge('realm="Cam", nonce="abc123", qop="auth", opaque="op"')
    assert challenge["realm"] == "Cam"
    assert challenge["nonce"] == "abc123"
    assert challenge["qop"] == "auth"
    assert challenge["opaque"] == "op"


def test_build_digest_authorization_md5():
    challenge = {"realm": "Cam", "nonce": "abc123", "qop": "auth"}
    auth = build_digest_authorization(
        "DESCRIBE", "rtsp://camera/cam1", "admin", "secret", challenge, 1, cnonce="deadbeef"
    )
    ha1 = _md5("admin:Cam:secret")
    ha2 = _md5("DESCRIBE:rtsp://camera/cam1")
    expected = _md5(f"{ha1}:abc123:00000001:deadbeef:auth:{ha2}")
    assert f'response="{expected}"' in auth
    assert "nc=00000001" in auth
    assert "qop=auth" in auth
    assert 'username="admin"' in auth


def test_build_digest_authorization_without_qop():
    challenge = {"realm": "Cam", "nonce": "n"}
    auth = build_digest_authorization("OPTIONS", "rtsp://c/cam1", "u", "p", challenge, 1)
    ha1 = _md5("u:Cam:p")
    ha2 = _md5("OPTIONS:rtsp://c/cam1")
    expected = _md5(f"{ha1}:n:{ha2}")
    assert f'response="{expected}"' in auth


def test_extract_digest_challenge_from_401():
    response = (
        b"RTSP/1.0 401 Unauthorized\r\n"
        b"CSeq: 1\r\n"
        b'WWW-Authenticate: Digest realm="Cam", nonce="n1", qop="auth"\r\n\r\n'
    )
    challenge = extract_digest_challenge(response)
    assert challenge is not None
    assert challenge["nonce"] == "n1"


def test_inject_authorization_replaces_existing():
    message = b"DESCRIBE rtsp://c/cam1 RTSP/1.0\r\nCSeq: 1\r\nAuthorization: Basic old\r\n\r\n"
    out = inject_authorization(message, "Digest new")
    assert b"Authorization: Basic old" not in out
    assert b"Authorization: Digest new" in out
    assert out.endswith(b"\r\n\r\n")
