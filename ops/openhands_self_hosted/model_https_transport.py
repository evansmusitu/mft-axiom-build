"""Fixed-origin HTTPS provider transport for a separate restricted broker process.

Neither this module nor its tests grant any external-data-egress authority.
Run only after independent gateway admission; no redirects or arbitrary URLs.
"""
import http.client
import json


class ProviderTransportRejected(RuntimeError):
    """Sanitized model transport failure, never carries a credential."""


_ORIGIN = 'api.openai.com'
_PATH = '/v1/chat/completions'
_MAX_PROVIDER_BYTES = 1024 * 1024
_MAX_REQUEST_BYTES = 32768


def fixed_openai_transport(origin, path, credential, body, timeout_seconds,
                           *, connection_factory=http.client.HTTPSConnection):
    if type(origin) is not str or origin != _ORIGIN:
        raise ProviderTransportRejected('model upstream origin outside hard-coded allowlist')
    if type(path) is not str or path != _PATH:
        raise ProviderTransportRejected('model upstream route outside hard-coded allowlist')
    if (type(credential) is not str or not credential.strip() or
            '\r' in credential or '\n' in credential or
            any(ord(char) < 32 for char in credential)):
        raise ProviderTransportRejected('model broker provider credential unavailable')
    if type(timeout_seconds) not in (int, float) or not 1 <= timeout_seconds <= 30:
        raise ProviderTransportRejected('model broker transport timeout invalid')
    if (type(body) is not dict or
            set(body) != {'model','messages','max_completion_tokens','stream'} or
            body.get('stream') is not False):
        raise ProviderTransportRejected('model transport payload is not gated')
    try:
        encoded=json.dumps(body, separators=(',',':'), ensure_ascii=True,
                           allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, OverflowError):
        raise ProviderTransportRejected('model transport body serialization rejected') from None
    if len(encoded)>_MAX_REQUEST_BYTES:
        raise ProviderTransportRejected('model request exceeds maximum bytes')
    connection=None
    try:
        # Standard HTTPSConnection always verifies TLS certificates by default.
        # The connection factory is injectable only in offline unit tests.
        connection=connection_factory(_ORIGIN, timeout=timeout_seconds)
        connection.request('POST', _PATH, encoded, {
            'Authorization':'Bearer '+credential,
            'Content-Type':'application/json',
            'Accept':'application/json',
            'Connection':'close',
            'User-Agent':'MUSITU-Axiom-Broker-Restricted/1.0',
        })
        response=connection.getresponse()
        # No redirect handling: only HTTP 200 with JSON payload is accepted.
        if response.status != 200:
            raise ProviderTransportRejected('model provider returned non-success HTTP status')
        if 'application/json' not in (response.getheader('Content-Type','application/json') if hasattr(response,'getheader') else 'application/json'):
            raise ProviderTransportRejected('model provider returned non-JSON content-type')
        data=response.read(_MAX_PROVIDER_BYTES+1)
        if len(data)>_MAX_PROVIDER_BYTES or credential.encode('utf-8') in data:
            raise ProviderTransportRejected('model provider response safety check rejected')
        try:
            decoded=json.loads(data)
        except (ValueError, UnicodeDecodeError):
            raise ProviderTransportRejected('model provider response is not JSON') from None
        if type(decoded) is not dict or type(decoded.get('choices')) is not list:
            raise ProviderTransportRejected('model provider reply shape invalid')
        return decoded
    except ProviderTransportRejected:
        raise
    except Exception:
        raise ProviderTransportRejected('model provider HTTPS request failed') from None
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
