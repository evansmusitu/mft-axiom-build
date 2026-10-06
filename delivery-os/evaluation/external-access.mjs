const ONFLEET_AUTH_TEST_URL = 'https://onfleet.com/api/v2/auth/test';

function report(provider, ready, blockedBy, extra = {}) {
  return {
    schema: 'musitu-delivery-benchmark-access.v1',
    provider,
    ready,
    blocked_by: blockedBy,
    ...extra,
  };
}

export async function probeOnfleetAccess({ apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    return report('onfleet', false, ['ONFLEET_TEST_API_KEY_REQUIRED'], {
      auth_mode: 'basic_api_key',
      endpoint: ONFLEET_AUTH_TEST_URL,
    });
  }

  try {
    const response = await fetchImpl(ONFLEET_AUTH_TEST_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      },
    });
    return report(
      'onfleet',
      response.ok === true,
      response.ok === true ? [] : ['ONFLEET_AUTH_TEST_FAILED'],
      {
        auth_mode: 'basic_api_key',
        endpoint: ONFLEET_AUTH_TEST_URL,
        http_status: Number.isInteger(response.status) ? response.status : null,
      },
    );
  } catch {
    return report('onfleet', false, ['ONFLEET_AUTH_TEST_UNREACHABLE'], {
      auth_mode: 'basic_api_key',
      endpoint: ONFLEET_AUTH_TEST_URL,
      http_status: null,
    });
  }
}

export async function probeBringgAccess({
  tokenUrl,
  clientId,
  clientSecret,
  fetchImpl = fetch,
} = {}) {
  const blockedBy = [];
  if (!tokenUrl) blockedBy.push('BRINGG_SANDBOX_TOKEN_URL_REQUIRED');
  if (!clientId) blockedBy.push('BRINGG_SANDBOX_CLIENT_ID_REQUIRED');
  if (!clientSecret) blockedBy.push('BRINGG_SANDBOX_CLIENT_SECRET_REQUIRED');
  if (blockedBy.length) {
    return report('bringg', false, blockedBy, {
      auth_mode: 'oauth2_client_credentials',
      endpoint: tokenUrl || null,
    });
  }

  const body = new FormData();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  try {
    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      return report('bringg', false, ['BRINGG_TOKEN_REQUEST_FAILED'], {
        auth_mode: 'oauth2_client_credentials',
        endpoint: tokenUrl,
        http_status: Number.isInteger(response.status) ? response.status : null,
      });
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      return report('bringg', false, ['BRINGG_TOKEN_RESPONSE_INVALID_JSON'], {
        auth_mode: 'oauth2_client_credentials',
        endpoint: tokenUrl,
        http_status: Number.isInteger(response.status) ? response.status : null,
      });
    }

    if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) {
      return report('bringg', false, ['BRINGG_ACCESS_TOKEN_NOT_RETURNED'], {
        auth_mode: 'oauth2_client_credentials',
        endpoint: tokenUrl,
        http_status: Number.isInteger(response.status) ? response.status : null,
      });
    }

    return report('bringg', true, [], {
      auth_mode: 'oauth2_client_credentials',
      endpoint: tokenUrl,
      http_status: Number.isInteger(response.status) ? response.status : null,
      token_type: typeof payload.token_type === 'string' ? payload.token_type : null,
      expires_in: Number.isFinite(payload.expires_in) ? payload.expires_in : null,
    });
  } catch {
    return report('bringg', false, ['BRINGG_TOKEN_ENDPOINT_UNREACHABLE'], {
      auth_mode: 'oauth2_client_credentials',
      endpoint: tokenUrl,
      http_status: null,
    });
  }
}
