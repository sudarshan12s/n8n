The reviewer's feedback is spot-on: exposing an unvalidated `serviceEndpoint` creates a severe **Server-Side Request Forgery (SSRF) and Credential Leakage risk**.

Because the OCI SDK automatically attaches HTTP signatures containing authorization material, API keys, or tenancy identifiers to outgoing requests, allowing arbitrary endpoints means an attacker could point the client to a server they control and capture these signed request headers.

---

### Recommended Remediation Steps

#### 1. Implement Strict Hostname and Protocol Validation

Use a helper function to validate that the endpoint is strictly HTTPS and matches legitimate Oracle Cloud domains (including government/sovereign cloud realms if supported).

```typescript
import { NodeOperationError } from 'n8n-workflow';

export function validateOciEndpoint(endpoint?: string): string | undefined {
  if (!endpoint || !endpoint.trim()) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new NodeOperationError(
      undefined,
      `Invalid URL format provided for service endpoint: "${endpoint}"`,
    );
  }

  if (url.protocol !== 'https:') {
    throw new NodeOperationError(
      undefined,
      'OCI service endpoint must use HTTPS',
    );
  }

  // Allow standard OCI realms (commercial, gov, and sovereign realms)
  const allowedHostPatterns = [
    /^([a-z0-9-]+\.)*oci\.oraclecloud\.com$/i,
    /^([a-z0-9-]+\.)*oci\.oraclecloud2\.com$/i, // Gov realm
    /^([a-z0-9-]+\.)*oci\.oraclecloud3\.com$/i, // FedRAMP realm
    /^([a-z0-9-]+\.)*oci\.oraclecloud4\.com$/i, // Dedicated/EU Sovereign
  ];

  const isAllowed = allowedHostPatterns.some((pattern) => pattern.test(url.hostname));

  if (!isAllowed) {
    throw new NodeOperationError(
      undefined,
      `Unsupported OCI service endpoint domain: "${url.hostname}". Only trusted Oracle Cloud domains are allowed.`,
    );
  }

  return url.toString();
}

```

---

#### 2. Update `createOciGenAiClient`

Wrap the endpoint assignment in the validator before setting `client.endpoint`:

```typescript
export async function createOciGenAiClient(
  credentials: OciGenAiCredentials,
): Promise<genaiInference.GenerativeAiInferenceClient> {
  const authenticationDetailsProvider = await getAuthenticationDetailsProvider(credentials);
  const client = new genaiInference.GenerativeAiInferenceClient({ authenticationDetailsProvider });

  if (credentials.regionId) {
    client.region = common.Region.fromRegionId(credentials.regionId.trim());
  }

  const validatedEndpoint = validateOciEndpoint(credentials.serviceEndpoint);
  if (validatedEndpoint) {
    client.endpoint = validatedEndpoint;
  }

  return client;
}

```

---

### Alternative: Remove `serviceEndpoint` Entirely

If custom private endpoints are not strictly required for this PR's initial release, the safest approach is to remove `serviceEndpoint` altogether and let the SDK resolve endpoints automatically via `regionId`:

```typescript
if (credentials.regionId) {
  client.region = common.Region.fromRegionId(credentials.regionId.trim());
}

```

This completely eliminates SSRF and signed-request exfiltration vectors via user-controlled endpoint configuration.








nstance Principal / Resource Principal should not be offered blindly

The UI currently supports all four authentication types.

That's good from a capability perspective, but:

Instance Principal
Resource Principal

implicitly depend on the n8n runtime environment.

For example, an n8n worker running in OCI may legitimately have an instance/resource identity. In another environment it won't.

More importantly, if users are allowed to create workflows that use that identity, the workflow itself becomes a mechanism to exercise that OCI principal.

So for enterprise n8n I would strongly consider making these authentication methods an administrator-controlled capability rather than assuming all four are safe for every user.




